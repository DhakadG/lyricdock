// Dev check: real touch gestures on the phone over CDP (Input.dispatchTouchEvent), with seek / skip / like intercepted, so
// nothing reaches Spotify. Each case says what should fire; the script reports what did.  node scripts/gesture-test.mjs
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
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.value;
const sleep = t => new Promise(r => setTimeout(r, t));
const touch = (type, x, y) => call('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function drag(x0, y0, x1, y1, ms = 250, steps = 12) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); }
  await touch('touchEnd');
}
async function tap(x, y) { await touch('touchStart', x, y); await sleep(60); await touch('touchEnd'); }

await ev(`(() => { window.__g = []; const g = window.__g;
  Lyrics.onSeek(t => g.push('seek')); window.__nx = $('next').onclick; window.__pv = $('prev').onclick; window.__ht = $('heart').onclick;
  $('next').onclick = () => g.push('next'); $('prev').onclick = () => g.push('prev'); $('heart').onclick = () => g.push('like');
  document.body.classList.remove('ui'); return 1; })()`);
const box = JSON.parse(await ev(`JSON.stringify(document.getElementById('lyrics').getBoundingClientRect())`));
await sleep(3600); // free scroll glides back first
const findLine = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#lines .ln:not(.dots):not(.credits)')].map(l => l.querySelector('.sy') || l).map(w => w.getBoundingClientRect()).find(r => r.top > 60 && r.bottom < innerHeight - 40 && document.elementFromPoint(r.left + 4, r.top + r.height / 2)?.closest('.ln:not(.dots)')))`));
const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
const cases = [
  ['vertical scroll on lyrics', () => drag(cx, cy + 60, cx + 8, cy - 70), 'free scroll only'],
  ['diagonal scroll on lyrics', () => drag(cx, cy + 50, cx + 75, cy - 40), 'free scroll only (no skip)'],
  ['horizontal swipe on lyrics', () => drag(cx + 80, cy, cx - 90, cy + 8, 120, 4), 'nothing (skips: cover only)'],
  ['tap on a lyric line', async () => { const line = await findLine(); await tap(line.left + 4, line.top + line.height / 2); }, 'seek (no controls)'],
  ['double tap on a line', async () => { const line = await findLine(); await tap(line.left + 4, line.top + line.height / 2); await sleep(120); await tap(line.left + 4, line.top + line.height / 2); }, 'seek, seek (no like)'],
];
for (const [name, fn, want] of cases) {
  await ev(`window.__g.length = 0; document.body.classList.remove('ui'); 1`);
  await sleep(name.includes('tap') ? 3600 : 500);
  await fn();
  await sleep(700);
  const got = await ev(`JSON.stringify({ fired: window.__g, controls: document.body.classList.contains('ui'), free: Lyrics.isFree() })`);
  console.log(`${name.padEnd(28)} want: ${want.padEnd(28)} got: ${got}`);
}
await ev(`$('next').onclick = window.__nx; $('prev').onclick = window.__pv; $('heart').onclick = window.__ht; Lyrics.onSeek(seek); document.body.classList.remove('ui'); 1`);
// ---- timeline and cover (their commands are caught before they reach Spotify)
const T2 = (type, x, y) => call('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const drag2 = async (x0, y0, x1, y1, n = 4) => { await T2('touchStart', x0, y0); for (let i = 1; i <= n; i++) { await sleep(15); await T2('touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); } await T2('touchEnd'); };
const tap2 = async (x, y) => { await T2('touchStart', x, y); await sleep(60); await T2('touchEnd'); };
await ev(`(() => { window.__g = []; const g = window.__g;
  window.__ds = Dock.send; try { Dock.send = s => { const m = JSON.parse(s); if (m.type === 'cmd') g.push(m.cmd); else window.__ds.call(Dock, s); }; } catch (e) {}
  window.__rs = Rtc.send; Rtc.send = s => { const m = JSON.parse(s); if (m.type === 'cmd') g.push(m.cmd); else window.__rs(s); };
  return String(Dock.send === window.__ds); })()`);
await sleep(1200); // the cover may still be growing back from "controls up": measure once it has settled
const tl = JSON.parse(await ev(`JSON.stringify(document.getElementById('tlhit').getBoundingClientRect())`));
const art = JSON.parse(await ev(`JSON.stringify(document.getElementById('art').getBoundingClientRect())`));
const ty = tl.top + tl.height / 2, ax = art.left + art.width / 2, ay = art.top + art.height / 2;
const cases2 = [
  ['timeline: finger scrolls up', () => drag2(tl.left + 60, ty, tl.left + 64, ty - 90), 'nothing'],
  ['timeline: tap', () => tap2(tl.left + tl.width * 0.5, ty), 'seek'],
  ['timeline: drag sideways', () => drag2(tl.left + 20, ty, tl.left + tl.width * 0.7, ty + 3, 6), 'seek (once, on release)'],
  ['cover: tap', () => tap2(ax, ay), 'controls toggle'],
  ['cover: vertical drag', () => drag2(ax, ay + 40, ax + 5, ay - 60), 'nothing'],
  ['cover: swipe left', () => drag2(ax + 60, ay, ax - 120, ay + 4), 'next (swipe.js; details: swipe-test.mjs)'],
];
for (const [name, fn, want] of cases2) {
  await ev(`window.__g.length = 0; document.body.classList.remove('ui'); 1`);
  await sleep(900);
  await fn();
  await sleep(900);
  console.log(`${name.padEnd(28)} want: ${want.padEnd(24)} got: ${await ev(`JSON.stringify({ fired: window.__g, controls: document.body.classList.contains('ui') })`)}`);
}
await ev(`try { Dock.send = window.__ds; } catch (e) {} Rtc.send = window.__rs; document.body.classList.remove('ui', 'art-dragging'); 1`);

ws.close();
