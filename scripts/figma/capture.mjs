// Dev tool: capture what the Figma design file is built from - for every layout, at one moment of the demo song, in the
// phone's current orientation: a real screenshot (idle, controls, quick settings), every [data-block] rectangle, every visible
// lyric line (text, state, side, box, font size) and the song details. Output: <dir>/<orient>-<layout>-*.png + data.json.
//   node scripts/figma/capture.mjs <dir>        (demo song running: node scripts/demo-phone.mjs start)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = process.argv[2] ?? 'android/build/figma';
fs.mkdirSync(dir, { recursive: true });
const ADB = process.env.ADB ?? 'C:/Users/lost_husky/Downloads/Programs/ADB_AppControl/adb/adb.exe';
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find(p => p.url.includes('android_asset')).webSocketDebuggerUrl);
let id = 0;
const call = (m, p = {}) => new Promise(r => { const my = ++id; const on = e => { const x = JSON.parse(e.data); if (x.id !== my) return; ws.removeEventListener('message', on); r(x.result); }; ws.addEventListener('message', on); ws.send(JSON.stringify({ id: my, method: m, params: p })); });
await new Promise(r => ws.addEventListener('open', r));
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const sleep = t => new Promise(r => setTimeout(r, t));
const shot = f => fs.writeFileSync(f, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64e6 }));

const DATA = `(() => {
  const R = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const shown = e => { for (let x = e; x && x !== document.documentElement; x = x.parentElement) { const c = getComputedStyle(x); if (+c.opacity < .05 || c.visibility === 'hidden' || c.display === 'none') return false; } return true; };
  const inView = r => r.w > 2 && r.h > 2 && r.x < innerWidth && r.y < innerHeight && r.x + r.w > 0 && r.y + r.h > 0;
  const blocks = [...document.querySelectorAll('[data-block]')].map(e => ({ name: e.dataset.block, ...R(e), show: shown(e) })).filter(b => b.show && inView(b));
  const pane = document.getElementById('lyrics').getBoundingClientRect();
  const lines = [...document.querySelectorAll('#lines > .ln')].map(l => {
    const r = R(l), cs = getComputedStyle(l);
    return { text: l.classList.contains('dots') ? '•••' : (l.querySelector('.main') || l).innerText.replace(/\\s+/g, ' ').trim(), bg: l.querySelector('.bgv')?.innerText.trim() || '',
      state: l.classList.contains('on') ? 'active' : l.classList.contains('sung') ? 'sung' : 'upcoming', opp: l.classList.contains('opp'), dots: l.classList.contains('dots'),
      credits: l.classList.contains('credits'), ...r, fs: parseFloat(cs.fontSize), op: +cs.opacity, align: cs.textAlign };
  }).filter(l => l.y + l.h > pane.top && l.y < pane.bottom && l.h > 2 && l.text);
  const sung = [...document.querySelectorAll('#lines .ln.on .sy')].map(s => ({ t: s.textContent, gp: s.style.getPropertyValue('--gp') }));
  return { size: [innerWidth, innerHeight], layout: Settings.S.layout, blocks, lines, sung, pane: R(document.getElementById('lyrics')),
    meta: { title: document.getElementById('title').innerText, artist: document.getElementById('artist').innerText, album: document.getElementById('album').innerText,
      cur: document.getElementById('tlcur').innerText, dur: document.getElementById('tldur').innerText },
    css: { lsize: getComputedStyle(document.documentElement).getPropertyValue('--lsize'), acc: getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() } };
})()`;

const orient = await ev(`innerWidth > innerHeight ? 'land' : 'port'`);
const layouts = JSON.parse(await ev(`JSON.stringify(Settings.schema().find(x => x.k === 'layout').opts.map(o => o[0]))`));
const orig = await ev(`Settings.S.layout`);
const all = fs.existsSync(`${dir}/data.json`) ? JSON.parse(fs.readFileSync(`${dir}/data.json`, 'utf8')) : {};
for (const L of layouts) {
  await ev(`Settings.set('layout', '${L}'); document.body.classList.remove('ui', 'qs-open'); 1`);
  await sleep(2400);
  // the demo song again (the app replays Spotify's song whenever it re-checks the source), at the same moment every
  // time: an active held note, a duet line, background vocals in view
  await ev(`window.demoTrack && demoTrack('word'); demoAt(19500); 1`);
  await sleep(1400);
  shot(`${dir}/${orient}-${L}-idle.png`);
  all[`${orient}-${L}`] = JSON.parse(await ev(`JSON.stringify(${DATA})`));
  await ev(`showUi(true); 1`); await sleep(1100); shot(`${dir}/${orient}-${L}-controls.png`);
  await ev(`document.querySelector('#qs [data-q=tune]')?.click(); 1`); await sleep(1100); shot(`${dir}/${orient}-${L}-quick.png`);
  await ev(`document.body.classList.remove('ui', 'qs-open'); 1`);
  console.log(orient, L, all[`${orient}-${L}`].lines.length, 'lines', all[`${orient}-${L}`].blocks.length, 'blocks');
}
await ev(`Settings.set('layout', '${orig}'); Settings.open(); 1`); await sleep(1500); shot(`${dir}/${orient}-settings.png`);
await ev(`document.body.classList.remove('settings-open'); 1`);
fs.writeFileSync(`${dir}/data.json`, JSON.stringify(all, null, 1));
ws.close();
