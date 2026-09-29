// Figma: 03/04 · Screens for LyricDock v2. Run via the loader with ARGS = { orient: 'land'|'port', layouts: [...] }.
// One row per layout: block wireframe (measured on the phone) · design built from the 02 components · real phone captures.
const ORDER = ['split', 'player', 'lyrics', 'compact', 'tv', 'cinema', 'nowbar', 'clocksplit', 'clock'];
const NAME = { split: 'Default', player: 'Player card', lyrics: 'Lyrics only', compact: 'Compact', tv: 'TV view', cinema: 'Cinema', nowbar: 'Now Bar', clocksplit: 'Cover + clock', clock: 'Flip clock' };
const DESC = { split: 'Cover column + Lyrics pane. Timeline under the cover; controls over the cover on tap.', player: 'Mini player (thumb, Now playing, Deck) beside the lyrics. Deck timeline always visible.',
  lyrics: 'Lyrics pane full width. Edge progress bar.', compact: 'Small cover + Now playing on top, lyrics below. Edge progress bar.', tv: 'Default with a bigger cover and type, for a desk or TV.',
  cinema: 'Huge centred lyrics; Now-playing badge bottom-left.', nowbar: 'Lyrics + floating Now Bar pill (round spinning cover). Like button lives in the title row, never on the spinning cover.',
  clocksplit: 'Cover column + flip clock (HH:MM).', clock: 'Full-screen flip clock. Tap = seconds, double tap = back.' };
const { orient, layouts } = ARGS;
const BASE = 'http://localhost:9229/build/figma/';
await figma.loadAllPagesAsync();
const page = figma.root.children.find(p => p.name === 'LyricDock · Design File'); await figma.setCurrentPageAsync(page);
const board = page.children.find(c => c.name === 'LyricDock v2 — Design File');
const ids = JSON.parse(figma.root.getPluginData('ld2'));
const N = async id => figma.getNodeByIdAsync(id);
for (const s of ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Light']) await figma.loadFontAsync({ family: 'Inter', style: s });
const hex = h => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const solid = (h, o = 1) => ({ type: 'SOLID', color: hex(h), opacity: o });
const W = '#FFFFFF', ACC = '#DCBE6E';
const frame = (parent, name, w, h, fill, r = 0) => { const n = figma.createFrame(); n.name = name; n.resize(w, h); n.cornerRadius = r; n.fills = fill ? [fill] : []; parent?.appendChild(n); return n; };
const txt = (parent, s, size, style = 'Regular', fill = solid(W), w) => { const t = figma.createText(); t.fontName = { family: 'Inter', style }; t.fontSize = size; t.characters = s; t.fills = [fill]; if (w) { t.textAutoResize = 'HEIGHT'; t.resize(w, t.height); } parent?.appendChild(t); return t; };
const imgCache = {};
const img = async f => imgCache[f] ??= figma.createImage(new Uint8Array(await (await fetch(BASE + f)).arrayBuffer()));
const imgFill = (im, mode = 'FILL') => ({ type: 'IMAGE', imageHash: im.hash, scaleMode: mode });
const variant = (set, name) => set.children.find(c => c.name === name) ?? set.defaultVariant;
const prop = (inst, start) => Object.keys(inst.componentProperties).find(k => k.startsWith(start));

const LS = await N(ids.line), TL = await N(ids.timeline), BAT = await N(ids.battery), NP = await N(ids.np), LK = await N(ids.like), NB = await N(ids.nowbar), PILL = await N(ids.pill), TAG = await N(ids.tag);
const data = await (await fetch(BASE + 'data.json')).json();
const cover = await img('cover.png');
const cards = {}; for (const d of ['0', '9', '4', '1']) cards[d] = await img(`fc-light-card-${d}.png`); // the phone runs light cards
const cardSize = await cards['0'].getSizeAsync();

// the orientation's section
const secName = orient === 'land' ? '04 · Screens — Landscape (760 × 360)' : '04 · Screens — Portrait (360 × 760)';
const [SW, SH] = orient === 'land' ? [760, 360] : [360, 760];
const ROWH = SH + 110, ROWW = 320 + 5 * SW + 6 * 40;
let sec = board.children.find(c => c.name === secName);
if (!sec) {
  sec = frame(board, secName, ROWW + 80, 140 + ORDER.length * ROWH, solid('#0B0B0E'), 24);
  sec.x = orient === 'land' ? 0 : 4600; sec.y = 2300; sec.clipsContent = false;
  txt(sec, secName, 40, 'Extra Bold', solid('#E0B56B')).x = 40;
  const sub = txt(sec, 'Each row: blocks measured on the phone (Settings → Show block names) · the design built from 02 · Components · real phone screenshots (idle, controls up, quick settings). Demo song "Midnight Signal" at 0:19.5.', 16, 'Regular', solid(W, .6), ROWW - 80); sub.x = 40; sub.y = 56;
  for (const [i, h] of ['Layout', 'Wireframe · blocks', 'Design · components', 'Phone · idle', 'Phone · controls', 'Phone · quick settings'].entries()) { const t = txt(sec, h, 14, 'Semi Bold', solid(W, .5)); t.x = i ? 40 + 320 + (i - 1) * (SW + 40) : 40; t.y = 104; }
}

const SKIP = new Set(['Screen', 'Cover art', 'Title row', 'Title', 'Artist', 'Album line', 'Battery']);
for (const L of layouts) {
  const D = data[`${orient}-${L}`]; if (!D) continue;
  sec.children.filter(c => c.name === `Row · ${NAME[L]}`).forEach(c => c.remove());
  const row = frame(sec, `Row · ${NAME[L]}`, ROWW, SH, null); row.x = 40; row.y = 140 + ORDER.indexOf(L) * ROWH; row.clipsContent = false;
  const B = Object.fromEntries(D.blocks.map(b => [b.name, b]));
  const isClock = L === 'clock';
  const blocks = D.blocks.filter(b => isClock ? ['Clock screen', 'Status cluster'].includes(b.name) : b.name !== 'Clock screen');

  // label
  const lab = frame(row, 'Label', 290, SH, null);
  txt(lab, NAME[L], 26, 'Extra Bold');
  const id = txt(lab, `layout: ${L}`, 13, 'Medium', solid(ACC)); id.y = 36;
  const ds = txt(lab, DESC[L], 13, 'Regular', solid(W, .65), 280); ds.y = 60;
  // wireframe: one clean box per block. Containers go when their children already cover them, identical boxes merge,
  // each role has its own colour, and every box gets a numbered chip (legend in the label column) that never collides.
  const inside = (a, b) => a.x >= b.x - 2 && a.y >= b.y - 2 && a.x + a.w <= b.x + b.w + 2 && a.y + a.h <= b.y + b.h + 2;
  let wb = blocks.filter(b => !SKIP.has(b.name)).map(b => ({ ...b }));
  const pillLike = { nowbar: 'Now Bar pill', cinema: 'Now-playing badge' }[L];
  const col = wb.find(b => b.name === 'Cover column');
  if (col && pillLike) { col.name = pillLike; wb = wb.filter(b => b === col || !inside(b, col)); }
  else wb = wb.filter(b => b.name !== 'Cover column');
  const merged = [];
  for (const b of wb) { const m = merged.find(x => Math.abs(x.x - b.x) < 3 && Math.abs(x.y - b.y) < 3 && Math.abs(x.w - b.w) < 3 && Math.abs(x.h - b.h) < 3); if (m) m.name += ' / ' + b.name; else merged.push(b); }
  for (const b of merged) { const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y); b.w = Math.min(SW, b.x + b.w) - x0; b.h = Math.min(SH, b.y + b.h) - y0; b.x = x0; b.y = y0; }
  merged.sort((a, b) => b.w * b.h - a.w * a.h); // big first, small on top
  const ROLE = [[/Lyrics/, '#B79CFF'], [/Cover$|Cover art/, '#6FA8FF'], [/Like/, '#FF7A9A'], [/Timeline|Edge/, '#5FD3C0'], [/Now playing|Now Bar|badge/, '#8EE07A'], [/Deck|Control|List/, '#FFB35C'], [/Clock/, '#DCBE6E'], [/Status/, '#C8C8D0']];
  const colour = n => (ROLE.find(([re]) => re.test(n)) ?? [0, '#C8C8D0'])[1];
  const wf = frame(row, 'Wireframe', SW, SH, solid('#121218'), 14); wf.x = 320; wf.clipsContent = true;
  wf.strokes = [solid(W, .12)]; wf.strokeWeight = 1;
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const pane = B['Lyrics pane'];
  if (pane && !isClock) for (const l of D.lines) { // faint bars where the lyric lines sit
    const w = Math.min(l.w, (l.dots ? 3 : l.text.length) * l.fs * .5), h = l.fs * .55, y = l.y + (Math.min(l.h, l.fs * 1.3) - h) / 2;
    const x = l.align === 'right' ? l.x + l.w - w : l.align === 'center' ? l.x + (l.w - w) / 2 : l.x, bar = { x, y, w, h };
    if (y < pane.y || y + h > pane.y + pane.h || merged.some(o => !/Lyrics/.test(o.name) && hit(bar, o))) continue;
    const r = figma.createRectangle(); wf.appendChild(r); r.name = 'line'; r.resize(Math.max(8, w), h); r.cornerRadius = h / 2;
    r.x = x; r.y = y; r.fills = [solid(W, l.state === 'active' ? .22 : .07)];
  }
  const chips = [];
  merged.forEach((b, i) => {
    const c = colour(b.name);
    const r = frame(wf, b.name, Math.max(3, b.w), Math.max(3, b.h), solid(c, .09), Math.min(8, b.h / 2)); r.x = b.x; r.y = b.y;
    r.strokes = [solid(c, .85)]; r.strokeWeight = 1;
    // candidate spots, best first; a spot is bad if it hits a chip / name or cuts across another box's outline
    const cand = [];
    if (b.w >= 26 && b.h >= 24) cand.push([b.x + 4, b.y + 4]);
    if (b.w >= 18 && b.h >= 18) cand.push([b.x + (b.w - 16) / 2, b.y + (b.h - 16) / 2]);
    for (const dx of [0, 20, 40, -20, 60]) cand.push([b.x + dx, b.y - 20], [b.x + dx, b.y + b.h + 4]);
    cand.push([b.x + b.w + 4, b.y + (b.h - 16) / 2], [b.x - 20, b.y + (b.h - 16) / 2]);
    const crosses = (a, o) => o !== b && hit(a, o) && !inside(a, o);
    const ok = c => c.x >= 2 && c.y >= 2 && c.x + 16 <= SW - 2 && c.y + 16 <= SH - 2 && !chips.some(o => hit(o, c)) && !merged.some(o => crosses(c, o));
    const ch = cand.map(([x, y]) => ({ x, y, w: 16, h: 16 })).find(ok) ?? { x: b.x + 4, y: b.y + 4, w: 16, h: 16 };
    chips.push(ch);
    const chip = frame(wf, `#${i + 1}`, 16, 16, solid(c), 8); chip.x = ch.x; chip.y = ch.y;
    const n = txt(chip, String(i + 1), 9, 'Extra Bold', solid('#121218')); n.x = 8 - n.width / 2; n.y = 8 - n.height / 2;
    if (b.w >= 110 && b.h >= 44) { const nm = txt(wf, b.name, 11, 'Semi Bold', solid(c)); nm.x = ch.x + 22; nm.y = ch.y + 1; const nb = { x: nm.x, y: nm.y, w: nm.width, h: 14 }; if (chips.some(o => hit(o, nb)) || merged.some(o => o !== b && hit(nb, o) && !inside(nb, o)) || !inside(nb, b)) nm.remove(); else chips.push(nb); }
  });
  // legend
  const lg = frame(lab, 'Legend', 280, 10, null); lg.y = ds.y + ds.height + 14; lg.layoutMode = 'VERTICAL'; lg.itemSpacing = 5; lg.primaryAxisSizingMode = 'AUTO';
  merged.forEach((b, i) => { const it = frame(lg, b.name, 10, 10, null); it.layoutMode = 'HORIZONTAL'; it.itemSpacing = 7; it.counterAxisAlignItems = 'CENTER'; it.primaryAxisSizingMode = 'AUTO'; it.counterAxisSizingMode = 'AUTO';
    const d = frame(it, 'chip', 14, 14, solid(colour(b.name)), 7); const n = txt(d, String(i + 1), 8, 'Extra Bold', solid('#121218')); n.x = 7 - n.width / 2; n.y = 7 - n.height / 2;
    txt(it, b.name, 11, 'Medium', solid(W, .75)); });

  // design
  const dx = 320 + SW + 40;
  const ds2 = frame(row, `${NAME[L]} — design`, SW, SH, solid('#000000'), 14); ds2.x = dx; ds2.clipsContent = true;
  const bg = figma.createRectangle(); ds2.appendChild(bg); bg.name = 'Background · cover, blurred'; bg.resize(SW * 1.4, SH * 1.4); bg.x = -SW * .2; bg.y = -SH * .2;
  bg.fills = [imgFill(cover)]; bg.effects = [{ type: 'LAYER_BLUR', radius: 90, visible: true }];
  const dim = figma.createRectangle(); ds2.appendChild(dim); dim.name = 'Dim'; dim.resize(SW, SH); dim.fills = [solid('#000000', isClock ? .7 : .42)];
  const put = (n, x, y) => { ds2.appendChild(n); n.x = x; n.y = y; return n; };
  const coverRect = (b, r) => { const c = figma.createRectangle(); c.name = 'Cover'; c.resize(b.w, b.h); c.cornerRadius = r; c.fills = [imgFill(cover)]; c.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: .45 }, offset: { x: 0, y: 6 }, radius: 22, spread: 0, visible: true, blendMode: 'NORMAL' }]; return put(c, b.x, b.y); };

  if (!isClock) {
    // lyrics
    const pane = B['Lyrics pane'];
    if (pane) {
      const lp = frame(ds2, 'Lyrics pane', pane.w, pane.h, null); lp.x = pane.x; lp.y = pane.y; lp.clipsContent = true;
      let bottom = -1e9; // Inter wraps a little differently from the app's font: stack, never overlap
      for (const l of D.lines) {
        const state = l.dots ? 'Interlude' : { active: 'Active', sung: 'Sung', upcoming: 'Upcoming' }[l.state];
        const voice = l.dots ? 'Lead' : l.opp ? 'Duet' : 'Lead';
        const inst = variant(LS, `State=${state}, Voice=${voice}`).createInstance(); lp.appendChild(inst);
        if (!l.dots) {
          inst.setProperties({ [prop(inst, 'Line')]: l.text });
          const t = inst.findOne(n => n.type === 'TEXT'); t.fontSize = l.fs; t.textAutoResize = 'HEIGHT'; inst.resize(l.w, inst.height); t.layoutSizingHorizontal = 'FILL'; if (l.align === 'right') t.textAlignHorizontal = 'RIGHT'; if (l.align === 'center') t.textAlignHorizontal = 'CENTER';
        } else inst.rescale(l.fs / 32.4);
        inst.x = l.x - pane.x; inst.y = Math.max(l.y - pane.y, bottom + 4); bottom = inst.y + inst.height;
        if (l.dots && l.align === 'center') inst.x = (pane.w - inst.width) / 2;
        if (l.bg) { const bv = variant(LS, `State=${state}, Voice=Background`).createInstance(); lp.appendChild(bv); bv.setProperties({ [prop(bv, 'Line')]: l.bg }); const t = bv.findOne(n => n.type === 'TEXT'); t.fontSize = l.fs * .62;
          if (l.align !== 'start') { t.textAutoResize = 'HEIGHT'; bv.resize(l.w, bv.height); t.layoutSizingHorizontal = 'FILL'; t.textAlignHorizontal = l.align === 'center' ? 'CENTER' : 'RIGHT'; }
          bv.x = inst.x; bv.y = bottom + 2; bottom = bv.y + bv.height; }
      }
      // the app's soft fade at the top and bottom of the pane (an alpha mask), so lines never run hard into the edge bar
      const m = figma.createRectangle(); m.name = 'Fade mask'; m.resize(pane.w, pane.h); lp.insertChild(0, m);
      m.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 0 } }, { position: .1, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: .86, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } }] }];
      m.isMask = true; m.maskType = 'ALPHA';
    }
    // cover, like, timeline, now playing
    if (L === 'nowbar' && B['Cover column']) { const nb = NB.createInstance(); nb.rescale(B['Cover column'].h / 46); put(nb, B['Cover column'].x, B['Cover column'].y); }
    else {
      const cv = B['Cover art'] ?? B['Cover']; if (cv) coverRect(cv, Math.max(4, cv.w * .045));
      if (B['Like button'] && B['Cover'] && B['Like button'].y < B['Cover'].y + B['Cover'].h) { const lk = LK.defaultVariant.createInstance(); lk.rescale(B['Like button'].w / 25); put(lk, B['Like button'].x, B['Like button'].y); }
      if (B['Timeline']) { const t = variant(TL, 'State=Idle, Lossless=On').createInstance(); t.resize(B['Timeline'].w, 14); put(t, B['Timeline'].x, B['Timeline'].y - 2); }
      const np = B['Now playing'], ti = B['Title'];
      if (np && ti) {
        const ar = B['Artist'], centred = !(ar && Math.abs(ar.x - ti.x) < 4) && ti.x - np.x > 16; // left layouts start the artist where the title starts
        const inst = (centred || !ids.npLeft ? NP : await N(ids.npLeft)).createInstance();
        inst.setProperties({ [prop(inst, 'Title')]: D.meta.title, [prop(inst, 'Artist')]: D.meta.artist, [prop(inst, 'Album')]: D.meta.album });
        const tn = inst.findOne(n => n.name === 'Title'); inst.rescale(ti.h / tn.height);
        put(inst, centred ? np.x + np.w / 2 - inst.width / 2 : ti.x, ti.y);
        if (L === 'player' && B['Like button']) { const lk = LK.defaultVariant.createInstance(); lk.rescale(B['Like button'].w / 25); const k = ti.h / tn.height;
          const tw = figma.createText(); tw.fontName = tn.fontName; tw.fontSize = tn.fontSize; tw.characters = D.meta.title; const w = tw.width * inst.width / NP.width; tw.remove();
          put(lk, ti.x + Math.min(w, np.x + np.w - ti.x - lk.width) + 6, B['Like button'].y); }
        if (L === 'player') { const th = { x: np.x + 6, y: np.y + 2, w: ti.x - np.x - 14, h: ti.x - np.x - 14 }; coverRect(th, 6); }
      }
      if (B['Deck']) { const p = PILL.createInstance(); const dt = B['Deck timeline'], top = dt ? dt.y + dt.h + 6 : B['Deck'].y, room = B['Deck'].y + B['Deck'].h - top;
          p.rescale(Math.min(B['Deck'].w / p.width, room / p.height)); put(p, B['Deck'].x + (B['Deck'].w - p.width) / 2, top); // the timeline sits on top of the pill, like the app's deck // the timeline sits on top of the pill, like the app's deck
        if (B['Deck timeline']) { const t = variant(TL, 'State=Idle, Lossless=On').createInstance(); t.resize(B['Deck timeline'].w, 14); put(t, B['Deck timeline'].x, B['Deck timeline'].y); } }
    }
    if (B['Edge progress bar']) { const e = B['Edge progress bar']; const tr = frame(ds2, 'Edge progress bar', e.w, 3, solid(W, .18), 2); tr.x = e.x; tr.y = e.y; frame(tr, 'Fill', e.w * 22 / 200, 3, solid(W, .9), 2);
      const et = B['Edge times']; if (et) { const a = txt(ds2, D.meta.cur, 9, 'Semi Bold', solid(W, .7)); a.x = et.x; a.y = et.y; const b = txt(ds2, D.meta.dur, 9, 'Semi Bold', solid(W, .55)); b.x = et.x + et.w - b.width; b.y = et.y; } }
  } else {
    // flip clock, full screen: the app's own card art (fc-card-*.png, baked from the Figma digit frames)
    const cs = B['Clock screen'], stacked = cs.h > cs.w;
    const ch = stacked ? cs.h * .3 : cs.h * .52, cw = ch * cardSize.width / cardSize.height, gap = cw * .06, colon = stacked ? 0 : cw * .28;
    const groups = [['0', '9'], ['4', '1']];
    const totalW = stacked ? 2 * cw + gap : 4 * cw + 2 * gap + colon, totalH = stacked ? 2 * ch + ch * .12 : ch;
    groups.forEach((g, gi) => g.forEach((d, di) => {
      const r = figma.createRectangle(); r.name = `Card ${d}`; r.resize(cw, ch); r.fills = [imgFill(cards[d], 'FIT')];
      const x = cs.x + (cs.w - totalW) / 2 + (stacked ? di * (cw + gap) : gi * (2 * cw + gap + colon) + di * (cw + gap));
      const y = cs.y + (cs.h - totalH) / 2 + (stacked ? gi * (ch * 1.12) : 0);
      put(r, x, y);
    }));
  }
  if (L === 'clocksplit') {
    const cp = B['Clock pane'], stacked = orient === 'port'; // the phone stacks HH over MM in portrait
    const cw = stacked ? cp.w * .3 : cp.w * .2, ch = cw * cardSize.height / cardSize.width, gap = cw * .06, colon = stacked ? 0 : cw * .22;
    const totalW = stacked ? 2 * cw + gap : 4 * cw + 2 * gap + colon, totalH = stacked ? 2 * ch + ch * .1 : ch;
    [['0', '9'], ['4', '1']].forEach((g, gi) => g.forEach((d, di) => {
      const r = figma.createRectangle(); r.name = `Card ${d}`; r.resize(cw, ch); r.fills = [imgFill(cards[d], 'FIT')];
      put(r, cp.x + (cp.w - totalW) / 2 + (stacked ? di * (cw + gap) : gi * (2 * cw + gap + colon) + di * (cw + gap)), cp.y + (cp.h - totalH) / 2 + (stacked ? gi * ch * 1.1 : 0));
    }));
  }
  if (B['Status cluster']) { const s = B['Status cluster']; const b = variant(BAT, 'Style=Percent inside, State=Normal').createInstance(); b.rescale(s.h / 14); put(b, s.x, s.y); }

  // real captures
  for (const [i, k] of ['idle', 'controls', 'quick'].entries()) {
    const im = await img(`${orient}-${L}-${k}.png`);
    const r = frame(row, `Phone · ${k}`, SW, SH, imgFill(im), 14); r.x = dx + (i + 1) * (SW + 40); r.clipsContent = true;
  }
}
return { sec: sec.id, done: layouts };
