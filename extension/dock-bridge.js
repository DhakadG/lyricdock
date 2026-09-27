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
      volume: safe(() => Math.round(P.getVolume() * 100), undefined), shuffle: safe(() => P.getShuffle(), undefined), repeat: safe(() => P.getRepeat(), undefined) });
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
    if (track) send(track); else sendTrack();
    if (preload) send(preload);
    extraMsgs.forEach(send);
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
    else if (m.type === 'settings' && okSettings(m.S)) { LS.set(SETTINGS_KEY, JSON.stringify(m.S)); syncControls(m.S); }
    else if (m.type === 'schema' && Array.isArray(m.schema) && JSON.stringify(m.schema).length < 60000) {
      LS.set(SCHEMA_KEY, JSON.stringify(m.schema));
      if (m.builtins && typeof m.builtins === 'object' && JSON.stringify(m.builtins).length < 20000) LS.set('lyricdock:builtins', JSON.stringify(m.builtins));
      if (okSettings(m.defaults)) LS.set('lyricdock:defaults', JSON.stringify(m.defaults));
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
      else if (m.cmd === 'shuffle') P.toggleShuffle();
      else if (m.cmd === 'repeat') { if (P.setRepeat) P.setRepeat(Number.isFinite(m.v) ? m.v % 3 : (P.getRepeat() + 1) % 3); else P.toggleRepeat(); }
      else if (m.cmd === 'play' && /^spotify:[a-z]+:[A-Za-z0-9:]+$/.test(m.uri ?? '')) playItem(m.uri, m.ctx);
      setTimeout(beat, 80);
    }
    else if (m.type === 'list' && ['queue', 'recent', 'library', 'friends'].includes(m.which)) lists(m.which).then(r => send({ type: 'list', which: m.which, ...r }));
  }

  // ---- queue / recently played / library / friends for the phone's slide-over panel
  const art64 = x => img(x?.images?.find?.(i => i.width <= 300)?.url || x?.images?.[0]?.url || x?.imageUrl || x?.image_url || x?.image || '');
  function playItem(uri, ctx) {
    if (/^spotify:(playlist|album|artist|show|collection|user)/.test(uri)) return P.playUri(uri);
    if (ctx && /^spotify:/.test(ctx)) return P.playUri(ctx, {}, { skipTo: { uri } });
    return P.playUri(uri);
  }
  async function lists(which) {
    try {
      if (which === 'queue') {
        const q = Spicetify.Queue ?? {}, meta = t => ({ uri: t?.contextTrack?.uri ?? t?.uri, title: t?.contextTrack?.metadata?.title ?? t?.metadata?.title,
          sub: t?.contextTrack?.metadata?.artist_name ?? t?.metadata?.artist_name, art: img(t?.contextTrack?.metadata?.image_url ?? t?.metadata?.image_url) });
        const items = (q.nextTracks ?? []).filter(t => (t?.contextTrack?.uri ?? t?.uri)?.startsWith('spotify:track') && t?.provider !== 'unavailable').slice(0, 60).map(meta);
        return { now: q.track ? meta(q.track) : null, items };
      }
      if (which === 'recent') {
        const r = await Spicetify.CosmosAsync.get('https://api.spotify.com/v1/me/player/recently-played?limit=40');
        return { items: (r?.items ?? []).map(x => ({ uri: x.track.uri, ctx: x.context?.uri, title: x.track.name, sub: x.track.artists.map(a => a.name).join(', '),
          art: art64(x.track.album), time: Date.parse(x.played_at) })) };
      }
      if (which === 'library') {
        const root = await Spicetify.Platform.RootlistAPI.getContents({ limit: 500 });
        const flat = xs => xs.flatMap(x => x.type === 'folder' ? flat(x.items ?? []) : [x]);
        const items = [{ uri: 'spotify:collection:tracks', title: 'Liked Songs', sub: 'Playlist', art: '' },
          ...flat(root?.items ?? []).filter(x => x.uri).map(x => ({ uri: x.uri, title: x.name, sub: `Playlist · ${x.owner?.name ?? ''}`, art: art64(x) }))];
        return { items };
      }
      if (which === 'friends') {
        const r = await Spicetify.CosmosAsync.get('https://spclient.wg.spotify.com/presence-view/v1/buddylist');
        return { items: (r?.friends ?? []).sort((a, b) => b.timestamp - a.timestamp).map(f => ({ uri: f.track?.uri, ctx: f.track?.context?.uri,
          title: f.user?.name, sub: `${f.track?.name ?? ''} · ${f.track?.artist?.name ?? ''}`, ctxName: f.track?.context?.name,
          art: f.user?.imageUrl || '', time: f.timestamp, live: Date.now() - f.timestamp < 5 * 60000 })) };
      }
    } catch (e) { return { items: [], error: `Couldn't load this (${String(e?.message || e).slice(0, 80)})` }; }
    return { items: [] };
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
    extras(it, base.id);
    if (track.lyrics) return;
    // Ads have no lyrics; local files and podcasts can't use Spotify's lyrics endpoint (it wants a track id).
    const kind = it.uri.split(':')[1];
    const lyrics = kind === 'ad' ? NONE
      : (kind === 'track' ? await spotifyLyrics(base.id) : null) ?? (kind !== 'episode' ? await lrclib(it.metadata || {}) : null) ?? NONE;
    if (item()?.uri !== it.uri) return; // skipped meanwhile
    if (!track.lyrics) { track = { ...track, lyrics }; send(track); }
    upgradeFromSpicy(it.uri, base, dir);
  }

  // Extras for the phone's background: the artist's picture ('Artist image' background) and tempo + loudness
  // from Spotify's audio analysis ('Move with the music'), loudness as 0..1 every 0.5s. Kept for reconnects.
  let extraMsgs = [];
  async function extras(it, id) {
    extraMsgs = [];
    const keep = m => { if (item()?.uri === it.uri) { extraMsgs.push(m); send(m); } };
    const artistUri = it.artists?.[0]?.uri || it.metadata?.artist_uri || '';
    const errs = [];
    // Artist picture: Spotify's own GraphQL artist page query first (what Spicy Lyrics uses for its artist
    // visuals: the header image, else the avatar), then the Web API.
    (async () => {
      let url = null;
      try {
        const q = Spicetify.GraphQL?.Definitions?.queryArtistOverview;
        if (q) {
          const r = await Spicetify.GraphQL.Request(q, { uri: artistUri, locale: '', includePrerelease: false });
          const v = r?.data?.artistUnion?.visuals;
          const pick = s => [...(s ?? [])].sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url;
          url = pick(v?.headerImage?.sources) || pick(v?.avatarImage?.sources) || null;
        } else errs.push('artist: no GraphQL definition');
      } catch (e) { errs.push('artist gql: ' + (e?.message || e)); }
      if (!url && artistUri) {
        try {
          const a = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/artists/${artistUri.split(':')[2]}`);
          url = [...(a?.images ?? [])].sort((x, y) => y.width - x.width)[0]?.url || null;
        } catch (e) { errs.push('artist web: ' + (e?.message || e)); }
      }
      if (url) keep({ type: 'artist', id, img: url });
      else send({ type: 'diag', extras: errs.slice(0, 4) });
      // Album + release year for the phone's album line.
      try {
        const albumUri = it.album?.uri || it.metadata?.album_uri;
        const q = Spicetify.GraphQL?.Definitions?.getAlbum;
        const r = q && albumUri ? await Spicetify.GraphQL.Request(q, { uri: albumUri, locale: '', offset: 0, limit: 1 }) : null;
        const a = r?.data?.albumUnion;
        keep({ type: 'album', id, album: a?.name || it.metadata?.album_title || '', year: (a?.date?.isoString || '').slice(0, 4) });
      } catch { keep({ type: 'album', id, album: it.metadata?.album_title || '', year: '' }); }
    })();
    try {
      const d = await Spicetify.getAudioData(it.uri);
      const segs = d?.segments ?? [], tempo = d?.track?.tempo;
      if (!segs.length || !Number.isFinite(tempo)) { send({ type: 'diag', audio: 'no analysis data' }); return; }
      const n = Math.ceil((d.track.duration || segs[segs.length - 1].start + 1) * 2), loud = new Array(n).fill(0);
      for (const g of segs) { const i = Math.floor(g.start * 2); if (i < n) loud[i] = Math.max(loud[i], Math.min(1, Math.max(0, (g.loudness_max + 35) / 30))); }
      for (let i = 1; i < n; i++) if (!loud[i]) loud[i] = loud[i - 1]; // fill 0.5s slots between segments
      keep({ type: 'audio', id, tempo, loud: loud.map(v => Math.round(v * 100) / 100) });
    } catch (e) { send({ type: 'diag', audio: String(e?.message || e).slice(0, 200) }); } // no audio analysis: the background keeps its set speed
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
  // Panel look: Spotify's own - its font stack, neutral greys, pill buttons, green only where Spotify uses it (switches).
  const FONT = 'var(--encore-body-font-stack, SpotifyMixUI, CircularSp, "Helvetica Neue", system-ui, sans-serif)';
  const CSS = `.ld-panel{--hair:rgba(255,255,255,.07);--sub:rgba(255,255,255,.62);font-family:${FONT};font-size:14px;display:flex;flex-direction:column;gap:1px;padding-bottom:12px}
    .ld-panel h3{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:22px 4px 6px;color:#fff}
    .ld-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 12px;border-radius:6px}
    .ld-row>:first-child{min-width:0;flex:1} .ld-row>:last-child{flex-shrink:0}
    .ld-row:hover{background:rgba(255,255,255,.04)}
    .ld-desc{font-size:12.5px;color:var(--sub);margin-top:3px;line-height:1.45;max-width:52ch}
    .ld-label{display:flex;align-items:center;gap:6px;font-weight:500;color:#fff}
    .ld-help{flex:none;width:16px;height:16px;display:inline-grid;place-items:center;cursor:help;color:rgba(255,255,255,.45);transition:color .15s}
    .ld-help svg{width:14px;height:14px;fill:currentColor}
    .ld-help:hover,.ld-help:focus{color:#fff;outline:none}
    .ld-help::after{content:attr(data-help);position:absolute;left:12px;right:12px;top:calc(100% - 2px);z-index:10;padding:10px 12px;border-radius:6px;
      font:400 13px/1.5 ${FONT};color:rgba(255,255,255,.92);text-align:left;white-space:normal;
      background:#282828;box-shadow:0 16px 24px rgba(0,0,0,.5),0 6px 8px rgba(0,0,0,.3);
      opacity:0;transform:translateY(-3px);pointer-events:none;transition:opacity .12s,transform .12s}
    .ld-help:hover::after,.ld-help:focus::after{opacity:1;transform:none;transition-delay:.25s}
    .ld-panel select,.ld-panel input[type=text]{background:#2a2a2a;color:#fff;border:0;border-radius:4px;padding:8px 12px;font:inherit;font-size:13px;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);transition:box-shadow .15s}
    .ld-panel select:hover,.ld-panel input[type=text]:hover{box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
    .ld-panel select:focus,.ld-panel input[type=text]:focus{outline:none;box-shadow:inset 0 0 0 1.5px #fff}
    .ld-panel button{cursor:pointer;font:700 13px/1 ${FONT};color:#fff;background:transparent;border:0;border-radius:999px;padding:9px 16px;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);transition:transform .1s,box-shadow .15s,background .15s}
    .ld-panel button:hover{box-shadow:inset 0 0 0 1px #fff;transform:scale(1.03)} .ld-panel button:active{transform:scale(.97)}
    .ld-panel button.ld-primary{background:#fff;color:#000;box-shadow:none} .ld-panel button.ld-primary:hover{background:#f0f0f0}
    .ld-panel option,.ld-panel optgroup{background:#282828;color:#fff}
    .ld-panel input[type=range]{width:210px;accent-color:#fff;cursor:pointer} .ld-panel input[type=text]{width:240px}
    .ld-switch{-webkit-appearance:none;appearance:none;width:40px;height:22px;border-radius:11px;background:#535353;position:relative;cursor:pointer;margin:0;transition:background .2s}
    .ld-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s cubic-bezier(.3,1.3,.6,1)}
    .ld-switch:hover{background:#6a6a6a} .ld-switch:checked{background:#1ed760} .ld-switch:checked::after{transform:translateX(18px)}
    .ld-val{min-width:58px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:rgba(255,255,255,.85)}
    .ld-status{display:flex;align-items:center;gap:10px;padding:4px 12px 10px;font-size:13px;color:var(--sub)}
    .ld-status i{flex:none;width:8px;height:8px;border-radius:50%;background:#f15e6c}
    .ld-status.on{color:#fff} .ld-status.on i{background:#1ed760}
    .ld-presets{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ld-preview{position:sticky;top:-1px;z-index:5;margin:0 0 8px;height:150px;border-radius:8px;overflow:hidden;background:#181818 center/cover;
      box-shadow:0 8px 24px rgba(0,0,0,.5)}
    .ld-preview-bg{position:absolute;inset:-30px;background:inherit;background-size:cover;filter:blur(28px) saturate(1.4)}
    .ld-preview-dim{position:absolute;inset:0;background:#000}
    .ld-preview-lines{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 22px;color:#fff;font-family:system-ui,Roboto,sans-serif}
    .ld-preview-lines div{letter-spacing:-.012em;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ld-preview-tag{position:absolute;top:8px;right:10px;font-size:11px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:.02em}
    .ld-topbar{position:relative}
    .ld-topbar::after{content:'';position:absolute;right:6px;top:6px;width:7px;height:7px;border-radius:50%;background:#e5534b;
      box-shadow:0 0 0 2px var(--background-base,#000);pointer-events:none}
    .ld-topbar.ld-on::after{background:#3ddc97}`;  safe(() => { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); });

  let panel = null;
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  // Every change is saved and sent at once (sliders while dragging), and shown in the live preview.
  function change(k, v) {
    const S = readJson(SETTINGS_KEY, {});
    S[k] = v;
    LS.set(SETTINGS_KEY, JSON.stringify(S));
    if (ws?.readyState === 1) send({ type: 'set', k, v }); else LS.set(DIRTY_KEY, '1');
    preview(S);
  }

  function control(x, S) {
    const v = S[x.k] ?? x.def;
    if (x.type === 'toggle') { const c = h('input', { type: 'checkbox', checked: !!v, className: 'ld-switch' }); c.dataset.k = x.k; c.onchange = () => change(x.k, c.checked); return c; }
    if (x.type === 'choice') {
      const s = h('select', {}, ...x.opts.map(([val, name]) => h('option', { value: val, selected: val === v }, name)));
      s.onchange = () => change(x.k, s.value);
      s.dataset.k = x.k;
      return s;
    }
    if (x.type === 'range') {
      const out = h('span', { className: 'ld-val' }, `${v}${x.unit ?? ''}`);
      const r = h('input', { type: 'range', min: x.min, max: x.max, step: x.step, value: v });
      r.oninput = () => { out.textContent = `${r.value}${x.unit ?? ''}`; change(x.k, +r.value); };
      r.dataset.k = x.k; out.dataset.out = x.k;
      return h('div', { className: 'ld-presets' }, r, out);
    }
    const t = h('input', { type: 'text', value: v ?? '', placeholder: x.placeholder ?? '', spellcheck: false });
    t.onchange = () => change(x.k, t.value.trim());
    return t;
  }

  // Label + ⓘ chip; hovering (or focusing) the chip shows the setting's help text under the row.
  function label(x) {
    const l = h('div', { className: 'ld-label' }, x.label);
    if (x.help) { const c = h('span', { className: 'ld-help', tabIndex: 0 }); c.innerHTML = INFO; c.dataset.help = x.help; l.append(c); }
    return l;
  }

  const INFO = '<svg viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8.75-3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zM7.25 7h1.5v4.5h-1.5z"/></svg>';
  const scroller = () => { for (let e = panel?.parentElement; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) return e; return null; };

  // Changes coming back from the phone (or made there): update the controls in place - no rebuild, no scroll jump,
  // and a slider being dragged is left alone.
  function syncControls(S) {
    if (!panel?.isConnected) return;
    for (const c of panel.querySelectorAll('[data-k]')) {
      const v = S[c.dataset.k];
      if (v === undefined || c === document.activeElement) continue;
      if (c.type === 'checkbox') c.checked = !!v; else if (String(c.value) !== String(v)) c.value = v;
      const out = panel.querySelector(`[data-out="${c.dataset.k}"]`);
      if (out && c.type === 'range') out.textContent = `${v}${out.textContent.replace(/^[-\d.]+/, '')}`;
    }
    preview(S);
  }

  // Live preview: three lyric lines styled with the current settings over the playing cover, pinned to the top of the
  // panel so every change is visible without leaving it.
  const previewBox = h('div', { className: 'ld-preview' });
  previewBox.innerHTML = '<div class="ld-preview-bg"></div><div class="ld-preview-dim"></div><div class="ld-preview-lines"><div></div><div></div><div></div></div><div class="ld-preview-tag">Live preview</div>';
  function preview(S) {
    const d = { size: 1, weight: '700', lineOpacity: 0.5, blurLines: true, blurAmount: 1.2, glow: true, glowStrength: 1, align: 'left', bgDim: 0.2, lineGap: 1.5, bg: 'dynamic', ...readJson('lyricdock:defaults', {}), ...S };
    const art = safe(() => img(item()?.metadata?.image_xlarge_url || item()?.metadata?.image_url), '');
    previewBox.style.backgroundImage = art ? `url("${art}")` : 'none';
    previewBox.querySelector('.ld-preview-bg').style.display = d.bg === 'black' ? 'none' : '';
    previewBox.querySelector('.ld-preview-dim').style.opacity = d.bg === 'black' ? 1 : d.bgDim;
    const lines = previewBox.querySelectorAll('.ld-preview-lines div'), words = ['Every change you make', 'shows up here as you move it', 'before it reaches the phone'];
    lines.forEach((l, i) => {
      const active = i === 1;
      l.textContent = words[i];
      Object.assign(l.style, {
        fontSize: `${(active ? 26 : 22) * d.size}px`, fontWeight: d.weight, textAlign: d.align === 'center' ? 'center' : 'left',
        opacity: active ? 1 : d.lineOpacity, padding: `${d.lineGap * 1.6}px 0`,
        filter: !active && d.blurLines ? `blur(${d.blurAmount}px)` : 'none',
        textShadow: active && d.glow ? `0 0 ${8 * d.glowStrength}px rgba(255,255,255,${Math.min(0.55 * d.glowStrength, 0.9)})` : 'none',
      });
    });
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
      VERSION === 'dev' ? '' : latest && latest !== VERSION ? h('button', { className: 'ld-primary', onclick: () => location.reload() }, 'Update now')
        : h('button', { onclick: e => checkUpdate(e.target) }, 'Check for updates')));
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
    // Built-in presets come from the phone (its shipped default config and variants); yours are stored here.
    const builtins = readJson('lyricdock:builtins', {}), defs = readJson('lyricdock:defaults', {});
    const grp = (label, list, pre) => { const g = h('optgroup', { label }); list.forEach(n => g.append(h('option', { value: pre + n }, n))); return g; };
    const sel = h('select', {}, ...(Object.keys(builtins).length ? [grp('Built-in', Object.keys(builtins), 'b:')] : []),
      ...(names.length ? [grp('Yours', names, 'u:')] : [h('option', { value: '' }, 'No presets of yours yet - save one')]));
    const chosen = () => sel.value.startsWith('b:') ? { ...defs, ...builtins[sel.value.slice(2)] } : presets[sel.value.slice(2)];
    const name = h('input', { type: 'text', placeholder: 'New preset name' });
    const savePresets = p => { LS.set(PRESETS_KEY, JSON.stringify(p)); send({ type: 'presets', presets: p }); renderPanel(); };
    kids.push(h('h3', {}, 'Presets'), h('div', { className: 'ld-row' }, h('div', { className: 'ld-presets' },
      sel,
      h('button', { onclick: () => { const p = chosen(); if (!p) return; LS.set(SETTINGS_KEY, JSON.stringify({ ...S, ...p }));
        if (on) send({ type: 'load', S: p }); else LS.set(DIRTY_KEY, '1'); renderPanel(); } }, 'Apply'),
      h('button', { onclick: () => { if (!sel.value.startsWith('u:')) return; const p = { ...presets }; delete p[sel.value.slice(2)]; savePresets(p); } }, 'Delete'),
      name,
      h('button', { onclick: () => { const n = name.value.trim().slice(0, 40); if (!n) return; const { apiKey, ...rest } = S; savePresets({ ...presets, [n]: rest }); } }, 'Save current'))));
    if (!schema.length) kids.push(h('div', { className: 'ld-desc' }, 'Connect the phone once so its settings can load here.'));
    for (const x of schema) {
      if (x.group) { kids.push(h('h3', {}, x.group)); continue; }
      kids.push(h('div', { className: 'ld-row' },
        h('div', {}, label(x), ...(x.desc ? [h('div', { className: 'ld-desc' }, x.desc)] : [])), control(x, S)));
    }
    // Keep the scroll position: rebuilding must never throw you back to the top.
    const sc = scroller(), top = sc?.scrollTop ?? 0;
    panel.replaceChildren(previewBox, ...kids);
    if (sc) sc.scrollTop = top;
    preview(S);
  }

  function openPanel() {
    panel = h('div', { className: 'ld-panel' });
    Spicetify.PopupModal.display({ title: 'LyricDock', content: panel, isLarge: true });
    renderPanel();
  }
  // isRight: Spicetify gives right-side buttons the class of Spotify's own round action buttons (left ones sit
  // small among the back/forward arrows), so this matches the native top-bar buttons.
  safe(() => new Spicetify.Topbar.Button('LyricDock', ICON, openPanel, false, true).element.classList.add('ld-topbar'));
  // Manual "Check for updates": same as the loader's 30-minute check - download the new build into the loader's
  // cache (so it's used even if Update isn't clicked), then show the update popup.
  async function checkUpdate(btn) {
    const say = t => { if (btn) btn.textContent = t; };
    say('Checking…');
    try {
      const v = (await (await fetch(`https://raw.githubusercontent.com/DhakadG/lyricdock/main/extension/version.json?t=${Date.now()}`, { cache: 'no-store' })).json()).version;
      const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
      if (!/^\d+\.\d+\.\d+$/.test(v) || !newer(v, VERSION)) { say('Up to date'); setTimeout(() => say('Check for updates'), 3000); return; }
      say('Downloading…');
      const r = await fetch(`https://cdn.jsdelivr.net/gh/DhakadG/lyricdock@v${v}/extension/dock-bridge.js`);
      const code = await r.text();
      if (!r.ok || !code.includes('function dockBridge')) throw new Error('download failed');
      localStorage.setItem('lyricdock:build', code);
      localStorage.setItem('lyricdock:build-version', v);
      window.__lyricdock.latest = v;
      dispatchEvent(new Event('lyricdock:update'));
    } catch (e) { say('Check failed - retry'); }
  }

  // Update notice (the loader has already downloaded the new build; reloading Spotify's page switches to it).
  function showUpdate() {
    const to = window.__lyricdock?.latest;
    if (!to || to === VERSION || VERSION === 'dev') return;
    const cmd = 'iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex';
    const box = h('div', { className: 'ld-panel', style: 'overflow-x:hidden' },
      h('div', { className: 'ld-row' }, h('div', {}, h('div', {}, h('b', {}, `v${VERSION}`), '  →  ', h('b', { style: 'color:#3ddc97' }, `v${to}`)),
        h('div', { className: 'ld-desc' }, 'Already downloaded. Update reloads Spotify\'s window (about a second) to switch to it; otherwise it loads next time Spotify starts.'))),
      h('div', { className: 'ld-row' }, h('div', {}, h('div', {}, 'Something broken after a Spotify update?'),
        h('div', { className: 'ld-desc' }, 'Run updater (needs the installer run once), or paste this into PowerShell:'), h('code', { style: 'display:block;font-size:11px;opacity:.8;user-select:all;word-break:break-all;margin-top:4px' }, cmd)),
        h('div', { className: 'ld-presets' },
          h('button', { onclick: () => window.open('lyricdock-updater://update') }, 'Run updater'),
          h('button', { onclick: () => { Spicetify.Platform?.ClipboardAPI?.copy(cmd); Spicetify.showNotification('Copied'); } }, 'Copy'))),
      h('div', { className: 'ld-presets', style: 'justify-content:space-between;margin-top:8px' },
        h('a', { href: `https://github.com/DhakadG/lyricdock/releases/tag/v${to}`, target: '_blank' }, 'Release notes'),
        h('button', { className: 'ld-primary', style: 'border-radius:999px;padding:9px 24px', onclick: () => location.reload() }, 'Update')));
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
  // At startup (and after Update reloads the page) the player may not have the current song yet: retry until it does.
  (async () => { for (let i = 0; i < 30 && !track; i++) { await sendTrack(); if (!track) await sleep(1000); } })();
})();
