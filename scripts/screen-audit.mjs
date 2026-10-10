// Dev check: walk every layout and state on the phone, screenshot each (adb, real pixels incl. WebGL) and report layout
// problems: named blocks ([data-block]) that overlap when they shouldn't, text cut off by its box, blocks off screen.
//   node scripts/screen-audit.mjs <outDir>          (needs adb forward tcp:9333, see scripts/cdp.mjs; run demo-phone first)
import fs from 'node:fs';
import { ev, sleep, screencap as shot, ws } from './cdp.mjs';
const out = process.argv[2] ?? 'android/build/audit';
fs.mkdirSync(out, { recursive: true });

// Pairs that may legitimately overlap (containers and their children, overlays that sit on the cover...).
const CHECK = `(() => {
  const ok = (a, b) => a.contains(b) || b.contains(a);
  const shown = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity < 0.05 || cs.visibility === 'hidden' || cs.display === 'none') return false; } return true; };
  const vis = el => { const r = el.getBoundingClientRect();
    if (!(r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth) || !shown(el)) return false;
    const h = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    return !h || el.contains(h) || h.contains(el) || !h.closest('#clockScreen, #settings, #listPanel'); }; // not hidden under a full-screen sheet
  const els = [...document.querySelectorAll('[data-block]')].filter(vis);
  // what actually matters: text / controls sitting on each other. The lyrics pane and screen are big containers: compare
  // against the visible lyric *lines* instead of the pane.
  const lines = [...document.querySelectorAll('#lines .ln:not(.far):not(.dots):not(.skel)')].filter(l => { const r = l.getBoundingClientRect(); const b = document.getElementById('lyrics').getBoundingClientRect(), c = (r.top + r.bottom) / 2; return l.textContent.trim() && vis(l) && c > b.top && c < b.bottom; }); // clipped by the pane = not on screen
  const OVERLAY = ['Quick settings', 'List panel', 'Control pill', 'List buttons', 'Toast', 'Quick bar', 'Settings button', 'Tags']; // meant to sit over the lyrics / song info
  const floaters = els.filter(e => !['Screen', 'Lyrics pane', 'Cover column', 'Clock screen', 'Clock pane', 'Now playing', 'Deck'].includes(e.dataset.block));
  const pane = document.getElementById('lyrics').getBoundingClientRect();
  const clip = (el, r) => el.classList?.contains('ln') ? { left: Math.max(r.left, pane.left), right: Math.min(r.right, pane.right), top: Math.max(r.top, pane.top), bottom: Math.min(r.bottom, pane.bottom) } : r;
  const hit = (a, b) => { const x = clip(a, a.getBoundingClientRect()), y = clip(b, b.getBoundingClientRect()); const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top); return w > 3 && h > 3 ? Math.round(w) + 'x' + Math.round(h) : null; };
  const issues = [];
  for (let i = 0; i < floaters.length; i++) for (let j = i + 1; j < floaters.length; j++) {
    const a = floaters[i], b = floaters[j]; if (ok(a, b) || OVERLAY.includes(a.dataset.block) || OVERLAY.includes(b.dataset.block)) continue; const o = hit(a, b); if (o) issues.push('overlap: ' + a.dataset.block + ' / ' + b.dataset.block + ' ' + o); }
  for (const f of floaters) { if (f.closest('#lyrics') || OVERLAY.includes(f.dataset.block)) continue; for (const l of lines) { const o = hit(f, l); if (o && !ok(f, l)) { issues.push('over lyrics: ' + f.dataset.block + ' on "' + l.textContent.trim().slice(0, 24) + '" ' + o); break; } } }
  for (const e of [...document.querySelectorAll('#title, #artist, #album, #tlcur, #tldur, #batt span, #tnow, .st-title, .sl-sp-label, #qtitle')].filter(vis)) {
    if (e.scrollWidth > e.clientWidth + 1 && !e.classList.contains('mq-on') && !e.closest('.mq-on')) issues.push('clipped text: ' + (e.id || e.className) + ' "' + e.textContent.trim().slice(0, 30) + '"'); }
  for (const e of floaters) { const r = e.getBoundingClientRect(); if (r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2) issues.push('off screen: ' + e.dataset.block); }
  return issues;
})()`;

const layouts = JSON.parse(await ev(`JSON.stringify(Settings.schema().find(x => x.k === 'layout').opts.map(o => o[0]))`));
const orig = await ev(`Settings.S.layout`);
const orient = await ev(`innerWidth > innerHeight ? 'land' : 'port'`);
const states = [
  ['idle', `document.body.classList.remove('ui','qs-open','settings-open','lists-open'); 1`],
  ['controls', `showUi(true); 1`],
  ['quick', `showUi(true); document.querySelector('#qs [data-q=tune]')?.click(); 1`],
];
const report = [];
for (const L of layouts) {
  await ev(`Settings.set('layout', '${L}'); document.body.classList.remove('ui','qs-open'); 1`);
  await sleep(2600);
  for (const [s, js] of states) {
    await ev(js);
    await sleep(1300);
    const f = `${out}/${orient}-${L}-${s}.png`;
    shot(f);
    const issues = await ev(CHECK);
    const blocks = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-block]')].map(e => { const r = e.getBoundingClientRect(); let v = true; for (let x = e; x && x !== document.documentElement; x = x.parentElement) { const c = getComputedStyle(x); if (+c.opacity < .05 || c.visibility === 'hidden' || c.display === 'none') v = false; } return { name: e.dataset.block, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), v }; }).filter(b => b.v && b.w > 2 && b.h > 2 && b.x < innerWidth && b.y < innerHeight && b.x + b.w > 0 && b.y + b.h > 0))`));
    report.push({ screen: `${L} / ${s}`, issues, blocks, size: await ev(`[innerWidth, innerHeight]`) });
    console.log(`${(L + ' / ' + s).padEnd(22)} ${issues.length ? issues.join(' | ') : 'ok'}`);
  }
  await ev(`document.body.classList.remove('ui','qs-open'); 1`);
}
// the sheets
await ev(`Settings.set('layout', '${orig}'); 1`); await sleep(2000);
for (const [s, js] of [['settings', `Settings.open(); 1`], ['lists', `document.body.classList.remove('settings-open'); document.querySelector('#lists button')?.click(); 1`]]) {
  await ev(js); await sleep(1500); shot(`${out}/sheet-${s}.png`);
  const issues = await ev(CHECK); report.push({ screen: s, issues });
  console.log(`${s.padEnd(22)} ${issues.length ? issues.join(' | ') : 'ok'}`);
}
await ev(`document.body.classList.remove('settings-open','lists-open','ui'); 1`);
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
ws.close();
