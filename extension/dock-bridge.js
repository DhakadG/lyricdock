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
  let shown = null, pendingState = null, pendingSince = 0, linkSig = '';
  function linkState() {
    const on = connected();
    // The panel follows every change in which phones are linked (and how) at once; only the notification waits.
    const sig = openLinks().map(l => `${l.code}:${l.kind}`).sort().join();
    if (sig !== linkSig) { linkSig = sig; renderPanel(); }
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

  // Offers go out on the chosen relay and ntfy.sh in turn (the phone listens on both), so a relay mismatch between
  // the two ends can never strand a paired phone.
  const NTFY = 'https://ntfy.sh';
  const relaysFor = S => [...new Set([relayFor(S), NTFY])];
  async function rtcOpen(code, attempt = 0) {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const S = settingsFor(code), rs = relaysFor(S), RELAY = rs[attempt % rs.length];
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
      const w = rtcWrap(pc, dc);
      w.relay = RELAY;
      return w;
    } catch { try { pc.close(); } catch {} return null; }
    finally { try { sub?.close(); } catch {} }
  }

  // Looks like a WebSocket to the rest of the bridge; splits big messages (SCTP caps message size).
  function rtcWrap(pc, dc) {
    const parts = new Map();
    const w = { kind: 'rtc', pc, onmessage: null, onclose: null,
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
  // How a live WebRTC link travels: direct on the network, or through a TURN relay; round trip in ms.
  async function linkPath(l) {
    try {
      const st = await l.pc.getStats(), all = [...st.values()];
      const tr = all.find(x => x.type === 'transport' && x.selectedCandidatePairId);
      const pair = tr ? st.get(tr.selectedCandidatePairId) : all.find(x => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
      const loc = pair && st.get(pair.localCandidateId);
      l.via = loc?.candidateType === 'relay' ? 'TURN relay' : 'same network';
      l.rtt = pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : l.rtt;
    } catch {}
  }

  // ---- Find devices. Phones listen on lobby topics for their network (derived from the public IP both ends share,
  // learnt through STUN) and their Spotify account. Spotify asks who is there, each phone answers with its name and
  // an ECDH key; Connect shows the same 4 digits on both screens and the phone's Allow hands its pairing code over,
  // encrypted with the agreed key. Mirrors rtc.js on the phone.
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
  const shaHex = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s))));
  async function accountId() {
    return safe(() => Spicetify.Platform.username, null) || (await Spicetify.CosmosAsync.get('https://api.spotify.com/v1/me').catch(() => null))?.id || null;
  }
  let netIp = null, netAt = 0;
  async function publicIp() {
    if (netIp && Date.now() - netAt < 10 * 60000) return netIp;
    const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] });
    try {
      p.createDataChannel('x');
      const ip = new Promise(res => {
        p.onicecandidate = e => { const m = / (\d+\.\d+\.\d+\.\d+) \d+ typ srflx/.exec(e.candidate?.candidate || ''); if (m) res(m[1]); if (!e.candidate) res(null); };
        setTimeout(() => res(null), 5000);
      });
      await p.setLocalDescription(await p.createOffer());
      const got = await ip;
      if (got) { netIp = got; netAt = Date.now(); }
    } catch {} finally { try { p.close(); } catch {} }
    return netIp;
  }
  const deskId = () => { let d = LS.get('lyricdock:desk'); if (!d) { d = Math.random().toString(36).slice(2, 12); LS.set('lyricdock:desk', d); } return d; };
  const deskName = () => `Spotify on ${safe(() => Spicetify.Platform.PlatformData?.os_name, '') || navigator.userAgentData?.platform || 'this computer'}`;

  // One scan at a time; the panel renders scan.found and each device's state (found / asking / paired / denied).
  let scan = null;
  async function findDevices() {
    if (scan?.running) return;
    if (typeof RTCPeerConnection === 'undefined') return;
    const kp = await crypto.subtle.generateKey(EC, false, ['deriveBits']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey), desk = deskId();
    const [ip, uid] = await Promise.all([publicIp(), accountId()]);
    const topics = [...(ip ? [['net', 'ldn' + (await shaHex('lyricdock-net:' + ip)).slice(0, 24)]] : []), ...(uid ? [['acct', 'lda' + (await shaHex('lyricdock-account:' + uid)).slice(0, 24)]] : [])];
    const rs = relaysFor(readJson(SETTINGS_KEY, {}));
    scan = { running: true, found: new Map(), kp, desk, topics, socks: [], ip: !!ip, account: !!uid, startedAt: Date.now() };
    const s = scan;
    for (const r of rs) for (const [how, t] of topics) {
      const ws = new WebSocket(`${wsUrl(r)}/${t}/ws`);
      s.socks.push(ws);
      ws.onmessage = e => {
        const ev = safe(() => JSON.parse(e.data), {}), m = ev.event === 'message' ? safe(() => JSON.parse(ev.message), null) : null;
        if (m?.desk !== desk) return;
        if (m.t === 'here' && m.pub && typeof m.id === 'string') {
          const old = s.found.get(m.id);
          s.found.set(m.id, { ...(old ?? { state: 'found', how: new Set() }), id: m.id, name: String(m.name || 'Phone').slice(0, 40), pub: m.pub, relay: old?.relay ?? r, topic: old?.topic ?? t, linked: !!m.linked });
          s.found.get(m.id).how.add(how);
          renderPanel();
        } else if (m.t === 'accept' && m.box) accepted(s, m);
        else if (m.t === 'deny') { const d = s.found.get(m.from); if (d) { d.state = 'denied'; renderPanel(); } }
      };
    }
    const ask = () => { for (const r of rs) for (const [, t] of topics) fetch(`${r}/${t}`, { method: 'POST', body: JSON.stringify({ t: 'scan', desk, name: deskName(), pub }), headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {}); };
    setTimeout(ask, 800); setTimeout(ask, 4000); setTimeout(ask, 9000);
    renderPanel();
    // Stop listening after 90s unless a phone is mid-pairing.
    const end = () => { if ([...s.found.values()].some(d => d.state === 'asking') && Date.now() - s.startedAt < 180000) return setTimeout(end, 5000);
      s.running = false; s.socks.forEach(w => { try { w.close(); } catch {} }); renderPanel(); };
    setTimeout(() => { s.scanned = true; renderPanel(); }, 12000);
    setTimeout(end, 90000);
  }
  async function connectDevice(id) {
    const s = scan, d = s?.found.get(id);
    if (!d) return;
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', d.pub, EC, false, []) }, s.kp.privateKey, 256);
    d.hk = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
    d.digits = String(((d.hk[0] << 16) | (d.hk[1] << 8) | d.hk[2]) % 10000).padStart(4, '0');
    d.state = 'asking';
    renderPanel();
    fetch(`${d.relay}/${d.topic}`, { method: 'POST', body: JSON.stringify({ t: 'connect', desk: s.desk, to: id }), headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {});
  }
  async function accepted(s, m) {
    const d = s.found.get(m.from);
    if (!d?.hk || d.state === 'paired') return;
    const aes = await crypto.subtle.importKey('raw', d.hk, 'AES-GCM', false, ['decrypt']);
    const c = cleanCode((await unseal(aes, m.box))?.code);
    if (c.length !== 10) return;
    addPair(c, d.name);
    d.state = 'paired'; d.code = c;
    dial.delete(c);
    safe(() => Spicetify.showNotification(`${d.name} connected to LyricDock`));
    ensureLink(); renderPanel();
  }
  // First run with nothing paired: look once in the background and say so if a phone is around.
  setTimeout(async () => {
    if (pairs().length) return;
    await findDevices();
    setTimeout(() => { if (!pairs().length && scan?.found.size) safe(() => Spicetify.showNotification(`LyricDock found ${[...scan.found.values()][0].name} - press Ctrl+Alt+L to connect`)); }, 12000);
  }, 6000);

  // ---- keep every paired phone linked. Failed dials back off (1, 2, 4, 8s, then every 10s) and alternate relays.
  const dial = new Map();
  let adbBusy = false, nextAdb = 0;
  function ensureLink() {
    linkState();
    // Quiet = dead: 2.5s over adb (a forwarded socket can look open after the phone died), 8s over WebRTC, which rides
    // out Wi-Fi power-save hiccups (ICE recovers by itself; closing early is what caused needless reconnects).
    for (const [id, l] of links) if (l.readyState !== 1 || Date.now() - l.lastRx > (l.kind === 'rtc' ? 8000 : 2500)) closeLink(id, l.readyState === 1 ? 'went quiet' : 'disconnected');
    if (!links.has('adb') && !adbBusy && Date.now() > nextAdb) {
      adbBusy = true; nextAdb = Date.now() + 3000;
      tryOpen(1200).then(s => { adbBusy = false; if (s) adopt('adb', s, null); });
    }
    const adbCode = links.get('adb')?.code;
    for (const { code } of pairs()) {
      if (links.has(code) || code === adbCode) continue;
      const d = dial.get(code) ?? { busy: false, next: 0, fails: 0, n: 0 };
      dial.set(code, d);
      if (d.busy || Date.now() < d.next) continue;
      d.busy = true;
      rtcOpen(code, d.n++).then(s => {
        d.busy = false;
        if (s && !links.has(code) && links.get('adb')?.code !== code) { d.fails = 0; adopt(code, s, code); }
        else if (!s) { d.fails++; d.next = Date.now() + Math.min(10000, 1000 * 2 ** Math.min(d.fails - 1, 4)); }
        else s.close();
      });
    }
  }
  setInterval(() => openLinks().forEach(l => l.pc && linkPath(l)), 5000);

  function adopt(id, s, code) {
    s.kind ??= 'adb';
    s.code = code;
    s.lastRx = Date.now();
    s.since = Date.now();
    links.set(id, s);
    s.onclose = () => { if (links.get(id) === s) { links.delete(id); log(`${phoneName(s.code)} disconnected`); ensureLink(); } };
    s.onmessage = e => { s.lastRx = Date.now(); onMessage(e.data, s); };
    log(`${phoneName(code)} connected${s.kind === 'rtc' ? '' : ' over adb'}`);
    if (s.pc) linkPath(s);
    const S = settingsFor(code);
    sendTo(s, { type: 'hello', last: S, presets: readJson(PRESETS_KEY, {}), paired: !!code, version: VERSION, desk: deskName() });
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
    // Diagnostics for development: which of Spotify's internal APIs this client has (names only), last errors.
    else if (m.type === 'probe') sendTo(from, { type: 'diag', gql: Object.keys(Spicetify.GraphQL?.Definitions ?? {}), platform: Object.keys(Spicetify.Platform ?? {}), errors: lastErrors.slice(-10) });
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
  // Spotify rate-limits the client's Web API token hard (429): cache slow-changing answers for 10 minutes.
  const memo = new Map();
  async function webCached(path, ttl = 600000) {
    const hit = memo.get(path);
    if (hit && Date.now() - hit.at < ttl) return hit.v;
    const v = await web(path);
    memo.set(path, { v, at: Date.now() });
    return v;
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
          const r = await webCached('/me/player/recently-played?limit=50', 60000);
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
        const [al, ar] = await Promise.all([webCached('/me/albums?limit=50').catch(() => null), webCached('/me/following?type=artist&limit=50').catch(() => null)]);
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
      const items = (c?.items ?? []).filter(t => t?.uri && t?.name).map(t => trackRow(t)); // unavailable / local rows have no name
      return { head: { uri, title: meta?.name ?? 'Playlist', sub: [meta?.owner?.displayName ?? meta?.owner?.name, `${c?.totalLength ?? items.length} songs`].filter(Boolean).join(' · '), art: pickImg(meta?.images) }, ctx: uri, items: await withLiked(items) };
    }
    if (type === 'album') {
      let head, items;
      try {
        const a = (await gql('getAlbum', { uri, locale: '', offset: 0, limit: 300 }))?.data?.albumUnion;
        const art = pickImg(a?.coverArt?.sources);
        items = ((a?.tracksV2 ?? a?.tracks)?.items ?? []).map(x => trackRow(x.track, art));
        head = { uri, title: a?.name, sub: [names(a?.artists?.items), (a?.date?.isoString || '').slice(0, 4)].filter(Boolean).join(' · '), art };
      } catch (e) {
        noteErr('album gql', e);
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

  const lastErrors = [];
  const noteErr = (where, e) => { lastErrors.push(`${where}: ${String(e?.message || e).slice(0, 160)}`); if (lastErrors.length > 20) lastErrors.shift(); };
  // Spotify renames its search query between versions (searchDesktop, then searchModalResults...): try what exists,
  // and read the answer by walking it for anything with a track / album / artist / playlist URI - so a reshuffled
  // response still works. The Web API (rate-limited for the client's token) is the last resort.
  const SEARCH_VARS = q => ({ searchTerm: q, offset: 0, limit: 10, numberOfTopResults: 5, includeAudiobooks: false, includeArtistHasConcertsField: false,
    includePreReleases: false, includeLocalConcertsField: false, includeAuthors: false, includeEpisodeContentRatingsV2: false });
  function harvest(root) {
    const out = new Map(), seen = new Set();
    const imgOf = o => pickImg(o?.coverArt?.sources ?? o?.albumOfTrack?.coverArt?.sources ?? o?.visuals?.avatarImage?.sources ?? o?.images?.items?.[0]?.sources ?? o?.images);
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 12 || seen.has(o)) return;
      seen.add(o);
      const uri = typeof o.uri === 'string' ? o.uri : '', kind = /^spotify:(track|album|artist|playlist):/.exec(uri)?.[1];
      const name = o.name ?? o.profile?.name;
      if (kind && name && !out.has(uri)) {
        if (kind === 'track') out.set(uri, { ...trackRow(o, imgOf(o)), section: 'Songs' });
        else if (kind === 'artist') out.set(uri, { ...boxRow(uri, name, 'Artist', imgOf(o)), round: true, section: 'Artists' });
        else if (kind === 'album') out.set(uri, { ...boxRow(uri, name, ['Album', names(o.artists?.items ?? o.artists)].filter(Boolean).join(' · '), imgOf(o)), section: 'Albums' });
        else out.set(uri, { ...boxRow(uri, name, ['Playlist', o.ownerV2?.data?.name ?? o.owner?.name].filter(Boolean).join(' · '), imgOf(o)), section: 'Playlists' });
      }
      for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, depth + 1);
    };
    walk(root, 0);
    const order = { Songs: 0, Artists: 1, Albums: 2, Playlists: 3 };
    return [...out.values()].sort((x, y) => order[x.section] - order[y.section]);
  }
  async function search(q) {
    let items = [];
    for (const def of ['searchDesktop', 'searchModalResults', 'searchSuggestions']) {
      if (!Spicetify.GraphQL?.Definitions?.[def]) continue;
      try {
        const r = await gql(def, SEARCH_VARS(q));
        if (r?.errors?.length) throw new Error(r.errors[0]?.message || 'error');
        // Merge: the quick-search query returns top songs, suggestions add artists / albums / playlists.
        const seen = new Set(items.map(x => x.uri));
        for (const x of harvest(r?.data)) if (!seen.has(x.uri)) { seen.add(x.uri); items.push(x); }
      } catch (e) { noteErr(`search ${def}`, e); }
    }
    const order = { Songs: 0, Artists: 1, Albums: 2, Playlists: 3 };
    items.sort((x, y) => order[x.section] - order[y.section]);
    if (!items.length) {
      const r = await web(`/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=8`);
      items = harvest(r);
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
        const c = (await gql('canvas', { trackUri: it.uri, uri: it.uri }))?.data?.trackUnion?.canvas;
        if (c?.url && /\.mp4(\?|$)/.test(c.url)) keep({ type: 'canvas', id, url: c.url });
      } catch (e) { noteErr('canvas', e); }
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
  // Spotify's own key handling (Mousetrap) swallows plain listeners, so bind through it; e.code keeps Ctrl+Alt from
  // turning into AltGr characters on some keyboard layouts.
  const SHORTCUTS = { KeyL: () => openPanel(), KeyW: () => { send({ type: 'wake' }); safe(() => Spicetify.showNotification('Waking LyricDock')); }, KeyY: cycleLayout };
  let lastKey = 0;
  const fire = code => { if (Date.now() - lastKey < 300) return; lastKey = Date.now(); SHORTCUTS[code]?.(); };
  safe(() => { for (const c of Object.keys(SHORTCUTS)) Spicetify.Mousetrap.bind(`ctrl+alt+${c.slice(3).toLowerCase()}`, e => { e?.preventDefault?.(); fire(c); return false; }); });
  for (const target of [window, document]) target.addEventListener('keydown', e => {
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || !SHORTCUTS[e.code]) return;
    e.preventDefault(); e.stopPropagation(); fire(e.code);
  }, true);

  // ---- Spotify top bar: LyricDock button -> settings window. The phone sends its settings schema (with section
  // icons), so the window always matches the app. Connected: changes apply instantly. Offline: saved, sent later.
  // Layout (after ivLyrics' settings): a sidebar of sections grouped by category with a search box, the section on
  // the right as cards of rows, and a live preview only on the sections that change how the phone looks - full size
  // at the top, shrinking to a slim strip as you scroll so it stays in view without eating the page.
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-8A2.5 2.5 0 0 1 4.5 4z"/>'
    + '<path d="M6 9h9" stroke-width="2.4"/><path d="M6 12.8h6" stroke-width="2.4" opacity=".5"/><path d="M12 17v2.6M8.6 20.6h6.8"/></svg>';
  const FONT = 'var(--encore-body-font-stack, SpotifyMixUI, CircularSp, "Helvetica Neue", system-ui, sans-serif)';
  const I = { // desktop-only sections
    overview: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
    devices: 'M7 2.5h10v19H7zM11 18.5h2',
    diag: 'M4 5h16M4 10h16M4 15h10M4 20h7',
    search: 'M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4.5 4.5',
    presets: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5',
    close: 'M6 6l12 12M18 6L6 18',
    eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  };
  // Section icons / colours / categories built in, so the sidebar is right even before the phone sends its schema.
  const META = {
    'Layout': ['M3.5 4.5h17v15h-17zM9.5 4.5v15', '#0A84FF', 'View', 'Where the cover, title, controls and lyrics sit, and which gestures work.'],
    'Now playing': ['M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', '#FF375F', 'View', 'The song details around the lyrics.'],
    'Background': ['M3.5 5h17v14h-17zM3.5 16l5-5 4 4 3-3 5 5M15.5 9.5h.01', '#BF5AF2', 'View', 'What moves behind the lyrics.'],
    'Lyrics': ['M4 6h16M4 11h11M4 16h14M4 20.5h8', '#FF9F0A', 'View', 'Font, size, spacing, colours and word effects.'],
    'Animations': ['M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5', '#64D2FF', 'View', 'How songs change and how the lyrics glide.'],
    'Screen': ['M7 2.5h10v19H7zM11 18.5h2', '#8E8E93', 'Device', 'Keep-awake, brightness, night mode and the phone\'s buttons.'],
    'Clock': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.2 2', '#5E5CE6', 'Device', 'The flip clock.'],
    'Performance': ['M4 17a8 8 0 1 1 16 0M12 17l4.2-5.3M3 17h2M19 17h2', '#30D158', 'Device', 'Trade looks for smoothness on slower phones.'],
    'Playback source': ['M4 15v-3a8 8 0 0 1 16 0v3M4 14.5h3v6H4zM17 14.5h3v6h-3z', '#FF453A', 'Source', 'Follow Spotify on the computer, your account, or both.'],
    'Updates': ['M12 3.5v11M7 10l5 5 5-5M4.5 20h15', '#0A84FF', 'Ops', 'Automatic updates and release notes.'],
    'Connection': ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', '#30D158', 'Ops', 'How the phone and Spotify find each other.'],
  };
  const svgIcon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const CSS = `.ldx{--hair:rgba(255,255,255,.07);--sub:rgba(255,255,255,.6);--g:#1ed760;position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
      background:rgba(0,0,0,.62);font-family:${FONT};font-size:14px;color:#fff;animation:ldxIn .16s ease-out}
    @keyframes ldxIn{from{opacity:0}} @keyframes ldxCard{from{transform:translateY(10px) scale(.985);opacity:0}}
    .ldx-card{width:min(1180px,94vw);height:min(840px,90vh);display:grid;grid-template-rows:auto 1fr;background:#121212;border-radius:14px;overflow:hidden;
      box-shadow:0 40px 90px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.07);animation:ldxCard .22s cubic-bezier(.2,.8,.2,1)}
    .ldx-head{display:flex;align-items:center;gap:12px;padding:16px 18px 16px 24px;border-bottom:1px solid var(--hair)}
    .ldx-title{font-size:21px;font-weight:800;letter-spacing:-.02em}
    .ldx-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;color:var(--sub);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);font-variant-numeric:tabular-nums}
    .ldx-conn{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:13px;color:var(--sub)}
    .ldx-conn i{width:8px;height:8px;border-radius:50%;background:#f15e6c} .ldx-conn.on{color:#fff} .ldx-conn.on i{background:var(--g);box-shadow:0 0 0 4px rgba(30,215,96,.15)}
    .ldx-x{width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:var(--sub);cursor:pointer;display:grid;place-items:center;margin-left:8px}
    .ldx-x:hover{background:rgba(255,255,255,.08);color:#fff}
    .ldx svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
    .ldx-body{display:grid;grid-template-columns:250px 1fr;min-height:0}
    .ldx-nav{border-right:1px solid var(--hair);padding:16px 12px 20px;overflow:auto;background:#0f0f0f}
    .ldx-find{position:relative;margin:0 2px 6px} .ldx-find svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--sub);width:16px;height:16px}
    .ldx-find input{width:100%;box-sizing:border-box;background:#1c1c1c;border:0;border-radius:8px;padding:11px 12px 11px 38px;color:#fff;font:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}
    .ldx-find input:focus{outline:none;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.55)}
    .ldx-cat{font-size:11.5px;font-weight:600;color:rgba(255,255,255,.42);margin:18px 12px 6px}
    .ldx-item{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;border:0;background:transparent;padding:6px 10px 6px 7px;border-radius:8px;
      color:rgba(255,255,255,.88);font:500 14px ${FONT};text-align:left;cursor:pointer;transition:background .12s}
    .ldx-item:hover{background:rgba(255,255,255,.06)}
    .ldx-item.on{background:rgba(255,255,255,.12);color:#fff}
    .ldx-ico{flex:none;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.18),0 1px 2px rgba(0,0,0,.3)}
    .ldx .ldx-ico svg{width:16px;height:16px;stroke:#fff;stroke-width:2}
    .ldx-main{overflow:auto;padding:26px 36px 48px;position:relative}
    .ldx-main::-webkit-scrollbar,.ldx-nav::-webkit-scrollbar{width:10px} .ldx-main::-webkit-scrollbar-thumb,.ldx-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:5px;border:3px solid transparent;background-clip:padding-box}
    .ldx-main::-webkit-scrollbar-track,.ldx-nav::-webkit-scrollbar-track{background:transparent}
    .ldx-h{display:flex;align-items:center;gap:12px;margin-bottom:6px}
    .ldx-h{flex-direction:column;align-items:flex-start;gap:2px}
    .ldx-badge{font:600 12.5px/1.2 ${FONT};color:rgba(255,255,255,.45)}
    .ldx-h h2{font-size:28px;font-weight:700;letter-spacing:-.025em;margin:0}
    .ldx-lead{color:var(--sub);margin:4px 0 22px;max-width:72ch;line-height:1.5}
    .ldx-sec{font-size:15px;font-weight:700;margin:26px 2px 10px;display:flex;justify-content:space-between;align-items:baseline}
    .ldx-sec a{font-size:12.5px;font-weight:600;color:var(--sub);cursor:pointer} .ldx-sec a:hover{color:#fff;text-decoration:underline}
    .ldx-box{background:#181818;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);margin-bottom:18px}
    .ldx-row{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:15px 18px;border-top:1px solid var(--hair)}
    .ldx-row:first-child{border-top:0}
    .ldx-row>:first-child{min-width:0;flex:1} .ldx-row>:last-child{flex:none}
    .ldx-row b{font-weight:600;font-size:14.5px;display:flex;align-items:center;gap:8px}
    .ldx-row small{display:block;color:var(--sub);font-size:12.8px;line-height:1.5;margin-top:4px;max-width:78ch}
    .ldx-row .ldx-in{font-size:11px;font-weight:600;color:rgba(255,255,255,.45);padding:2px 7px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);cursor:pointer}
    .ldx-row.flash{animation:ldxFlash 1.6s ease-out} @keyframes ldxFlash{0%,30%{background:rgba(30,215,96,.12)}}
    .ldx mark{background:rgba(30,215,96,.22);color:#fff;border-radius:3px;padding:0 2px}
    .ldx-empty{color:var(--sub);padding:30px 4px}
    .ldx select,.ldx input[type=text]{background:#2a2a2a;color:#fff;border:0;border-radius:6px;padding:9px 12px;font:inherit;font-size:13px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);min-width:180px}
    .ldx select:hover,.ldx input[type=text]:hover{box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
    .ldx select:focus,.ldx input[type=text]:focus{outline:none;box-shadow:inset 0 0 0 1.5px #fff}
    .ldx option,.ldx optgroup{background:#282828;color:#fff}
    .ldx button.ld-btn{cursor:pointer;font:700 13px/1 ${FONT};color:#fff;background:transparent;border:0;border-radius:999px;padding:9px 16px;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);transition:transform .1s,box-shadow .15s,background .15s}
    .ldx button.ld-btn:hover{box-shadow:inset 0 0 0 1px #fff;transform:scale(1.03)} .ldx button.ld-btn:active{transform:scale(.97)}
    .ldx button.ld-primary{background:#fff;color:#000;box-shadow:none} .ldx button.ld-primary:hover{background:#f0f0f0}
    .ldx input[type=range]{width:220px;accent-color:var(--g);cursor:pointer}
    .ld-switch{-webkit-appearance:none;appearance:none;width:42px;height:24px;border-radius:12px;background:#4d4d4d;position:relative;cursor:pointer;margin:0;transition:background .2s}
    .ld-switch::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s cubic-bezier(.3,1.3,.6,1)}
    .ld-switch:hover{background:#5f5f5f} .ld-switch:checked{background:var(--g)} .ld-switch:checked::after{transform:translateX(18px)}
    .ld-val{min-width:64px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600;font-size:12.5px;padding:6px 8px;border-radius:6px;background:#242424}
    .ld-presets{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ld-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#f15e6c;display:inline-block} .ld-dot.on{background:var(--g)}
    .ldx-hero .ldx-row{padding:20px 20px} .ldx-hero b{font-size:17px}
    .ldx-digits{text-align:right} .ldx-digits span{display:block;font:800 30px/1.1 ${FONT};letter-spacing:.22em;font-variant-numeric:tabular-nums}
    .ldx-ok{color:var(--g);font-weight:700}
    .ldx-spin{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;animation:ldxSpin .8s linear infinite} @keyframes ldxSpin{to{transform:rotate(360deg)}}
    .ldx input.ldx-name{min-width:0;width:190px;background:transparent;box-shadow:none;padding:4px 6px;font-weight:600;font-size:14.5px}
    .ldx input.ldx-name:hover{background:#2a2a2a}
    .ld-log{font-size:12.5px;color:var(--sub);padding:12px 18px;font-variant-numeric:tabular-nums;line-height:1.8}
    .ld-kbd{font:600 11px/1 ${FONT};padding:4px 7px;border-radius:5px;background:#333;color:#fff;margin-right:3px}
    .ld-preview{position:sticky;top:-26px;z-index:4;margin:0 0 20px;height:168px;border-radius:12px;overflow:hidden;background:#181818 center/cover;
      box-shadow:0 10px 30px rgba(0,0,0,.45);transition:height .28s cubic-bezier(.2,.8,.2,1)}
    .ld-preview.mini{height:58px}
    .ld-preview-bg{position:absolute;inset:-30px;background:inherit;background-size:cover;filter:blur(28px) saturate(1.4)}
    .ld-preview-dim{position:absolute;inset:0;background:#000}
    .ld-preview-lines{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 24px;color:#fff;font-family:Inter,system-ui,sans-serif;transition:transform .28s}
    .ld-preview-lines div{letter-spacing:-.02em;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ld-preview.mini .ld-preview-lines div:not(:nth-child(2)){display:none}
    .ld-preview.mini .ld-preview-lines{transform:scale(.72);transform-origin:left center}
    .ld-preview-tag{position:absolute;top:10px;right:12px;display:flex;gap:6px;align-items:center;font-size:11px;font-weight:700;color:rgba(255,255,255,.7)}
    .ld-preview-tag svg{width:14px;height:14px}
    .ld-preview.mini .ld-preview-tag{top:50%;transform:translateY(-50%)}
    .ld-topbar{position:relative}
    .ld-topbar::after{content:'';position:absolute;right:6px;top:6px;width:7px;height:7px;border-radius:50%;background:#e5534b;
      box-shadow:0 0 0 2px var(--background-base,#000);pointer-events:none}
    .ld-topbar.ld-on::after{background:#3ddc97}
    .ld-panel{font-family:${FONT}} .ld-panel .ld-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 12px}
    .ld-panel .ld-desc{font-size:12.5px;color:rgba(255,255,255,.62);margin-top:3px;line-height:1.45}
    .ld-panel button{cursor:pointer;font:700 13px/1 ${FONT};color:#fff;background:transparent;border:0;border-radius:999px;padding:9px 16px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
    .ld-panel button.ld-primary{background:#fff;color:#000;box-shadow:none} .ld-panel .ld-presets{display:flex;gap:8px;flex-wrap:wrap;align-items:center}`;
  safe(() => { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); });

  let panel = null, main = null, nav = null, panelPhone = null, filter = '', section = 'devices';
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const hi = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
  const btn = (text, onclick, primary) => h('button', { className: `ld-btn${primary ? ' ld-primary' : ''}`, onclick }, text);

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
    const t = h('input', { type: 'text', value: v ?? '', placeholder: x.placeholder ?? '', spellcheck: false });
    t.onchange = () => change(x.k, t.value.trim());
    return t;
  }
  const mark = (text, q) => { const e = document.createElement('span'); if (!q) { e.textContent = text; return e; }
    const i = text.toLowerCase().indexOf(q); if (i < 0) { e.textContent = text; return e; }
    e.append(text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)); return e; };
  // A settings row: label, the full explanation underneath (no hover needed), the control on the right.
  function row(x, S, q, where) {
    const r = h('div', { className: 'ldx-row' },
      h('div', {}, h('b', {}, mark(x.label, q), ...(where ? [h('span', { className: 'ldx-in', onclick: () => go(where, x.k) }, where)] : [])),
        ...(x.help || x.desc ? [h('small', {}, mark(x.help || x.desc, q))] : [])),
      control(x, S));
    r.dataset.row = x.k;
    return r;
  }

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

  // Live preview: three lyric lines styled with the current settings over the playing cover.
  const previewBox = h('div', { className: 'ld-preview' });
  previewBox.innerHTML = `<div class="ld-preview-bg"></div><div class="ld-preview-dim"></div><div class="ld-preview-lines"><div></div><div></div><div></div></div><div class="ld-preview-tag">${svgIcon(I.eye)}Live preview</div>`;
  function preview(S) {
    const d = { size: 1, weight: '800', lineOpacity: 0.5, blurLines: true, blurAmount: 1.2, glow: true, glowStrength: 1, align: 'left', bgDim: 0.2, lineGap: 1.5, bg: 'dynamic', ...readJson('lyricdock:defaults', {}), ...S };
    const art = safe(() => img(item()?.metadata?.image_xlarge_url || item()?.metadata?.image_url), '');
    previewBox.style.backgroundImage = art ? `url("${art}")` : 'none';
    previewBox.querySelector('.ld-preview-bg').style.display = d.bg === 'black' ? 'none' : '';
    previewBox.querySelector('.ld-preview-dim').style.opacity = d.bg === 'black' ? 1 : d.bgDim;
    previewBox.querySelector('.ld-preview-lines').style.fontFamily = d.font && d.font !== 'system' ? `"${d.font}", system-ui` : 'system-ui';
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

  // ---- sections
  const VISUAL = new Set(['View']);
  function sections(schema) {
    const groups = schema.filter(x => x.group), byCat = new Map();
    for (const g of groups) { Object.assign(g, { icon: g.icon || META[g.group]?.[0], tint: g.tint || META[g.group]?.[1], cat: g.cat || META[g.group]?.[2], desc: g.desc || META[g.group]?.[3] }); const c = g.cat || 'More'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(g); }
    const list = [['General', [{ id: 'devices', label: 'Devices', icon: I.devices, tint: '#30D158' }, { id: 'overview', label: 'Overview', icon: I.overview, tint: '#8E8E93' }]]];
    for (const [cat, gs] of byCat) list.push([cat, gs.map(g => ({ id: g.group, label: g.group, icon: g.icon || I.overview, tint: g.tint, cat: g.cat, desc: g.desc }))]);
    const src = list.find(([c]) => c === 'Source');
    (src ? src[1] : list[0][1]).push({ id: 'presets', label: 'Presets', icon: I.presets, tint: '#FFD60A', cat: 'Source' });
    list.push(['Help', [{ id: 'diag', label: 'Diagnostics', icon: I.diag, tint: '#636366' }]]);
    return list;
  }
  const rowsOf = (schema, group) => { const out = []; let g = null; for (const x of schema) { if (x.group) { g = x.group; continue; } if (g === group && x.k && x.type !== 'action') out.push(x); } return out; };
  function go(id, k) {
    filter = ''; const f = panel?.querySelector('.ldx-find input'); if (f) f.value = '';
    section = id; renderPanel(true);
    if (k) setTimeout(() => { const r = main?.querySelector(`[data-row="${k}"]`); if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); } }, 30);
  }

  function renderNav(schema) {
    const list = h('div', {});
    for (const [cat, items] of sections(schema)) {
      list.append(h('div', { className: 'ldx-cat' }, cat));
      for (const it of items) {
        const b = h('button', { className: `ldx-item${!filter && section === it.id ? ' on' : ''}`, onclick: () => go(it.id) });
        b.innerHTML = `<i class="ldx-ico" style="background:${it.tint || '#8E8E93'}">${svgIcon(it.icon)}</i>`; b.append(it.label);
        list.append(b);
      }
    }
    nav.querySelector('.ldx-list').replaceWith(Object.assign(list, { className: 'ldx-list' }));
  }

  function header(badge, title, lead) {
    return [h('div', { className: 'ldx-h' }, h('span', { className: 'ldx-badge' }, badge), h('h2', {}, title)), ...(lead ? [h('p', { className: 'ldx-lead' }, lead)] : [])];
  }

  function overview(S) {
    const ps = pairs(), latest = window.__lyricdock?.latest, loaderV2 = (window.__lyricdock?.loader ?? 0) >= 2;
    const kids = [...header('General', 'Overview', 'Version and updates.')];
    const ver = h('div', { className: 'ldx-box' });
    ver.append(h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, `LyricDock ${VERSION === 'dev' ? '(development build)' : 'v' + VERSION}`),
      h('small', {}, VERSION === 'dev' ? 'Installed with -Dev: no auto-updates' : LS.get('lyricdock:pin') ? `Pinned to v${LS.get('lyricdock:pin')} - updates paused` : latest && latest !== VERSION ? `v${latest} downloaded` : 'Up to date - updates install automatically')),
      VERSION === 'dev' ? '' : latest && latest !== VERSION ? btn('Update now', () => location.reload(), true) : btn('Check for updates', e => checkUpdate(e.target))));
    if (VERSION !== 'dev') {
      const chan = h('select', {}, h('option', { value: 'stable' }, 'Stable'), h('option', { value: 'beta' }, 'Beta (pre-releases)'));
      chan.value = LS.get('lyricdock:channel') === 'beta' ? 'beta' : 'stable';
      chan.onchange = () => { LS.set('lyricdock:channel', chan.value); checkUpdate(null); };
      const vs = h('select', {}, h('option', { value: '' }, 'Latest (auto-update)'));
      loadReleases().then(rs => rs.forEach(r => vs.append(h('option', { value: r.v, selected: LS.get('lyricdock:pin') === r.v }, `v${r.v}${r.pre ? ' (beta)' : ''}`))));
      vs.onchange = () => {
        if (!vs.value) { LS.set('lyricdock:pin', ''); checkUpdate(null); return; }
        LS.set('lyricdock:pin', vs.value);
        useBuild(vs.value).catch(() => safe(() => Spicetify.showNotification('Could not download that version', true)));
      };
      chan.disabled = vs.disabled = !loaderV2;
      ver.append(h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'Update channel and version'),
        h('small', {}, loaderV2 ? 'Beta gets pre-releases first. Pick an older version to roll back (updates pause until you choose Latest).' : 'Run the updater once (Update popup → Run updater) to enable channels and rollback.')),
      h('div', { className: 'ld-presets' }, chan, vs)));
    }
    kids.push(ver);
    return kids;
  }

  // ---- Devices: what is connected right now, Find devices, your devices, other ways to connect.
  function devicesSection() {
    const ps = pairs(), live = openLinks(), kids = [...header('Connection', 'Devices', 'The phones and tablets that show LyricDock for this Spotify.')];
    const viaText = l => l.kind === 'rtc' ? `${l.via || 'same network'}${l.rtt != null ? ` · ${l.rtt} ms` : ''}` : 'USB (adb, developer)';
    // Status at a glance
    const hero = h('div', { className: 'ldx-box ldx-hero' });
    hero.append(h('div', { className: 'ldx-row' },
      h('div', {}, h('b', {}, h('span', { className: 'ld-dot' + (live.length ? ' on' : '') }),
        live.length ? `Connected to ${live.map(l => phoneName(l.code)).join(' and ')}` : ps.length ? 'Waiting for your phone' : 'No device connected yet'),
        h('small', {}, live.length ? live.map(l => `${phoneName(l.code)}: ${viaText(l)}`).join('   ·   ')
          : ps.length ? 'LyricDock reconnects by itself as soon as the phone is on and online. Keep the app open on the phone.'
          : 'Open LyricDock on the phone, then Find devices below.')),
      ''));
    kids.push(hero);

    // Find devices
    const s = scan, found = s ? [...s.found.values()] : [];
    kids.push(h('div', { className: 'ldx-sec' }, 'Find devices', s ? h('a', { onclick: () => { scan = null; findDevices(); } }, 'Search again') : ''));
    const box = h('div', { className: 'ldx-box' });
    if (!s) {
      box.append(h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'Look for phones running LyricDock'),
        h('small', {}, 'Finds every phone with LyricDock open on this network, and phones signed in to your Spotify account anywhere. You confirm on the phone; nothing to type.')),
        btn('Find devices', () => findDevices(), true)));
    } else {
      for (const d of found) {
        const known = ps.some(p => p.name === d.name) && d.state === 'found';
        const where = [d.how.has('net') ? 'On this network' : '', d.how.has('acct') ? 'Signed in to your Spotify' : ''].filter(Boolean).join(' · ');
        const right = d.state === 'asking' ? h('div', { className: 'ldx-digits' }, h('small', {}, 'Tap Allow on the phone if it shows'), h('span', {}, d.digits))
          : d.state === 'paired' ? h('span', { className: 'ldx-ok' }, 'Connected')
          : d.state === 'denied' ? btn('Try again', () => connectDevice(d.id))
          : btn(known ? 'Connect again' : 'Connect', () => connectDevice(d.id), true);
        box.append(h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, d.name), h('small', {}, `${where}${d.state === 'denied' ? ' · declined on the phone' : ''}`)), right));
      }
      if (!found.length) box.append(h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, s.running && !s.scanned ? 'Looking…' : 'No devices found'),
        h('small', {}, s.running && !s.scanned ? `Asking phones on ${[s.ip ? 'this network' : '', s.account ? 'your Spotify account' : ''].filter(Boolean).join(' and ') || 'this network'}.`
          : 'Open LyricDock on the phone and connect it to the same Wi-Fi (or sign it in to your Spotify account in its Settings → Playback source), then search again.')),
        s.running && !s.scanned ? h('span', { className: 'ldx-spin' }) : btn('Search again', () => { scan = null; findDevices(); })));
    }
    kids.push(box);

    // Your devices
    if (ps.length) {
      kids.push(h('div', { className: 'ldx-sec' }, 'Your devices'));
      const mine = h('div', { className: 'ldx-box' });
      for (const p of ps) {
        const l = linkFor(p.code) || (links.get('adb')?.code === p.code ? links.get('adb') : null);
        const nameIn = h('input', { type: 'text', value: p.name, className: 'ldx-name', title: 'Rename' });
        nameIn.onchange = () => { const all = pairs(); const x = all.find(y => y.code === p.code); if (x) { x.name = nameIn.value.trim().slice(0, 40) || x.name; writeJson(PAIRS_KEY, all); renderPanel(); } };
        mine.append(h('div', { className: 'ldx-row' },
          h('div', {}, h('b', {}, h('span', { className: 'ld-dot' + (l ? ' on' : '') }), nameIn),
            h('small', {}, l ? `Connected · ${viaText(l)}` : 'Offline - reconnects automatically')),
          h('div', { className: 'ld-presets' },
            ...(ps.length > 1 ? [btn(panelPhone === p.code ? 'Editing its settings' : 'Edit its settings', () => { panelPhone = p.code; renderPanel(); }, panelPhone === p.code)] : []),
            btn('Forget', () => { if (confirm(`Forget ${p.name}? It will need to be found and allowed again.`)) { removePair(p.code); renderPanel(); } }))));
      }
      kids.push(mine);
    }

    // Other ways
    kids.push(h('div', { className: 'ldx-sec' }, 'Other ways to connect'));
    const codeIn = h('input', { type: 'text', placeholder: 'e.g. K7QX-9MP-2F2' });
    const S = readJson(SETTINGS_KEY, {}), r = relayFor(S);
    kids.push(h('div', { className: 'ldx-box' },
      h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'Pairing code'), h('small', {}, 'If Find devices can\'t see the phone (another network, a strict router): type the code from the phone\'s Settings → Connection.')),
        h('div', { className: 'ld-presets' }, codeIn, btn('Pair', () => {
          const c = cleanCode(codeIn.value);
          if (c.length !== 10) return safe(() => Spicetify.showNotification('That code should be 10 characters', true));
          addPair(c); panelPhone = c; ensureLink(); renderPanel();
        }))),
      h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'How devices find each other'),
        h('small', {}, `Connection setup goes through ${r === NTFY ? 'ntfy.sh' : r.includes('127.0.0.1') ? 'the LyricDock Helper on this PC' : r} (always encrypted), with ntfy.sh as the fallback. Music and lyrics then flow directly between Spotify and the phone. Change it on the phone: Settings → Connection.`)), '')));
    return kids;
  }

  function presetsSection(S) {
    const presets = readJson(PRESETS_KEY, {}), names_ = Object.keys(presets).sort();
    const builtins = readJson('lyricdock:builtins', {}), defs = readJson('lyricdock:defaults', {});
    const grp = (lab, list, pre) => { const g = h('optgroup', { label: lab }); list.forEach(n => g.append(h('option', { value: pre + n }, n))); return g; };
    const sel = h('select', {}, ...(Object.keys(builtins).length ? [grp('Built-in', Object.keys(builtins), 'b:')] : []),
      ...(names_.length ? [grp('Yours', names_, 'u:')] : [h('option', { value: '' }, 'No presets of yours yet')]));
    const chosen = () => sel.value.startsWith('b:') ? { ...defs, ...builtins[sel.value.slice(2)] } : presets[sel.value.slice(2)];
    const name = h('input', { type: 'text', placeholder: 'New preset name' });
    const savePresets = p => { writeJson(PRESETS_KEY, p); send({ type: 'presets', presets: p }); renderPanel(); };
    return [...header('Source', 'Presets', 'Built-in looks and your own. Yours are stored here in Spotify, so every phone can use them.'),
      h('div', { className: 'ldx-box' },
        h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'Apply a preset'), h('small', {}, 'Default is the shipped config; Smooth suits slow phones; Full Spicy turns every effect up.')),
          h('div', { className: 'ld-presets' }, sel, btn('Apply', () => { const p = chosen(); if (p) loadAll(p); }, true),
            btn('Delete', () => { if (!sel.value.startsWith('u:')) return; const p = { ...presets }; delete p[sel.value.slice(2)]; savePresets(p); }))),
        h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'Save the current settings'), h('small', {}, 'API keys are never included.')),
          h('div', { className: 'ld-presets' }, name, btn('Save', () => { const n = name.value.trim().slice(0, 40); if (!n) return; const { apiKey, videoKey, ...rest } = S; savePresets({ ...presets, [n]: rest }); }))),
        h('div', { className: 'ldx-row' }, h('div', {}, h('b', {}, 'Settings file'), h('small', {}, 'Export this phone\'s settings as JSON, or import a file (from another PC, or a backup).')),
          h('div', { className: 'ld-presets' }, btn('Export', exportSettings), btn('Import', importSettings))))];
  }

  function diagnostics() {
    const kbd = t => h('span', { className: 'ld-kbd' }, t);
    return [...header('Help', 'Diagnostics', 'What the connection has been doing, and the shortcuts.'),
      h('div', { className: 'ldx-sec' }, 'Connection log'),
      h('div', { className: 'ldx-box' }, h('div', { className: 'ld-log' }, ...(events.length ? events.slice(0, 20).map(e =>
        h('div', {}, `${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}   ${e.text}`)) : ['Nothing yet']))),
      h('div', { className: 'ldx-sec' }, 'Shortcuts'),
      h('div', { className: 'ldx-box' }, h('div', { className: 'ld-log' },
        h('div', {}, kbd('Ctrl'), kbd('Alt'), kbd('L'), '  this window'), h('div', {}, kbd('Ctrl'), kbd('Alt'), kbd('W'), '  wake the phone'),
        h('div', {}, kbd('Ctrl'), kbd('Alt'), kbd('Y'), '  next phone layout'), h('div', {}, 'Right-click a song, playlist, album or artist for LyricDock actions.')))];
  }

  function groupSection(schema, g, S) {
    const defs = readJson('lyricdock:defaults', {}), rows = rowsOf(schema, g.group);
    const kids = [...header(g.cat || 'Settings', g.group, g.desc)];
    if (VISUAL.has(g.cat) && LS.get('lyricdock:hidePreview') !== '1') kids.push(previewBox);
    kids.push(h('div', { className: 'ldx-sec' }, `${rows.length} setting${rows.length === 1 ? '' : 's'}`, h('span', { className: 'ld-presets' },
      ...(VISUAL.has(g.cat) ? [h('a', { onclick: () => { LS.set('lyricdock:hidePreview', LS.get('lyricdock:hidePreview') === '1' ? '0' : '1'); renderPanel(true); } }, LS.get('lyricdock:hidePreview') === '1' ? 'Show preview' : 'Hide preview')] : []),
      h('a', { onclick: () => { if (confirm(`Reset "${g.group}" to defaults?`)) loadAll(Object.fromEntries(rows.map(x => x.k).filter(k => k in defs).map(k => [k, defs[k]]))); } }, 'Reset section'))));
    kids.push(h('div', { className: 'ldx-box' }, ...rows.map(x => row(x, S))));
    return kids;
  }

  function searchSection(schema, S) {
    const q = filter.trim().toLowerCase(), hits = [];
    let g = null;
    for (const x of schema) { if (x.group) { g = x.group; continue; } if (x.k && x.type !== 'action' && `${x.label} ${x.help ?? ''} ${x.desc ?? ''} ${g}`.toLowerCase().includes(q)) hits.push([x, g]); }
    return [...header(`${hits.length} result${hits.length === 1 ? '' : 's'}`, 'Search settings', hits.length ? 'Change them right here, or open their section.' : 'Try different words.'),
      ...(hits.length ? [h('div', { className: 'ldx-box' }, ...hits.map(([x, gg]) => row(x, S, q, gg)))] : [])];
  }

  function renderPanel(scrollTop) {
    if (!panel?.isConnected) return;
    const schema = readJson(SCHEMA_KEY, []), ps = pairs();
    if (panelPhone && !ps.some(p => p.code === panelPhone)) panelPhone = null;
    panelPhone ??= openLinks().find(l => l.code)?.code ?? ps[0]?.code ?? null;
    const S = settingsFor(panelPhone), on = connected();
    const conn = panel.querySelector('.ldx-conn');
    conn.className = 'ldx-conn' + (on ? ' on' : '');
    conn.lastChild.textContent = on ? `${openLinks().length > 1 ? `${openLinks().length} phones` : phoneName(openLinks()[0]?.code)} connected` : 'No phone connected';
    renderNav(schema);
    const groups = schema.filter(x => x.group);
    if (!['devices', 'overview', 'presets', 'diag'].includes(section) && !groups.some(g => g.group === section)) section = 'devices';
    const kids = filter.trim() ? searchSection(schema, S)
      : section === 'devices' ? devicesSection() : section === 'overview' ? overview(S) : section === 'presets' ? presetsSection(S) : section === 'diag' ? diagnostics()
      : groupSection(schema, groups.find(g => g.group === section), S);
    if (!schema.length && !['devices', 'overview', 'diag'].includes(section)) kids.push(h('p', { className: 'ldx-empty' }, 'Connect the phone once so its settings can load here.'));
    if (ps.length > 1 && !['devices', 'overview', 'diag'].includes(section)) kids.splice(2, 0, h('p', { className: 'ldx-lead' }, `Editing ${phoneName(panelPhone)}${linkFor(panelPhone) ? '' : ' (offline - changes are sent when it connects)'}. Switch phones in Overview.`));
    const top = scrollTop === true ? 0 : main.scrollTop;
    main.replaceChildren(...kids);
    main.scrollTop = top;
    previewBox.classList.toggle('mini', main.scrollTop > 40);
    preview(S);
  }

  function openPanel() {
    if (panel?.isConnected) return;
    panel = h('div', { className: 'ldx', role: 'dialog' });
    panel.innerHTML = `<div class="ldx-card"><div class="ldx-head"><div class="ldx-title">LyricDock</div><span class="ldx-pill">${VERSION === 'dev' ? 'development' : 'v' + VERSION}</span>
      <div class="ldx-conn"><i></i><span></span></div><button class="ldx-x" aria-label="Close">${svgIcon(I.close)}</button></div>
      <div class="ldx-body"><nav class="ldx-nav"><div class="ldx-find">${svgIcon(I.search)}<input type="search" placeholder="Search settings…"></div><div class="ldx-list"></div></nav><main class="ldx-main"></main></div></div>`;
    nav = panel.querySelector('.ldx-nav'); main = panel.querySelector('.ldx-main');
    const close = () => { panel.remove(); panel = null; removeEventListener('keydown', esc, true); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    panel.onclick = e => { if (e.target === panel) close(); };
    panel.querySelector('.ldx-x').onclick = close;
    addEventListener('keydown', esc, true);
    const find = panel.querySelector('.ldx-find input');
    find.value = filter;
    find.oninput = () => { filter = find.value; renderPanel(true); };
    // The preview shrinks to a slim strip once the section scrolls, and grows back at the top.
    main.addEventListener('scroll', () => previewBox.classList.toggle('mini', main.scrollTop > 40), { passive: true });
    document.body.append(panel);
    renderPanel(true);
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

  // Update sheet: what's new first, one clear action. The loader has already downloaded the build; Update reloads
  // Spotify's window to switch to it (about a second), Later leaves it for the next start. Recovery tools for a
  // Spotify update that removed Spicetify sit behind a disclosure.
  const UCSS = `.ldu{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(0,0,0,.55);font-family:${FONT};color:#fff;animation:ldxIn .16s ease-out}
    .ldu-card{width:min(460px,92vw);max-height:86vh;overflow:auto;background:#181818;border-radius:16px;padding:24px;box-sizing:border-box;
      box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.07);animation:ldxCard .24s cubic-bezier(.2,.8,.2,1)}
    .ldu-top{display:flex;gap:14px;align-items:center}
    .ldu-app{flex:none;width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(160deg,#2a2a2a,#121212);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 6px 16px rgba(0,0,0,.4);color:#1ed760}
    .ldu-app svg{width:24px;height:24px}
    .ldu-top h2{margin:0;font-size:20px;font-weight:700;letter-spacing:-.02em}
    .ldu-top p{margin:2px 0 0;color:rgba(255,255,255,.6);font-size:13px}
    .ldu-x{margin-left:auto;align-self:flex-start;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:rgba(255,255,255,.6);cursor:pointer;display:grid;place-items:center}
    .ldu-x:hover{background:rgba(255,255,255,.08);color:#fff} .ldu-x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
    .ldu-ver{display:flex;align-items:center;gap:10px;margin:20px 0 4px;font-variant-numeric:tabular-nums;font-size:13px;font-weight:600}
    .ldu-ver span{padding:5px 10px;border-radius:999px;background:#242424;color:rgba(255,255,255,.7)}
    .ldu-ver span.new{background:rgba(30,215,96,.14);color:#1ed760}
    .ldu-ver svg{width:16px;height:16px;fill:none;stroke:rgba(255,255,255,.4);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .ldu-notes{margin:16px 0 0;padding:14px 16px;border-radius:12px;background:#202020;font-size:13.5px;line-height:1.55;color:rgba(255,255,255,.85)}
    .ldu-notes b{display:block;font-size:12px;font-weight:700;color:rgba(255,255,255,.5);margin:0 0 6px}
    .ldu-notes ul{margin:0;padding-left:18px} .ldu-notes li{margin:3px 0} .ldu-notes li strong{color:#fff;font-weight:600}
    .ldu-notes .ldu-skel{height:10px;border-radius:5px;background:#2c2c2c;margin:8px 0;animation:lduPulse 1.2s ease-in-out infinite alternate}
    @keyframes lduPulse{to{opacity:.4}}
    .ldu-actions{display:flex;gap:10px;align-items:center;margin-top:20px}
    .ldu-actions small{flex:1;color:rgba(255,255,255,.5);font-size:12px;line-height:1.4}
    .ldu-btn{cursor:pointer;border:0;border-radius:999px;padding:10px 20px;font:700 14px/1 ${FONT};white-space:nowrap;transition:transform .12s,background .15s,box-shadow .15s}
    .ldu-btn:active{transform:scale(.97)} .ldu-btn:focus{outline:none} .ldu-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
    .ldu-btn.ghost{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)} .ldu-btn.ghost:hover{box-shadow:inset 0 0 0 1px #fff}
    .ldu-btn.primary{background:#1ed760;color:#000} .ldu-btn.primary:hover{background:#3be477;transform:scale(1.03)}
    .ldu details{margin-top:18px;border-top:1px solid rgba(255,255,255,.07);padding-top:14px}
    .ldu summary{cursor:pointer;list-style:none;font-size:13px;font-weight:600;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:8px}
    .ldu summary::-webkit-details-marker{display:none}
    .ldu summary svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;transition:transform .2s}
    .ldu details[open] summary svg{transform:rotate(90deg)}
    .ldu summary:hover{color:#fff}
    .ldu-fix{margin-top:10px;font-size:12.5px;color:rgba(255,255,255,.6);line-height:1.5}
    .ldu-cmd{display:flex;gap:8px;align-items:center;margin-top:10px;padding:8px 8px 8px 12px;border-radius:10px;background:#101010;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
    .ldu-cmd code{flex:1;min-width:0;font:12px/1.4 ui-monospace,Consolas,monospace;color:rgba(255,255,255,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:all}
    .ldu-cmd button{flex:none;cursor:pointer;border:0;border-radius:6px;padding:6px 10px;background:#2a2a2a;color:#fff;font:600 12px ${FONT}} .ldu-cmd button:hover{background:#333}
    .ldu-fix .ldu-btn{margin-top:10px;padding:8px 14px;font-size:13px}`;
  safe(() => { const st = document.createElement('style'); st.textContent = UCSS; document.head.append(st); });

  // Release notes: the GitHub release body, as a short list (bold kept, links dropped).
  async function releaseNotes(v) {
    const r = await fetch(`https://api.github.com/repos/DhakadG/lyricdock/releases/tags/v${v}`).then(x => x.ok ? x.json() : null).catch(() => null);
    return String(r?.body || '').split(/\r?\n/).map(l => l.trim()).filter(l => /^[-*]\s+/.test(l)).slice(0, 6)
      .map(l => l.replace(/^[-*]\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mdLine = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  function showUpdate() {
    const to = window.__lyricdock?.latest;
    if (!to || to === VERSION || VERSION === 'dev' || document.querySelector('.ldu')) return;
    const cmd = 'iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex';
    const el = document.createElement('div');
    el.className = 'ldu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'LyricDock update');
    el.innerHTML = `<div class="ldu-card">
      <div class="ldu-top"><div class="ldu-app">${ICON}</div><div><h2>Update ready</h2><p>LyricDock ${esc(to)} is downloaded</p></div>
        <button class="ldu-x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="ldu-ver"><span>${esc(VERSION)}</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg><span class="new">${esc(to)}</span></div>
      <div class="ldu-notes"><b>What's new</b><div class="ldu-list"><div class="ldu-skel" style="width:88%"></div><div class="ldu-skel" style="width:70%"></div><div class="ldu-skel" style="width:78%"></div></div></div>
      <div class="ldu-actions"><small>Update reloads Spotify's window, about a second. Later loads it next time Spotify starts.</small>
        <button class="ldu-btn ghost" data-a="later">Later</button><button class="ldu-btn primary" data-a="update">Update now</button></div>
      <details><summary><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>LyricDock missing after a Spotify update?</summary>
        <div class="ldu-fix">Spotify updates can remove Spicetify. Run the updater (installed with LyricDock), or paste this into PowerShell.
          <div class="ldu-cmd"><code>${esc(cmd)}</code><button data-a="copy">Copy</button></div>
          <button class="ldu-btn ghost" data-a="run">Run updater</button></div></details>
    </div>`;
    const close = () => { el.remove(); removeEventListener('keydown', key, true); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('keydown', key, true);
    el.addEventListener('click', e => {
      if (e.target === el) return close();
      const a = e.target.closest('[data-a], .ldu-x');
      if (!a) return;
      if (a.classList.contains('ldu-x') || a.dataset.a === 'later') close();
      else if (a.dataset.a === 'update') location.reload();
      else if (a.dataset.a === 'run') window.open('lyricdock-updater://update');
      else if (a.dataset.a === 'copy') { safe(() => Spicetify.Platform.ClipboardAPI.copy(cmd)); a.textContent = 'Copied'; setTimeout(() => { a.textContent = 'Copy'; }, 1500); }
    });
    document.body.append(el);
    el.querySelector('.ldu-btn.primary').focus();
    releaseNotes(to).then(items => {
      const box = el.querySelector('.ldu-list');
      if (!box) return;
      box.innerHTML = items.length ? `<ul>${items.map(i => `<li>${mdLine(i)}</li>`).join('')}</ul>`
        : `Improvements and fixes. <a href="https://github.com/DhakadG/lyricdock/releases/tag/v${esc(to)}" target="_blank" style="color:#fff">Full release notes</a>`;
    });
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
