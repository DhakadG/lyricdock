// LyricDock bridge (Spicetify extension). Pushes the playing track, lyrics, position, liked state and audio
// quality to the LyricDock phone app(s), preloads the next track, stores each phone's settings/presets, answers
// the phone's queue / library / search panel, and takes playback commands back.
//
// Transport: a WebRTC data channel per paired phone (signalled through ntfy.sh, a self-hosted ntfy server, or the
// LyricDock Helper's local relay), plus ws://127.0.0.1:8975 over adb for development.
(function dockBridge() {
  if (!Spicetify?.Player?.addEventListener || !Spicetify.CosmosAsync || !Spicetify.Platform || !Spicetify.LocalStorage)
    return setTimeout(dockBridge, 300);
  if (window.__lyricdockRunning) return; // loader + a -Dev copy both installed: run once
  window.__lyricdockRunning = true;
  const VERSION = window.__lyricdock?.version ?? 'dev'; // set by the auto-updating loader (lyricdock.js)

  const URL_ = 'ws://127.0.0.1:8975';
  const P = Spicetify.Player, LS = Spicetify.LocalStorage;
  let track = null, preload = null;
  let last = { pos: 0, at: 0, playing: false };

  const safe = (f, d) => { try { return f(); } catch { return d; } }; // getProgress throws before anything loads
  const sleep = t => new Promise(r => setTimeout(r, t));
  const readJson = (k, d) => safe(() => JSON.parse(LS.get(k)) ?? d, d);
  const writeJson = (k, v) => LS.set(k, JSON.stringify(v));

  // ---- links: one per phone. Key = the phone's pairing code, or 'adb' for the developer link.
  const links = new Map();
  const openLinks = () => [...links.values()].filter(l => l.readyState === 1);
  const connected = () => openLinks().length > 0;
  const sendTo = (l, o) => { if (l?.readyState === 1) l.send(JSON.stringify(o)); };
  const send = o => { const s = JSON.stringify(o); for (const l of openLinks()) l.send(s); };
  const linkFor = code => openLinks().find(l => l.code === code);

  // Connection log for the panel (last 30 events).
  const events = [];
  const log = text => { events.unshift({ t: Date.now(), text }); events.length = Math.min(events.length, 30); };

  // ---- paired phones: [{ code, name }]. Migrates the single code older versions stored.
  const PAIR_KEY = 'lyricdock:pair', PAIRS_KEY = 'lyricdock:pairs';
  function pairs() {
    let p = readJson(PAIRS_KEY, null);
    if (!Array.isArray(p)) {
      const c = (LS.get(PAIR_KEY) || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
      p = c.length === 10 ? [{ code: c, name: 'Phone' }] : [];
      writeJson(PAIRS_KEY, p);
    }
    return p.filter(x => /^[A-Z2-9]{10}$/.test(x?.code ?? ''));
  }
  const cleanCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  function addPair(code, name) {
    const p = pairs(), had = p.find(x => x.code === code);
    if (had) { if (name && /^Phone( \d+)?$/.test(had.name)) { had.name = name; writeJson(PAIRS_KEY, p); } return false; }
    p.push({ code, name: name || `Phone ${p.length + 1}` });
    writeJson(PAIRS_KEY, p);
    log(`Paired ${name || 'a phone'}`);
    return true;
  }
  function removePair(code) {
    writeJson(PAIRS_KEY, pairs().filter(x => x.code !== code));
    closeLink(code, 'unpaired');
    const by = readJson(SET_BY, {}); delete by[code]; writeJson(SET_BY, by);
  }
  const phoneName = code => pairs().find(x => x.code === code)?.name || (code ? `Phone ${code.slice(0, 4)}` : 'Phone');

  // ---- settings: per phone (a new phone starts from the last settings used), presets shared.
  const SETTINGS_KEY = 'lyricdock:settings', SET_BY = 'lyricdock:settingsBy', PRESETS_KEY = 'lyricdock:presets', SCHEMA_KEY = 'lyricdock:schema', DIRTY_BY = 'lyricdock:dirtyBy';
  const okSettings = s => s && typeof s === 'object' && !Array.isArray(s) && JSON.stringify(s).length < 20000;
  const settingsFor = code => (code && readJson(SET_BY, {})[code]) || readJson(SETTINGS_KEY, {});
  function saveSettings(code, S) {
    writeJson(SETTINGS_KEY, S);
    if (code) { const by = readJson(SET_BY, {}); by[code] = S; writeJson(SET_BY, by); }
  }
  const dirty = (code, on) => { const d = readJson(DIRTY_BY, {}); if (on === undefined) return !!d[code]; if (on) d[code] = 1; else delete d[code]; writeJson(DIRTY_BY, d); };
  // Signalling + ICE come from the phone's Connection settings (so both ends agree).
  function relayFor(S) {
    if (S.relay === 'helper') return 'http://127.0.0.1:8977'; // the helper's local relay, as seen from this PC
    if (S.relay === 'custom' && /^https:\/\/[^\s]+$/.test(S.relayUrl ?? '')) return S.relayUrl.replace(/\/+$/, '');
    return 'https://ntfy.sh';
  }
  function iceFor(S) {
    const servers = String(S.ice ?? '').split(',').map(x => x.trim()).filter(Boolean).map(e => {
      const [urls, username, credential] = e.split('|');
      return /^(stun|turns?):/.test(urls) ? { urls, ...(username ? { username, credential } : {}) } : null;
    }).filter(Boolean);
    return { iceServers: servers };
  }
  const wsUrl = u => u.replace(/^http/, 'ws');

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
    const b = { type: 'pos', pos, playing, dur: safe(() => P.getDuration(), 0), liked: safe(() => P.getHeart(), undefined), quality: quality(),
      volume: safe(() => Math.round(P.getVolume() * 100), undefined), shuffle: safe(() => P.getShuffle(), undefined), repeat: safe(() => P.getRepeat(), undefined) };
    for (const l of openLinks()) sendTo(l, { ...b, via: l.kind });
  }

  // ---- adb link (development): ws://127.0.0.1:8975 forwarded to the phone.
  const tryOpen = ms => new Promise(res => {
    const s = new WebSocket(URL_);
    const t = setTimeout(() => { s.onopen = null; s.close(); res(null); }, ms);
    s.onopen = () => { clearTimeout(t); res(s); };
    s.onerror = () => { clearTimeout(t); res(null); };
  });

  function closeLink(id, why) {
    const l = links.get(id);
    if (!l) return;
    links.delete(id);
    l.onclose = null;
    try { l.close(); } catch {}
    if (why) log(`${phoneName(l.code)} ${why}`);
  }

  // Connection feedback: a dot on the top-bar button, and a notice only when the state has held for 3s.
  let shown = null, pendingState = null, pendingSince = 0;
  function linkState() {
    const on = connected();
    document.querySelector('.ld-topbar')?.classList.toggle('ld-on', on);
    if (on !== pendingState) { pendingState = on; pendingSince = Date.now(); }
    if (on !== shown && Date.now() - pendingSince > 3000) {
      if (shown !== null) safe(() => Spicetify.showNotification(on ? 'LyricDock connected' : 'LyricDock phone offline'));
      shown = on;
      renderPanel();
    }
  }

  // ---- WebRTC link. The offer/answer swap goes through the relay as a dumb mailbox; topic and AES-GCM key come
  // from the phone's pairing code, so the relay only sees ciphertext. Mirrors the phone's rtc.js.
  const CHUNK = 16000;
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

  async function rtcOpen(code) {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const S = settingsFor(code), RELAY = relayFor(S);
    const { topic, key } = await sigKeys(code);
    const pc = new RTCPeerConnection(iceFor(S)), dc = pc.createDataChannel('dock', { ordered: true });
    let sub = null;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const id = Math.random().toString(36).slice(2);
      sub = new WebSocket(`${wsUrl(RELAY)}/${topic}/ws`);
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
      if (!m) throw 0;
      await pc.setRemoteDescription(m.sdp);
      const ok = await new Promise(r => { if (dc.readyState === 'open') r(true); dc.onopen = () => r(true); setTimeout(() => r(false), 6000); });
      if (!ok) throw 0;
      return rtcWrap(pc, dc);
    } catch { try { pc.close(); } catch {} return null; }
    finally { try { sub?.close(); } catch {} }
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
  // is linked (or when "Find phones" is clicked), announce on a relay topic derived from the account id; a phone
  // signed in to the same account answers with its ECDH key, both screens show the same 4 digits, and tapping
  // Allow on the phone sends its pairing code back, encrypted with the agreed key.
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  let autoBusy = false, nextAuto = 0;
  async function accountId() {
    return safe(() => Spicetify.Platform.username, null) || (await Spicetify.CosmosAsync.get('https://api.spotify.com/v1/me').catch(() => null))?.id || null;
  }
  async function autoPair(force) {
    if (autoBusy || (!force && (connected() || Date.now() < nextAuto)) || typeof RTCPeerConnection === 'undefined') return;
    autoBusy = true;
    nextAuto = Date.now() + 30000;
    let sub = null, modal = false;
    const RELAY = relayFor(readJson(SETTINGS_KEY, {}));
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
      sub = new WebSocket(`${wsUrl(RELAY)}/${topic}/ws`);
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
      const k = await next('key', force ? 15000 : 8000);
      if (!k?.pub) { if (force) safe(() => Spicetify.showNotification('No new phone answered. Open LyricDock on the phone and sign in to the same Spotify account.', true)); return; }
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', k.pub, EC, false, []) }, kp.privateKey, 256);
      const hk = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
      const digits = String(((hk[0] << 16) | (hk[1] << 8) | hk[2]) % 10000).padStart(4, '0');
      Spicetify.PopupModal.display({ title: 'Connect your LyricDock phone',
        content: `<div style="text-align:center;padding:8px 0 4px"><div style="opacity:.7">Your phone found this Spotify. Tap <b>Allow</b> on the phone if it shows:</div><div style="font-size:44px;font-weight:800;letter-spacing:.25em;margin:14px 0">${digits}</div></div>` });
      modal = true;
      const a = await next('accept', 65000);
      if (!a?.box) return;
      const aes = await crypto.subtle.importKey('raw', hk, 'AES-GCM', false, ['decrypt']);
      const c = cleanCode((await unseal(aes, a.box))?.code);
      if (c.length !== 10) return;
      addPair(c);
      safe(() => Spicetify.showNotification('LyricDock phone paired'));
      nextAuto = Date.now() + 60000; ensureLink(); renderPanel();
    } catch {} finally {
      try { sub?.close(); } catch {}
      if (modal) safe(() => Spicetify.PopupModal.hide());
      autoBusy = false;
    }
  }

  // ---- keep every paired phone linked. Failed dials back off (1, 2, 4, 8s, then every 10s).
  const dial = new Map();
  let adbBusy = false, nextAdb = 0;
  function ensureLink() {
    linkState();
    for (const [id, l] of links) if (l.readyState !== 1 || Date.now() - l.lastRx > 2500) closeLink(id, l.readyState === 1 ? 'went quiet' : 'disconnected');
    if (!links.has('adb') && !adbBusy && Date.now() > nextAdb) {
      adbBusy = true; nextAdb = Date.now() + 3000;
      tryOpen(1200).then(s => { adbBusy = false; if (s) adopt('adb', s, null); });
    }
    const adbCode = links.get('adb')?.code;
    for (const { code } of pairs()) {
      if (links.has(code) || code === adbCode) continue;
      const d = dial.get(code) ?? { busy: false, next: 0, fails: 0 };
      dial.set(code, d);
      if (d.busy || Date.now() < d.next) continue;
      d.busy = true;
      rtcOpen(code).then(s => {
        d.busy = false;
        if (s && !links.has(code) && links.get('adb')?.code !== code) { d.fails = 0; adopt(code, s, code); }
        else if (!s) { d.fails++; d.next = Date.now() + Math.min(10000, 1000 * 2 ** Math.min(d.fails - 1, 4)); }
        else s.close();
      });
    }
    if (!connected()) autoPair();
  }

  function adopt(id, s, code) {
    s.kind ??= 'adb';
    s.code = code;
    s.lastRx = Date.now();
    links.set(id, s);
    s.onclose = () => { if (links.get(id) === s) { links.delete(id); log(`${phoneName(s.code)} disconnected`); ensureLink(); } };
    s.onmessage = e => { s.lastRx = Date.now(); onMessage(e.data, s); };
    log(`${phoneName(code)} connected via ${s.kind === 'rtc' ? 'direct network (WebRTC)' : 'adb'}`);
    const S = settingsFor(code);
    sendTo(s, { type: 'hello', last: S, presets: readJson(PRESETS_KEY, {}), paired: !!code, version: VERSION });
    if (code && dirty(code)) { sendTo(s, { type: 'load', S }); dirty(code, false); }
    renderPanel();
    if (track) sendTo(s, track); else sendTrack();
    if (preload) sendTo(s, preload);
    extraMsgs.forEach(m => sendTo(s, m));
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

  const URI = /^spotify:[a-z]+:[A-Za-z0-9:._-]+$/;
  function onMessage(data, from) {
    const m = safe(() => JSON.parse(data), null);
    if (!m || typeof m !== 'object') return;
    if (m.type === 'alive') {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(m.ip ?? '')) from.ip = m.ip;
      const c = cleanCode(m.code);
      if (c.length === 10 && from.kind === 'adb' && from.code !== c) { from.code = c; closeLink(c, 'moved to adb'); addPair(c, m.name); renderPanel(); }
      if (c.length === 10 && typeof m.name === 'string' && m.name) addPair(c, m.name.slice(0, 40));
      return;
    }
    if (m.type === 'pair') {
      const c = cleanCode(m.code);
      if (c.length !== 10) return;
      if (from.kind === 'adb') from.code = c;
      if (addPair(c)) { safe(() => Spicetify.showNotification('LyricDock phone paired')); renderPanel(); }
    }
    else if (m.type === 'settings' && okSettings(m.S)) { saveSettings(from.code, m.S); if (!panelPhone || panelPhone === from.code) syncControls(m.S); }
    else if (m.type === 'schema' && Array.isArray(m.schema) && JSON.stringify(m.schema).length < 60000) {
      writeJson(SCHEMA_KEY, m.schema);
      if (m.builtins && typeof m.builtins === 'object' && JSON.stringify(m.builtins).length < 20000) writeJson('lyricdock:builtins', m.builtins);
      if (okSettings(m.defaults)) writeJson('lyricdock:defaults', m.defaults);
      if (okSettings(m.S)) saveSettings(from.code, m.S);
      renderPanel();
    }
    else if (m.type === 'preset' && typeof m.name === 'string' && m.name.length <= 40) {
      const presets = readJson(PRESETS_KEY, {});
      if (m.action === 'save' && okSettings(m.S)) { const { apiKey, videoKey, ...rest } = m.S; presets[m.name] = rest; } // keys stay out of presets
      else if (m.action === 'delete') delete presets[m.name];
      writeJson(PRESETS_KEY, presets);
      send({ type: 'presets', presets });
      renderPanel();
    }
    else if (m.type === 'cmd') {
      const uri = URI.test(m.uri ?? '') ? m.uri : null;
      if (m.cmd === 'toggle') P.togglePlay();
      else if (m.cmd === 'next') P.next();
      else if (m.cmd === 'prev') P.back();
      else if (m.cmd === 'heart') P.toggleHeart();
      else if (m.cmd === 'seek' && Number.isFinite(m.ms)) P.seek(Math.max(0, m.ms));
      else if (m.cmd === 'volume' && Number.isFinite(m.v)) P.setVolume(Math.max(0, Math.min(1, m.v / 100)));
      else if (m.cmd === 'shuffle') P.toggleShuffle();
      else if (m.cmd === 'repeat') { if (P.setRepeat) P.setRepeat(Number.isFinite(m.v) ? m.v % 3 : (P.getRepeat() + 1) % 3); else P.toggleRepeat(); }
      else if (m.cmd === 'play' && uri) playItem(uri, URI.test(m.ctx ?? '') ? m.ctx : null, !!m.shuffle);
      else if (uri && ['queueAdd', 'queueRemove', 'queueTop', 'like', 'unlike'].includes(m.cmd))
        act(m.cmd, uri, typeof m.uid === 'string' ? m.uid : null).then(r => sendTo(from, { type: 'acted', cmd: m.cmd, uri, ...r }));
      setTimeout(beat, 80);
    }
    else if (m.type === 'list' && ['queue', 'recent', 'library', 'friends', 'tracks', 'search'].includes(m.which)) {
      const arg = m.which === 'tracks' ? (URI.test(m.uri ?? '') ? m.uri : null) : m.which === 'search' ? String(m.q ?? '').slice(0, 100) : null;
      lists(m.which, arg).then(r => sendTo(from, { type: 'list', which: m.which, uri: m.uri, q: m.q, ...r }));
    }
  }

  // ---- queue / recently played / library / friends / browse / search for the phone's panel.
  // Spotify's own clients (Platform APIs, GraphQL) first; the Web API with the client's token as a fallback.
  const img = u => {
    u = u || '';
    if (u.startsWith('spotify:mosaic:')) return `https://mosaic.scdn.co/300/${u.slice(15).split(':').join('')}`;
    return u.replace('spotify:image:', 'https://i.scdn.co/image/');
  };
  const pickImg = srcs => {
    const s = [...(srcs ?? [])].map(x => ({ url: x?.url, w: x?.width || x?.maxWidth || 0 })).filter(x => x.url).sort((a, b) => a.w - b.w);
    return img((s.find(x => x.w >= 200) || s[s.length - 1])?.url);
  };
  async function token() {
    try {
      const s = await Spicetify.Platform.AuthorizationAPI?.getState?.();
      if (s?.token?.accessToken) return s.token.accessToken;
    } catch {}
    return Spicetify.Platform.Session?.accessToken;
  }
  async function web(path, method = 'GET') {
    const r = await fetch(path.startsWith('https:') ? path : `https://api.spotify.com/v1${path}`, { method, headers: { authorization: `Bearer ${await token()}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  const gql = (def, vars) => { const d = Spicetify.GraphQL?.Definitions?.[def]; if (!d) throw new Error(`no ${def}`); return Spicetify.GraphQL.Request(d, vars); };
  const names = xs => (xs ?? []).map(a => a?.name ?? a?.profile?.name).filter(Boolean).join(', ');
  const kindOf = uri => uri?.split(':')[1];

  function playItem(uri, ctx, shuffle) {
    if (shuffle) safe(() => P.setShuffle(true));
    if (/^spotify:(playlist|album|artist|show|collection|user)/.test(uri)) return P.playUri(uri);
    if (ctx) return P.playUri(ctx, {}, { skipTo: { uri } });
    return P.playUri(uri);
  }

  // Liked flags for track rows (one call for the whole list).
  async function withLiked(items) {
    const uris = items.filter(x => kindOf(x.uri) === 'track').map(x => x.uri).slice(0, 300);
    if (!uris.length) return items;
    try {
      const got = await Spicetify.Platform.LibraryAPI.contains(...uris);
      const set = new Set(uris.filter((u, i) => got?.[i]));
      return items.map(x => kindOf(x.uri) === 'track' ? { ...x, liked: set.has(x.uri) } : x);
    } catch { return items; }
  }

  async function act(cmd, uri, uid) {
    try {
      if (cmd === 'queueAdd') await Spicetify.addToQueue([{ uri }]);
      else if (cmd === 'queueRemove') await Spicetify.removeFromQueue([{ uri, ...(uid ? { uid } : {}) }]);
      else if (cmd === 'queueTop') {
        // Move to the top of the user queue: take the queued items out and put them back with this one first.
        const queued = (Spicetify.Queue?.nextTracks ?? []).filter(t => t?.provider === 'queue').map(t => t.contextTrack ?? t).filter(t => t?.uri);
        if (queued.length) await Spicetify.removeFromQueue(queued.map(t => ({ uri: t.uri, uid: t.uid })));
        const rest = queued.filter(t => !(t.uri === uri && (!uid || t.uid === uid)));
        await Spicetify.addToQueue([{ uri }, ...rest.map(t => ({ uri: t.uri }))]);
      }
      else if (cmd === 'like' || cmd === 'unlike') {
        const L = Spicetify.Platform.LibraryAPI;
        try { await (cmd === 'like' ? L.add({ uris: [uri] }) : L.remove({ uris: [uri] })); }
        catch { await web(`/me/library?uris=${encodeURIComponent(uri)}`, cmd === 'like' ? 'PUT' : 'DELETE'); }
        if (uri === item()?.uri) setTimeout(beat, 300);
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 120) }; }
  }

  // Local play history: always available, even when Spotify's recently-played endpoint refuses.
  const HISTORY_KEY = 'lyricdock:history';
  function remember_(t, it) {
    const h = readJson(HISTORY_KEY, []).filter(x => x.uri !== t.uri);
    h.unshift({ uri: t.uri, title: t.title, sub: t.artist, art: t.art, ctx: safe(() => P.data?.context?.uri, null) || undefined, time: Date.now() });
    writeJson(HISTORY_KEY, h.slice(0, 60));
  }

  const trackRow = (t, art) => ({ uri: t?.uri, uid: t?.uid, title: t?.name, sub: names(t?.artists?.items ?? t?.artists), art: art ?? pickImg(t?.album?.images ?? t?.albumOfTrack?.coverArt?.sources), dur: t?.duration?.milliseconds ?? t?.duration?.totalMilliseconds ?? t?.duration_ms });
  const boxRow = (uri, title, sub, art) => ({ uri, title, sub, art, box: true });

  async function lists(which, arg) {
    try {
      if (which === 'queue') {
        const q = Spicetify.Queue ?? {}, meta = t => { const c = t?.contextTrack ?? t, md = c?.metadata ?? {};
          return { uri: c?.uri, uid: c?.uid, title: md.title, sub: md.artist_name, art: img(md.image_url), queued: t?.provider === 'queue' }; };
        const items = (q.nextTracks ?? []).filter(t => (t?.contextTrack?.uri ?? t?.uri)?.startsWith('spotify:track') && t?.provider !== 'unavailable').slice(0, 80).map(meta);
        const ctx = safe(() => P.data?.context, null);
        return { now: q.track ? meta(q.track) : null, items: await withLiked(items), ctxName: ctx?.metadata?.context_description || '' };
      }
      if (which === 'recent') {
        let items = null;
        try {
          const r = await web('/me/player/recently-played?limit=50');
          items = (r?.items ?? []).map(x => ({ ...trackRow(x.track), ctx: x.context?.uri, time: Date.parse(x.played_at) }));
        } catch {}
        if (!items?.length) items = readJson(HISTORY_KEY, []);
        return { items: await withLiked(items) };
      }
      if (which === 'library') {
        const root = await Spicetify.Platform.RootlistAPI.getContents({ limit: 500 });
        const flat = xs => xs.flatMap(x => x.type === 'folder' ? flat(x.items ?? []) : [x]);
        const items = [boxRow('spotify:collection:tracks', 'Liked Songs', 'Playlist', 'liked'),
          ...flat(root?.items ?? []).filter(x => x.uri).map(x => boxRow(x.uri, x.name, ['Playlist', x.owner?.name ?? x.owner?.displayName].filter(Boolean).join(' · '), pickImg(x.images)))];
        const [al, ar] = await Promise.all([web('/me/albums?limit=50').catch(() => null), web('/me/following?type=artist&limit=50').catch(() => null)]);
        items.push(...(al?.items ?? []).map(a => boxRow(a.album.uri, a.album.name, `Album · ${names(a.album.artists)}`, pickImg(a.album.images))),
          ...(ar?.artists?.items ?? []).map(a => boxRow(a.uri, a.name, 'Artist', pickImg(a.images))));
        return { items };
      }
      if (which === 'friends') {
        const tok = await token();
        let r = null, err = '';
        for (const host of ['https://guc-spclient.spotify.com', 'https://spclient.wg.spotify.com']) {
          try {
            const x = await fetch(`${host}/presence-view/v1/buddylist`, { headers: { authorization: `Bearer ${tok}` } });
            if (x.ok) { r = await x.json(); break; }
            err = `HTTP ${x.status}`;
          } catch (e) { err = String(e?.message || e); }
        }
        if (!r) r = await Spicetify.CosmosAsync.get('https://spclient.wg.spotify.com/presence-view/v1/buddylist').catch(e => { throw new Error(err || e?.message); });
        return { items: (r?.friends ?? []).sort((a, b) => b.timestamp - a.timestamp).map(f => ({ uri: f.track?.uri, ctx: f.track?.context?.uri,
          title: f.user?.name, sub: `${f.track?.name ?? ''} · ${f.track?.artist?.name ?? ''}`, ctxName: f.track?.context?.name,
          art: f.user?.imageUrl || '', time: f.timestamp, live: Date.now() - f.timestamp < 5 * 60000, friend: true })) };
      }
      if (which === 'tracks' && arg) return await browse(arg);
      if (which === 'search' && arg) return await search(arg);
    } catch (e) { return { items: [], error: `Couldn't load this (${String(e?.message || e).slice(0, 80)})` }; }
    return { items: [] };
  }

  async function browse(uri) {
    const [, type, id] = uri.split(':');
    if (uri === 'spotify:collection:tracks' || /^spotify:user:[^:]+:collection$/.test(uri)) {
      let items;
      try { const r = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 500, offset: 0 }); items = (r?.items ?? []).map(t => trackRow(t)); }
      catch { const r = await web('/me/tracks?limit=50'); items = (r?.items ?? []).map(x => trackRow(x.track)); }
      return { head: { title: 'Liked Songs', sub: `${items.length} songs`, art: 'liked', uri: 'spotify:collection:tracks' }, ctx: 'spotify:collection:tracks', items: items.map(x => ({ ...x, liked: true })) };
    }
    if (type === 'playlist') {
      const A = Spicetify.Platform.PlaylistAPI;
      const [meta, c] = await Promise.all([A.getMetadata(uri).catch(() => null), A.getContents(uri, { limit: 500 })]);
      const items = (c?.items ?? []).filter(t => t?.uri).map(t => trackRow(t));
      return { head: { uri, title: meta?.name ?? 'Playlist', sub: [meta?.owner?.displayName ?? meta?.owner?.name, `${c?.totalLength ?? items.length} songs`].filter(Boolean).join(' · '), art: pickImg(meta?.images) }, ctx: uri, items: await withLiked(items) };
    }
    if (type === 'album') {
      let head, items;
      try {
        const a = (await gql('getAlbum', { uri, locale: '', offset: 0, limit: 300 }))?.data?.albumUnion;
        const art = pickImg(a?.coverArt?.sources);
        items = ((a?.tracksV2 ?? a?.tracks)?.items ?? []).map(x => trackRow(x.track, art));
        head = { uri, title: a?.name, sub: [names(a?.artists?.items), (a?.date?.isoString || '').slice(0, 4)].filter(Boolean).join(' · '), art };
      } catch {
        const a = await web(`/albums/${id}`), art = pickImg(a?.images);
        items = (a?.tracks?.items ?? []).map(t => trackRow(t, art));
        head = { uri, title: a?.name, sub: [names(a?.artists), (a?.release_date || '').slice(0, 4)].filter(Boolean).join(' · '), art };
      }
      return { head, ctx: uri, items: await withLiked(items) };
    }
    if (type === 'artist') {
      let head, items = [];
      try {
        const u = (await gql('queryArtistOverview', { uri, locale: '', includePrerelease: false }))?.data?.artistUnion, d = u?.discography;
        head = { uri, title: u?.profile?.name, sub: 'Artist', art: pickImg(u?.visuals?.avatarImage?.sources), round: true };
        items = (d?.topTracks?.items ?? []).map(x => ({ ...trackRow(x.track), section: 'Popular' }));
        const rel = [...(d?.popularReleasesAlbums?.items ?? []), ...(d?.albums?.items ?? []).flatMap(x => x?.releases?.items ?? [x]), ...(d?.singles?.items ?? []).flatMap(x => x?.releases?.items ?? [x])];
        const seen = new Set();
        for (const r of rel) if (r?.uri && !seen.has(r.uri)) { seen.add(r.uri); items.push({ ...boxRow(r.uri, r.name, [r.type ? r.type[0] + r.type.slice(1).toLowerCase() : 'Album', r.date?.year].filter(Boolean).join(' · '), pickImg(r.coverArt?.sources)), section: 'Releases' }); }
      } catch {
        const [a, t, al] = await Promise.all([web(`/artists/${id}`), web(`/artists/${id}/top-tracks?market=from_token`).catch(() => null), web(`/artists/${id}/albums?limit=40`).catch(() => null)]);
        head = { uri, title: a?.name, sub: 'Artist', art: pickImg(a?.images), round: true };
        items = [...(t?.tracks ?? []).map(x => ({ ...trackRow(x), section: 'Popular' })),
          ...(al?.items ?? []).map(x => ({ ...boxRow(x.uri, x.name, [x.album_type, (x.release_date || '').slice(0, 4)].join(' · '), pickImg(x.images)), section: 'Releases' }))];
      }
      return { head, ctx: uri, items: await withLiked(items) };
    }
    throw new Error('Not browsable');
  }

  async function search(q) {
    let items = [];
    try {
      const s = (await gql('searchDesktop', { searchTerm: q, offset: 0, limit: 10, numberOfTopResults: 5, includeAudiobooks: false,
        includeArtistHasConcertsField: false, includePreReleases: false, includeLocalConcertsField: false, includeAuthors: false }))?.data?.searchV2;
      if (!s) throw new Error('no results');
      const d = x => x?.item?.data ?? x?.data ?? x;
      items = [
        ...(s.tracksV2?.items ?? []).map(d).filter(t => t?.uri).map(t => ({ ...trackRow(t), section: 'Songs' })),
        ...(s.artists?.items ?? []).map(d).filter(a => a?.uri).map(a => ({ ...boxRow(a.uri, a.profile?.name, 'Artist', pickImg(a.visuals?.avatarImage?.sources)), round: true, section: 'Artists' })),
        ...(s.albumsV2?.items ?? s.albums?.items ?? []).map(d).filter(a => a?.uri).map(a => ({ ...boxRow(a.uri, a.name, `Album · ${names(a.artists?.items)}`, pickImg(a.coverArt?.sources)), section: 'Albums' })),
        ...(s.playlists?.items ?? []).map(d).filter(p => p?.uri).map(p => ({ ...boxRow(p.uri, p.name, `Playlist · ${p.ownerV2?.data?.name ?? ''}`, pickImg(p.images?.items?.[0]?.sources)), section: 'Playlists' })),
      ];
    } catch {
      const r = await web(`/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=8`);
      items = [
        ...(r?.tracks?.items ?? []).map(t => ({ ...trackRow(t), section: 'Songs' })),
        ...(r?.artists?.items ?? []).map(a => ({ ...boxRow(a.uri, a.name, 'Artist', pickImg(a.images)), round: true, section: 'Artists' })),
        ...(r?.albums?.items ?? []).map(a => ({ ...boxRow(a.uri, a.name, `Album · ${names(a.artists)}`, pickImg(a.images)), section: 'Albums' })),
        ...(r?.playlists?.items ?? []).filter(Boolean).map(p => ({ ...boxRow(p.uri, p.name, `Playlist · ${p.owner?.display_name ?? ''}`, pickImg(p.images)), section: 'Playlists' })),
      ];
    }
    return { items: await withLiked(items) };
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
  const item = () => P.data?.item ?? P.data?.track;
  const artists = (it, m) => {
    const n = (it?.artists ?? []).map(a => a?.name).filter(Boolean);
    if (n.length) return n.join(', ');
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
    if (base.uri.startsWith('spotify:track:')) remember_(base, it);
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

  // Extras for the phone: the artist's picture ('Artist image' background), album + year, the Spotify Canvas
  // (looping video) and tempo + loudness from Spotify's audio analysis. Kept for reconnects.
  let extraMsgs = [];
  async function extras(it, id) {
    extraMsgs = [];
    const keep = m => { if (item()?.uri === it.uri) { extraMsgs.push(m); send(m); } };
    const artistUri = it.artists?.[0]?.uri || it.metadata?.artist_uri || '';
    (async () => {
      let url = null;
      try {
        const v = (await gql('queryArtistOverview', { uri: artistUri, locale: '', includePrerelease: false }))?.data?.artistUnion?.visuals;
        url = pickImg(v?.headerImage?.sources) || pickImg(v?.avatarImage?.sources) || null;
      } catch {}
      if (!url && artistUri) url = pickImg((await web(`/artists/${artistUri.split(':')[2]}`).catch(() => null))?.images) || null;
      if (url) keep({ type: 'artist', id, img: url });
      try {
        const albumUri = it.album?.uri || it.metadata?.album_uri;
        const a = albumUri ? (await gql('getAlbum', { uri: albumUri, locale: '', offset: 0, limit: 1 }))?.data?.albumUnion : null;
        keep({ type: 'album', id, album: a?.name || it.metadata?.album_title || '', year: (a?.date?.isoString || '').slice(0, 4) });
      } catch { keep({ type: 'album', id, album: it.metadata?.album_title || '', year: '' }); }
    })();
    // Spotify Canvas: the short looping video some songs have.
    (async () => {
      try {
        const c = (await gql('canvas', { uri: it.uri }))?.data?.trackUnion?.canvas;
        if (c?.url && /\.mp4(\?|$)/.test(c.url)) keep({ type: 'canvas', id, url: c.url });
      } catch {}
    })();
    try {
      const d = await Spicetify.getAudioData(it.uri);
      const segs = d?.segments ?? [], tempo = d?.track?.tempo;
      if (!segs.length || !Number.isFinite(tempo)) return;
      const n = Math.ceil((d.track.duration || segs[segs.length - 1].start + 1) * 2), loud = new Array(n).fill(0);
      for (const g of segs) { const i = Math.floor(g.start * 2); if (i < n) loud[i] = Math.max(loud[i], Math.min(1, Math.max(0, (g.loudness_max + 35) / 30))); }
      for (let i = 1; i < n; i++) if (!loud[i]) loud[i] = loud[i - 1]; // fill 0.5s slots between segments
      keep({ type: 'audio', id, tempo, loud: loud.map(v => Math.round(v * 100) / 100) });
    } catch {} // no audio analysis: the background keeps its set speed
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

  // ---- right-click menu: "Show on LyricDock" (browse a playlist / album / artist on the phone) and
  // "Play with lyrics on LyricDock" (play a song and wake the phone's screen).
  safe(() => {
    const CM = Spicetify.ContextMenu;
    new CM.Item('Show on LyricDock', ([u]) => { send({ type: 'browse', uri: u }); send({ type: 'wake' }); },
      ([u]) => connected() && (/^spotify:(playlist|album|artist|collection)/.test(u ?? '') || /^spotify:user:[^:]+:collection$/.test(u ?? ''))).register();
    new CM.Item('Play with lyrics on LyricDock', ([u]) => { P.playUri(u); send({ type: 'wake' }); },
      ([u]) => connected() && /^spotify:track:/.test(u ?? '')).register();
  });

  // ---- keyboard shortcuts: Ctrl+Alt+L settings panel, Ctrl+Alt+W wake the phone, Ctrl+Alt+Y next phone layout.
  function cycleLayout() {
    const x = readJson(SCHEMA_KEY, []).find(s => s.k === 'layout');
    if (!x?.opts?.length) return;
    const S = settingsFor(panelPhone), i = x.opts.findIndex(([v]) => v === S.layout);
    const v = x.opts[(i + 1) % x.opts.length][0];
    change('layout', v);
    safe(() => Spicetify.showNotification(`LyricDock layout: ${x.opts.find(([k]) => k === v)[1]}`));
  }
  const SHORTCUTS = { l: () => openPanel(), w: () => send({ type: 'wake' }), y: cycleLayout };
  addEventListener('keydown', e => {
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
    const f = SHORTCUTS[e.key.toLowerCase()];
    if (f) { e.preventDefault(); f(); }
  }, true);

  // ---- Spotify top bar: LyricDock button -> settings panel. The phone sends its settings schema, so the panel
  // always matches the app. Connected: changes apply instantly. Offline: saved, pushed when the phone connects.
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-8A2.5 2.5 0 0 1 4.5 4z"/>'
    + '<path d="M6 9h9" stroke-width="2.4"/><path d="M6 12.8h6" stroke-width="2.4" opacity=".5"/><path d="M12 17v2.6M8.6 20.6h6.8"/></svg>';
  // Panel look: Spotify's own - its font stack, neutral greys, pill buttons, green only where Spotify uses it (switches).
  const FONT = 'var(--encore-body-font-stack, SpotifyMixUI, CircularSp, "Helvetica Neue", system-ui, sans-serif)';
  const CSS = `.ld-panel{--hair:rgba(255,255,255,.07);--sub:rgba(255,255,255,.62);font-family:${FONT};font-size:14px;display:flex;flex-direction:column;gap:1px;padding-bottom:12px}
    .ld-panel h3{display:flex;align-items:baseline;justify-content:space-between;font-size:15px;font-weight:700;letter-spacing:-.01em;margin:22px 4px 6px;color:#fff}
    .ld-panel h3 a{font-size:12px;font-weight:600;color:var(--sub);cursor:pointer;text-decoration:none} .ld-panel h3 a:hover{color:#fff;text-decoration:underline}
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
    .ld-panel select,.ld-panel input[type=text],.ld-panel input[type=search]{background:#2a2a2a;color:#fff;border:0;border-radius:4px;padding:8px 12px;font:inherit;font-size:13px;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);transition:box-shadow .15s}
    .ld-panel select:hover,.ld-panel input[type=text]:hover,.ld-panel input[type=search]:hover{box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
    .ld-panel select:focus,.ld-panel input[type=text]:focus,.ld-panel input[type=search]:focus{outline:none;box-shadow:inset 0 0 0 1.5px #fff}
    .ld-panel button{cursor:pointer;font:700 13px/1 ${FONT};color:#fff;background:transparent;border:0;border-radius:999px;padding:9px 16px;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);transition:transform .1s,box-shadow .15s,background .15s}
    .ld-panel button:hover{box-shadow:inset 0 0 0 1px #fff;transform:scale(1.03)} .ld-panel button:active{transform:scale(.97)}
    .ld-panel button.ld-primary{background:#fff;color:#000;box-shadow:none} .ld-panel button.ld-primary:hover{background:#f0f0f0}
    .ld-panel option,.ld-panel optgroup{background:#282828;color:#fff}
    .ld-panel input[type=range]{width:210px;accent-color:#fff;cursor:pointer} .ld-panel input[type=text]{width:240px}
    .ld-search{position:sticky;top:149px;z-index:4;padding:8px 0;background:var(--background-elevated-base,#282828)} .ld-search input{width:100%!important;box-sizing:border-box}
    .ld-switch{-webkit-appearance:none;appearance:none;width:40px;height:22px;border-radius:11px;background:#535353;position:relative;cursor:pointer;margin:0;transition:background .2s}
    .ld-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s cubic-bezier(.3,1.3,.6,1)}
    .ld-switch:hover{background:#6a6a6a} .ld-switch:checked{background:#1ed760} .ld-switch:checked::after{transform:translateX(18px)}
    .ld-val{min-width:58px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:rgba(255,255,255,.85)}
    .ld-status{display:flex;align-items:center;gap:10px;padding:4px 12px 10px;font-size:13px;color:var(--sub)}
    .ld-status i,.ld-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#f15e6c;display:inline-block}
    .ld-status.on{color:#fff} .ld-status.on i,.ld-dot.on{background:#1ed760}
    .ld-presets{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ld-log{font-size:12px;color:var(--sub);padding:4px 12px;font-variant-numeric:tabular-nums;line-height:1.7}
    .ld-kbd{font:600 11px/1 ${FONT};padding:3px 6px;border-radius:4px;background:#3e3e3e;color:#fff;margin:0 2px}
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
    .ld-topbar.ld-on::after{background:#3ddc97}`;
  safe(() => { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); });

  let panel = null, panelPhone = null, filter = '';
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  // Every change is saved and sent at once (sliders while dragging), and shown in the live preview.
  function change(k, v) {
    const S = settingsFor(panelPhone);
    S[k] = v;
    saveSettings(panelPhone, S);
    const l = panelPhone ? linkFor(panelPhone) : openLinks()[0];
    if (l) sendTo(l, { type: 'set', k, v }); else if (panelPhone) dirty(panelPhone, true);
    preview(S);
  }
  function loadAll(patch) {
    const S = { ...settingsFor(panelPhone), ...patch };
    saveSettings(panelPhone, S);
    const l = panelPhone ? linkFor(panelPhone) : openLinks()[0];
    if (l) sendTo(l, { type: 'load', S: patch }); else if (panelPhone) dirty(panelPhone, true);
    renderPanel();
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
    if (x.type === 'action') return '';
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

  // Export / import the selected phone's settings as a JSON file (API keys left out of exports).
  function exportSettings() {
    const { apiKey, videoKey, spClientId, ...S } = settingsFor(panelPhone);
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })), download: 'lyricdock-settings.json' });
    document.body.append(a); a.click(); a.remove();
  }
  function importSettings() {
    const f = h('input', { type: 'file', accept: '.json,application/json' });
    f.onchange = async () => {
      const S = await f.files[0]?.text().then(t => safe(() => JSON.parse(t), null));
      if (!okSettings(S)) return safe(() => Spicetify.showNotification('That file is not a LyricDock settings file', true));
      loadAll(S);
      safe(() => Spicetify.showNotification('Settings imported'));
    };
    f.click();
  }

  // Versions: stable / beta channel and pinning an older build (rollback). Read by the loader (lyricdock.js v2+).
  let releases = null;
  async function loadReleases() {
    if (releases) return releases;
    releases = (await fetch('https://api.github.com/repos/DhakadG/lyricdock/releases?per_page=12').then(r => r.json()).catch(() => []))
      .filter(r => /^v\d+\.\d+\.\d+$/.test(r?.tag_name ?? '')).map(r => ({ v: r.tag_name.slice(1), pre: r.prerelease }));
    return releases;
  }
  async function useBuild(v) {
    const r = await fetch(`https://cdn.jsdelivr.net/gh/DhakadG/lyricdock@v${v}/extension/dock-bridge.js`);
    const code = await r.text();
    if (!r.ok || !code.includes('function dockBridge')) throw new Error('download failed');
    localStorage.setItem('lyricdock:build', code);
    localStorage.setItem('lyricdock:build-version', v);
    location.reload();
  }

  function renderPanel() {
    if (!panel?.isConnected) return;
    const schema = readJson(SCHEMA_KEY, []), presets = readJson(PRESETS_KEY, {}), ps = pairs();
    if (panelPhone && !ps.some(p => p.code === panelPhone)) panelPhone = null;
    panelPhone ??= openLinks().find(l => l.code)?.code ?? ps[0]?.code ?? null;
    const S = settingsFor(panelPhone), on = connected(), target = panelPhone ? linkFor(panelPhone) : openLinks()[0];
    const kids = [h('div', { className: 'ld-status' + (on ? ' on' : '') }, h('i'),
      on ? `${openLinks().length > 1 ? `${openLinks().length} phones` : 'Phone'} connected - changes apply instantly` : 'No phone connected - changes are saved and applied when it connects')];

    // version, channel, rollback
    const latest = window.__lyricdock?.latest, loaderV2 = (window.__lyricdock?.loader ?? 0) >= 2;
    kids.push(h('div', { className: 'ld-row' }, h('div', {}, `LyricDock ${VERSION === 'dev' ? '(development build)' : 'v' + VERSION}`,
      h('div', { className: 'ld-desc' }, VERSION === 'dev' ? 'Installed with -Dev: no auto-updates' : LS.get('lyricdock:pin') ? `Pinned to v${LS.get('lyricdock:pin')} - updates paused` : latest && latest !== VERSION ? `v${latest} downloaded` : 'Up to date - updates install automatically')),
      VERSION === 'dev' ? '' : latest && latest !== VERSION ? h('button', { className: 'ld-primary', onclick: () => location.reload() }, 'Update now')
        : h('button', { onclick: e => checkUpdate(e.target) }, 'Check for updates')));
    if (VERSION !== 'dev') {
      const chan = h('select', {}, h('option', { value: 'stable' }, 'Stable'), h('option', { value: 'beta' }, 'Beta (pre-releases)'));
      chan.value = LS.get('lyricdock:channel') === 'beta' ? 'beta' : 'stable';
      chan.onchange = () => { LS.set('lyricdock:channel', chan.value); checkUpdate(null); };
      const ver = h('select', {}, h('option', { value: '' }, 'Latest (auto-update)'));
      loadReleases().then(rs => { rs.forEach(r => ver.append(h('option', { value: r.v, selected: LS.get('lyricdock:pin') === r.v }, `v${r.v}${r.pre ? ' (beta)' : ''}`))); });
      ver.onchange = () => {
        if (!ver.value) { LS.set('lyricdock:pin', ''); checkUpdate(null); return; }
        LS.set('lyricdock:pin', ver.value);
        useBuild(ver.value).catch(() => safe(() => Spicetify.showNotification('Could not download that version', true)));
      };
      kids.push(h('div', { className: 'ld-row' }, h('div', {}, h('div', { className: 'ld-label' }, 'Update channel and version'),
        h('div', { className: 'ld-desc' }, loaderV2 ? 'Beta gets pre-releases first. Pick an older version to roll back (updates pause until you choose Latest).' : 'Run the updater once (Update popup → Run updater) to enable channels and rollback.')),
        h('div', { className: 'ld-presets' }, chan, ver)));
      chan.disabled = ver.disabled = !loaderV2;
    }

    // phones
    kids.push(h('h3', {}, 'Phones', h('a', { onclick: () => { autoPair(true); safe(() => Spicetify.showNotification('Looking for phones on your Spotify account…')); } }, 'Find phones on my account')));
    for (const p of ps) {
      const l = linkFor(p.code) || (links.get('adb')?.code === p.code ? links.get('adb') : null);
      const nameIn = h('input', { type: 'text', value: p.name, style: 'width:150px' });
      nameIn.onchange = () => { const all = pairs(); const x = all.find(y => y.code === p.code); if (x) { x.name = nameIn.value.trim().slice(0, 40) || x.name; writeJson(PAIRS_KEY, all); renderPanel(); } };
      kids.push(h('div', { className: 'ld-row' },
        h('div', {}, h('div', { className: 'ld-label' }, h('span', { className: 'ld-dot' + (l ? ' on' : '') }), nameIn),
          h('div', { className: 'ld-desc' }, `${p.code.slice(0, 4)}-${p.code.slice(4, 7)}-${p.code.slice(7)} · ${l ? `connected via ${l.kind === 'rtc' ? 'direct network (WebRTC)' : 'adb'}${l.ip ? ` · ${l.ip}` : ''}` : 'offline'}`)),
        h('div', { className: 'ld-presets' },
          ...(ps.length > 1 ? [h('button', { className: panelPhone === p.code ? 'ld-primary' : '', onclick: () => { panelPhone = p.code; renderPanel(); } }, panelPhone === p.code ? 'Editing' : 'Edit settings')] : []),
          h('button', { onclick: () => { if (confirm(`Unpair ${p.name}?`)) { removePair(p.code); renderPanel(); } } }, 'Unpair'))));
    }
    const codeIn = h('input', { type: 'text', placeholder: 'Code on the phone, e.g. K7QX-9MP-2F2' });
    kids.push(h('div', { className: 'ld-row' },
      h('div', {}, h('div', {}, ps.length ? 'Add another phone' : 'Pair a phone'), h('div', { className: 'ld-desc' }, 'Enter the code the phone shows under its waiting screen (Settings → Connection). Several phones can be paired, each with its own settings.')),
      h('div', { className: 'ld-presets' }, codeIn, h('button', { onclick: () => {
        const c = cleanCode(codeIn.value);
        if (c.length !== 10) return safe(() => Spicetify.showNotification('That code should be 10 characters', true));
        addPair(c); panelPhone = c; ensureLink(); renderPanel();
      } }, 'Pair'))));

    // presets
    const names_ = Object.keys(presets).sort();
    // Built-in presets come from the phone (its shipped default config and variants); yours are stored here.
    const builtins = readJson('lyricdock:builtins', {}), defs = readJson('lyricdock:defaults', {});
    const grp = (lab, list, pre) => { const g = h('optgroup', { label: lab }); list.forEach(n => g.append(h('option', { value: pre + n }, n))); return g; };
    const sel = h('select', {}, ...(Object.keys(builtins).length ? [grp('Built-in', Object.keys(builtins), 'b:')] : []),
      ...(names_.length ? [grp('Yours', names_, 'u:')] : [h('option', { value: '' }, 'No presets of yours yet - save one')]));
    const chosen = () => sel.value.startsWith('b:') ? { ...defs, ...builtins[sel.value.slice(2)] } : presets[sel.value.slice(2)];
    const name = h('input', { type: 'text', placeholder: 'New preset name' });
    const savePresets = p => { writeJson(PRESETS_KEY, p); send({ type: 'presets', presets: p }); renderPanel(); };
    kids.push(h('h3', {}, `Presets${ps.length > 1 ? ` · ${phoneName(panelPhone)}` : ''}`, h('span', { className: 'ld-presets' },
      h('a', { onclick: exportSettings }, 'Export'), h('a', { onclick: importSettings }, 'Import'))),
    h('div', { className: 'ld-row' }, h('div', { className: 'ld-presets' },
      sel,
      h('button', { onclick: () => { const p = chosen(); if (p) loadAll(p); } }, 'Apply'),
      h('button', { onclick: () => { if (!sel.value.startsWith('u:')) return; const p = { ...presets }; delete p[sel.value.slice(2)]; savePresets(p); } }, 'Delete'),
      name,
      h('button', { onclick: () => { const n = name.value.trim().slice(0, 40); if (!n) return; const { apiKey, videoKey, ...rest } = S; savePresets({ ...presets, [n]: rest }); } }, 'Save current'))));

    // settings, with search and per-group reset
    const search = h('input', { type: 'search', placeholder: 'Search settings', value: filter });
    search.oninput = () => { filter = search.value; applyFilter(); };
    kids.push(h('div', { className: 'ld-search' }, search));
    if (!schema.length) kids.push(h('div', { className: 'ld-desc' }, 'Connect the phone once so its settings can load here.'));
    let group = null;
    for (const x of schema) {
      if (x.group) {
        group = x.group;
        const keys = [];
        for (let i = schema.indexOf(x) + 1; i < schema.length && !schema[i].group; i++) if (schema[i].k && schema[i].type !== 'action') keys.push(schema[i].k);
        const g = h('h3', {}, x.group, keys.length ? h('a', { onclick: () => { if (!confirm(`Reset "${x.group}" to defaults?`)) return;
          loadAll(Object.fromEntries(keys.filter(k => k in defs).map(k => [k, defs[k]]))); } }, 'Reset') : '');
        g.dataset.group = group;
        kids.push(g);
        continue;
      }
      if (x.type === 'action') continue; // phone-only actions (leave kiosk...)
      const row = h('div', { className: 'ld-row' }, h('div', {}, label(x), ...(x.desc ? [h('div', { className: 'ld-desc' }, x.desc)] : [])), control(x, S));
      row.dataset.find = `${x.label} ${x.help ?? ''} ${x.desc ?? ''} ${group ?? ''}`.toLowerCase();
      row.dataset.inGroup = group;
      kids.push(row);
    }

    // connection log + shortcuts
    kids.push(h('h3', {}, 'Connection log'), h('div', { className: 'ld-log' }, ...(events.length ? events.slice(0, 12).map(e =>
      h('div', {}, `${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  ${e.text}`)) : ['Nothing yet'])));
    const kbd = t => h('span', { className: 'ld-kbd' }, t);
    kids.push(h('h3', {}, 'Shortcuts'), h('div', { className: 'ld-log' },
      h('div', {}, kbd('Ctrl'), kbd('Alt'), kbd('L'), ' this panel'), h('div', {}, kbd('Ctrl'), kbd('Alt'), kbd('W'), ' wake the phone'),
      h('div', {}, kbd('Ctrl'), kbd('Alt'), kbd('Y'), ' next phone layout'), h('div', {}, 'Right-click a song, playlist, album or artist for LyricDock actions.')));
    if (!target && on) kids.splice(1, 0, h('div', { className: 'ld-desc', style: 'padding:0 12px 8px' }, `${phoneName(panelPhone)} is offline - its settings are saved and sent when it connects.`));

    // Keep the scroll position: rebuilding must never throw you back to the top.
    const sc = scroller(), top = sc?.scrollTop ?? 0;
    panel.replaceChildren(previewBox, ...kids);
    if (sc) sc.scrollTop = top;
    applyFilter();
    preview(S);
  }
  function applyFilter() {
    if (!panel) return;
    const q = filter.trim().toLowerCase(), hit = new Set();
    for (const r of panel.querySelectorAll('[data-find]')) { const ok = !q || r.dataset.find.includes(q); r.style.display = ok ? '' : 'none'; if (ok) hit.add(r.dataset.inGroup); }
    for (const g of panel.querySelectorAll('h3[data-group]')) g.style.display = !q || hit.has(g.dataset.group) ? '' : 'none';
  }

  function openPanel() {
    panel = h('div', { className: 'ld-panel' });
    Spicetify.PopupModal.display({ title: 'LyricDock', content: panel, isLarge: true });
    renderPanel();
  }
  // isRight: Spicetify gives right-side buttons the class of Spotify's own round action buttons (left ones sit
  // small among the back/forward arrows), so this matches the native top-bar buttons.
  safe(() => new Spicetify.Topbar.Button('LyricDock', ICON, openPanel, false, true).element.classList.add('ld-topbar'));

  // Which build should run: a pinned version, else the channel's newest (version.json: {version, beta}).
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  async function wanted() {
    const pin = LS.get('lyricdock:pin');
    if (/^\d+\.\d+\.\d+$/.test(pin || '')) return pin;
    const j = await (await fetch(`https://raw.githubusercontent.com/DhakadG/lyricdock/main/extension/version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    return LS.get('lyricdock:channel') === 'beta' && /^\d+\.\d+\.\d+$/.test(j.beta ?? '') && newer(j.beta, j.version) ? j.beta : j.version;
  }
  // Manual "Check for updates": download the new build into the loader's cache (so it's used even if Update isn't
  // clicked), then show the update popup.
  async function checkUpdate(btn) {
    const say = t => { if (btn) btn.textContent = t; };
    say('Checking…');
    try {
      const v = await wanted();
      if (!/^\d+\.\d+\.\d+$/.test(v) || v === VERSION) { say('Up to date'); setTimeout(() => say('Check for updates'), 3000); return; }
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
