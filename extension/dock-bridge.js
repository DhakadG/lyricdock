// LyricDock bridge (Spicetify extension). Pushes the playing track, lyrics, position, liked state and audio
// quality to the LyricDock phone app, preloads the next track, stores the phone's settings/presets, and takes
// playback commands back.
//
// Transport: always ws://127.0.0.1:8975. Chromium refuses ws:// from Spotify's https page to a LAN address, so
// the phone is reached through adb's port forward - over USB, or wireless adb when the cable is out
// (scripts/link.ps1 switches between them).
(function dockBridge() {
  if (!Spicetify?.Player?.addEventListener || !Spicetify.CosmosAsync || !Spicetify.Platform || !Spicetify.LocalStorage)
    return setTimeout(dockBridge, 300);
  if (window.__lyricdockRunning) return; // loader + a -Dev copy both installed: run once
  window.__lyricdockRunning = true;
  const VERSION = window.__lyricdock?.version ?? 'dev'; // set by the auto-updating loader (lyricdock.js)

  const URL_ = 'ws://127.0.0.1:8975';
  const P = Spicetify.Player, LS = Spicetify.LocalStorage;
  let ws = null, track = null, preload = null, busy = false, lastRx = 0;
  let last = { pos: 0, at: 0, playing: false };

  const send = o => ws?.readyState === 1 && ws.send(JSON.stringify(o));
  const safe = (f, d) => { try { return f(); } catch { return d; } }; // getProgress throws before anything loads
  const sleep = t => new Promise(r => setTimeout(r, t));
  const readJson = (k, d) => safe(() => JSON.parse(LS.get(k)) ?? d, d);

  // ---- audio quality, best effort across Spotify client versions
  const QUALITY = { lossless: 'Lossless', hifi: 'Lossless', very_high: 'Very high', veryhigh: 'Very high', high: 'High', normal: 'Normal', low: 'Low' };
  function quality() {
    const st = safe(() => Spicetify.Platform.PlayerAPI._state, null);
    for (const q of [P.data?.playbackQuality, st?.playbackQuality, P.data?.playback_quality]) {
      const v = typeof q === 'string' ? q : q?.bitrateLevel ?? q?.level ?? q?.hifiStatus;
      if (v != null && v !== '') return QUALITY[String(v).toLowerCase()] ?? String(v).replace(/_/g, ' ').toLowerCase();
    }
    return '';
  }

  function beat() {
    const pos = safe(() => P.getProgress(), 0), playing = safe(() => P.isPlaying(), false);
    last = { pos, at: Date.now(), playing };
    send({ type: 'pos', pos, playing, dur: safe(() => P.getDuration(), 0), liked: safe(() => P.getHeart(), undefined), quality: quality(), via: ws?.kind,
      volume: safe(() => Math.round(P.getVolume() * 100), undefined) });
  }

  // ---- link. The phone sends {type:'alive'} every second; an adb-forwarded socket can look open after the
  // phone end died (cable pulled, app restarted), so 2.5s of silence means dead: drop it and reconnect.
  const tryOpen = ms => new Promise(res => {
    const s = new WebSocket(URL_);
    const t = setTimeout(() => { s.onopen = null; s.close(); res(null); }, ms);
    s.onopen = () => { clearTimeout(t); res(s); };
    s.onerror = () => { clearTimeout(t); res(null); };
  });

  function drop() { const dead = ws; ws = null; if (dead) { dead.onclose = null; dead.close(); } }

  // Connection feedback: a dot on the top-bar button, and a notice only when the state has held for 3s
  // (a USB <-> Wi-Fi handoff shouldn't pop two toasts).
  let shown = null, pendingState = null, pendingSince = 0;
  function linkState() {
    const on = ws?.readyState === 1;
    document.querySelector('.ld-topbar')?.classList.toggle('ld-on', on);
    if (on !== pendingState) { pendingState = on; pendingSince = Date.now(); }
    if (on !== shown && Date.now() - pendingSince > 3000) {
      if (shown !== null) safe(() => Spicetify.showNotification(on ? 'LyricDock connected' : 'LyricDock disconnected'));
      shown = on;
      renderPanel();
    }
  }

  // ---- no-adb link: WebRTC data channel straight to the phone (Wi-Fi, or USB tethering). WebRTC isn't blocked
  // the way ws:// to a LAN address is. The offer/answer swap goes through ntfy.sh as a dumb mailbox; topic and
  // AES-GCM key come from the phone's pairing code, so the relay only sees ciphertext. Mirrors the phone's rtc.js.
  const PAIR_KEY = 'lyricdock:pair', RELAY = 'https://ntfy.sh', CHUNK = 16000;
  const pairCode = () => (LS.get(PAIR_KEY) || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  const te = new TextEncoder(), b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function sigKeys(code) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('lyricdock-topic:' + code)));
    const topic = 'ld' + Array.from(h.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
    const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', te.encode('lyricdock-key:' + code)), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { topic, key };
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return b64(iv) + '.' + b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)))));
  }
  async function unseal(key, s) {
    try { const [iv, ct] = s.split('.').map(unb64); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct))); }
    catch { return null; }
  }
  const gathered = pc => new Promise(r => {
    if (pc.iceGatheringState === 'complete') return r();
    pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r();
    setTimeout(r, 3000);
  });

  async function rtcOpen() {
    const code = pairCode();
    if (code.length !== 10 || typeof RTCPeerConnection === 'undefined') return null;
    const { topic, key } = await sigKeys(code);
    const pc = new RTCPeerConnection(), dc = pc.createDataChannel('dock', { ordered: true });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const id = Math.random().toString(36).slice(2);
      const sub = new WebSocket(`${RELAY.replace('https', 'wss')}/${topic}/ws`);
      const answer = new Promise(res => {
        sub.onmessage = async e => {
          const ev = safe(() => JSON.parse(e.data), {});
          if (ev.event !== 'message') return;
          const m = await unseal(key, ev.message);
          if (m?.t === 'answer' && m.id === id) res(m);
        };
        setTimeout(() => res(null), 8000);
      });
      await new Promise(r => { sub.onopen = r; setTimeout(r, 3000); });
      await fetch(`${RELAY}/${topic}`, { method: 'POST', body: await seal(key, { t: 'offer', id, sdp: pc.localDescription }), headers: { Cache: 'no', Firebase: 'no' } });
      const m = await answer;
      sub.close();
      if (!m) throw 0;
      await pc.setRemoteDescription(m.sdp);
      const ok = await new Promise(r => { if (dc.readyState === 'open') r(true); dc.onopen = () => r(true); setTimeout(() => r(false), 6000); });
      if (!ok) throw 0;
      return rtcWrap(pc, dc);
    } catch { try { pc.close(); } catch {} return null; }
  }

  // Looks like a WebSocket to the rest of the bridge; splits big messages (SCTP caps message size).
  function rtcWrap(pc, dc) {
    const parts = new Map();
    const w = { kind: 'rtc', onmessage: null, onclose: null,
      get readyState() { return dc.readyState === 'open' ? 1 : 3; },
      send(str) {
        if (dc.readyState !== 'open') return;
        if (str.length <= CHUNK) return dc.send(str);
        const id = Math.random().toString(36).slice(2), n = Math.ceil(str.length / CHUNK);
        for (let i = 0; i < n; i++) dc.send(JSON.stringify({ _c: id, i, n, d: str.slice(i * CHUNK, (i + 1) * CHUNK) }));
      },
      close() { try { pc.close(); } catch {} } };
    dc.onmessage = e => {
      const m = safe(() => JSON.parse(e.data), null);
      if (!m?._c) return w.onmessage?.({ data: e.data });
      const p = parts.get(m._c) ?? [];
      p[m.i] = m.d; parts.set(m._c, p);
      if (p.filter(x => x !== undefined).length === m.n) { parts.delete(m._c); w.onmessage?.({ data: p.join('') }); }
    };
    dc.onclose = () => w.onclose?.();
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) w.onclose?.(); };
    return w;
  }

  // ---- automatic pairing through the Spotify account (mirrors rtc.js watchAccount on the phone). While no phone
  // is linked, announce on a relay topic derived from the account id; a phone signed in to the same account
  // answers with its ECDH key, both screens show the same 4 digits, and tapping Allow on the phone sends its
  // pairing code back, encrypted with the agreed key. The account id isn't secret - the Allow tap is the gate.
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  let autoBusy = false, nextAuto = 0;
  async function accountId() {
    return safe(() => Spicetify.Platform.username, null) || (await Spicetify.CosmosAsync.get('https://api.spotify.com/v1/me').catch(() => null))?.id || null;
  }
  async function autoPair() {
    if (autoBusy || ws?.readyState === 1 || Date.now() < nextAuto || typeof RTCPeerConnection === 'undefined') return;
    autoBusy = true;
    nextAuto = Date.now() + 30000;
    let sub = null, modal = false;
    try {
      const uid = await accountId();
      if (!uid) return;
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('lyricdock-account:' + uid)));
      const topic = 'lda' + Array.from(h, b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
      let desk = LS.get('lyricdock:desk');
      if (!desk) { desk = Math.random().toString(36).slice(2, 12); LS.set('lyricdock:desk', desk); }
      const kp = await crypto.subtle.generateKey(EC, false, ['deriveBits']);
      let got = () => {};
      const inbox = [];
      sub = new WebSocket(`${RELAY.replace('https', 'wss')}/${topic}/ws`);
      sub.onmessage = e => {
        const ev = safe(() => JSON.parse(e.data), {}), m = ev.event === 'message' ? safe(() => JSON.parse(ev.message), null) : null;
        if (m?.desk === desk && (m.t === 'key' || m.t === 'accept')) { inbox.push(m); got(); }
      };
      const next = (t, ms) => new Promise(res => {
        const look = () => { const i = inbox.findIndex(m => m.t === t); if (i >= 0) { clearTimeout(timer); res(inbox.splice(i, 1)[0]); } };
        const timer = setTimeout(() => res(null), ms);
        got = look; look();
      });
      await new Promise(r => { sub.onopen = r; setTimeout(r, 3000); });
      const name = `Spotify on ${navigator.userAgentData?.platform || 'this computer'}`;
      await fetch(`${RELAY}/${topic}`, { method: 'POST', body: JSON.stringify({ t: 'discover', desk, name, pub: await crypto.subtle.exportKey('jwk', kp.publicKey) }), headers: { Cache: 'no', Firebase: 'no' } });
      const k = await next('key', 8000);
      if (!k?.pub) return;
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', k.pub, EC, false, []) }, kp.privateKey, 256);
      const hk = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
      const digits = String(((hk[0] << 16) | (hk[1] << 8) | hk[2]) % 10000).padStart(4, '0');
      Spicetify.PopupModal.display({ title: 'Connect your LyricDock phone',
        content: `<div style="text-align:center;padding:8px 0 4px"><div style="opacity:.7">Your phone found this Spotify. Tap <b>Allow</b> on the phone if it shows:</div><div style="font-size:44px;font-weight:800;letter-spacing:.25em;margin:14px 0">${digits}</div></div>` });
      modal = true;
      const a = await next('accept', 65000);
      if (!a?.box) return;
      const aes = await crypto.subtle.importKey('raw', hk, 'AES-GCM', false, ['decrypt']);
      const c = (await unseal(aes, a.box))?.code?.replace(/-/g, '');
      if (!/^[A-Z2-9]{10}$/.test(c ?? '')) return;
      LS.set(PAIR_KEY, c);
      safe(() => Spicetify.showNotification('LyricDock phone paired'));
      drop(); nextAuto = Date.now() + 60000; ensureLink(); renderPanel();
    } catch {} finally {
      try { sub?.close(); } catch {}
      if (modal) safe(() => Spicetify.PopupModal.hide());
      autoBusy = false;
    }
  }

  let nextUsbProbe = 0;
  async function ensureLink() {
    linkState();
    if (ws?.readyState === 1 && Date.now() - lastRx > 2500) drop();
    // On WebRTC, look for the adb/USB link every 10s and move to it when it appears (developer / wired use).
    if (!busy && ws?.readyState === 1 && ws.kind === 'rtc' && Date.now() > nextUsbProbe) {
      nextUsbProbe = Date.now() + 10000;
      busy = true;
      const s = await tryOpen(800);
      busy = false;
      if (s) { const old = ws; ws = null; old.onclose = null; old.close(); return adopt(s); }
    }
    if (busy || ws?.readyState === 1) return;
    busy = true;
    try {
      const s = (await tryOpen(1500)) ?? (await rtcOpen());
      if (s) adopt(s); else autoPair();
    } finally { busy = false; }
  }

  function adopt(s) {
    s.kind ??= 'adb';
    ws = s;
    s.onclose = () => { if (ws === s) { ws = null; ensureLink(); } };
    s.onmessage = e => { lastRx = Date.now(); onMessage(e.data); };
    lastRx = Date.now();
    console.log('[dock] linked via', s.kind);
    // `apply`: settings were changed in the desktop panel while the phone was away - push them now.
    const dirty = LS.get(DIRTY_KEY) === '1';
    send({ type: 'hello', last: readJson(SETTINGS_KEY, null), presets: readJson(PRESETS_KEY, {}), paired: pairCode().length === 10, version: VERSION });
    if (dirty) { send({ type: 'load', S: readJson(SETTINGS_KEY, {}) }); LS.set(DIRTY_KEY, '0'); }
    renderPanel();
    if (track) send(track);
    if (preload) send(preload);
    beat();
  }

  // Spotify's page timers get throttled to ~1/min while minimized; a Worker's timers don't, and its messages
  // wake the page. Falls back to setInterval if the client's CSP refuses blob workers.
  function every100ms(fn) {
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 100)'], { type: 'text/javascript' })));
      w.onmessage = fn;
    } catch { setInterval(fn, 100); }
  }

  // ---- phone settings + presets live here too, so a new phone (or a reinstall) starts configured.
  const SETTINGS_KEY = 'lyricdock:settings', PRESETS_KEY = 'lyricdock:presets', SCHEMA_KEY = 'lyricdock:schema', DIRTY_KEY = 'lyricdock:dirty';
  const okSettings = s => s && typeof s === 'object' && !Array.isArray(s) && JSON.stringify(s).length < 20000;

  function onMessage(data) {
    const m = safe(() => JSON.parse(data), null);
    if (!m || typeof m !== 'object') return;
    if (m.type === 'pair' && /^[A-Z2-9]{10}$/.test(m.code?.replace(/-/g, '') ?? '')) {
      if (pairCode() !== m.code.replace(/-/g, '')) { LS.set(PAIR_KEY, m.code.replace(/-/g, '')); safe(() => Spicetify.showNotification('LyricDock phone paired')); renderPanel(); }
    }
    else if (m.type === 'settings' && okSettings(m.S)) { LS.set(SETTINGS_KEY, JSON.stringify(m.S)); renderPanel(); }
    else if (m.type === 'schema' && Array.isArray(m.schema) && JSON.stringify(m.schema).length < 60000) {
      LS.set(SCHEMA_KEY, JSON.stringify(m.schema));
      if (okSettings(m.S)) LS.set(SETTINGS_KEY, JSON.stringify(m.S));
      renderPanel();
    }
    else if (m.type === 'preset' && typeof m.name === 'string' && m.name.length <= 40) {
      const presets = readJson(PRESETS_KEY, {});
      if (m.action === 'save' && okSettings(m.S)) { const { apiKey, ...rest } = m.S; presets[m.name] = rest; } // keys stay out of presets
      else if (m.action === 'delete') delete presets[m.name];
      LS.set(PRESETS_KEY, JSON.stringify(presets));
      send({ type: 'presets', presets });
      renderPanel();
    }
    else if (m.type === 'cmd') {
      if (m.cmd === 'toggle') P.togglePlay();
      else if (m.cmd === 'next') P.next();
      else if (m.cmd === 'prev') P.back();
      else if (m.cmd === 'heart') P.toggleHeart();
      else if (m.cmd === 'seek' && Number.isFinite(m.ms)) P.seek(Math.max(0, m.ms));
      else if (m.cmd === 'volume' && Number.isFinite(m.v)) P.setVolume(Math.max(0, Math.min(1, m.v / 100)));
      setTimeout(beat, 80);
    }
  }

  // ---- lyrics, fastest local source first, never blocking on the network:
  //   1. Spicy Lyrics' own cache (already on this PC)        -> sent raw ({spicy}), the phone normalizes it
  //   2. Spotify's lyrics (the client's own endpoint)         -> immediately, while Spicy may still be fetching
  //   3. LRCLIB                                               -> only if Spotify has none
  // then: Spicy's cache is watched for a minute and its (word-synced) lyrics replace the fallback when they land.
  // The phone can additionally use the Spicy Lyrics developer API with the user's own key (api.js).
  // Never call api.spicylyrics.org's internal client API: it is Spicy's own (418 to others) and extra requests
  // on the same account trip Spicy's rate limit on the desktop.
  const NONE = { kind: 'none', lines: [], writers: [], source: null };

  async function token() {
    try {
      const s = await Spicetify.Platform.AuthorizationAPI?.getState?.();
      if (s?.token?.accessToken) return s.token.accessToken;
    } catch {}
    return Spicetify.Platform.Session?.accessToken;
  }

  // Spicy Lyrics' ExpireStore (Cache Storage). 'none' = Spicy looked and found nothing.
  async function spicyCache(id) {
    try {
      const r = await (await caches.open('SpicyLyrics_LyricsStore_g1')).match('/' + id);
      const c = r && (await r.json())?.Content;
      return !c ? null : c.Value === 'NO_LYRICS' ? 'none' : c;
    } catch { return null; }
  }

  const withEnds = lines => lines.map((l, i) => ({ ...l, e: l.e ?? lines[i + 1]?.t ?? l.t + 5000 }));

  async function spotifyLyrics(id) {
    const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`;
    let r = await Spicetify.CosmosAsync.get(url).catch(() => null);
    if (!r?.lyrics) {
      const tok = await token();
      if (tok) r = await fetch(url, { headers: { authorization: `Bearer ${tok}`, 'app-platform': 'WebPlayer' } })
        .then(x => x.ok ? x.json() : null).catch(() => null);
    }
    const L = r?.lyrics;
    if (!L?.lines?.length) return null;
    if (L.syncType !== 'LINE_SYNCED') return { kind: 'static', lines: L.lines.map(x => ({ s: x.words })), writers: [], source: 'Spotify' };
    return { kind: 'line', lines: withEnds(L.lines.map(x => ({ t: +x.startTimeMs, s: x.words }))), writers: [], source: 'Spotify' };
  }

  // Search, not exact /get: artist spellings differ (Spotify "Harrdy Sandhu" vs LRCLIB "Hardy Sandhu").
  async function lrclib(m) {
    const dur = (+m.duration || 0) / 1000;
    const search = q => fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)
      .then(x => x.ok ? x.json() : []).catch(() => []);
    let hits = await search(`${m.title} ${m.artist_name}`);
    if (!hits.length) hits = await search(m.title || '');
    if (dur) hits = hits.filter(h => Math.abs(h.duration - dur) < 5); // title-only search can hit other songs
    const r = hits.sort((a, b) => !!b.syncedLyrics - !!a.syncedLyrics || Math.abs(a.duration - dur) - Math.abs(b.duration - dur))[0];
    if (r?.syncedLyrics) {
      const lines = r.syncedLyrics.split('\n').map(s => s.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/))
        .filter(Boolean).map(([, mm, ss, s]) => ({ t: Math.round((+mm * 60 + +ss) * 1000), s }));
      return { kind: 'line', lines: withEnds(lines), writers: [], source: 'LRCLIB' };
    }
    if (r?.plainLyrics) return { kind: 'static', lines: r.plainLyrics.split('\n').map(s => ({ s })), writers: [], source: 'LRCLIB' };
    return null;
  }

  // Spicy-sourced lyrics per track id (fallbacks aren't kept: they may be upgraded).
  const ready = new Map();
  const remember = (id, L) => { ready.set(id, L); if (ready.size > 40) ready.delete(ready.keys().next().value); };
  async function fromSpicyCache(id) {
    if (ready.has(id)) return ready.get(id);
    const c = await spicyCache(id);
    if (!c || c === 'none') return null;
    const L = { spicy: c };
    remember(id, L);
    return L;
  }

  // ---- track info
  const img = u => (u || '').replace('spotify:image:', 'https://i.scdn.co/image/');
  const item = () => P.data?.item ?? P.data?.track;
  const artists = (it, m) => {
    const names = (it?.artists ?? []).map(a => a?.name).filter(Boolean);
    if (names.length) return names.join(', ');
    return Object.keys(m).filter(k => /^artist_name(:\d+)?$/.test(k))
      .sort((a, b) => (+a.split(':')[1] || 0) - (+b.split(':')[1] || 0)).map(k => m[k]).join(', ');
  };
  const info = (it, m) => ({ id: it.uri.split(':')[2], uri: it.uri, title: m.title, artist: artists(it, m), album: m.album_title,
    art: img(m.image_xlarge_url || m.image_large_url || m.image_url), dur: +m.duration || 0 });

  // Next vs previous: going back to the track before this one = previous (the phone slides the other way).
  let hist = [];
  function direction(id) {
    if (hist.length > 1 && hist[hist.length - 2] === id) { hist.pop(); return -1; }
    if (hist[hist.length - 1] !== id) hist = [...hist, id].slice(-50);
    return 1;
  }

  async function sendTrack() {
    const it = item();
    if (!it?.uri) return;
    const base = info(it, it.metadata || {});
    const dir = direction(base.id);
    track = { type: 'track', ...base, dir, lyrics: await fromSpicyCache(base.id) }; // cache read: a few ms
    send(track);
    beat();
    send({ type: 'diag', quality: quality(), pd: Object.keys(P.data || {}),
      pq: safe(() => JSON.stringify([P.data?.playbackQuality, Spicetify.Platform.PlayerAPI._state?.playbackQuality]).slice(0, 400), '') });
    preloadNext();
    setTimeout(preloadNext, 3000); // Spotify's queue can lag the song change by a moment
    if (track.lyrics) return;
    // Ads have no lyrics; local files and podcasts can't use Spotify's lyrics endpoint (it wants a track id).
    const kind = it.uri.split(':')[1];
    const lyrics = kind === 'ad' ? NONE
      : (kind === 'track' ? await spotifyLyrics(base.id) : null) ?? (kind !== 'episode' ? await lrclib(it.metadata || {}) : null) ?? NONE;
    if (item()?.uri !== it.uri) return; // skipped meanwhile
    if (!track.lyrics) { track = { ...track, lyrics }; send(track); }
    upgradeFromSpicy(it.uri, base, dir);
  }

  // Spicy fetches the playing track itself; its word-synced lyrics replace the fallback as soon as they land.
  async function upgradeFromSpicy(uri, base, dir) {
    for (let i = 0; i < 60 && item()?.uri === uri; i++) {
      await sleep(1000);
      const L = await fromSpicyCache(base.id);
      if (!L || item()?.uri !== uri) continue;
      track = { type: 'track', ...base, dir, lyrics: L };
      send(track);
      return;
    }
  }

  // Preload: cover + whatever Spicy already has for the next track (no network).
  async function preloadNext() {
    const now = item()?.uri;
    const n = (Spicetify.Queue?.nextTracks ?? []).map(t => t?.contextTrack).find(t => t?.uri?.startsWith('spotify:track:') && t.uri !== now);
    if (!n || n.uri === preload?.uri) return;
    const base = info(n, n.metadata || {});
    preload = { type: 'preload', ...base, lyrics: await fromSpicyCache(base.id) };
    send(preload);
  }

  // ---- Spotify top bar: LyricDock button -> settings panel. The phone sends its settings schema, so the panel
  // always matches the app. Connected: changes apply instantly. Offline: saved, pushed when the phone connects.
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-8A2.5 2.5 0 0 1 4.5 4z"/>'
    + '<path d="M6 9h9" stroke-width="2.4"/><path d="M6 12.8h6" stroke-width="2.4" opacity=".5"/><path d="M12 17v2.6M8.6 20.6h6.8"/></svg>';
  const CSS = `.ld-panel{--hair:rgba(255,255,255,.08);display:flex;flex-direction:column;gap:2px;font-size:14px}
    .ld-panel h3{font-size:15px;font-weight:600;margin:12px 2px 2px;padding-top:12px;border-top:1px solid var(--hair)}
    .ld-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 12px;border-radius:12px}
    .ld-row:hover{background:rgba(255,255,255,.06)} .ld-desc{font-size:12px;opacity:.6;margin-top:2px}
    .ld-panel select,.ld-panel input[type=text],.ld-panel button{background:rgba(255,255,255,.06);color:inherit;border:0;
      box-shadow:inset 0 0 0 1px var(--hair);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px}
    .ld-panel button{cursor:pointer} .ld-panel button:hover{background:rgba(255,255,255,.14)} .ld-panel option{color:#000}
    .ld-panel input[type=range]{width:200px;accent-color:#fff} .ld-panel input[type=text]{width:240px}
    .ld-val{min-width:64px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8}
    .ld-status{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.06);font-size:13px}
    .ld-status i{width:8px;height:8px;border-radius:50%;background:#e5534b} .ld-status.on i{background:#3ddc97}
    .ld-presets{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .ld-topbar{position:relative}
    .ld-topbar::after{content:'';position:absolute;right:6px;top:6px;width:7px;height:7px;border-radius:50%;background:#e5534b;
      box-shadow:0 0 0 2px var(--background-base,#000);pointer-events:none}
    .ld-topbar.ld-on::after{background:#3ddc97}`;
  safe(() => { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); });

  let panel = null;
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  function change(k, v) {
    const S = readJson(SETTINGS_KEY, {});
    S[k] = v;
    LS.set(SETTINGS_KEY, JSON.stringify(S));
    if (ws?.readyState === 1) send({ type: 'set', k, v }); else LS.set(DIRTY_KEY, '1');
  }

  function control(x, S) {
    const v = S[x.k] ?? x.def;
    if (x.type === 'toggle') { const c = h('input', { type: 'checkbox', checked: !!v }); c.onchange = () => change(x.k, c.checked); return c; }
    if (x.type === 'choice') {
      const s = h('select', {}, ...x.opts.map(([val, name]) => h('option', { value: val, selected: val === v }, name)));
      s.onchange = () => change(x.k, s.value);
      return s;
    }
    if (x.type === 'range') {
      const out = h('span', { className: 'ld-val' }, `${v}${x.unit ?? ''}`);
      const r = h('input', { type: 'range', min: x.min, max: x.max, step: x.step, value: v });
      r.oninput = () => { out.textContent = `${r.value}${x.unit ?? ''}`; };
      r.onchange = () => change(x.k, +r.value);
      return h('div', { className: 'ld-presets' }, r, out);
    }
    const t = h('input', { type: 'text', value: v ?? '', placeholder: x.placeholder ?? '', spellcheck: false });
    t.onchange = () => change(x.k, t.value.trim());
    return t;
  }

  function renderPanel() {
    if (!panel?.isConnected) return;
    const schema = readJson(SCHEMA_KEY, []), S = readJson(SETTINGS_KEY, {}), presets = readJson(PRESETS_KEY, {});
    const on = ws?.readyState === 1;
    const kids = [h('div', { className: 'ld-status' + (on ? ' on' : '') }, h('i'),
      on ? 'Phone connected - changes apply instantly' : 'Phone not connected - changes are saved and applied when it connects')];
    const latest = window.__lyricdock?.latest;
    kids.push(h('div', { className: 'ld-row' }, h('div', {}, `LyricDock ${VERSION === 'dev' ? '(development build)' : 'v' + VERSION}`,
      h('div', { className: 'ld-desc' }, VERSION === 'dev' ? 'Installed with -Dev: no auto-updates' : latest && latest !== VERSION ? `v${latest} downloaded` : 'Up to date - updates install automatically')),
      ...(latest && latest !== VERSION && VERSION !== 'dev' ? [h('button', { onclick: () => location.reload() }, 'Update now')] : [])));
    // pairing (no-adb link): the code the phone shows under its waiting screen / Settings -> Connection
    const pc = pairCode(), codeIn = h('input', { type: 'text', placeholder: 'e.g. K7QX-9MP-2F', value: pc ? `${pc.slice(0, 4)}-${pc.slice(4, 7)}-${pc.slice(7)}` : '' });
    kids.push(h('h3', {}, 'Pair phone'), h('div', { className: 'ld-row' },
      h('div', {}, h('div', {}, pc ? `Paired${on ? ` - connected via ${ws.kind === 'rtc' ? 'direct Wi-Fi (WebRTC)' : 'adb'}` : ''}` : 'Not paired'),
        h('div', { className: 'ld-desc' }, 'Enter the code shown on the phone. No cable or adb needed after this.')),
      h('div', { className: 'ld-presets' }, codeIn, h('button', { onclick: () => {
        const c = codeIn.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
        if (c.length !== 10) return safe(() => Spicetify.showNotification('That code should be 10 characters', true));
        LS.set(PAIR_KEY, c); drop(); ensureLink(); renderPanel();
      } }, 'Pair'))));
    // presets
    const names = Object.keys(presets).sort();
    const sel = h('select', {}, ...(names.length ? names.map(n => h('option', { value: n }, n)) : [h('option', { value: '' }, 'No presets yet - save one')]));
    const name = h('input', { type: 'text', placeholder: 'New preset name' });
    const savePresets = p => { LS.set(PRESETS_KEY, JSON.stringify(p)); send({ type: 'presets', presets: p }); renderPanel(); };
    kids.push(h('h3', {}, 'Presets'), h('div', { className: 'ld-row' }, h('div', { className: 'ld-presets' },
      sel,
      h('button', { onclick: () => { const p = presets[sel.value]; if (!p) return; LS.set(SETTINGS_KEY, JSON.stringify({ ...S, ...p }));
        if (on) send({ type: 'load', S: p }); else LS.set(DIRTY_KEY, '1'); renderPanel(); } }, 'Apply'),
      h('button', { onclick: () => { if (!sel.value) return; const p = { ...presets }; delete p[sel.value]; savePresets(p); } }, 'Delete'),
      name,
      h('button', { onclick: () => { const n = name.value.trim().slice(0, 40); if (!n) return; const { apiKey, ...rest } = S; savePresets({ ...presets, [n]: rest }); } }, 'Save current'))));
    if (!schema.length) kids.push(h('div', { className: 'ld-desc' }, 'Connect the phone once so its settings can load here.'));
    for (const x of schema) {
      if (x.group) { kids.push(h('h3', {}, x.group)); continue; }
      kids.push(h('div', { className: 'ld-row' },
        h('div', {}, h('div', {}, x.label), ...(x.desc ? [h('div', { className: 'ld-desc' }, x.desc)] : [])), control(x, S)));
    }
    panel.replaceChildren(...kids);
  }

  function openPanel() {
    panel = h('div', { className: 'ld-panel' });
    Spicetify.PopupModal.display({ title: 'LyricDock', content: panel, isLarge: true });
    renderPanel();
  }
  // isRight: Spicetify gives right-side buttons the class of Spotify's own round action buttons (left ones sit
  // small among the back/forward arrows), so this matches the native top-bar buttons.
  safe(() => new Spicetify.Topbar.Button('LyricDock', ICON, openPanel, false, true).element.classList.add('ld-topbar'));
  // Update notice (the loader has already downloaded the new build; reloading Spotify's page switches to it).
  function showUpdate() {
    const to = window.__lyricdock?.latest;
    if (!to || to === VERSION || VERSION === 'dev') return;
    const cmd = 'iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex';
    const box = h('div', { className: 'ld-panel' },
      h('div', { className: 'ld-row' }, h('div', {}, h('div', {}, h('b', {}, `v${VERSION}`), '  →  ', h('b', { style: 'color:#3ddc97' }, `v${to}`)),
        h('div', { className: 'ld-desc' }, 'Already downloaded. Update reloads Spotify\'s window (about a second) to switch to it; otherwise it loads next time Spotify starts.'))),
      h('div', { className: 'ld-row' }, h('div', {}, h('div', {}, 'Something broken after a Spotify update?'),
        h('div', { className: 'ld-desc' }, 'Run updater (needs the installer run once), or paste this into PowerShell:'), h('code', { style: 'font-size:11px;opacity:.8;user-select:all' }, cmd)),
        h('div', { className: 'ld-presets' },
          h('button', { onclick: () => window.open('lyricdock-updater://update') }, 'Run updater'),
          h('button', { onclick: () => { Spicetify.Platform?.ClipboardAPI?.copy(cmd); Spicetify.showNotification('Copied'); } }, 'Copy'))),
      h('div', { className: 'ld-presets', style: 'justify-content:space-between;margin-top:8px' },
        h('a', { href: `https://github.com/DhakadG/lyricdock/releases/tag/v${to}`, target: '_blank' }, 'Release notes'),
        h('button', { style: 'background:#1ed760;color:#000;font-weight:700;border-radius:999px;padding:8px 22px', onclick: () => location.reload() }, 'Update')));
    Spicetify.PopupModal.display({ title: 'LyricDock update available', content: box });
  }
  addEventListener('lyricdock:update', () => { renderPanel(); safe(showUpdate); });

  // ---- sync: events + 500ms heartbeat + 100ms drift check (catches seeks instantly) + 1s link check.
  P.addEventListener('songchange', sendTrack);
  P.addEventListener('onplaypause', beat);
  let tick = 0;
  every100ms(() => {
    tick++;
    const pos = safe(() => P.getProgress(), 0), playing = safe(() => P.isPlaying(), false);
    const expected = last.pos + (last.playing ? Date.now() - last.at : 0);
    if (tick % 5 === 0 || playing !== last.playing || Math.abs(pos - expected) > 250) beat();
    if (tick % 10 === 0) ensureLink();
  });
  ensureLink();
  sendTrack();
})();
