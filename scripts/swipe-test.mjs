// Dev check for the cover swipe (swipe.js) on the phone: real touches over CDP, with everything the app would send to
// Spotify captured instead (nothing is skipped for real). Checks which song lands, the commands sent, that no card or
// inline style is left behind, and saves a screenshot mid-drag.   node scripts/swipe-test.mjs [outDir]
import fs from 'node:fs';
import { call, ev, sleep, touch, screencap, ws } from './cdp.mjs';
const out = process.argv[2] ?? 'android/build/swipe-test';
fs.mkdirSync(out, { recursive: true });
async function drag(x0, y0, dx, ms = 260, steps = 14, hold) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await touch('touchMove', x0 + dx * i / steps, y0 + i * 0.6); }
  if (hold) await hold();
  await touch('touchEnd');
}
const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(50); await touch('touchEnd'); };
const shot = f => screencap(`${out}/${f}`);

const orig = await ev('Settings.S.layout');
// capture outgoing commands: Dock.send / Rtc.send are swapped for a recorder (Dock's other calls still go through)
await ev(`(() => { if (!window.__realDock) { window.__realDock = Dock; window.__realRtc = Rtc.send; }
  window.__sent = []; const real = window.__realDock;
  window.Dock = new Proxy({}, { get: (_, k) => k === 'send' ? s => { const m = JSON.parse(s); if (m.type === 'cmd') window.__sent.push(m.cmd); else real.send(s); } : (...a) => real[k](...a) });
  Rtc.send = s => { try { const m = JSON.parse(s); if (m.type === 'cmd') return; } catch (e) {} window.__realRtc(s); };
  Settings.set('layout', 'split'); document.body.classList.remove('ui'); return 1; })()`);
await sleep(2500);
const state = () => ev(`JSON.stringify({ id: P.id, title: document.getElementById('title').textContent, art: document.getElementById('art').style.backgroundImage,
  nb: (n => ({ next: n.next.map(x => x.id), prev: n.prev.map(x => x.id) }))(window.neighbours()), sent: window.__sent.slice(),
  left: [document.getElementById('art'), ...document.querySelectorAll('.art-peek')].filter(e => e.style.transform || e.style.opacity).length,
  peeksShown: [...document.querySelectorAll('.art-peek')].filter(e => +getComputedStyle(e).opacity > 0.01).length,
  cue: document.getElementById('swipeCue').className, dragging: document.body.classList.contains('art-dragging') })`).then(JSON.parse);
const cov = JSON.parse(await ev(`JSON.stringify(document.getElementById('art').getBoundingClientRect())`));
const cx = cov.left + cov.width / 2, cy = cov.top + cov.height / 2, step = cov.width * 1.08;
const results = [];
async function check(name, fn, want) {
  await ev(`window.__sent.length = 0; window.__swlog = []; 1`);
  const before = await state();
  await fn(before);
  await sleep(900);
  const after = await state();
  const got = want(before, after);
  const trace = got === true ? '' : `\n      trace: ${(await ev('JSON.stringify(window.__swlog)'))}\n      after: ${JSON.stringify({ title: after.title, art: after.art.slice(0, 60), dragging: after.dragging, cue: after.cue })}`;
  results.push([got === true ? 'ok  ' : 'FAIL', name, got === true ? '' : got, `sent=${after.sent.join(',') || '-'}`, after.left || after.peeksShown ? `LEFTOVER styles=${after.left} peeks=${after.peeksShown}` : '', trace]);
}
const same = (b, a) => a.id === b.id && !a.sent.length || `moved to ${a.title}`;
const landed = (n, dir) => (b, a) => {
  const t = (dir > 0 ? b.nb.next : b.nb.prev)[n - 1];
  if (a.id !== t) return `expected ${t}, got ${a.id}`;
  const c = a.sent.filter(x => x === (dir > 0 ? 'next' : 'prev')).length;
  return c >= n || `sent ${c} ${dir > 0 ? 'next' : 'prev'}`;
};
await check('short drag springs back', () => drag(cx, cy, -step * 0.2, 400), same);
const vdrag = dir => () => call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] }).then(async () => { for (let i = 1; i < 10; i++) { await sleep(25); await touch('touchMove', cx + 3, cy + dir * i * 12); } await touch('touchEnd'); });
await check('drag down on the cover does nothing', vdrag(1), same);
await check('swipe up on the cover = play / pause', vdrag(-1), (b, a) => a.id === b.id && a.sent.join() === 'toggle' || `sent=${a.sent}`);
await check('short slow swipe up does nothing', async () => { await touch('touchStart', cx, cy); for (let i = 1; i <= 6; i++) { await sleep(60); await touch('touchMove', cx, cy - i * 4); } await sleep(150); await touch('touchEnd'); }, same);
await check('swipe left one card = next', () => drag(cx, cy, -step * 0.7, 300, 14, async () => { await sleep(150); shot('mid-next.png'); }), landed(1, 1));
await check('swipe right one card = previous', () => drag(cx, cy, step * 0.7, 300), landed(1, -1));
await check('long swipe = 2 ahead', () => drag(cx, cy, -step * 2.1, 520, 22, async () => { await sleep(150); shot('mid-two.png'); }), landed(2, 1));
await check('flick = next', () => drag(cx, cy, -step * 0.3, 60, 4), landed(1, 1)); // adb-driven touches arrive slower than a real finger's
await check('flick back cancels', () => drag(cx, cy, -step * 0.5, 300, 10, async () => { for (let i = 1; i <= 3; i++) { await sleep(12); await touch('touchMove', cx - step * 0.5 + i * 25, cy); } }), same);
const lyr = JSON.parse(await ev(`JSON.stringify(document.getElementById('lyrics').getBoundingClientRect())`));
await check('horizontal swipe on the lyrics does nothing', () => drag(lyr.left + lyr.width * .7, lyr.top + lyr.height / 2, -lyr.width * .5, 160, 6), same);
// quick left, right, left: the end state must be one consistent song, nothing left on screen
await check('quick left-right-left', async () => { await drag(cx, cy, -step * 0.5, 90, 4); await sleep(60); await drag(cx, cy, step * 0.5, 90, 4); await sleep(60); await drag(cx, cy, -step * 0.5, 90, 4); },
  (b, a) => (a.title && a.art.includes('url') && !a.dragging) || 'inconsistent');
await check('double tap on the cover = like', async () => { await tap(cx, cy); await sleep(110); await tap(cx, cy); }, (b, a) => a.sent.includes('heart') || 'no like');
await sleep(600);
for (const r of results) console.log(r.filter(Boolean).join('  '));
// restore
await ev(`(() => { window.Dock = window.__realDock; Rtc.send = window.__realRtc; Settings.set('layout', ${JSON.stringify(orig)});
  P.skip = null; P.hist = []; const t = SRC[P.source].track; if (t) onTrack({ ...t, dir: 1 }); return 1; })()`); // back to what Spotify is really playing
ws.close();
