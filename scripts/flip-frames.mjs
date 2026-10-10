// Dev check: film the flip clock on the phone. Puts the Flip clock layout up with seconds on and the animations slowed
// (Settings -> Animation speed), then grabs a burst of frames of the seconds cards and tiles them into one image.
//   node scripts/flip-frames.mjs <out.png> [theme: light|dark] [anim]      (needs the adb forward, see cdp.mjs)
import fs from 'node:fs';
import { call, ev, sleep, ws } from './cdp.mjs';
const [, , out = 'android/build/flip-frames.png', theme = 'light', anim = ''] = process.argv;
const before = await ev(`JSON.stringify({ layout: Settings.S.layout, theme: Settings.S.clockTheme, secs: Settings.S.clockSeconds, speed: Settings.S.animSpeed, anim: Settings.S.clockAnim })`);
await ev(`Settings.set('layout', 'clock'); Settings.set('clockTheme', '${theme}'); Settings.set('clockSeconds', true); Settings.set('animSpeed', 0.5); ${anim ? `Settings.set('clockAnim', '${anim}');` : ''} 1`);
await sleep(9000); // the airport-board entry rolls in first
// the last seconds card
const r = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#clockScreen .fc-group[data-u="s"] .fc-cell')].pop().getBoundingClientRect())`));
// Freeze the flip the moment it starts and step its animations through time: exact frames, however slow CDP is.
await ev(`new Promise(res => { const s = new Date().getSeconds(); const t = setInterval(() => { if (new Date().getSeconds() !== s) { clearInterval(t); setTimeout(() => { window.__fa = document.getElementById('clockScreen').getAnimations({ subtree: true }); window.__fa.forEach(a => a.pause()); res(window.__fa.length); }, 30); } }, 4); })`);
const total = await ev(`Math.max(...window.__fa.map(a => (a.effect.getTiming().delay || 0) + a.effect.getTiming().duration))`);
const frames = [];
for (let i = 0; i <= 23; i++) {
  const t = Math.round(total * i / 23);
  await ev(`window.__fa.forEach(a => { a.currentTime = ${t}; }); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  const shot = await call('Page.captureScreenshot', { format: 'png', clip: { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8, scale: 1 } });
  frames.push({ at: t, data: shot.data });
}
await ev(`window.__fa.forEach(a => a.play()); 1`);// tile them in a little HTML page rendered back through the phone? Simpler: write each frame, the caller tiles.
const dir = out.replace(/\.png$/, '');
fs.mkdirSync(dir, { recursive: true });
frames.forEach((f, i) => fs.writeFileSync(`${dir}/${String(i).padStart(2, '0')}-${f.at}ms.png`, Buffer.from(f.data, 'base64')));
const b = JSON.parse(before);
await ev(`Settings.set('clockTheme', '${b.theme}'); Settings.set('clockSeconds', ${b.secs}); Settings.set('animSpeed', ${b.speed}); Settings.set('clockAnim', '${b.anim}'); Settings.set('layout', '${b.layout}'); 1`);
console.log(`${frames.length} frames in ${dir}`);
ws.close();
