// No-adb link: a WebRTC data channel straight between Spotify (desktop) and this phone (Wi-Fi, USB tethering, or
// a TURN relay when away). WebRTC is exempt from the "no ws:// from https" rule that blocks a plain LAN WebSocket.
//
// Two jobs go through a signalling relay (ntfy.sh, your own ntfy, or the LyricDock Helper's local relay):
//  1. Connecting a paired Spotify: one offer / answer swap, on a topic + AES-GCM key derived from this phone's
//     pairing code - the relay only ever sees ciphertext.
//  2. Being found ("Find devices" in Spotify): the phone listens on lobby topics for its network (derived from the
//     public IP both devices share, learnt through STUN) and its Spotify account. Spotify asks who is there, the
//     phone answers with its name and an ECDH key; when you click Connect, both screens show the same 4 digits and
//     tapping Allow here hands the pairing code over, encrypted with the agreed key.
// The phone always listens on the chosen relay AND ntfy.sh, so a mismatch between the two ends can't strand it.
const Rtc = (() => {
  const CHUNK = 16000;
  // Settings is a top-level const (not a window property): read it by name.
  const SS = () => (typeof Settings !== 'undefined' ? Settings.S : {});
  const NTFY = 'https://ntfy.sh';
  const relay = () => {
    const S = SS();
    if (S.relay === 'helper' && /^\d+\.\d+\.\d+\.\d+$/.test(S.relayUrl || '')) return `http://${S.relayUrl}:8977`;
    if (S.relay === 'custom' && /^https?:\/\/\S+$/.test(S.relayUrl || '')) return S.relayUrl.replace(/\/+$/, '');
    return NTFY;
  };
  const relays = () => [...new Set([relay(), NTFY])];
  const wsOf = u => u.replace(/^http/, 'ws');
  const ice = () => ({ iceServers: String(SS().ice || '').split(',').map(x => x.trim()).filter(Boolean).map(e => {
    const [urls, username, credential] = e.split('|');
    return /^(stun|turns?):/.test(urls) ? { urls, ...(username ? { username, credential } : {}) } : null;
  }).filter(Boolean) });
  // Connection log (Settings -> Connection), newest first.
  const events = [];
  const note = t => { events.unshift(`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${t}`); events.length = Math.min(events.length, 20); };
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const stored = (k, make) => { let v = localStorage.getItem(k); if (!v) { v = make(); try { localStorage.setItem(k, v); } catch (e) {} } return v; };
  let code = localStorage.getItem('dock:pair');
  if (!/^[A-Z2-9]{10}$/.test(code || '')) {
    code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHA[b % ALPHA.length]).join('');
    try { localStorage.setItem('dock:pair', code); } catch (e) {}
  }
  const myId = stored('dock:id', () => Math.random().toString(36).slice(2, 10));
  const pretty = `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7)}`;
  let pc = null, dc = null, onMsg = () => {}, status = 'waiting', topic, key, desk = null;

  // ---- crypto: topic + key from the code
  const enc = new TextEncoder();
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
  const sha = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  async function init() {
    topic = 'ld' + hex((await sha('lyricdock-topic:' + code)).slice(0, 12));
    key = await crypto.subtle.importKey('raw', await sha('lyricdock-key:' + code), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
    return b64(iv) + '.' + b64(ct);
  }
  async function open(s) {
    try {
      const [iv, ct] = s.split('.').map(unb64);
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)));
    } catch (e) { return null; } // not ours / tampered: ignore
  }
  const post = (r, t, body) => fetch(`${r}/${t}`, { method: 'POST', body, headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {});

  // ---- subscriptions: one WebSocket per (relay, topic), re-opened when dropped, closed when no longer wanted
  const subs = new Map(); // `${relay} ${topic}` -> ws
  function subscribe(r, t, onMessage) {
    const k = `${r} ${t}`;
    if (subs.has(k)) return;
    const ws = new WebSocket(`${wsOf(r)}/${t}/ws`);
    subs.set(k, ws);
    ws.onmessage = e => { let ev; try { ev = JSON.parse(e.data); } catch (x) { return; } if (ev.event === 'message') onMessage(ev.message, r, t); };
    ws.onclose = () => { if (subs.get(k) === ws) { subs.delete(k); setTimeout(() => want.has(k) && subscribe(r, t, onMessage), 3000); } };
  }
  const want = new Set();
  function sync(list) { // list: [[relay, topic, handler]]
    const keys = new Set(list.map(([r, t]) => `${r} ${t}`));
    for (const [k, ws] of subs) if (!keys.has(k)) { want.delete(k); subs.delete(k); try { ws.close(); } catch (e) {} }
    for (const [r, t, h] of list) { want.add(`${r} ${t}`); subscribe(r, t, h); }
  }

  // ---- offers from a paired Spotify
  async function onOffer(raw, r) {
    const m = await open(raw);
    if (m?.t === 'offer' && m.sdp) answer(m, r);
  }
  const gathered = p => new Promise(res => {
    if (p.iceGatheringState === 'complete') return res();
    p.onicegatheringstatechange = () => p.iceGatheringState === 'complete' && res();
    setTimeout(res, 3000);
  });
  // Settings -> Connection path: offer only the Wi-Fi address, or only the other ones (the USB-tethering cable).
  function onlyPath(d) {
    const mode = SS().linkPath || 'auto';
    let wifi = '';
    try { wifi = Dock.ip(); } catch (e) {}
    if (mode === 'auto' || !wifi) return d;
    const keep = line => {
      if (!line.startsWith('a=candidate')) return true;
      const ip = line.split(' ')[4], isWifi = ip === wifi;
      return mode === 'wifi' ? isWifi : !isWifi && !ip.includes(':');
    };
    return { type: d.type, sdp: d.sdp.split('\r\n').filter(keep).join('\r\n') };
  }
  async function answer(m, r) {
    try { pc?.close(); } catch (e) {}
    pc = new RTCPeerConnection(ice());
    pc.ondatachannel = e => wire(e.channel);
    pc.onconnectionstatechange = () => {
      const s = pc?.connectionState || 'closed';
      if (s !== status && ['connected', 'failed', 'disconnected'].includes(s)) note({ connected: 'Connected', failed: 'Connection failed', disconnected: 'Connection lost' }[s]);
      status = s;
    };
    await pc.setRemoteDescription(m.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    post(r, topic, await seal({ t: 'answer', id: m.id, sdp: onlyPath(pc.localDescription) }));
  }

  // ---- data channel, with chunking (SCTP messages are capped; raw lyrics can be big)
  const parts = new Map();
  let lastLink = 0;
  function wire(ch) {
    dc = ch;
    ch.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m._c) {
        const p = parts.get(m._c) ?? [];
        p[m.i] = m.d;
        parts.set(m._c, p);
        if (p.filter(x => x !== undefined).length < m.n) return;
        parts.delete(m._c);
        try { m = JSON.parse(p.join('')); } catch (x) { return; }
      }
      if (m.type === 'hello' && typeof m.desk === 'string') desk = m.desk.slice(0, 60);
      onMsg(m);
    };
    ch.onclose = () => { lastLink = Date.now(); if (dc === ch) dc = null; };
  }
  function send(str) {
    if (dc?.readyState !== 'open') return;
    if (str.length <= CHUNK) return dc.send(str);
    const id = Math.random().toString(36).slice(2), n = Math.ceil(str.length / CHUNK);
    for (let i = 0; i < n; i++) dc.send(JSON.stringify({ _c: id, i, n, d: str.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }

  // ---- being found: lobby topics for this network (public IP via STUN) and the Spotify account
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  let uid = null, netIp = null, netAt = 0, asking = false, onAsk = async () => false;
  const seen = new Map(); // desk -> { kp, deskPub, name }
  async function publicIp() {
    if (netIp && Date.now() - netAt < 10 * 60000) return netIp;
    const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] });
    try {
      p.createDataChannel('x');
      const ip = new Promise(res => {
        p.onicecandidate = e => { const c = e.candidate?.candidate || ''; const m = / (\d+\.\d+\.\d+\.\d+) \d+ typ srflx/.exec(c); if (m) res(m[1]); if (!e.candidate) res(null); };
        setTimeout(() => res(null), 5000);
      });
      await p.setLocalDescription(await p.createOffer());
      const got = await ip;
      if (got) { netIp = got; netAt = Date.now(); }
    } catch (e) {} finally { try { p.close(); } catch (e) {} }
    return netIp;
  }
  const lobbyTopic = async (kind, v) => (kind === 'net' ? 'ldn' : 'lda') + hex(await sha(`lyricdock-${kind === 'net' ? 'net' : 'account'}:${v}`)).slice(0, 24);
  let lobbies = [];
  async function refreshLobbies() {
    const ip = await publicIp(), out = [];
    if (ip) out.push(await lobbyTopic('net', ip));
    if (uid) out.push(await lobbyTopic('acct', uid));
    lobbies = out;
    sync([...relays().map(r => [r, topic, onOffer]), ...relays().flatMap(r => out.map(t => [r, t, onLobby]))]);
  }
  const deviceName = () => { try { return Dock.model() || 'Android phone'; } catch (e) { return 'LyricDock phone'; } };
  async function onLobby(raw, r, t) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (typeof m?.desk !== 'string' || m.desk.length > 40) return;
    if (m.t === 'scan' && m.pub) {
      // A Spotify is looking: say who we are (a fresh key per Spotify, so digits differ every time).
      let s = seen.get(m.desk);
      if (!s) { s = { kp: await crypto.subtle.generateKey(EC, false, ['deriveBits']) }; seen.set(m.desk, s); if (seen.size > 20) seen.delete(seen.keys().next().value); }
      Object.assign(s, { deskPub: m.pub, name: String(m.name || 'Spotify').slice(0, 60) });
      post(r, t, JSON.stringify({ t: 'here', desk: m.desk, id: myId, name: deviceName(), pub: await crypto.subtle.exportKey('jwk', s.kp.publicKey), linked: dc?.readyState === 'open' }));
    } else if (m.t === 'connect' && m.to === myId && seen.has(m.desk) && !asking) {
      const s = seen.get(m.desk);
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', s.deskPub, EC, false, []) }, s.kp.privateKey, 256);
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
      const digits = String(((h[0] << 16) | (h[1] << 8) | h[2]) % 10000).padStart(4, '0');
      asking = true;
      const ok = await onAsk(s.name, digits).catch(() => false);
      asking = false;
      if (!ok) return post(r, t, JSON.stringify({ t: 'deny', desk: m.desk, from: myId }));
      const aes = await crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify({ code }))));
      post(r, t, JSON.stringify({ t: 'accept', desk: m.desk, from: myId, box: b64(iv) + '.' + b64(ct) }));
      note(`Paired with ${s.name}`);
    }
  }

  // Which network the live connection uses: the selected ICE pair's local + remote address.
  let path = null;
  async function refreshPath() {
    if (!pc || dc?.readyState !== 'open') { path = null; return; }
    try {
      const st = await pc.getStats(), all = [...st.values()];
      const tr = all.find(x => x.type === 'transport' && x.selectedCandidatePairId);
      const pair = tr ? st.get(tr.selectedCandidatePairId) : all.find(x => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
      const l = pair && st.get(pair.localCandidateId), rm = pair && st.get(pair.remoteCandidateId);
      path = l ? { local: l.address || l.ip, remote: rm?.address || rm?.ip, rtt: pair.currentRoundTripTime, relayed: l.candidateType === 'relay' } : null;
    } catch (e) { path = null; }
  }
  setInterval(refreshPath, 5000);

  let lastRelays = '';
  init().then(refreshLobbies);
  // Relay changed, public IP may have changed, account signed in: keep the subscriptions right.
  setInterval(() => { if (relays().join() !== lastRelays) { lastRelays = relays().join(); note('Signalling server changed'); refreshLobbies(); } }, 3000);
  setInterval(refreshLobbies, 5 * 60000);
  lastRelays = relays().join();
  return {
    code: pretty,
    send,
    watchAccount: u => { if (u && u !== uid) { uid = u; refreshLobbies(); } },
    onAsk: f => { onAsk = f; },
    onMessage: f => { onMsg = f; },
    open: () => dc?.readyState === 'open',
    path: () => path,
    log: () => events,
    desk: () => desk,
    discoverable: () => ({ network: lobbies.some(t => t.startsWith('ldn')), account: lobbies.some(t => t.startsWith('lda')), ip: netIp }),
    lastLink: () => lastLink,
    refreshPath,
    status: () => dc?.readyState === 'open' ? 'connected' : ['failed', 'closed', 'disconnected'].includes(status) ? 'standby' : status,
  };
})();
