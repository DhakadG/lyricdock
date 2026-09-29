// Dev tool: play the invented demo song ("Midnight Signal", scripts/preview-driver.js) on the real phone, so animation and
// layout checks don't depend on what Spotify is playing. While it runs, messages from the desktop and the Spotify account
// are held back in memory (no setting changes; an app restart ends the demo).
//   node scripts/demo-phone.mjs start [posMs] [kind]   kind: word | line | static
//   node scripts/demo-phone.mjs at <posMs>
//   node scripts/demo-phone.mjs stop                   back to the real song
import fs from 'node:fs';
const [, , cmd = 'start', a1, a2] = process.argv;
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find(p => p.url.includes('android_asset')).webSocketDebuggerUrl);
let id = 0;
const call = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id;
  const on = e => { const m = JSON.parse(e.data); if (m.id !== my) return; ws.removeEventListener('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: my, method, params }));
});
await new Promise(r => ws.addEventListener('open', r));
const run = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

if (cmd === 'start') {
  // the demo data from the preview driver, minus its fake Dock and its own timers
  const src = fs.readFileSync(new URL('./preview-driver.js', import.meta.url), 'utf8')
    .replace(/^window\.Dock = .*$/m, '').replace(/setInterval\([\s\S]*?\);\n/, '').replace(/demoTrack\(\);\s*demoAt\(4000\);/, '')
    .replace(/\bdock\(/g, 'handle(');
  console.log(await run(`(() => {
    if (!window.__realRoute) { window.__realRoute = route; window.route = (s, m) => (m.type === 'track' || m.type === 'pos' || m.type === 'preload') ? null : window.__realRoute(s, m); }
    ${src}
    clearInterval(window.__demoT);
    window.__demoT = setInterval(() => window.__t0 && handle({ type: 'pos', pos: window.__base + performance.now() - window.__t0, playing: true, dur: 200000, quality: 'Lossless', liked: true, volume: 60 }), 500);
    demoTrack('${a2 || 'word'}'); demoAt(${+a1 || 4000}); return 'demo on';
  })()`));
} else if (cmd === 'at') {
  console.log(await run(`demoAt(${+a1}); 'at ${a1}'`));
} else if (cmd === 'stop') {
  console.log(await run(`(() => { clearInterval(window.__demoT); window.__t0 = 0; if (window.__realRoute) { window.route = window.__realRoute; window.__realRoute = null; }
    const s = SRC[P.source]; for (const m of [s.track && { ...s.track, dir: 1 }, s.preload, s.pos]) if (m) handle(m); return 'demo off'; })()`));
}
ws.close();
