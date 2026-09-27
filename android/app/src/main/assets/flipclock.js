// Flip clock: one dark card per digit that flips like a mechanical clock. Shown full screen when the music stops
// (or always, as the "Flip clock" layout) and beside the cover in the "Cover + clock" layout.
// The digit cards are designed in Figma (Dumpyard, page "LyricDock · Flip Clock", frame "Digits — Puff 3D": raised
// puff-print numerals split at the hinge, paper grain on the cards) and baked to fc-*.webp by scripts/flip-assets.ps1:
// card-0..9 and card-blank (the whole card) and numeral-0..9 (no card, for "Show the cards" off), all 300 x 440 at 2x.
// Flat in assets/, not a subfolder: the Windows aapt2 writes subfolder entries with backslashes, which don't load.
//
// A card is four layers, each the WHOLE card clipped to one half at exactly the centre line (clip-path), so every
// layer lines up to the pixel: static top (new digit), static bottom (old digit), top flap (old) and bottom flap
// (new). A flip only changes image sources (no markup rebuilt) and moves the two flaps around the centre line:
//   fall  the top flap tips over (ease-in, like gravity), darkening, and is hidden once edge-on;
//   land  the bottom flap - which appears only after it has turned past 70deg, still in shadow, so no bright sliver
//         pops out at the split - swings down onto the old bottom and settles.
// Variants: classic, bounce (overshoot), fold (slow, sheen + cast shadow), cascade (digit by digit), roll, fade.
// Sound is synthesised (Web Audio, no files): a whoosh as the flap falls, a click as it lands; haptics at the landing.
const Flip = (() => {
  const $ = id => document.getElementById(id);
  const S = () => Settings.S;
  const DIGITS = '0123456789';
  const src = d => (S().clockCards ? `fc-card-${DIGITS.includes(d) ? d : 'blank'}.webp` : DIGITS.includes(d) ? `fc-numeral-${d}.webp` : '');
  // Decode every image once up front (and keep them referenced), so the first flip to a digit never shows a gap.
  let preload = null;
  const warm = () => { preload ??= [...DIGITS].flatMap(d => [`fc-card-${d}.webp`, `fc-numeral-${d}.webp`]).concat('fc-card-blank.webp')
    .map(u => { const i = new Image(); i.src = u; i.decode?.().catch(() => {}); return i; }); };
  const layerSvg = () => '<svg class="fc-svg" viewBox="0 0 300 440" aria-hidden="true"><image class="fc-num" width="300" height="440"/>'
    + '<rect y="218.5" width="300" height="3" fill="#000"/><text class="fc-ap" x="30" y="62"></text></svg>';
  // Point a layer at a digit (and the AM / PM mark): only attributes change.
  function paint(layer, d, label) {
    const u = src(d);
    if (layer.num.getAttribute('href') !== u) u ? layer.num.setAttribute('href', u) : layer.num.removeAttribute('href');
    if (layer.ap.textContent !== (label || '')) { layer.ap.textContent = label || ''; layer.ap.setAttribute('y', label === 'PM' ? 412 : 62); }
  }
  const EASE = { in: 'cubic-bezier(.5,0,.85,.35)', out: 'cubic-bezier(.15,.75,.35,1)' };
  // The system's reduce-motion preference turns every flip into a quiet crossfade.
  const rm = matchMedia('(prefers-reduced-motion: reduce)'), reduced = () => rm.matches;

  let root = null, groups = [], shown = false, secs = false, lastKey = '', tapT = 0, forceSecs = null;

  // ---- sound: noise bursts through filters, synthesised on demand (no audio files to ship)
  let ac = null, noise = null;
  function audio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      noise = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  function burst({ type, f0, f1 = f0, q = 1, vol, attack = 0.002, len, at = 0 }) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noise;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t, Math.random() * 0.1, len + 0.02);
  }
  function thump(vol, at) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.07);
  }
  function sound(fall, land) {
    const kind = S().clockSound, v = S().clockVolume;
    if (kind === 'off' || v <= 0 || document.hidden || document.body.classList.contains('night')) return;
    if (kind === 'mechanical') {
      burst({ type: 'bandpass', f0: 900, f1: 2600, q: 0.8, vol: 0.18 * v, attack: 0.02, len: Math.max(0.05, land - fall), at: fall });
      burst({ type: 'highpass', f0: 3200, vol: 0.9 * v, len: 0.016, at: land });
      burst({ type: 'bandpass', f0: 1800, q: 2, vol: 0.35 * v, len: 0.03, at: land + 0.012 });
    } else if (kind === 'click') burst({ type: 'highpass', f0: 3500, vol: 0.8 * v, len: 0.014, at: land });
    else if (kind === 'whoosh') burst({ type: 'bandpass', f0: 500, f1: 3000, q: 0.7, vol: 0.3 * v, attack: 0.03, len: Math.max(0.05, land - fall) + 0.04, at: fall });
    else if (kind === 'soft') { burst({ type: 'lowpass', f0: 1200, vol: 0.5 * v, len: 0.04, at: land }); thump(0.35 * v, land); }
  }
  const haptic = at => { if (S().clockHaptic) setTimeout(() => { try { Dock.vibrate(12); } catch (e) {} }, at * 1000); };

  // ---- DOM: a group per unit (hours, minutes, seconds), a card per digit, four full-card layers per card
  const cellHtml = () => { const svg = layerSvg();
    return `<div class="fc-cell"><div class="fc-l top">${svg}</div><div class="fc-l bot">${svg}<b class="fc-drop"></b></div>`
      + `<div class="fc-l flap top">${svg}<b class="fc-shade"></b><b class="fc-sheen"></b></div><div class="fc-l flap bot">${svg}<b class="fc-shade"></b></div></div>`; };
  const showSecs = () => forceSecs ?? secs;
  function parts() {
    const d = new Date(), h24 = S().clock24 === '24';
    let h = d.getHours();
    const ampm = h24 ? '' : h < 12 ? 'AM' : 'PM';
    if (!h24) h = h % 12 || 12;
    // 12-hour single-digit hours: the tens card is ' ' and collapses (see tensBlank), so 2:08 is one hours card.
    return { h: h24 ? String(h).padStart(2, '0') : String(h).padStart(2, ' '), m: String(d.getMinutes()).padStart(2, '0'), s: String(d.getSeconds()).padStart(2, '0'), ampm };
  }
  const tensBlank = v => v.h[0] === ' ';
  const apIndex = v => (tensBlank(v) ? 1 : 0); // AM / PM sits on the first visible hours card
  const labelFor = (v, u, i) => (v && u === 'h' && i === apIndex(v) ? v.ampm : '');
  const keyOf = v => `${v.h}${v.m}${showSecs() ? v.s : ''}${v.ampm}`;

  function build(blank) {
    if (!root) return;
    warm();
    const v = parts(), units = showSecs() ? ['h', 'm', 's'] : ['h', 'm'];
    root.querySelector('.fc-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'fc-wrap';
    wrap.innerHTML = units.map(u => `<div class="fc-group" data-u="${u}">${[...v[u]].map(cellHtml).join('')}</div>`).join('');
    root.prepend(wrap);
    groups = [...wrap.querySelectorAll('.fc-group')].map(el => ({ el, u: el.dataset.u, cells: [...el.querySelectorAll('.fc-cell')].map((c, i) => {
      const L = [...c.children].map(x => ({ el: x, num: x.querySelector('.fc-num'), ap: x.querySelector('.fc-ap') }));
      const cell = { el: c, top: L[0], bot: L[1], ft: L[2], fb: L[3], d: blank ? ' ' : v[el.dataset.u][i], label: blank ? '' : labelFor(v, el.dataset.u, i) };
      for (const x of L) paint(x, cell.d, cell.label);
      if (el.dataset.u === 'h' && i === 0 && tensBlank(v)) c.classList.add('gone');
      return cell;
    }) }));
    layout();
  }
  // Card size: as big as the space allows - groups side by side when wide, stacked when tall - x the size setting.
  // Visible cards only (a collapsed tens card doesn't take room).
  function layout() {
    if (!root) return;
    const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight, R = 440 / 300;
    const n = groups.length || 2, cards = groups.reduce((t, g) => t + g.cells.filter(c => !c.el.classList.contains('gone')).length, 0) || n * 2;
    const stacked = S().clockLayout === 'stacked' || (S().clockLayout === 'auto' && H > W);
    const inner = S().clockDigitGap, sep = S().clockGroupGap; // gaps between a group's cards / between groups, in card widths
    const perRow = Math.max(...(groups.length ? groups.map(g => g.cells.filter(c => !c.el.classList.contains('gone')).length) : [2]));
    const cw = stacked
      ? Math.min(W * 0.88 / (perRow + (perRow - 1) * inner), H * 0.84 / (n * R + (n - 1) * sep))
      : Math.min(W * 0.95 / (cards + (cards - n) * inner + (n - 1) * sep), H * 0.8 / R); // leaves room for the caption and burn-in shift
    const st = root.style, k = S().clockScale;
    st.setProperty('--fc-gap', `${cw * k * inner}px`);
    st.setProperty('--fc-sep', `${cw * k * sep}px`);
    st.setProperty('--cw', `${cw * k}px`);
    st.setProperty('--ch', `${cw * R * k}px`);
    st.setProperty('--fc-dim', 1 - S().clockDim);
    root.classList.toggle('stacked', stacked);
  }

  // ---- one card from its digit to d; returns seconds from now until it lands
  // Timeline (every layer animation uses fill 'both', so during any stagger delay each layer already sits in its
  // start pose - the landing flap hidden edge-on - instead of flashing its plain style):
  //   0 .. fall            top flap (old) tips over, darkening; hidden on its last frame (edge-on)
  //   fall .. fall+land    bottom flap (new) appears past 70deg in shadow and swings down; the old bottom under it
  //                        is only repainted when it has landed.
  function flip(cell, d, label, delay, speed = 1, anims = []) {
    const { top, bot, ft, fb } = cell, from = cell.d, fromLabel = cell.label;
    const anim = reduced() ? 'fade' : S().clockAnim;
    for (const x of [ft, fb, top, bot]) x.el.getAnimations({ subtree: true }).forEach(a => a.cancel());
    ft.el.classList.remove('on'); fb.el.classList.remove('on'); // a flip cut short by this one leaves no flap behind
    // Settled start: halves show the digit we leave, the flaps carry the two digits.
    paint(bot, from, fromLabel); paint(ft, from, fromLabel);
    paint(top, d, label); paint(fb, d, label);
    cell.d = d; cell.label = label;
    const T = { classic: [180, 210], bounce: [170, 420], fold: [300, 340], cascade: [160, 300], roll: [0, 420], fade: [0, 420] }[anim] || [180, 210];
    // Speed: the setting (clamped), and never so slow that a flip outlives the next second (it would be cut short).
    let sp = 1 / (Math.min(3, Math.max(0.3, S().animSpeed || 1)) * speed);
    if (showSecs()) sp = Math.min(sp, 820 / (T[0] + T[1] + delay));
    const fall = T[0] * sp, land = T[1] * sp, o = { fill: 'both' };
    if (anim === 'roll' || anim === 'fade') {
      paint(bot, d, label);
      const kf = anim === 'roll' ? [{ transform: 'translateY(-30%) rotateX(55deg)', opacity: 0 }, { transform: 'none', opacity: 1 }] : [{ opacity: 0 }, { opacity: 1 }];
      for (const h of [top, bot]) anims.push(h.el.firstElementChild.animate(kf, { duration: land, delay, easing: EASE.out, fill: 'backwards' }));
      return (delay + land) / 1000;
    }
    ft.el.classList.add('on'); fb.el.classList.add('on');
    anims.push(ft.el.animate([{ transform: 'rotateX(0)', opacity: 1 }, { transform: 'rotateX(-89deg)', opacity: 1, offset: 0.985 }, { transform: 'rotateX(-90deg)', opacity: 0 }],
      { duration: fall, delay, easing: EASE.in, ...o }));
    ft.el.querySelector('.fc-shade').animate([{ opacity: 0 }, { opacity: 0.65 }], { duration: fall, delay, easing: EASE.in, ...o });
    bot.el.querySelector('.fc-drop').animate([{ opacity: 0 }, { opacity: 0.35 }, { opacity: 0 }], { duration: fall + land * 0.6, delay, easing: 'ease-in-out' });
    if (anim === 'fold') ft.el.querySelector('.fc-sheen').animate([{ opacity: 0, transform: 'translateY(-60%)' }, { opacity: 0.5, transform: 'translateY(40%)' }], { duration: fall, delay, easing: 'linear', ...o });
    const springy = anim === 'bounce' || anim === 'cascade';
    const kf = [{ transform: 'rotateX(90deg)', opacity: 0 }, { transform: 'rotateX(70deg)', opacity: 0, offset: 0.1 }, { transform: 'rotateX(64deg)', opacity: 1, offset: 0.14 },
      ...(springy ? [{ transform: 'rotateX(-12deg)', opacity: 1, offset: 0.62 }, { transform: 'rotateX(5deg)', opacity: 1, offset: 0.82 }] : [{ transform: 'rotateX(-3deg)', opacity: 1, offset: 0.82 }]),
      { transform: 'rotateX(0)', opacity: 1 }];
    const landing = fb.el.animate(kf, { duration: land, delay: delay + fall, easing: springy ? 'ease-out' : EASE.out, ...o });
    landing.onfinish = () => { paint(bot, d, label); ft.el.classList.remove('on'); fb.el.classList.remove('on'); ft.el.getAnimations().forEach(a => a.cancel()); landing.cancel(); };
    anims.push(landing);
    fb.el.querySelector('.fc-shade').animate([{ opacity: 0.85 }, { opacity: 0.4, offset: 0.3 }, { opacity: 0 }], { duration: land, delay: delay + fall, easing: EASE.out, ...o });
    return (delay + fall + (springy ? land * 0.62 : land * 0.82)) / 1000;
  }

  // On screen = the full-screen clock is up, or the Cover + clock layout is showing its pane. Explicit, not inferred.
  const onScreen = () => !!root?.isConnected && (root.id === 'clockScreen' ? document.body.classList.contains('clock') : document.body.classList.contains('layout-clocksplit'));
  // busy: entering or leaving - one owner per card, so a tick never starts a competing flip on the same cards.
  let busy = false;
  // 4x a second: flip whatever changed (flips land on the second, not up to 1s late). Nothing while hidden.
  function tick() {
    if (!shown || !groups.length || busy || document.hidden) return;
    if (!onScreen()) { shown = false; return; } // left the screen without leave(): stop for good, no invisible ticking
    const v = parts(), key = keyOf(v);
    if (key === lastKey) return;
    if (key.slice(0, 4) !== lastKey.slice(0, 4)) announce(v);
    lastKey = key;
    turn(v, S().clockAnim === 'cascade' ? 110 : 35, true);
  }
  // Flip every card that differs from v (right to left, the order a real clock turns); v = null flips all to blank.
  function turn(v, stagger, withSound, speed, anims = []) {
    let landAt = -1, fallAt = 0, n = 0, big = false;
    const tens = groups.find(g => g.u === 'h')?.cells[0];
    if (tens && v && tens.el.classList.toggle('gone', tensBlank(v)) !== tens.wasGone) { tens.wasGone = tensBlank(v); layout(); }
    for (const g of [...groups].reverse()) {
      for (let i = g.cells.length - 1; i >= 0; i--) {
        const cell = g.cells[i], d = v ? v[g.u][i] : ' ', label = labelFor(v, g.u, i);
        if (d === undefined || (d === cell.d && label === cell.label)) continue;
        const delay = n * stagger;
        if (g.u !== 's') big = true;
        const l = flip(cell, d, label, delay, speed, anims);
        if (landAt < 0) fallAt = delay / 1000;
        landAt = Math.max(landAt, l);
        n++;
      }
    }
    if (withSound && landAt >= 0 && onScreen() && (!showSecs() || S().clockSoundEvery === 'all' || big)) { sound(fallAt, landAt); haptic(landAt); }
    return Math.max(0, landAt);
  }
  const settled = anims => Promise.all(anims.map(a => a.finished.catch(() => {})));

  // Enter: the cards start blank and flip to the time one after another. Resolves when they have landed.
  function show() {
    if (!root) return Promise.resolve();
    if (shown && root.querySelector('.fc-wrap')) return Promise.resolve();
    shown = true; busy = true;
    secs = S().clockSeconds;
    build(true);
    const v = parts();
    lastKey = keyOf(v);
    announce(v);
    return new Promise(res => requestAnimationFrame(() => {
      const anims = [];
      turn(v, 70, false, 1.2, anims);
      settled(anims).then(() => { busy = false; lastKey = ''; res(); }); // lastKey '' = catch up on a second that passed meanwhile
    }));
  }
  // Leave: the cards flip to blank quickly; resolves on the real animations, so the song view comes back after.
  function leave() {
    if (!root || !shown) return Promise.resolve();
    shown = false; busy = true;
    const anims = [];
    turn(null, 35, false, 1.6, anims);
    return settled(anims).then(() => { busy = false; });
  }
  function hide() { shown = false; }
  // Move the clock to another container (full screen, or beside the cover); a changed seconds option rebuilds.
  // The container can resize on its own (the cover beside it, rotation): watch it, not just the window.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  function mount(el, opts = {}) {
    const next = opts.secs ?? null, secsChanged = next !== forceSecs;
    forceSecs = next;
    if (root === el) { if (secsChanged && shown) { build(false); lastKey = ''; } return; }
    root?.querySelector('.fc-wrap')?.remove();
    ro?.disconnect();
    root = el;
    ro?.observe(root);
    shown = false;
  }
  // Screen readers: the time as text, updated only when the minute changes.
  const live = Object.assign(document.createElement('span'), { className: 'sr-only' });
  live.setAttribute('aria-live', 'polite');
  document.body.append(live);
  function announce(v) { live.textContent = `${v.h.trim()}:${v.m}${v.ampm ? ' ' + v.ampm : ''}`; }
  // Tap: seconds on / off (Fliqlo). Double tap: back to the lyrics.
  function onTap() {
    const now = performance.now();
    if (now - tapT < 320) { tapT = 0; return 'dismiss'; }
    tapT = now;
    setTimeout(() => { if (tapT === now && shown && !busy && forceSecs === null) { secs = !secs; Settings.set('clockSeconds', secs, false); build(false); lastKey = ''; } }, 330);
    return null;
  }
  if (!ro) addEventListener('resize', layout);
  setInterval(tick, 250);
  return { show, hide, leave, onTap, mount, layout, isShown: () => shown,
    // Structural settings (cards, 12/24 h, seconds, arrangement, animation) rebuild; size / dim only restyle.
    rebuild: () => { if (shown && !busy) { build(false); lastKey = ''; } } };
})();
