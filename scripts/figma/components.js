// Figma: 02 · Components for LyricDock v2 (run inside figma_execute). Real components with variants and text properties,
// built from the app's CSS values; icons are the app's own SVG paths.
await figma.loadAllPagesAsync();
const page = figma.root.children.find(p => p.name === 'LyricDock · Design File'); await figma.setCurrentPageAsync(page);
const board = page.children.find(c => c.name === 'LyricDock v2 — Design File');
board.children.filter(c => c.name.startsWith('01 ·')).forEach(c => c.remove());
const F = { r: { family: 'Inter', style: 'Regular' }, m: { family: 'Inter', style: 'Medium' }, s: { family: 'Inter', style: 'Semi Bold' }, b: { family: 'Inter', style: 'Bold' }, x: { family: 'Inter', style: 'Extra Bold' }, l: { family: 'Inter', style: 'Light' } };
for (const f of Object.values(F)) await figma.loadFontAsync(f);
const styles = Object.fromEntries((await figma.getLocalTextStylesAsync()).filter(s => s.name.startsWith('LyricDock/')).map(s => [s.name.slice(10), s]));
const vars = Object.fromEntries((await figma.variables.getLocalVariablesAsync()).map(v => [v.name, v]));
const hex = h => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const solid = (h, o = 1, v) => { const p = { type: 'SOLID', color: hex(h), opacity: o }; return v && vars[v] ? figma.variables.setBoundVariableForPaint(p, 'color', vars[v]) : p; };
const frame = (parent, name, w, h, fill, r = 0) => { const n = figma.createFrame(); n.name = name; n.resize(w, h); n.cornerRadius = r; n.fills = fill ? [fill] : []; n.clipsContent = false; parent?.appendChild(n); return n; };
const styled = []; // styles get linked at the end (async API); nodes whose size/font was overridden afterwards stay unlinked
const text = (parent, s, style, fill, opts = {}) => { const t = figma.createText(); const st = styles[style]; t.fontName = { family: st.fontName.family, style: st.fontName.style }; t.fontSize = st.fontSize; t.lineHeight = st.lineHeight; t.letterSpacing = st.letterSpacing; styled.push([t, st]); t.characters = s; t.fills = [fill]; if (opts.w) { t.textAutoResize = 'HEIGHT'; t.resize(opts.w, t.height); } if (opts.align) t.textAlignHorizontal = opts.align; parent?.appendChild(t); return t; };
const autoRow = (n, gap = 0, pad = 0, align = 'CENTER') => { n.layoutMode = 'HORIZONTAL'; n.itemSpacing = gap; n.paddingLeft = n.paddingRight = n.paddingTop = n.paddingBottom = pad; n.counterAxisAlignItems = align; n.primaryAxisSizingMode = 'AUTO'; n.counterAxisSizingMode = 'AUTO'; return n; };
const autoCol = (n, gap = 0, pad = 0) => { n.layoutMode = 'VERTICAL'; n.itemSpacing = gap; n.paddingLeft = n.paddingRight = n.paddingTop = n.paddingBottom = pad; n.primaryAxisSizingMode = 'AUTO'; n.counterAxisSizingMode = 'AUTO'; return n; };
const comp = (name, w, h) => { const c = figma.createComponent(); c.name = name; c.resize(w, h); c.fills = []; c.clipsContent = false; return c; };
const W = '#FFFFFF';

// section frame
const sec = frame(board, '01 · Components', 3600, 2600, solid('#0B0B0E'), 24); sec.x = 0; sec.y = 1400;
text(sec, '01 · Components', 'Sheet title', solid('#E0B56B')).x = 40;
const place = (n, x, y, label) => { sec.appendChild(n); n.x = x; n.y = y; if (label) { const t = text(sec, label, 'Row label', solid(W, .6)); t.x = x; t.y = y - 24; } return n; };

// ---- icons (the app's own paths, index.html)
const ICON = {
  shuffle: 'M17 3l4 4-4 4V8h-2.6l-3.2 4 3.2 4H17v-3l4 4-4 4v-3h-3.5l-3.7-4.6L6 18H3v-2h2l3.6-4.6L5 7H3V5h3l3.8 4.6L13.5 5H17z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z', next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z', play: 'M8 5v14l11-7z', pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  queue: 'M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm15-2v-4l5 5-5 5v-4z',
  recent: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z',
  search: 'M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  library: 'M4 3h2v18H4zm5 0h2v18H9zm4.9 1.3 1.9-.6 5 16.9-1.9.6z',
  friends: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v2h14v-2c0-2.3-3.7-4-7-4zm7.5-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm1 2.1c1.6.6 3.5 1.7 3.5 3.9v2h2v-2c0-2.3-3-3.6-5.5-3.9z',
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z',
  gear: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
};
const STROKE = { swap: 'M6 8h12m0 0-3.5-3.5M18 8l-3.5 3.5M18 16H6m0 0 3.5-3.5M6 16l3.5 3.5', layout: 'M4 5.5h16v13H4zM10 5.5v13',
  tune: 'M4 7h8M18 7h2M4 17h2M12 17h8M17.4 7a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0zM11.4 17a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0z',
  theme: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 3.5v17', close: 'M6 6l12 12M18 6 6 18' };
const icons = {};
let ix = 40;
for (const [k, d] of [...Object.entries(ICON).map(([k, d]) => [k, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}" fill="#FFFFFF"/></svg>`]),
  ...Object.entries(STROKE).map(([k, d]) => [k, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`])]) {
  const c = comp('Icon/' + k, 24, 24); const v = figma.createNodeFromSvg(d); v.name = k; c.appendChild(v); v.x = 0; v.y = 0;
  const vec = v; vec.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
  place(c, ix, 90); ix += 44; icons[k] = c;
}
const lbl = text(sec, 'Icons (index.html paths)', 'Row label', solid(W, .6)); lbl.x = 40; lbl.y = 66;
const icon = (k, size, fillHex) => { const i = icons[k].createInstance(); i.resize(size, size); if (fillHex) i.findAll(n => n.type === 'VECTOR').forEach(v => { if (v.fills?.length) v.fills = [solid(fillHex)]; if (v.strokes?.length) v.strokes = [solid(fillHex)]; }); return i; };

// ---- Lyric line: variants State × Voice
const lineSet = [];
const mkLine = (state, voice) => {
  const c = comp(`State=${state}, Voice=${voice}`, 380, 40); autoCol(c, 2); c.counterAxisAlignItems = voice === 'Duet' ? 'MAX' : 'MIN';
  if (state === 'Interlude') { const g = autoRow(frame(c, 'Dots', 10, 10, null), 7); for (let i = 0; i < 3; i++) { const d = frame(g, 'Dot', 13.6, 13.6, solid(W, [1, .7, .35][i]), 7); } return c; }
  const t = text(c, voice === 'Background' ? '(far away)' : 'And let the morning come', voice === 'Background' ? 'Background vocal' : 'Lyric line', solid(W, 1));
  t.name = 'Line';
  if (state === 'Upcoming') t.fills = [solid(W, .5, 'lyric/other-lines')];
  else if (state === 'Sung') t.fills = [solid(W, .45)];
  else { // Active: the sweep - sung part 92 %, the rest 60 %, with a soft edge
    t.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: .92 } }, { position: .42, color: { r: 1, g: 1, b: 1, a: .92 } }, { position: .58, color: { r: 1, g: 1, b: 1, a: .6 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: .6 } }] }];
    t.effects = [{ type: 'DROP_SHADOW', color: { r: 1, g: 1, b: 1, a: .28 }, offset: { x: 0, y: 0 }, radius: 7, spread: 0, visible: true, blendMode: 'NORMAL' }];
  }
  if (voice === 'Duet') t.textAlignHorizontal = 'RIGHT';
  c.addComponentProperty('Line', 'TEXT', t.characters); t.componentPropertyReferences = { characters: Object.keys(c.componentPropertyDefinitions)[0] };
  return c;
};
for (const s of ['Upcoming', 'Active', 'Sung', 'Interlude']) for (const v of ['Lead', 'Duet', 'Background']) { if (s === 'Interlude' && v !== 'Lead') continue; lineSet.push(mkLine(s, v)); }
lineSet.forEach(c => sec.appendChild(c));
const LS = figma.combineAsVariants(lineSet, sec); LS.name = 'Lyric line'; autoCol(LS, 16, 24); LS.fills = [solid('#101018')]; LS.cornerRadius = 16; place(LS, 40, 200, 'Lyric line — State × Voice (text property: Line)');

// ---- Timeline: State × Lossless
const tl = [];
for (const st of ['Idle', 'Touched']) for (const q of ['Off', 'On']) {
  const c = comp(`State=${st}, Lossless=${q}`, 232, 14); autoRow(c, 6); c.primaryAxisSizingMode = 'FIXED'; c.resize(232, 14);
  const a = text(c, '0:56', 'Time', solid(st === 'Touched' ? '#DCBE6E' : W, st === 'Touched' ? 1 : .72)); a.name = 'Elapsed';
  const trk = frame(c, 'Track', 170, st === 'Touched' ? 6.8 : 3.6, solid(W, .18), 99); trk.layoutGrow = 1; trk.clipsContent = true;
  const fill = frame(trk, 'Fill', 48, st === 'Touched' ? 6.8 : 3.6, solid(W, 1), 99);
  const b = text(c, '3:20', 'Time', solid(W, .58)); b.name = 'Duration';
  if (q === 'On') { const wv = autoRow(frame(c, 'Lossless', 10, 8, null), 1.2); [.45, 1, .7, .35].forEach(h => frame(wv, 'Bar', 1.2, 7.2 * h, solid('#DCBE6E', 1, 'accent/cover'), 1)); wv.effects = [{ type: 'DROP_SHADOW', color: { ...hex('#DCBE6E'), a: .55 }, offset: { x: 0, y: 0 }, radius: 2.5, spread: 0, visible: true, blendMode: 'NORMAL' }]; }
  tl.push(c);
}
tl.forEach(c => sec.appendChild(c));
const TL = figma.combineAsVariants(tl, sec); TL.name = 'Timeline'; autoCol(TL, 20, 20); TL.fills = [solid('#101018')]; TL.cornerRadius = 16; place(TL, 520, 200, 'Timeline — under the cover (Lossless: waveform beside the length)');

// ---- Battery: Style × State
const bat = [];
for (const style of ['Percent inside', 'Percent beside', 'Ring', 'Thin bar', 'Percent only']) for (const st of ['Normal', 'Charging', 'Low']) {
  const colr = st === 'Charging' ? '#7EE2A8' : st === 'Low' ? '#FF6B6B' : '#FFFFFF', lvl = st === 'Low' ? .12 : .87, pct = st === 'Low' ? '12%' : '87%';
  const c = comp(`Style=${style}, State=${st}`, 40, 14); autoRow(c, 3.6); c.opacity = .85;
  if (style === 'Percent inside') { const i = frame(c, 'Icon', 28, 12.6, null, 3.2); i.strokes = [solid(colr)]; i.strokeWeight = .9; frame(i, 'Level', (28 - 3.2) * lvl, 9.4, solid(colr, .34), 1).x = 1.6; i.children[0].y = 1.6; const t = text(i, pct, 'Status', solid(W)); t.x = 14 - t.width / 2; t.y = 6.3 - t.height / 2; frame(c, 'Nub', 1.6, 3.6, solid(colr, .6), 1); }
  if (style === 'Percent beside') { text(c, pct, 'Status', solid(colr)); const i = frame(c, 'Icon', 16.6, 8.3, null, 2.2); i.strokes = [solid(colr)]; i.strokeWeight = .9; const l = frame(i, 'Level', 13.4 * lvl, 5.1, solid(colr), 1); l.x = 1.6; l.y = 1.6; frame(c, 'Nub', 1.6, 3.6, solid(colr, .6), 1); }
  if (style === 'Ring') { const e = figma.createEllipse(); e.resize(17.6, 17.6); e.fills = []; e.strokes = [solid(colr)]; e.strokeWeight = 2; e.arcData = { startingAngle: -Math.PI / 2, endingAngle: -Math.PI / 2 + Math.PI * 2 * lvl, innerRadius: .88 }; e.fills = [solid(colr)]; e.strokes = []; c.appendChild(e); const t = text(c, pct.replace('%', ''), 'Status', solid(W)); t.layoutPositioning = 'ABSOLUTE'; t.x = 8.8 - t.width / 2; t.y = 8.8 - t.height / 2; }
  if (style === 'Thin bar') { const tr = frame(c, 'Track', 36, 2.9, solid(W, .2), 2); frame(tr, 'Level', 36 * lvl, 2.9, solid(colr), 2); }
  if (style === 'Percent only') text(c, (st === 'Charging' ? '⚡ ' : '') + pct, 'Status', solid(colr));
  bat.push(c);
}
bat.forEach(c => sec.appendChild(c));
const BS = figma.combineAsVariants(bat, sec); BS.name = 'Battery'; BS.layoutMode = 'HORIZONTAL'; BS.layoutWrap = 'WRAP'; BS.resize(420, 10); BS.itemSpacing = 26; BS.counterAxisSpacing = 22; BS.paddingLeft = BS.paddingRight = BS.paddingTop = BS.paddingBottom = 22; BS.primaryAxisSizingMode = 'FIXED'; BS.counterAxisSizingMode = 'AUTO'; BS.fills = [solid('#101018')]; BS.cornerRadius = 16;
place(BS, 900, 200, 'Battery — Style × State (green charging, red below 20 %)');

// ---- Time of day
const tm = [];
for (const st of ['Small', 'Pill', 'Big']) { const c = comp(`Style=${st}`, 60, 20); autoRow(c, 0, st === 'Pill' ? 0 : 0);
  if (st === 'Pill') { c.paddingLeft = c.paddingRight = 7.2; c.paddingTop = c.paddingBottom = 2.5; c.cornerRadius = 99; c.fills = [solid('#101014', .5, 'surface/glass')]; c.strokes = [solid(W, .14, 'line/glass-edge')]; c.strokeWeight = 1; }
  const t = text(c, st === 'Big' ? '9:41' : '9:41 PM', st === 'Big' ? 'Clock big' : 'Status', solid(W, st === 'Small' ? .75 : .9)); if (st !== 'Big') t.fontSize = 8.3; tm.push(c); }
tm.forEach(c => sec.appendChild(c));
const TM = figma.combineAsVariants(tm, sec); TM.name = 'Time of day'; autoRow(TM, 26, 22); TM.fills = [solid('#101018')]; TM.cornerRadius = 16; place(TM, 1360, 200, 'Time of day — Style');

// ---- Buttons + quick bar
const btn = (name, ik, size, white) => { const c = comp(name, size, size); c.cornerRadius = size / 2; c.fills = white ? [solid(W)] : []; const i = icon(ik, size * .6, white ? '#0C0C0F' : W); c.appendChild(i); i.x = size * .2; i.y = size * .2; return c; };
const QBTN = {}; for (const k of ['swap', 'layout', 'theme']) { QBTN[k] = btn('Quick button/' + k, k, 26); place(QBTN[k], 1360 + Object.keys(QBTN).length * 34, 300); }
const qTune = btn('Quick button/tune', 'tune', 26, true); place(qTune, 1360 + 4 * 34, 300);
const qText = (s) => { const c = comp('Quick button/' + s, 26, 26); c.cornerRadius = 13; const t = text(c, s, 'Row label', solid(W)); t.fontSize = 8.6; t.x = 13 - t.width / 2; t.y = 13 - t.height / 2; return c; };
const QT = { Aa: qText('Aa'), ss: qText('ss'), '12': qText('12') }; Object.values(QT).forEach((c, i) => place(c, 1360 + (5 + i) * 34, 300));
const qb = [];
for (const [variant, keys] of [['Default · TV', ['swap', 'Aa', 'layout']], ['Lyric layouts', ['Aa', 'layout']], ['Cover + clock', ['swap', 'theme', 'ss', 'layout']], ['Flip clock', ['theme', 'ss', '12', 'layout']]]) {
  const c = comp(`Layout=${variant}`, 100, 32); autoRow(c, 1, 4); c.paddingLeft = c.paddingRight = 4; c.cornerRadius = 18; c.fills = [solid('#16161C', .82)]; c.strokes = [solid(W, .14)]; c.strokeWeight = 1;
  for (const k of keys) c.appendChild((QBTN[k] || QT[k]).createInstance()); c.appendChild(qTune.createInstance()); qb.push(c); }
qb.forEach(c => sec.appendChild(c));
const QB = figma.combineAsVariants(qb, sec); QB.name = 'Quick bar'; autoCol(QB, 14, 20); QB.fills = [solid('#101018')]; QB.cornerRadius = 16; place(QB, 1360, 380, 'Quick bar — per layout');
const gear = comp('Settings button', 32, 32); gear.cornerRadius = 16; gear.fills = [solid('#16161C', .82)]; gear.strokes = [solid(W, .14)]; gear.strokeWeight = 1; const gi = icon('gear', 18); gear.appendChild(gi); gi.x = gi.y = 7; place(gear, 1600, 380, 'Settings button');

// ---- Control pill
const pill = comp('Control pill', 256, 106); pill.cornerRadius = 25; pill.fills = [solid('#101014', .5, 'surface/glass')]; pill.strokes = [solid(W, .14)]; pill.strokeWeight = 1;
autoCol(pill, 4, 6); pill.counterAxisAlignItems = 'CENTER'; pill.paddingLeft = pill.paddingRight = 6;
const row1 = autoRow(frame(pill, 'Transport', 10, 10, null), 10); for (const [k, s] of [['shuffle', 20], ['prev', 22], ['pause', 26], ['next', 22], ['repeat', 20]]) { if (k === 'pause') { const p = frame(row1, 'Play / pause', 42, 42, solid(W), 21); const i = icon('pause', 25, '#0C0C0F'); p.appendChild(i); i.x = i.y = 8.5; } else { const i = icon(k, s, W); row1.appendChild(i); if (k === 'shuffle' || k === 'repeat') i.opacity = .6; } }
const vol = frame(pill, 'Volume', 236, 4, solid(W, .2), 2); frame(vol, 'Level', 140, 4, solid('#DCBE6E', 1, 'accent/cover'), 2);
const row3 = autoRow(frame(pill, 'Lists', 10, 10, null), 26); for (const k of ['queue', 'recent', 'search', 'library', 'friends']) { const i = icon(k, 15, W); i.opacity = .7; row3.appendChild(i); }
place(pill, 1720, 380, 'Control pill');

// ---- Now playing, tag, like, Now Bar pill, Cinema badge
const np = comp('Now playing', 232, 60); autoCol(np, 2); np.counterAxisAlignItems = 'CENTER';
for (const [s, st, o] of [['Midnight Signal', 'Title', 1], ['Aria Vale, Kai Ren', 'Artist', .72], ['Harbour Lights', 'Album line', .5]]) { const t = text(np, s, st, solid(W, o)); t.name = st; np.addComponentProperty(st, 'TEXT', s); t.componentPropertyReferences = { characters: Object.keys(np.componentPropertyDefinitions).find(k => k.startsWith(st)) }; }
place(np, 2040, 380, 'Now playing — song info only');
const tag = comp('Tag / lyrics source', 100, 10); autoRow(tag, 3); const t1 = text(tag, 'Lyrics ·', 'Tag', solid(W, .42)); t1.letterSpacing = { unit: 'PERCENT', value: 2 }; text(tag, 'APPLE MUSIC', 'Tag', solid(W, .6)); place(tag, 2040, 480, 'Tag — bottom-right corner');
const like = []; for (const on of ['Off', 'On']) { const c = comp(`Liked=${on}`, 25, 25); c.cornerRadius = 13; c.fills = [solid('#0A0A0C', .55)]; const i = icon('heart', 14, on === 'On' ? '#1ED760' : W); c.appendChild(i); i.x = 5.5; i.y = 5.5; like.push(c); }
like.forEach(c => sec.appendChild(c)); const LK = figma.combineAsVariants(like, sec); LK.name = 'Like badge'; autoRow(LK, 16, 14); LK.fills = [solid('#101018')]; LK.cornerRadius = 12; place(LK, 2040, 540, 'Like badge (not on the spinning Now Bar cover)');
const nb = comp('Now Bar pill', 250, 46); autoRow(nb, 8, 4); nb.paddingRight = 16; nb.cornerRadius = 23; nb.fills = [solid('#0C0C10', .62)]; nb.strokes = [solid(W, .14)]; nb.strokeWeight = 1;
const nbc = frame(nb, 'Cover', 30, 30, solid('#4C7A54'), 15); const nbt = autoCol(frame(nb, 'Text', 10, 10, null), 1); text(nbt, 'Midnight Signal', 'Title', solid(W)).fontSize = 10.8; text(nbt, 'Aria Vale, Kai Ren', 'Artist', solid(W, .72)).fontSize = 8.3;
place(nb, 2040, 640, 'Now Bar pill (cover spins while playing)');

// ---- Settings rows (the sheet's building blocks)
const rows = [];
for (const [type, val] of [['Toggle on', true], ['Toggle off', false], ['Choice', 'Under the cover'], ['Slider', .5]]) {
  const c = comp(`Type=${type}`, 340, 40); c.layoutMode = 'HORIZONTAL'; c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'AUTO'; c.resize(340, 40); c.paddingLeft = c.paddingRight = 12; c.paddingTop = c.paddingBottom = 9; c.primaryAxisAlignItems = 'SPACE_BETWEEN'; c.counterAxisAlignItems = 'CENTER';
  const lab = text(c, type === 'Slider' ? 'Other lines brightness' : type === 'Choice' ? 'Progress bar' : 'Quick bar', 'Row label', solid(W, .94)); c.addComponentProperty('Label', 'TEXT', lab.characters); lab.componentPropertyReferences = { characters: Object.keys(c.componentPropertyDefinitions)[0] };
  if (type.startsWith('Toggle')) { const tr = frame(c, 'Toggle', 44, 26, val ? solid('#DCBE6E', .85, 'accent/cover') : solid('#000000', .45), 13); const k = frame(tr, 'Knob', 20, 20, solid(W, val ? 1 : .8), 10); k.x = val ? 21 : 3; k.y = 3; }
  if (type === 'Choice') { const s = autoRow(frame(c, 'Select', 10, 10, solid(W, .06), 9), 8, 7); s.paddingLeft = 11; s.strokes = [solid(W, .08)]; s.strokeWeight = 1; text(s, val, 'Row detail', solid(W, .94)).fontName = F.s; text(s, '⌄', 'Row detail', solid(W, .6)); }
  if (type === 'Slider') { const s = frame(c, 'Slider', 150, 18, null); frame(s, 'Track', 150, 5, solid(W, .14), 3).y = 6.5; const f2 = frame(s, 'Fill', 75, 5, solid('#DCBE6E', 1, 'accent/cover'), 3); f2.y = 6.5; const k = frame(s, 'Thumb', 18, 18, solid(W), 9); k.x = 66; }
  rows.push(c);
}
rows.forEach(c => sec.appendChild(c)); const RW = figma.combineAsVariants(rows, sec); RW.name = 'Settings row'; autoCol(RW, 0, 0); RW.fills = [solid('#16161B')]; RW.cornerRadius = 12; place(RW, 2380, 380, 'Settings row — Type (label is a text property)');

for (const [t, st] of styled) if (!t.removed && t.fontSize === st.fontSize && t.fontName.style === st.fontName.style && JSON.stringify(t.letterSpacing) === JSON.stringify(st.letterSpacing)) await Promise.race([t.setTextStyleIdAsync(st.id), new Promise(r => setTimeout(r, 300))]);
figma.root.setPluginData('ld2', JSON.stringify({ sec: sec.id, line: LS.id, timeline: TL.id, battery: BS.id, time: TM.id, quick: QB.id, gear: gear.id, pill: pill.id, np: np.id, tag: tag.id, like: LK.id, nowbar: nb.id, rows: RW.id, icons: Object.fromEntries(Object.entries(icons).map(([k, v]) => [k, v.id])) }));
return { ok: true, sec: sec.id };
