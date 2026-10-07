// Dev tool: the interaction shots for the design file, in the phone's current orientation - the layout picker, and the
// cover swipe held mid-drag (one song, then +2) with its edge tab. Each drag slides back before letting go, so nothing
// skips.   node scripts/figma/capture-extras.mjs <dir>     (demo song running: node scripts/demo-phone.mjs start)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = process.argv[2] ?? 'android/build/figma2';
fs.mkdirSync(dir, { recursive: true });
const ADB = process.env.ADB ?? 'C:/Users/lost_husky/Downloads/Programs/ADB_AppControl/adb/adb.exe';
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find(p => p.url.includes('android_asset')).webSocketDebuggerUrl);
let id = 0;
const call = (m, p = {}) => new Promise(r => { const my = ++id; const on = e => { const x = JSON.parse(e.data); if (x.id !== my) return; ws.removeEventListener('message', on); r(x.result); }; ws.addEventListener('message', on); ws.send(JSON.stringify({ id: my, method: m, params: p })); });
await new Promise(r => ws.addEventListener('open', r));
const ev = async x => (await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = t => new Promise(r => setTimeout(r, t));
const shot = f => fs.writeFileSync(`${dir}/${f}`, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64e6 }));
const T = (type, x, y) => call('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const orient = await ev(`innerWidth > innerHeight ? 'land' : 'port'`);
const orig = await ev('Settings.S.layout');

// Nothing real in the mockups: the demo song is re-pinned before every shot (the app replays Spotify's song whenever it
// re-checks the source), and the swipe's neighbours are invented songs with covers drawn right here.
await ev(`(() => {
  const mk = (t, a, b) => { const c = document.createElement('canvas'); c.width = c.height = 480; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 480, 480);
    gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 480, 480);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(360, 130, 150, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '800 50px Inter, sans-serif'; g.fillText(t, 34, 420); return c.toDataURL('image/jpeg', .9); };
  const songs = (list, tag) => list.map(([t, a, b], i) => ({ id: 'demo' + tag + i, title: t, artist: 'Aria Vale', art: mk(t, a, b), dur: 200000, lyrics: null }));
  const next = songs([['Paper Lanterns', '#ff7a59', '#6a1b9a'], ['Night Bus', '#1e88e5', '#0d1b2a'], ['Glasshouse', '#26a69a', '#1b5e20']], 'n');
  const prev = songs([['Low Tide', '#f9a825', '#4e342e'], ['Static Hearts', '#ec407a', '#311b92'], ['Northbound', '#78909c', '#263238']], 'p');
  if (!window.__realNb) window.__realNb = window.neighbours;
  window.neighbours = () => ({ next, prev });
  window.__pin = () => { demoTrack('word'); demoAt(19500); };
  return 1; })()`);
await ev(`Settings.set('layout', 'split'); document.body.classList.remove('ui', 'qs-open'); __pin(); 1`);
await sleep(2200);
await ev(`__pin(); showUi(true); document.querySelector('#qs [data-q=layout]').click(); 1`);
await sleep(1200); shot(`${orient}-picker.png`);
await ev(`document.body.classList.remove('ui', 'qs-open', 'qs-layouts'); 1`);
await sleep(1500);
const r = JSON.parse(await ev(`JSON.stringify(document.getElementById('art').getBoundingClientRect())`));
const cx = r.left + r.width / 2, cy = r.top + r.height / 2, step = r.width * 1.08;
for (const [name, dx] of [['swipe-next', -step * 0.75], ['swipe-two', -step * 1.95], ['swipe-prev', step * 0.75]]) {
  await ev(`__pin(); 1`); await sleep(700);
  await T('touchStart', cx, cy);
  for (let i = 1; i <= 16; i++) { await sleep(20); await T('touchMove', cx + dx * i / 16, cy); }
  await sleep(350); shot(`${orient}-${name}.png`);
  for (let i = 15; i >= 0; i--) { await sleep(12); await T('touchMove', cx + dx * i / 16, cy); } // back to the middle: springs back, no skip
  await T('touchEnd'); await sleep(900);
}
await ev(`Settings.set('layout', ${JSON.stringify(orig)}); if (window.__realNb) { window.neighbours = window.__realNb; window.__realNb = null; } 1`);
console.log(orient, 'picker + 3 swipe shots');
ws.close();
