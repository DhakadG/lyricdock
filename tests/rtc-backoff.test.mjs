// rtc.js: a relay that refuses the WebSocket handshake (ntfy's per-IP limit answers 429) is retried with a growing,
// jittered delay - not every 3 s, which kept the limit tripped. Runs the real file with fake sockets and timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('refused relay handshakes back off 3 s, 6 s, ... 2 min with jitter; an opened socket resets it', async () => {
  const sockets = [],
    timers = [];
  class WebSocket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    close() {}
  }
  // No public IP from STUN: the phone listens on its pairing topic only.
  class RTCPeerConnection {
    createDataChannel() {}
    async createOffer() {
      return {};
    }
    async setLocalDescription() {
      this.onicecandidate?.({ candidate: null });
    }
    close() {}
  }
  const store = new Map([['dock:pair', 'ABCDEFGHJK']]);
  vm.runInNewContext(readFileSync(new URL('../android/app/src/main/assets/rtc.js', import.meta.url), 'utf8'), {
    window: {},
    location: { protocol: 'http:' },
    document: { addEventListener() {} },
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: k => store.delete(k),
    },
    WebSocket,
    RTCPeerConnection,
    crypto,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    fetch: () => Promise.reject(new Error('offline')),
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    setInterval: () => 0,
  });
  for (let i = 0; i < 100 && !sockets.length; i++) await new Promise(r => setImmediate(r));
  assert.equal(sockets.length, 1);
  assert.match(sockets[0].url, /^wss:\/\/ntfy\.losthusky\.qzz\.io\/ld[0-9a-f]{24}\/ws$/);

  const refuse = () => {
    timers.length = 0;
    sockets.at(-1).onclose();
    assert.equal(timers.length, 1);
    return timers[0];
  };
  for (let n = 1; n <= 8; n++) {
    const t = refuse(),
      cap = Math.min(120e3, 3000 * 2 ** n);
    assert.ok(t.ms >= cap / 2 && t.ms <= cap, `refusal ${n}: ${t.ms} ms not in [${cap / 2}, ${cap}]`);
    t.fn();
    assert.equal(sockets.length, n + 1);
  }
  sockets.at(-1).onopen(); // a working subscription that later drops comes back within 3 s
  const t = refuse();
  assert.ok(t.ms >= 1500 && t.ms <= 3000, `${t.ms}`);
});
