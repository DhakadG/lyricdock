// Dev tool: play the invented demo song ("Midnight Signal", scripts/preview-driver.js) on the real phone, so animation and
// layout checks don't depend on what Spotify is playing. While it runs, messages from the desktop and the Spotify account
// are held back in memory (no setting changes; an app restart ends the demo).
//   node scripts/demo-phone.mjs start [posMs] [kind]   kind: word | line | static
//   node scripts/demo-phone.mjs at <posMs>
//   node scripts/demo-phone.mjs stop                   back to the real song
import fs from 'node:fs';
import { ev as run, ws } from './cdp.mjs';
const [, , cmd = 'start', a1, a2] = process.argv;

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
