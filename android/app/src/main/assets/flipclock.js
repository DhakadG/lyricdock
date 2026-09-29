// Flip clock: one card per digit that flips like a mechanical clock. Shown full screen when the music stops
// (or always, as the "Flip clock" layout) and beside the cover in the "Cover + clock" layout.
// The digit cards are designed in Figma (Dumpyard, page "LyricDock · Flip Clock", frames "Digits — Puff 3D" and "Digits — Light":
// raised puff-print numerals split at the hinge, paper grain on the cards) and baked to fc-*.webp / fc-light-*.webp by
// scripts/flip-assets.ps1: card-0..9, card-blank (the whole card) and numeral-0..9 (no card), all 300 x 440 at 2x.
// Flat in assets/, not a subfolder: the Windows aapt2 writes subfolder entries with backslashes, which don't load.
//
// A card is four layers, each the WHOLE card clipped to one half at exactly the centre line (clip-path), so every
// layer lines up to the pixel: static top (new digit), static bottom (old digit), top flap (old) and bottom flap
// (new). A flip only changes image sources and moves the two flaps around the centre line (see motion()): the top
// flap tips over and is hidden once edge-on, and the bottom flap - which appears only after it has turned past
// ~70deg, in shadow, so no bright sliver pops out at the split - comes down and lands.
// Variants: classic, snappy, bounce, fold (slow, sheen), cascade (digit by digit) on eased curves; gravity on a
// simulated fall with a small bounce off the stack; roll, fade. A colour change flips every card over (retheme).
// Coming in / going out (clockIntro): the airport board (every card rolls flap by flap from 0 to the time, and on to
// 0 when leaving), a flip from / to blank, or nothing.
// Sound is synthesised (Web Audio, no files): each card clacks as it lands; haptics at the landing.
const Flip = (() => {
  const $ = id => document.getElementById(id);
  const S = () => Settings.S;
  const DIGITS = '0123456789';
  // Two themes: dark cards with light numerals (fc-*) and light cards with dark numerals (fc-light-*). Automatic:
  // light by day, dark during the night-mode hours (Settings -> Night), whether or not night mode itself is on.
  const nightNow = () => { const h = new Date().getHours(), a = S().nightFrom ?? 22, b = S().nightTo ?? 7; return a < b ? h >= a && h < b : h >= a || h < b; };
  const theme = () => (S().clockTheme === 'auto' ? (nightNow() ? 'dark' : 'light') : S().clockTheme === 'light' ? 'light' : 'dark');
  const pre = (t = theme()) => (t === 'light' ? 'fc-light-' : 'fc-');
  const src = (d, p = pre()) => (S().clockCards ? `${p}card-${DIGITS.includes(d) ? d : 'blank'}.webp` : DIGITS.includes(d) ? `${p}numeral-${d}.webp` : '');
  // Decode the theme's images once up front (and keep them referenced), so the first flip to a digit never shows a gap.
  const preload = {};
  const warm = (p = pre()) => { preload[p] ??= [...DIGITS].flatMap(d => [`${p}card-${d}.webp`, `${p}numeral-${d}.webp`]).concat(`${p}card-blank.webp`)
    .map(u => { const i = new Image(); i.src = u; i.decode?.().catch(() => {}); return i; }); };
  const layerSvg = () => '<svg class="fc-svg" viewBox="0 0 300 440" aria-hidden="true"><image class="fc-num" width="300" height="440"/>'
    + '<rect y="218.5" width="300" height="3" fill="#000"/><text class="fc-ap" x="30" y="62"></text></svg>';
  // Point a layer at a digit (and the AM / PM mark): only attributes change.
  function paint(layer, d, label, p) {
    const u = src(d, p);
    if (layer.num.getAttribute('href') !== u) u ? layer.num.setAttribute('href', u) : layer.num.removeAttribute('href');
    if (layer.ap.textContent !== (label || '')) { layer.ap.textContent = label || ''; layer.ap.setAttribute('y', label === 'PM' ? 412 : 62); }
  }
  const EASE = { in: 'cubic-bezier(.5,0,.85,.35)', out: 'cubic-bezier(.15,.75,.35,1)' };
  // ---- how a flap moves. Two families:
  // Eased (classic, snappy, bounce, fold, cascade): the top flap falls on an ease-in curve, the bottom flap lands on
  //   an ease-out one, with an overshoot for the springy ones. Smooth and predictable.
  // Gravity: the path simulated once - released just past upright, the flap swings down about its hinge, pulled
  //   harder the further it tips (sin) plus a kick from the latch letting go; fastest at the bottom, where it hits the
  //   stack and bounces a little. PATH: [time 0..1, angle 0..180deg]; T90 = when it passes horizontal.
  const PATH = (() => {
    const all = []; let a = 0.18, w = 0, t = 0;
    while (a < Math.PI) { all.push([t, a]); w += (Math.sin(a) + 0.9) * 0.001; a += w * 0.001; t += 0.001; }
    all.push([t, Math.PI]);
    const at = x => { const i = Math.min(all.length - 1, Math.round(x * (all.length - 1))); return all[i][1] * 180 / Math.PI; };
    return Array.from({ length: 33 }, (_, i) => [i / 32, at(i / 32)]); // 32 steps is smooth at 60 fps
  })();
  const T90 = (() => { const i = PATH.findIndex(([, a]) => a >= 90); const [t0, a0] = PATH[i - 1], [t1, a1] = PATH[i]; return t0 + (t1 - t0) * (90 - a0) / (a1 - a0); })();
  const TOP = [{ transform: 'rotateX(0)', opacity: 1 }, { transform: 'rotateX(-89deg)', opacity: 1, offset: 0.985 }, { transform: 'rotateX(-90deg)', opacity: 0 }];
  const settle = over => [{ transform: 'rotateX(90deg)', opacity: 0 }, { transform: 'rotateX(70deg)', opacity: 0, offset: 0.1 }, { transform: 'rotateX(64deg)', opacity: 1, offset: 0.14 },
    ...(over ? [{ transform: 'rotateX(-12deg)', opacity: 1, offset: 0.62 }, { transform: 'rotateX(5deg)', opacity: 1, offset: 0.82 }] : [{ transform: 'rotateX(-3deg)', opacity: 1, offset: 0.82 }]),
    { transform: 'rotateX(0)', opacity: 1 }];
  // Eased variants: [fall ms, land ms, springy]. Gravity: time from release to impact (ms) and bounce heights (deg).
  const EASED = { classic: [180, 210], snappy: [110, 150], bounce: [170, 420, true], fold: [300, 340], cascade: [160, 300, true] };
  const GRAVITY = [230, [5, 1.5]];
  const baseMs = anim => (EASED[anim] ? EASED[anim][0] + EASED[anim][1] : GRAVITY[0] * 1.5);
  // Keyframes for one flip, in ms: top flap 0 -> -90deg over `fall`, then the bottom flap 90 -> 0deg over `dur`,
  // hitting the stack `hit` ms into it (when the click sounds).
  function motion(anim, sp) {
    if (EASED[anim]) {
      const [f, l, over] = EASED[anim];
      return { top: TOP, bot: settle(over), fall: f * sp, dur: l * sp, hit: l * sp * (over ? 0.62 : 0.82), topEase: EASE.in, botEase: over ? 'ease-out' : EASE.out };
    }
    const [ms, hops] = GRAVITY, j = 0.93 + Math.random() * 0.14; // a little uneven, like real flaps
    const total = ms * sp * j, fall = total * T90, drop = total - fall;
    const top = PATH.filter(([t]) => t / T90 < 0.97).map(([t, a]) => ({ transform: `rotateX(${-a.toFixed(2)}deg)`, opacity: 1, offset: t / T90 }));
    top.push({ transform: 'rotateX(-89deg)', opacity: 1, offset: 0.985 }, { transform: 'rotateX(-90deg)', opacity: 0, offset: 1 }); // hidden edge-on
    // Bounces: constant deceleration g (deg/ms^2), sized so a 7deg bounce takes ~70 ms at speed 1.
    const g = (2 * 7) / (35 * 35) / (sp * sp), hopMs = hops.map(h => 2 * Math.sqrt((2 * h * j) / g));
    const dur = drop + hopMs.reduce((x, y) => x + y, 0), bot = [{ transform: 'rotateX(90deg)', opacity: 0, offset: 0 }];
    for (const [t, a] of PATH.filter(([t]) => t > T90)) { const deg = 180 - a; bot.push({ transform: `rotateX(${deg.toFixed(2)}deg)`, opacity: deg > 72 ? 0 : 1, offset: ((t - T90) * total) / dur }); }
    let at = drop;
    hops.forEach((h, i) => { for (let k = 1; k <= 6; k++) { const u = k / 6, x = hopMs[i] * u; bot.push({ transform: `rotateX(${(h * j * 4 * u * (1 - u)).toFixed(2)}deg)`, opacity: 1, offset: (at + x) / dur }); } at += hopMs[i]; });
    bot[bot.length - 1].offset = 1;
    return { top, bot, fall, dur, hit: drop, topEase: 'linear', botEase: 'linear' };
  }
  // The system's reduce-motion preference turns every flip into a quiet crossfade.
  const rm = matchMedia('(prefers-reduced-motion: reduce)'), reduced = () => rm.matches;

  let root = null, groups = [], shown = false, secs = false, lastKey = '', tapT = 0, forceSecs = null;

  // ---- sound: noise bursts through filters, synthesised on demand (no audio files to ship)
  let ac = null, noise = null, out = null;
  function audio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { return null; }
      // Everything goes through one limiter and one master level: when a whole board of cards lands at once the bursts add
      // up, and straight into the speaker they clipped into a harsh crackle.
      const lim = ac.createDynamicsCompressor();
      lim.threshold.value = -14; lim.knee.value = 8; lim.ratio.value = 12; lim.attack.value = 0.001; lim.release.value = 0.08;
      out = ac.createGain(); out.gain.value = 0.9;
      lim.connect(out).connect(ac.destination);
      out = lim;
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); // 1 s: long enough for any burst from any offset
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
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, len + 0.02);
  }
  function thump(vol, at, f = 140) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.05);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.07);
  }
  const jit = () => 0.85 + Math.random() * 0.3; // no two flaps sound exactly alike
  // A flap hitting the stack: a sharp plastic tick, a short hollow body and a dull knock.
  // Real boards rattle: many flaps landing together sound like a quick run of clicks, not one loud blast. Clacks
  // closer than 9 ms to one already scheduled are dropped, and each one gets quieter the busier its 60 ms window is.
  const landed = [];
  function budget(at) {
    const t = (ac?.currentTime ?? 0) + at;
    while (landed.length && landed[0] < t - 0.2) landed.shift();
    if (landed.some(x => Math.abs(x - t) < 0.009)) return 0;
    const busy = landed.filter(x => Math.abs(x - t) < 0.06).length;
    landed.push(t); landed.sort((a, b) => a - b);
    return 1 / Math.sqrt(1 + busy);
  }
  function clack(at, v) {
    if (!audio()) return;
    v *= budget(at);
    if (!v) return;
    burst({ type: 'highpass', f0: 4200 * jit(), vol: 0.9 * v, attack: 0.0008, len: 0.012, at });
    burst({ type: 'bandpass', f0: 1700 * jit(), q: 5, vol: 0.6 * v, attack: 0.001, len: 0.04, at: at + 0.002 });
    thump(0.3 * v, at, 190 * jit());
  }
  // The flap sweeping down: a soft rush of air that swells until it lands.
  const air = (from, to, v) => burst({ type: 'bandpass', f0: 500, f1: 1400, q: 0.7, vol: 0.28 * v, attack: Math.max(0.03, (to - from) * 0.8), len: Math.max(0.05, to - from) + 0.02, at: from });
  // One card's sound: fall = when its flap lets go, land = when it hits (s from now).
  function sound(fall, land, scale = 1) {
    const kind = S().clockSound, v = S().clockVolume * scale;
    if (kind === 'off' || v <= 0 || document.hidden || document.body.classList.contains('night')) return;
    if (kind === 'solari') { clack(land, v); clack(land + 0.016 + Math.random() * 0.01, v * 0.45); } // the airport board: a flap, and the next one rattling
    else if (kind === 'mechanical') { air(fall, land, v * 0.7); clack(land, v); }
    else if (kind === 'click') clack(land, v * 0.8);
    else if (kind === 'whoosh') { air(fall, land, v); burst({ type: 'lowpass', f0: 900, vol: 0.25 * v, len: 0.03, at: land }); }
    else if (kind === 'soft') { burst({ type: 'lowpass', f0: 1200, vol: 0.5 * v, len: 0.04, at: land }); thump(0.35 * v, land); }
  }
  // A basic vibration motor needs ~30 ms to be felt at all (12 ms ran but was imperceptible).
  let buzzAt = 0;
  const haptic = at => { const ms = { light: 30, firm: 50 }[S().clockHaptic], when = performance.now() + at * 1000;
    if (!ms || Math.abs(when - buzzAt) < 140) return; // cards landing together: one buzz
    buzzAt = when;
    setTimeout(() => { try { Dock.vibrate(ms); } catch (e) {} }, at * 1000); };

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

  // fill: null = the time; ' ' = blank cards; '0' = every card on 0 (the airport-board entry starts there).
  function build(fill = null) {
    if (!root) return;
    warm();
    painted = theme();
    root.classList.toggle('fc-light', painted === 'light');
    root.classList.toggle('fc-bare', !S().clockCards);
    const v = parts(), units = showSecs() ? ['h', 'm', 's'] : ['h', 'm'];
    root.querySelector('.fc-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'fc-wrap';
    wrap.innerHTML = units.map(u => `<div class="fc-group" data-u="${u}">${[...v[u]].map(cellHtml).join('')}</div>`).join('');
    root.prepend(wrap);
    groups = [...wrap.querySelectorAll('.fc-group')].map(el => ({ el, u: el.dataset.u, cells: [...el.querySelectorAll('.fc-cell')].map((c, i) => {
      const L = [...c.children].map(x => ({ el: x, num: x.querySelector('.fc-num'), ap: x.querySelector('.fc-ap') }));
      const t = v[el.dataset.u][i], d = fill === null || t === ' ' ? t : fill;
      const cell = { el: c, top: L[0], bot: L[1], ft: L[2], fb: L[3], d, label: fill === ' ' ? '' : labelFor(v, el.dataset.u, i) };
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
  // Returns { fall, land }: seconds from now until the flap lets go and until it hits (0 for crossfades).
  // fromPre: paint the digit being left in another theme's images (a colour change flips the cards over).
  function flip(cell, d, label, delay, speed = 1, anims = [], forceAnim = null, fromPre) {
    const { top, bot, ft, fb } = cell, from = cell.d, fromLabel = cell.label;
    const anim = reduced() ? 'fade' : forceAnim || S().clockAnim;
    for (const x of [ft, fb, top, bot]) x.el.getAnimations({ subtree: true }).forEach(a => a.cancel());
    ft.el.classList.remove('on'); fb.el.classList.remove('on'); // a flip cut short by this one leaves no flap behind
    // Settled start: halves show the digit we leave, the flaps carry the two digits.
    paint(bot, from, fromLabel, fromPre); paint(ft, from, fromLabel, fromPre);
    paint(top, d, label); paint(fb, d, label);
    cell.d = d; cell.label = label;
    // Speed: the setting (clamped), and never so slow that a flip outlives the next second (it would be cut short).
    let sp = 1 / (Math.min(3, Math.max(0.3, S().animSpeed || 1)) * speed);
    if (showSecs()) sp = Math.min(sp, 820 / (baseMs(anim) + delay));
    const o = { fill: 'both' };
    if (anim === 'roll' || anim === 'fade') {
      const land = 420 * sp;
      paint(bot, d, label);
      const kf = anim === 'roll' ? [{ transform: 'translateY(-30%) rotateX(55deg)', opacity: 0 }, { transform: 'none', opacity: 1 }] : [{ opacity: 0 }, { opacity: 1 }];
      for (const h of [top, bot]) anims.push(h.el.firstElementChild.animate(kf, { duration: land, delay, easing: EASE.out, fill: 'backwards' }));
      return { fall: delay / 1000, land: (delay + land) / 1000 };
    }
    const m = motion(anim, sp);
    // Shading follows the card each flap is made of: black cards sink into near-black as they turn away from the light;
    // paper-white cards only dim a little, in a warm tone - a black-level shade on them read as a dark card flipping over.
    // During a colour change the falling flap is still the old colour (fromPre), the landing one already the new.
    const lightTo = pre() === 'fc-light-', lightFrom = fromPre ? fromPre === 'fc-light-' : lightTo;
    const SH = l => (l ? { c: '#4b4238', fall: 0.26, land: 0.34, drop: 0.14 } : { c: '#000', fall: 0.65, land: 0.85, drop: 0.35 });
    const shFrom = SH(lightFrom), shTo = SH(lightTo);
    for (const [el, sh] of [[ft.el.querySelector('.fc-shade'), shFrom], [fb.el.querySelector('.fc-shade'), shTo], [bot.el.querySelector('.fc-drop'), shFrom]]) el.style.setProperty('--sh', sh.c);
    ft.el.classList.add('on'); fb.el.classList.add('on');
    anims.push(ft.el.animate(m.top, { duration: m.fall, delay, easing: m.topEase, ...o }));
    ft.el.querySelector('.fc-shade').animate([{ opacity: 0 }, { opacity: shFrom.fall }], { duration: m.fall, delay, easing: EASE.in, ...o });
    bot.el.querySelector('.fc-drop').animate([{ opacity: 0 }, { opacity: shFrom.drop }, { opacity: 0 }], { duration: m.fall + m.hit * 1.5, delay, easing: 'ease-in-out' });
    if (anim === 'fold') ft.el.querySelector('.fc-sheen').animate([{ opacity: 0, transform: 'translateY(-60%)' }, { opacity: 0.5, transform: 'translateY(40%)' }], { duration: m.fall, delay, easing: 'linear', ...o });
    const landing = fb.el.animate(m.bot, { duration: m.dur, delay: delay + m.fall, easing: m.botEase, ...o });
    landing.onfinish = () => { paint(bot, d, label); ft.el.classList.remove('on'); fb.el.classList.remove('on'); ft.el.getAnimations().forEach(a => a.cancel()); landing.cancel(); };
    anims.push(landing);
    fb.el.querySelector('.fc-shade').animate([{ opacity: shTo.land }, { opacity: 0 }], { duration: m.hit * 1.3, delay: delay + m.fall, easing: EASE.out, ...o });
    return { fall: delay / 1000, land: (delay + m.fall + m.hit) / 1000 };
  }

  // On screen = the full-screen clock is up, or the Cover + clock layout is showing its pane. Explicit, not inferred.
  const onScreen = () => !!root?.isConnected && (root.id === 'clockScreen' ? document.body.classList.contains('clock') : document.body.classList.contains('layout-clocksplit'));
  // busy: entering or leaving - one owner per card, so a tick never starts a competing flip on the same cards.
  let busy = false;
  // 4x a second: flip whatever changed (flips land on the second, not up to 1s late). Nothing while hidden.
  // A colour change (the setting, a long press, or Automatic at the night-mode hours): every card flips over, left to
  // right, from the old colour to the new one - the digits stay. Off screen or mid-animation it just rebuilds.
  let painted = null; // the theme the cards show
  function retheme() {
    const t = theme();
    if (t === painted) return;
    if (!shown || busy || !groups.length) { if (root?.querySelector('.fc-wrap')) build(); return; }
    const from = pre(painted), anims = [];
    painted = t; busy = true;
    warm();
    root.classList.toggle('fc-light', t === 'light');
    groups.flatMap(g => g.cells).filter(c => !c.el.classList.contains('gone')).forEach((c, i) => {
      const hit = flip(c, c.d, c.label, i * 70, 1, anims, flapAnim(), from);
      sound(hit.fall, hit.land, 0.7);
    });
    settled(anims).then(() => { busy = false; lastKey = ''; });
  }
  function tick() {
    if (!shown || !groups.length || busy || document.hidden) return;
    if (!onScreen()) { shown = false; return; } // left the screen without leave(): stop for good, no invisible ticking
    if (theme() !== painted) return retheme();
    const v = parts(), key = keyOf(v);
    if (key === lastKey) return;
    if (key.slice(0, 4) !== lastKey.slice(0, 4)) announce(v);
    lastKey = key;
    turn(v, S().clockAnim === 'cascade' ? 110 : 35, true);
  }
  // Flip every card that differs from v (right to left, the order a real clock turns); v = null flips all to blank.
  // Each card makes its own sound as it lands, so several changing at once rattle like a real board.
  function turn(v, stagger, withSound, speed, anims = []) {
    let landAt = -1, n = 0, big = false;
    const tens = groups.find(g => g.u === 'h')?.cells[0], hits = [];
    if (tens && v && tens.el.classList.toggle('gone', tensBlank(v)) !== tens.wasGone) { tens.wasGone = tensBlank(v); layout(); }
    for (const g of [...groups].reverse()) {
      for (let i = g.cells.length - 1; i >= 0; i--) {
        const cell = g.cells[i], d = v ? v[g.u][i] : ' ', label = labelFor(v, g.u, i);
        if (d === undefined || (d === cell.d && label === cell.label)) continue;
        if (g.u !== 's') big = true;
        const t = flip(cell, d, label, n * stagger, speed, anims);
        hits.push(t);
        landAt = Math.max(landAt, t.land);
        n++;
      }
    }
    if (withSound && hits.length && onScreen() && (!showSecs() || S().clockSoundEvery === 'all' || big)) {
      for (const t of hits) sound(t.fall, t.land, hits.length > 1 ? 0.8 : 1);
      haptic(landAt);
    }
    return Math.max(0, landAt);
  }
  const settled = anims => Promise.all(anims.map(a => a.finished.catch(() => {})));

  // The airport board: every card turns forward one flap at a time until it shows its target, each at its own pace
  // (a slightly random start and speed), clacking at every flap. The next flap lets go as the previous one lands.
  let gen = 0; // a newer enter / leave stops an older one's rolling
  function roll(targets, withSound) {
    const my = ++gen, cells = groups.flatMap(g => g.cells).filter(c => !c.el.classList.contains('gone'));
    return Promise.all(cells.map((cell, i) => new Promise(res => {
      const { d: target, label } = targets(cell);
      const pace = 3.7 + Math.random() * 0.8; // x normal speed: ~60 ms a flap
      const step = () => {
        if (my !== gen) return res();
        if (cell.d === target || !DIGITS.includes(target)) return res();
        const next = DIGITS[(DIGITS.indexOf(cell.d) + 1) % 10] ?? '0', anims = [];
        const t = flip(cell, next, label, 0, pace, anims, flapAnim());
        if (withSound) sound(t.fall, t.land, 0.55);
        if (next === target) { haptic(t.land); settled(anims).then(res); } else setTimeout(step, t.land * 1000);
      };
      setTimeout(step, i * 40 + Math.random() * 45);
    })));
  }
  const flapAnim = () => (['roll', 'fade'].includes(S().clockAnim) ? 'classic' : S().clockAnim); // the board always flaps
  const intro = () => (reduced() ? 'none' : S().clockIntro || 'roll');

  // Enter. roll: every card starts on 0 and rolls forward to the time. flip: blank cards flip to the time.
  // Resolves when they have landed.
  function show() {
    if (!root) return Promise.resolve();
    if (shown && root.querySelector('.fc-wrap')) return Promise.resolve();
    shown = true; busy = true;
    secs = S().clockSeconds;
    const how = intro(), v = parts();
    build(how === 'roll' ? '0' : how === 'flip' ? ' ' : null);
    lastKey = keyOf(v);
    announce(v);
    const done = () => { busy = false; lastKey = ''; }; // lastKey '' = catch up on a second that passed meanwhile
    if (how === 'none') { done(); return Promise.resolve(); }
    return new Promise(res => requestAnimationFrame(() => {
      if (how === 'roll') { roll(c => { const g = groups.find(x => x.cells.includes(c)); return { d: v[g.u][g.cells.indexOf(c)], label: c.label }; }, true).then(() => { done(); res(); }); return; }
      const anims = [];
      turn(v, 70, false, 1.2, anims);
      settled(anims).then(() => { done(); res(); });
    }));
  }
  // Leave. roll: every card rolls forward to 0 (through 9, the way a board only turns one way). flip: to blank.
  // Resolves on the real animations, so the song view comes back after.
  function leave() {
    if (!root || !shown) return Promise.resolve();
    shown = false; busy = true;
    const how = intro(), done = () => { busy = false; };
    if (how === 'none') { done(); return Promise.resolve(); }
    if (how === 'roll') return roll(c => ({ d: '0', label: c.label }), true).then(done);
    const anims = [];
    turn(null, 35, false, 1.6, anims);
    return settled(anims).then(done);
  }
  function hide() { shown = false; }
  // Move the clock to another container (full screen, or beside the cover); a changed seconds option rebuilds.
  // The container can resize on its own (the cover beside it, rotation): watch it, not just the window.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  function mount(el, opts = {}) {
    const next = opts.secs ?? null, secsChanged = next !== forceSecs;
    forceSecs = next;
    if (root === el) { if (secsChanged && shown) { build(); lastKey = ''; } return; }
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
    setTimeout(() => { if (tapT === now && shown && !busy && forceSecs === null) { secs = !secs; Settings.set('clockSeconds', secs, false); build(); lastKey = ''; } }, 330);
    return null;
  }
  if (!ro) addEventListener('resize', layout);
  setInterval(tick, 250);
  return { show, hide, leave, onTap, mount, layout, isShown: () => shown,
    // Structural settings (cards, 12/24 h, seconds, arrangement, animation) rebuild; size / dim only restyle.
    rebuild: () => { if (theme() !== painted) return retheme(); if (shown && !busy) { build(); lastKey = ''; } },
    // Long press: swap the card colour (Automatic becomes the opposite of what it shows now).
    toggleTheme: () => { Settings.set('clockTheme', theme() === 'light' ? 'dark' : 'light', false); return theme(); } };
})();
