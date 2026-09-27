// No-adb link: a WebRTC data channel straight between Spotify (desktop) and this phone on the local network
// (Wi-Fi, or USB tethering for a cable without adb). WebRTC is exempt from the "no ws:// from https" rule that
// blocks a plain LAN WebSocket, and measured ~7ms round trips here.
//
// Setting it up needs one offer/answer swap per connection. That goes through ntfy.sh (a free public message
// relay, no account) as a dumb mailbox: the topic and an AES-GCM key are both derived from the pairing code this
// phone shows, so the relay only ever sees ciphertext. The extension carries the same code (dock-bridge.js).
const Rtc = (() => {
  const RELAY = 'https://ntfy.sh', CHUNK = 16000;
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let code = localStorage.getItem('dock:pair');
  if (!/^[A-Z2-9]{10}$/.test(code || '')) {
    code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHA[b % ALPHA.length]).join('');
    try { localStorage.setItem('dock:pair', code); } catch (e) {}
  }
  const pretty = `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7)}`;
  let pc = null, dc = null, sub = null, onMsg = () => {}, status = 'waiting', topic, key;

  // ---- crypto: topic + key from the code
  const enc = new TextEncoder();
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function init() {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('lyricdock-topic:' + code)));
    topic = 'ld' + Array.from(h.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
    const k = await crypto.subtle.digest('SHA-256', enc.encode('lyricdock-key:' + code));
    key = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
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
  const publish = async obj => fetch(`${RELAY}/${topic}`, { method: 'POST', body: await seal(obj), headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {});

  // ---- relay subscription: always listening for offers from the desktop
  function listen() {
    sub = new WebSocket(`${RELAY.replace('https', 'wss')}/${topic}/ws`);
    sub.onmessage = async e => {
      const ev = JSON.parse(e.data);
      if (ev.event !== 'message') return;
      const m = await open(ev.message);
      if (m?.t === 'offer' && m.sdp) answer(m);
    };
    sub.onclose = () => setTimeout(listen, 3000);
  }

  const gathered = p => new Promise(r => {
    if (p.iceGatheringState === 'complete') return r();
    p.onicegatheringstatechange = () => p.iceGatheringState === 'complete' && r();
    setTimeout(r, 3000);
  });

  async function answer(m) {
    try { pc?.close(); } catch (e) {}
    pc = new RTCPeerConnection();
    pc.ondatachannel = e => wire(e.channel);
    pc.onconnectionstatechange = () => { status = pc?.connectionState || 'closed'; };
    await pc.setRemoteDescription(m.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    publish({ t: 'answer', id: m.id, sdp: pc.localDescription });
  }

  // ---- data channel, with chunking (SCTP messages are capped; raw lyrics can be big)
  const parts = new Map();
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
      onMsg(m);
    };
    ch.onclose = () => { if (dc === ch) dc = null; };
  }

  function send(str) {
    if (dc?.readyState !== 'open') return;
    if (str.length <= CHUNK) return dc.send(str);
    const id = Math.random().toString(36).slice(2), n = Math.ceil(str.length / CHUNK);
    for (let i = 0; i < n; i++) dc.send(JSON.stringify({ _c: id, i, n, d: str.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }

  // ---- automatic pairing through the Spotify account (LocalSend-style "found a device, accept?").
  // Both sides know the account id, so they meet on a relay topic derived from it. That id isn't secret, so the
  // pairing code is only released after an ECDH key agreement AND the user tapping Allow on this phone while
  // both screens show the same 4 digits (a swapped key would show different digits).
  let acct = null, asking = false, onAsk = async () => false;
  const denied = new Set();
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  async function acctTopic(uid) { return 'lda' + hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('lyricdock-account:' + uid)))).slice(0, 24); }
  const post = (t, body) => fetch(`${RELAY}/${t}`, { method: 'POST', body, headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {});

  async function watchAccount(uid) {
    if (!uid || acct?.uid === uid) return;
    try { acct?.ws.close(); } catch (e) {}
    const topic = await acctTopic(uid), ws = new WebSocket(`${RELAY.replace('https', 'wss')}/${topic}/ws`);
    acct = { uid, topic, ws };
    ws.onmessage = e => {
      const ev = JSON.parse(e.data);
      if (ev.event !== 'message') return;
      let m; try { m = JSON.parse(ev.message); } catch (x) { return; }
      if (m?.t === 'discover' && typeof m.desk === 'string' && m.pub) onDiscover(m).catch(() => { asking = false; });
    };
    ws.onclose = () => { if (acct?.ws === ws) { acct = null; setTimeout(() => watchAccount(uid), 5000); } };
  }

  async function onDiscover(m) {
    if (asking || denied.has(m.desk) || dc?.readyState === 'open') return;
    const kp = await crypto.subtle.generateKey(EC, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', m.pub, EC, false, []) }, kp.privateKey, 256);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
    const digits = String(((h[0] << 16) | (h[1] << 8) | h[2]) % 10000).padStart(4, '0');
    const aes = await crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt']);
    await post(acct.topic, JSON.stringify({ t: 'key', desk: m.desk, pub: await crypto.subtle.exportKey('jwk', kp.publicKey) }));
    asking = true;
    const ok = await onAsk(String(m.name || 'Spotify desktop').slice(0, 60), digits);
    asking = false;
    if (!ok) { denied.add(m.desk); return; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify({ code }))));
    await post(acct.topic, JSON.stringify({ t: 'accept', desk: m.desk, box: b64(iv) + '.' + b64(ct) }));
  }

  init().then(listen);
  return {
    code: pretty,
    send,
    watchAccount,
    onAsk: f => { onAsk = f; },
    onMessage: f => { onMsg = f; },
    open: () => dc?.readyState === 'open',
    status: () => dc?.readyState === 'open' ? 'connected' : ['failed', 'closed', 'disconnected'].includes(status) ? 'standby' : status, // desktop moved to USB / will re-offer
  };
})();
