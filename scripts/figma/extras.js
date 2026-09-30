// Figma: 05 anatomy · 06 flip clock · 07 settings · 08 blanks for LyricDock v2 (right-hand column of the board).
// ARGS = { only: ['05','06','07','08'] }
const BASE = 'http://localhost:9229/build/';
await figma.loadAllPagesAsync();
const page = figma.root.children.find(p => p.name === 'LyricDock · Design File'); await figma.setCurrentPageAsync(page);
const board = page.children.find(c => c.name === 'LyricDock v2 — Design File');
const ids = JSON.parse(figma.root.getPluginData('ld2'));
const N = id => figma.getNodeByIdAsync(id);
for (const s of ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold']) await figma.loadFontAsync({ family: 'Inter', style: s });
const hex = h => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const solid = (h, o = 1) => ({ type: 'SOLID', color: hex(h), opacity: o });
const W = '#FFFFFF', ACC = '#DCBE6E', GOLD = '#E0B56B';
const frame = (parent, name, w, h, fill, r = 0) => { const n = figma.createFrame(); n.name = name; n.resize(w, h); n.cornerRadius = r; n.fills = fill ? [fill] : []; n.clipsContent = false; parent?.appendChild(n); return n; };
const txt = (parent, s, size, style = 'Regular', fill = solid(W), w) => { const t = figma.createText(); t.fontName = { family: 'Inter', style }; t.fontSize = size; t.characters = s; t.fills = [fill]; if (w) { t.textAutoResize = 'HEIGHT'; t.resize(w, t.height); } parent?.appendChild(t); return t; };
const at = (n, x, y) => { n.x = x; n.y = y; return n; };
const img = async f => figma.createImage(new Uint8Array(await (await fetch(BASE + f)).arrayBuffer()));
const imgFill = (im, mode = 'FILL') => ({ type: 'IMAGE', imageHash: im.hash, scaleMode: mode });
const variant = (set, name) => set.children.find(c => c.name === name) ?? set.defaultVariant;
const prop = (inst, start) => Object.keys(inst.componentProperties).find(k => k.startsWith(start));
const CW = 1700, ROW = 9250; // row 3 of the board: sections 04-08 left to right, after the screens
const section = (name, X, y, h, sub) => {
  board.children.filter(c => c.name === name).forEach(c => c.remove());
  const s = frame(board, name, CW, h, solid('#0B0B0E'), 24); s.x = X; s.y = y;
  at(txt(s, name, 40, 'Extra Bold', solid(GOLD)), 40, 24); if (sub) at(txt(s, sub, 16, 'Regular', solid(W, .6), CW - 80), 40, 80);
  return s;
};
const note = (s, x, y, head, body, w = 420) => { const h = at(txt(s, head, 14, 'Bold', solid(ACC)), x, y); const b = at(txt(s, body, 13, 'Regular', solid(W, .7), w), x, y + 20); return b.y + b.height; };
const only = new Set(ARGS.only);
const LS = await N(ids.line), RW = await N(ids.rows), cover = await img('figma/cover.png');

if (only.has('05')) {
  const s = section('04 · Lyrics anatomy', 0, ROW, 780, 'How one line is drawn (anim.js · lyrics.js · style.css). Every state is a variant of the Lyric line component.');
  const stage = frame(s, 'Stage', 900, 620, solid('#000000'), 18); at(stage, 40, 130); stage.clipsContent = true;
  const bg = figma.createRectangle(); stage.appendChild(bg); bg.resize(1300, 900); at(bg, -200, -140); bg.fills = [imgFill(cover)]; bg.effects = [{ type: 'LAYER_BLUR', radius: 110, visible: true }];
  const dim = figma.createRectangle(); stage.appendChild(dim); dim.resize(900, 620); dim.fills = [solid('#000000', .45)];
  const rows = [['Sung', 'Lead', 'Dil mera tera zindagi', 44], ['Active', 'Duet', 'sohnee teri yaad', 52], ['Active', 'Background', '(teri yaad)', 30], ['Interlude', 'Lead', '', 44], ['Upcoming', 'Lead', 'Ooh oh', 44], ['Upcoming', 'Background', '(ah ah)', 27], ['Upcoming', 'Lead', 'Hold me through the static', 44]];
  let y = 40; const marks = [];
  for (const [st, v, t, fs] of rows) {
    const inst = variant(LS, `State=${st}, Voice=${v}`).createInstance(); stage.appendChild(inst);
    if (st !== 'Interlude') { inst.setProperties({ [prop(inst, 'Line')]: t }); const tn = inst.findOne(n => n.type === 'TEXT'); tn.fontSize = fs; tn.textAutoResize = 'HEIGHT'; inst.resize(780, inst.height); tn.layoutSizingHorizontal = 'FILL'; if (v === 'Duet') tn.textAlignHorizontal = 'RIGHT'; if (v === 'Background' && st === 'Active') tn.textAlignHorizontal = 'RIGHT'; }
    else inst.rescale(1.4);
    at(inst, 60, y); marks.push([st, v, y + inst.height / 2]); y += inst.height + (v === 'Background' ? 18 : 10);
  }
  // callouts
  const cx = 980; let cy = 140;
  const C = [
    ['Sung · 45 %', 'Lines already sung settle to a quiet 45 % white. No blur: crisp translucent text, like Spotify.'],
    ['Active · the sweep', 'One gradient paint path: sung part 92 %, unsung 60 %, soft edge (--gp moves per syllable, --a1/--a0 set the two levels). The line lifts with a quantised spring (translate3d + scale, compositor only).'],
    ['Active · glow', 'A copy of the syllable in ::after carries a fixed text-shadow; only its opacity (--go) animates, so the glow costs nothing per frame. It rises with the line, never flashes white first.'],
    ['Duet · right side', 'Second singer (opp) is right-aligned with a 12 % inset from the lead side.'],
    ['Background vocal', '62 % size under its line, same sweep, lower levels.'],
    ['Interlude dots', 'Three dots fill in turn across the gap, then breathe out as the next line starts.'],
    ['Upcoming · 50 %', '"Other lines brightness" (default 50 %). Blur distant lines is off by default: it cost frames on mid-range phones.'],
    ['Long held syllables', 'Letter mode: each letter lifts and scales up to 1.175 with a proximity falloff 1/(1+d^2.8), sine-out sweep.'],
    ['Scroll', 'The pane scrolls on a spring (Smooth / Spring / Snappy). A drag claims the gesture, so scrolling never seeks, skips or opens the controls.'],
  ];
  for (const [h, b] of C) cy = note(s, cx, cy, h, b, 660) + 18;
}

if (only.has('06')) {
  const s = section('05 · Flip clock', 1780, ROW, 1330, 'The clock layouts use the same digit art as the app (fc-card-*.png is baked from the Digits frames on this page). Copies of the two art boards, the flip in motion on the phone, and the behaviour.');
  let y = 130;
  for (const id of ['157:1022', '157:1205']) {
    const src = await N(id); if (!src) continue;
    const c = src.clone(); s.appendChild(c); c.name = src.name + ' (copy of ' + id + ')'; c.rescale((CW - 80) / c.width); at(c, 40, y); y += c.height + 30;
  }
  at(txt(s, 'Light cards · one flip on the phone (after the shading fix: no dark card mid-flip)', 14, 'Bold', solid(ACC)), 40, y); y += 28;
  const fr = [0, 3, 6, 9, 12, 15, 18, 21]; const fw = (CW - 80 - 7 * 12) / 8, fh = fw * 720 / 1520;
  for (const [i, k] of fr.entries()) {
    const name = ['00-0ms', '01-38ms', '02-76ms', '03-114ms', '04-152ms', '05-191ms', '06-229ms', '07-267ms', '08-305ms', '09-343ms', '10-381ms', '11-419ms', '12-457ms', '13-495ms', '14-534ms', '15-572ms', '16-610ms', '17-648ms', '18-686ms', '19-724ms', '20-762ms', '21-800ms'][k];
    const im = await img(`flip-light-after/${name}.png`);
    const r = frame(s, 'Frame ' + name, fw, fh, imgFill(im), 8); at(r, 40 + i * (fw + 12), y);
    at(txt(s, name.split('-')[1], 11, 'Medium', solid(W, .5)), r.x, y + fh + 6);
  }
  y += fh + 40;
  const cols = [
    ['Flip', 'Top flap falls under gravity, bottom flap lands with a small bounce. Shading follows the card colour: dark cards shade to black, light cards to a warm grey (#4b4238), so a light card never looks black mid-flip.'],
    ['Entry and exit', 'Airport-board cascade: digits run through the numbers to the time; leaving runs them out. Tap = seconds, double tap = back, long press = card colour.'],
    ['Sound', 'Every clack goes through one limiter (threshold -14 dB, ratio 12) and a master level. Clacks closer than 9 ms are dropped and each gets quieter the busier its 60 ms window is, so a cascade rattles instead of clipping.'],
    ['Haptics', 'One buzz per burst of landings (140 ms merge), light 30 ms or firm 50 ms.'],
  ];
  cols.forEach(([h, b], i) => note(s, 40 + i * 410, y, h, b, 380));
}

if (only.has('07')) {
  const s = section('06 · Settings', 3560, ROW, 1000, 'The real sheets from the phone next to the sheet built from the Settings row component (label is a text property).');
  const land = await img('figma/land-settings.png'), port = await img('figma/port-settings.png');
  at(txt(s, 'Phone · landscape', 14, 'Semi Bold', solid(W, .5)), 40, 120); at(frame(s, 'Phone · settings (landscape)', 760, 360, imgFill(land), 14), 40, 144);
  at(txt(s, 'Phone · portrait', 14, 'Semi Bold', solid(W, .5)), 40, 530); at(frame(s, 'Phone · settings (portrait)', 200, 422, imgFill(port), 14), 40, 554);
  at(txt(s, 'Design · sheet', 14, 'Semi Bold', solid(W, .5)), 860, 120);
  const sheet = frame(s, 'Settings sheet', 380, 10, solid('#101014', .96), 18); at(sheet, 860, 144);
  sheet.layoutMode = 'VERTICAL'; sheet.primaryAxisSizingMode = 'AUTO'; sheet.counterAxisSizingMode = 'FIXED'; sheet.paddingLeft = sheet.paddingRight = 20; sheet.paddingTop = sheet.paddingBottom = 18; sheet.itemSpacing = 6;
  sheet.strokes = [solid(W, .1)]; sheet.strokeWeight = 1;
  txt(sheet, 'Settings', 22, 'Extra Bold');
  const G = [
    ['Layout', [['Choice', 'Layout', 'Default'], ['Choice', 'Progress bar', 'Under the cover'], ['Toggle on', 'Quick bar'], ['Toggle off', 'Show block names']]],
    ['Lyrics', [['Slider', 'Text size'], ['Slider', 'Other lines brightness'], ['Toggle off', 'Blur distant lines'], ['Choice', 'Lyrics scroll', 'Smooth']]],
    ['Now playing', [['Choice', 'Lossless indicator', 'Waveform'], ['Choice', 'Lyrics source', 'Bottom-right']]],
    ['Status', [['Choice', 'Battery style', 'Percent inside'], ['Choice', 'Time of day', 'Small']]],
    ['Performance', [['Toggle off', 'Glass blur'], ['Choice', 'Background frame rate', '30 fps']]],
  ];
  for (const [g, rows] of G) {
    const h = txt(sheet, g.toUpperCase(), 11, 'Bold', solid(ACC)); h.letterSpacing = { unit: 'PERCENT', value: 8 };
    const grp = frame(sheet, g, 340, 10, solid('#16161B'), 12); grp.layoutMode = 'VERTICAL'; grp.primaryAxisSizingMode = 'AUTO'; grp.layoutAlign = 'STRETCH';
    for (const [type, label, val] of rows) {
      const r = variant(RW, `Type=${type}`).createInstance(); grp.appendChild(r); r.layoutAlign = 'STRETCH';
      r.setProperties({ [prop(r, 'Label')]: label });
      if (val) { const v = r.findOne(n => n.type === 'TEXT' && n.characters === 'Under the cover'); if (v) v.characters = val; }
    }
  }
  note(s, 1290, 144, 'Groups', 'Layout · Lyrics · Now playing · Status · Performance. Every row has an ⓘ explainer on the phone. Presets (Smooth / Balanced / Rich) set several rows at once; "Smooth" turns glass blur off.', 360);
  note(s, 1290, 300, 'Quick settings', 'The ⚙ in the quick bar opens a per-layout sheet built from the same rows (Settings.rows(keys)): lyric layouts get text and scroll rows, clock layouts get card colour, seconds, format, flip animation, sound and vibration.', 360);
}

if (only.has('08')) {
  const s = section('08 · Blank templates', 7120, ROW, 1000, 'Start new screens here. Safe area = the notch inset on the camera side (29.5 px on the M01) plus the edge gutter; both sides are kept clear whichever way the phone is turned.');
  const blank = async (name, w, h, x, y, inset) => {
    const f = frame(s, name, w, h, solid('#000000'), 14); at(f, x, y); f.clipsContent = true;
    const bg = figma.createRectangle(); f.appendChild(bg); bg.resize(w * 1.4, h * 1.4); at(bg, -w * .2, -h * .2); bg.fills = [imgFill(cover)]; bg.effects = [{ type: 'LAYER_BLUR', radius: 100, visible: true }]; bg.opacity = .5; bg.name = 'Background · cover, blurred';
    const safe = frame(f, 'Safe area', w - inset.l - inset.r, h - inset.t - inset.b, null, 6); at(safe, inset.l, inset.t); safe.strokes = [solid(ACC, .6)]; safe.dashPattern = [5, 4]; safe.strokeWeight = 1;
    at(txt(f, 'safe area', 10, 'Semi Bold', solid(ACC, .8)), inset.l + 6, inset.t + 4);
    at(txt(s, name, 13, 'Semi Bold', solid(W, .5)), x, y - 22);
    return f;
  };
  await blank('Landscape · 760 × 360', 760, 360, 40, 150, { l: 30, r: 16, t: 12, b: 12 });
  await blank('Landscape · notch right', 760, 360, 40, 560, { l: 16, r: 30, t: 12, b: 12 });
  await blank('Portrait · 360 × 760', 360, 760, 860, 150, { l: 12, r: 12, t: 30, b: 16 });
  const g = await blank('Portrait · 2 × 1 grid', 360, 760, 1260, 150, { l: 12, r: 12, t: 30, b: 16 });
  g.layoutGrids = [{ pattern: 'ROWS', alignment: 'STRETCH', gutterSize: 12, count: 2, offset: 30, visible: true, color: { r: .86, g: .75, b: .43, a: .08 } }];
}
if (only.has('09')) {
  const s = section('07 · Interactions', 5340, ROW, 1330, 'Changing songs and layouts (1.7.x). Only the cover (or the song card) swipes: a tab slides in from the edge the song comes from, shows its name and +2 / +3 when reaching further, and turns white when letting go commits. The layout button opens a sketch of every layout.');
  // the real thing, on the phone (demo song, invented neighbours)
  const shots = [['land-swipe-next', 'Swipe: one song ahead'], ['land-swipe-two', 'Drag further: +2'], ['land-swipe-prev', 'Previous'], ['land-picker', 'Layout picker']];
  shots.forEach(([f, cap], i) => { const x = 40 + i * 410; at(txt(s, cap, 13, 'Semi Bold', solid(W, .55)), x, 130); });
  for (const [i, [f]] of shots.entries()) { const im = await img(`figma/${f}.png`); at(frame(s, 'Phone · ' + f, 396, 188, imgFill(im), 12), 40 + i * 410, 152); }
  const ps = ['port-swipe-next', 'port-swipe-two', 'port-swipe-prev', 'port-picker'];
  for (const [i, f] of ps.entries()) { const im = await img(`figma/${f}.png`); at(frame(s, 'Phone · ' + f, 180, 380, imgFill(im), 12), 40 + i * 200, 380); }
  // components: the edge tab and a layout card
  const cx0 = 900; let cy0 = 380;
  at(txt(s, 'Edge tab — Side × State (Count: +2 / +3 when reaching further)', 13, 'Semi Bold', solid(W, .55)), cx0, cy0 - 22);
  const tabs = [];
  for (const side of ['Right', 'Left']) for (const st of ['Pulling', 'Armed']) {
    const c = figma.createComponent(); c.name = `Side=${side}, State=${st}`; c.layoutMode = 'HORIZONTAL'; c.primaryAxisSizingMode = 'AUTO'; c.counterAxisSizingMode = 'AUTO';
    c.counterAxisAlignItems = 'CENTER'; c.itemSpacing = 10; c.paddingLeft = c.paddingRight = 20; c.paddingTop = c.paddingBottom = 16; c.cornerRadius = 40;
    const armed = st === 'Armed', fg = armed ? '#0C0C0F' : W;
    c.fills = [armed ? solid(W) : solid('#121218', .82)]; c.strokes = [solid(W, .2)]; c.strokeWeight = 1;
    c.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: .5 }, offset: { x: 0, y: 8 }, radius: 24, spread: 0, visible: true, blendMode: 'NORMAL' }];
    if (armed) c.effects = [...c.effects, { type: 'DROP_SHADOW', color: { r: 1, g: 1, b: 1, a: .16 }, offset: { x: 0, y: 0 }, radius: 0, spread: 7, visible: true, blendMode: 'NORMAL' }];
    const chev = figma.createNodeFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26"><path d="${side === 'Right' ? 'M9.5 5.5 16 12l-6.5 6.5' : 'M14.5 5.5 8 12l6.5 6.5'}" fill="none" stroke="${fg}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    chev.name = 'Chevron';
    const word = txt(null, side === 'Right' ? 'Next' : 'Previous', 17, 'Extra Bold', solid(fg)); word.name = 'Word';
    const n = figma.createFrame(); n.name = 'Count'; n.layoutMode = 'HORIZONTAL'; n.primaryAxisSizingMode = 'AUTO'; n.counterAxisSizingMode = 'AUTO'; n.paddingLeft = n.paddingRight = 8; n.paddingTop = n.paddingBottom = 2; n.cornerRadius = 99; n.fills = [solid(ACC)];
    const nt = txt(n, '+2', 13, 'Extra Bold', solid('#0C0C0F')); nt.name = 'Count text'; n.visible = armed;
    if (side === 'Right') { c.appendChild(chev); c.appendChild(word); c.appendChild(n); } else { c.appendChild(n); c.appendChild(word); c.appendChild(chev); }
    c.addComponentProperty('Word', 'TEXT', word.characters); word.componentPropertyReferences = { characters: Object.keys(c.componentPropertyDefinitions).find(k => k.startsWith('Word')) };
    c.addComponentProperty('Show count', 'BOOLEAN', armed); n.componentPropertyReferences = { visible: Object.keys(c.componentPropertyDefinitions).find(k => k.startsWith('Show count')) };
    s.appendChild(c); tabs.push(c);
  }
  const ET = figma.combineAsVariants(tabs, s); ET.name = 'Edge tab'; ET.layoutMode = 'HORIZONTAL'; ET.layoutWrap = 'WRAP'; ET.primaryAxisSizingMode = 'FIXED'; ET.resize(520, 10); ET.counterAxisSizingMode = 'AUTO';
  ET.itemSpacing = 24; ET.counterAxisSpacing = 20; ET.paddingLeft = ET.paddingRight = ET.paddingTop = ET.paddingBottom = 22; ET.fills = [solid('#101018')]; ET.cornerRadius = 16; at(ET, cx0, cy0);
  cy0 += ET.height + 60;
  const nm = figma.createComponent(); nm.name = 'Edge tab / song name'; nm.layoutMode = 'HORIZONTAL'; nm.primaryAxisSizingMode = 'AUTO'; nm.counterAxisSizingMode = 'AUTO';
  nm.paddingLeft = nm.paddingRight = 14; nm.paddingTop = nm.paddingBottom = 6; nm.cornerRadius = 99; nm.fills = [solid('#000000', .6)];
  const nmt = txt(nm, 'Night Bus', 14, 'Semi Bold'); nm.addComponentProperty('Song', 'TEXT', 'Night Bus'); nmt.componentPropertyReferences = { characters: Object.keys(nm.componentPropertyDefinitions)[0] };
  s.appendChild(nm); at(txt(s, 'Song name (under the tab once armed)', 13, 'Semi Bold', solid(W, .55)), cx0, cy0 - 36); at(nm, cx0, cy0 - 14);
  cy0 += nm.height + 40;
  // layout card: the picker's cell, with its real sketch (from the phone's picker capture) as the image
  at(txt(s, 'Layout card — State (the picker cell; sketch is true to scale)', 13, 'Semi Bold', solid(W, .55)), cx0, cy0 - 22);
  const cards = [];
  for (const st of ['Off', 'On']) {
    const c = figma.createComponent(); c.name = `State=${st}`; c.layoutMode = 'VERTICAL'; c.resize(150, 10); c.primaryAxisSizingMode = 'AUTO'; c.counterAxisSizingMode = 'FIXED'; // resize first: it would reset the auto height
    c.itemSpacing = 3; c.paddingLeft = c.paddingRight = 8; c.paddingTop = 8; c.paddingBottom = 10; c.cornerRadius = 14;
    c.fills = [st === 'On' ? solid(ACC, .12) : solid(W, .045)]; c.strokes = [st === 'On' ? solid(ACC) : solid(W, .08)]; c.strokeWeight = st === 'On' ? 2 : 1; c.strokeAlign = 'INSIDE';
    const sk = figma.createFrame(); sk.name = 'Sketch'; sk.resize(134, 64); sk.cornerRadius = 8; sk.fills = [solid('#0D0D11')]; c.appendChild(sk); sk.layoutAlign = 'STRETCH';
    const r = (x, y, w, h, fill, rx = 2) => { const q = figma.createRectangle(); q.resize(w, h); q.x = x; q.y = y; q.cornerRadius = rx; q.fills = [fill]; sk.appendChild(q); };
    r(12, 2, 41, 41, solid(ACC, .8)); r(12, 45, 41, 2, solid(W, .22), 1); r(66, 8, 50, 3.5, solid(W, .26)); r(66, 16, 38, 3.5, solid(W, .95)); r(66, 24, 58, 3.5, solid(W, .26)); r(66, 32, 40, 3.5, solid(W, .26)); r(22, 53, 22, 3, solid(W, .92)); r(25, 58, 16, 2.4, solid(W, .45));
    const t1 = txt(c, 'Default', 13, 'Bold'); t1.name = 'Name'; const t2 = txt(c, 'Cover beside the lyrics', 11, 'Regular', solid(W, .5)); t2.name = 'Hint';
    c.addComponentProperty('Name', 'TEXT', 'Default'); t1.componentPropertyReferences = { characters: Object.keys(c.componentPropertyDefinitions).find(k => k.startsWith('Name')) };
    c.addComponentProperty('Hint', 'TEXT', 'Cover beside the lyrics'); t2.componentPropertyReferences = { characters: Object.keys(c.componentPropertyDefinitions).find(k => k.startsWith('Hint')) };
    s.appendChild(c); cards.push(c);
  }
  const LC = figma.combineAsVariants(cards, s); LC.name = 'Layout card'; LC.layoutMode = 'HORIZONTAL'; LC.primaryAxisSizingMode = 'AUTO'; LC.counterAxisSizingMode = 'AUTO'; LC.itemSpacing = 20;
  LC.paddingLeft = LC.paddingRight = LC.paddingTop = LC.paddingBottom = 20; LC.fills = [solid('#101018')]; LC.cornerRadius = 16; at(LC, cx0, cy0);
  let ny = cy0 + LC.height + 40;
  for (const [h, b] of [
    ['Where a swipe works', 'The cover (Default, TV view, Cover + clock) or the song card (Player card, Compact, Cinema, Now Bar). Lyrics, background and edges never change songs.'],
    ['How far', 'Up to 3 songs each way: next = the preloaded song + the queue, previous = what this phone showed. The card nearest the middle is the one that plays.'],
    ['Letting go', 'Past 32 % of a card, or a flick, commits; a flick back cancels. The strip carries on at the finger\'s speed and the new cover lands where the old one was, in the same frame as title, lyrics and colours.'],
    ['Taps', 'Tap the cover = controls; double tap = like (with the heart burst). Quick swipes in a row finish the previous one first, so covers never mix.'],
  ]) ny = note(s, cx0, ny, h, b, 760) + 14;
}
return 'ok ' + [...only].join(',');
