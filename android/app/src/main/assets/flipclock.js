// Flip clock screen (shown when music is paused / idle): one dark card per digit that flips like a mechanical clock.
// The ten digit cards are designed in Figma (page "LyricDock · Flip Clock", component set "Flip digit") and exported
// as SVG; D below holds each card's numeral path in the card's 300 x 440 space, and CARD is the exported card body
// (two halves, 2 px split, vertical gradients, a hairline of light on the top edge). scripts/flip-assets.mjs writes
// the same SVGs to design/flipclock/.
//
// How a flip works: each card has four layers - static top half (new digit), static bottom half (old), a top flap
// (old) that falls away and a bottom flap (new) that lands. Only the flaps move (transform + a shade overlay's
// opacity: no filters, cheap on old GPUs). Variants:
//   classic  fall 180 ms ease-in, land 200 ms ease-out, the falling flap darkens
//   bounce   the landing flap overshoots and settles
//   fold     slower, a sheen sweeps the flap and its shadow falls on the half below
//   cascade  units flip first, tens a beat later, hours after minutes (departure board)
//   roll     no split: the new digit rolls down over a drum
//   fade     a quiet crossfade
// Sound is synthesised (Web Audio, no files): a whoosh as the flap falls, a click as it lands; haptics at the landing.
const Flip = (() => {
  const $ = id => document.getElementById(id);
  const S = () => Settings.S;
  const D = {
    0: 'M150 92.9C196.5 92.9 215.1 127 215.1 173.5V266.5C215.1 313 196.5 347.1 150 347.1C103.5 347.1 84.9 313 84.9 266.5V173.5C84.9 127 103.5 92.9 150 92.9Z',
    1: 'M109.7 136.3L165.5 92.9V347.1',
    2: 'M88 158C88 114.6 115.9 92.9 150 92.9C187.2 92.9 212 117.7 212 154.9C212 192.1 193.4 213.8 159.3 247.9L91.1 323.85H221.3',
    3: 'M88 120.8C101.95 100.65 123.65 92.9 150 92.9C187.2 92.9 212 114.6 212 148.7C212 185.9 187.2 210.7 140.7 210.7C190.3 210.7 215.1 235.5 215.1 275.8C215.1 319.2 187.2 347.1 146.9 347.1C120.55 347.1 98.85 337.8 83.35 317.65',
    4: 'M187.2 347.1V92.9L84.9 269.6H230.6',
    5: 'M208.9 116.15H109.7L98.85 210.7C114.35 196.75 131.4 190.55 151.55 190.55C193.4 190.55 215.1 221.55 215.1 266.5C215.1 316.1 187.2 347.1 146.9 347.1C119 347.1 97.3 334.7 83.35 313',
    6: 'M199.6 114.6C187.2 100.65 170.15 92.9 150 92.9C106.6 92.9 84.9 133.2 84.9 204.5V263.4C84.9 316.1 109.7 347.1 150 347.1C190.3 347.1 215.1 316.1 215.1 269.6C215.1 226.2 190.3 198.3 150 198.3C115.9 198.3 91.1 220 84.9 247.9',
    7: 'M78.7 116.15H218.2L134.5 347.1',
    8: 'M150 210.7C115.9 210.7 95.75 189 95.75 151.8C95.75 114.6 119 92.9 150 92.9C181 92.9 204.25 114.6 204.25 151.8C204.25 189 184.1 210.7 150 210.7ZM150 210.7C109.7 210.7 84.9 235.5 84.9 278.9C84.9 319.2 112.8 347.1 150 347.1C187.2 347.1 215.1 319.2 215.1 278.9C215.1 235.5 190.3 210.7 150 210.7Z',
    9: 'M100.4 325.4C112.8 340.9 129.85 347.1 150 347.1C193.4 347.1 215.1 306.8 215.1 235.5V176.6C215.1 123.9 190.3 92.9 150 92.9C109.7 92.9 84.9 123.9 84.9 170.4C84.9 213.8 109.7 241.7 150 241.7C184.1 241.7 208.9 220 215.1 192.1',
  };
  // Gradients are defined once for the page (DEFS): repeating the ids inside every card made all cards re-resolve
  // them whenever a flip rewrote a card, which flashed.
  const DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="fcT" x1="0" y1="0" x2="0" y2="219" gradientUnits="userSpaceOnUse"><stop stop-color="#191919"/><stop offset="1" stop-color="#121212"/></linearGradient>'
    + '<linearGradient id="fcB" x1="0" y1="221" x2="0" y2="440" gradientUnits="userSpaceOnUse"><stop stop-color="#111"/><stop offset="1" stop-color="#0A0A0A"/></linearGradient></defs></svg>';
  const CARD = '<path d="M0 40C0 17.9 17.9 0 40 0H260C282.1 0 300 17.9 300 40V219H0V40Z" fill="url(#fcT)"/>'
    + '<path d="M0 221H300V400C300 422.1 282.1 440 260 440H40C17.9 440 0 422.1 0 400V221Z" fill="url(#fcB)"/>'
    + '<rect x="40" width="220" height="1" fill="#fff" fill-opacity=".06"/>';
  const card = (d, label) => `<svg class="fc-svg" viewBox="0 0 300 440" aria-hidden="true">${S().clockCards ? CARD : ''}`
    + `${D[d] ? `<path class="fc-num" transform="translate(150 220) scale(1.15) translate(-150 -220)" d="${D[d]}"/>` : ''}<rect y="218.5" width="300" height="3" fill="#000"/>${label ? `<text class="fc-ap" x="30" y="${label === 'PM' ? 412 : 62}">${label}</text>` : ''}</svg>`; // AM top-left, PM bottom-left
  // Fall: accelerates like gravity (the flap tips over its hinge). Land: fast, then decelerates onto the stop.
  const EASE = { in: 'cubic-bezier(.5,0,.85,.35)', out: 'cubic-bezier(.15,.75,.35,1)' };

  let root, groups = [], shown = false, secs = false, lastKey = '', tapT = 0;

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
  // fall / land: seconds from now when the (first) flap starts falling and when the (last) one lands.
  function sound(fall, land) {
    const kind = S().clockSound, v = S().clockVolume;
    if (kind === 'off' || v <= 0 || document.body.classList.contains('night')) return;
    if (kind === 'mechanical') {
      burst({ type: 'bandpass', f0: 900, f1: 2600, q: 0.8, vol: 0.18 * v, attack: 0.02, len: Math.max(0.05, land - fall), at: fall });
      burst({ type: 'highpass', f0: 3200, vol: 0.9 * v, len: 0.016, at: land });
      burst({ type: 'bandpass', f0: 1800, q: 2, vol: 0.35 * v, len: 0.03, at: land + 0.012 });
    } else if (kind === 'click') burst({ type: 'highpass', f0: 3500, vol: 0.8 * v, len: 0.014, at: land });
    else if (kind === 'whoosh') burst({ type: 'bandpass', f0: 500, f1: 3000, q: 0.7, vol: 0.3 * v, attack: 0.03, len: Math.max(0.05, land - fall) + 0.04, at: fall });
    else if (kind === 'soft') { burst({ type: 'lowpass', f0: 1200, vol: 0.5 * v, len: 0.04, at: land }); thump(0.35 * v, land); }
  }
  const haptic = at => { if (S().clockHaptic) setTimeout(() => { try { Dock.vibrate(12); } catch (e) {} }, at * 1000); };

  // ---- DOM: a group per unit (hours, minutes, seconds), a card per digit
  const cellHtml = (d, label) => { const f = card(d, label);
    return `<div class="fc-cell"><div class="fc-half top">${f}</div><div class="fc-half bot">${f}<b class="fc-drop"></b></div>`
      + `<div class="fc-flap top">${f}<b class="fc-shade"></b><b class="fc-sheen"></b></div><div class="fc-flap bot">${f}<b class="fc-shade"></b></div></div>`; };
  function parts() {
    const d = new Date(), h24 = S().clock24 === '24';
    let h = d.getHours();
    const ampm = h24 ? '' : h < 12 ? 'AM' : 'PM';
    if (!h24) h = h % 12 || 12;
    // 12-hour: a blank first card before single-digit hours (" 9"), so the layout never jumps.
    return { h: h24 ? String(h).padStart(2, '0') : String(h).padStart(2, ' '), m: String(d.getMinutes()).padStart(2, '0'), s: String(d.getSeconds()).padStart(2, '0'), ampm };
  }
  function build() {
    root = $('clockScreen');
    if (!document.getElementById('fcT')) document.body.insertAdjacentHTML('beforeend', DEFS);
    const v = parts(), units = secs ? ['h', 'm', 's'] : ['h', 'm'];
    root.querySelector('.fc-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'fc-wrap';
    wrap.innerHTML = units.map(u => `<div class="fc-group" data-u="${u}">${[...v[u]].map((d, i) => cellHtml(d, u === 'h' && i === 0 ? v.ampm : '')).join('')}</div>`).join('');
    root.prepend(wrap);
    groups = [...wrap.querySelectorAll('.fc-group')].map(el => ({ el, u: el.dataset.u, cells: [...el.querySelectorAll('.fc-cell')].map((c, i) => ({ el: c, d: v[el.dataset.u][i] })) }));
    layout();
  }
  // Card size: as big as the screen allows (groups side by side in landscape, stacked in portrait) x the size setting.
  function layout() {
    if (!root) return;
    const n = groups.length || 2, W = innerWidth, H = innerHeight, R = 440 / 300;
    const stacked = S().clockLayout === 'stacked' || (S().clockLayout === 'auto' && H > W);
    const inner = 0.05, sep = 0.3; // gap between a group's cards / between groups, in card widths
    const cw = stacked
      ? Math.min(W * 0.84 / (2 + inner), H * 0.9 / (n * R + (n - 1) * sep))
      : Math.min(W * 0.94 / (n * (2 + inner) + (n - 1) * sep), H * 0.8 / R);
    const st = root.style, k = S().clockScale;
    st.setProperty('--cw', `${cw * k}px`);
    st.setProperty('--ch', `${cw * R * k}px`);
    st.setProperty('--fc-dim', 1 - S().clockDim);
    root.classList.toggle('stacked', stacked);
  }

  // ---- flipping one card from its digit to d; returns seconds from now until it lands
  function flip(cell, d, label, delay) {
    const [top, bot, ft, fb] = cell.el.children, f = card(d, label);
    const anim = S().clockAnim, sp = 1 / (S().animSpeed || 1);
    ft.getAnimations().forEach(a => a.cancel()); fb.getAnimations().forEach(a => a.cancel());
    // Settle any flip still in flight first: the halves must show exactly the digit we are leaving (a cancelled
    // flip never ran its landing, which left a stale bottom half under the next flap - the jitter).
    const was = card(cell.d, label);
    bot.innerHTML = was + '<b class="fc-drop"></b>';
    ft.innerHTML = was + '<b class="fc-shade"></b><b class="fc-sheen"></b>'; // the old top half falls away
    fb.innerHTML = f + '<b class="fc-shade"></b>';
    top.innerHTML = f;
    cell.d = d;
    const T = { classic: [180, 200], bounce: [170, 420], fold: [300, 340], cascade: [160, 300], roll: [0, 420], fade: [0, 420] }[anim] || [180, 200];
    const fall = T[0] * sp, land = T[1] * sp, o = { fill: 'forwards' };
    if (anim === 'roll' || anim === 'fade') {
      ft.style.visibility = fb.style.visibility = 'hidden';
      bot.innerHTML = f + '<b class="fc-drop"></b>';
      const kf = anim === 'roll' ? [{ transform: 'translateY(-30%) rotateX(55deg)', opacity: 0 }, { transform: 'none', opacity: 1 }] : [{ opacity: 0 }, { opacity: 1 }];
      for (const h of [top, bot]) h.firstElementChild?.animate(kf, { duration: land, delay, easing: EASE.out, fill: 'backwards' });
      return (delay + land) / 1000;
    }
    ft.style.visibility = fb.style.visibility = 'visible';
    // Edge-on (+-90deg) a flap still renders as a 1px line across the split: fade the falling flap out on its last
    // frame and keep the landing flap invisible until it starts moving.
    fb.style.transform = 'rotateX(90deg)';
    fb.style.opacity = '0';
    ft.animate([{ transform: 'rotateX(0)', opacity: 1 }, { transform: 'rotateX(-88deg)', opacity: 1, offset: 0.97 }, { transform: 'rotateX(-90deg)', opacity: 0 }], { duration: fall, delay, easing: EASE.in, ...o });
    ft.querySelector('.fc-shade').animate([{ opacity: 0 }, { opacity: 0.6 }], { duration: fall, delay, easing: EASE.in, ...o });
    // The falling flap's shadow on the old bottom half, strongest just before the new flap covers it.
    bot.querySelector('.fc-drop')?.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: fall, delay, easing: EASE.in, fill: 'none' });
    if (anim === 'fold') {
      ft.querySelector('.fc-sheen').animate([{ opacity: 0, transform: 'translateY(-60%)' }, { opacity: 0.5, transform: 'translateY(40%)' }], { duration: fall, delay, easing: 'linear', ...o });
      bot.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: fall + land, delay, easing: 'ease-in-out' });
    }
    const springy = anim === 'bounce' || anim === 'cascade';
    const kf = springy
      ? [{ transform: 'rotateX(90deg)', opacity: 0 }, { transform: 'rotateX(88deg)', opacity: 1, offset: 0.02 }, { transform: 'rotateX(-12deg)', opacity: 1, offset: 0.62 }, { transform: 'rotateX(5deg)', opacity: 1, offset: 0.82 }, { transform: 'rotateX(0)', opacity: 1 }]
      : [{ transform: 'rotateX(90deg)', opacity: 0 }, { transform: 'rotateX(88deg)', opacity: 1, offset: 0.02 }, { transform: 'rotateX(-3deg)', opacity: 1, offset: 0.8 }, { transform: 'rotateX(0)', opacity: 1 }]; // a tiny settle, like a real flap hitting the stop
    fb.animate(kf, { duration: land, delay: delay + fall, easing: springy ? 'ease-out' : EASE.out, ...o }).onfinish = () => {
      bot.innerHTML = f + '<b class="fc-drop"></b>'; ft.style.visibility = fb.style.visibility = 'hidden'; fb.style.opacity = '';
    };
    fb.querySelector('.fc-shade').animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: land, delay: delay + fall, easing: EASE.out, ...o });
    return (delay + fall + (springy ? land * 0.62 : land)) / 1000;
  }

  // 4x a second: flip whatever changed (flips land on the second, not up to 1s late).
  function tick() {
    if (!shown) return;
    const v = parts(), key = `${v.h}${v.m}${secs ? v.s : ''}${v.ampm}`;
    if (key === lastKey) return;
    const first = !lastKey;
    lastKey = key;
    if (first) return;
    const cascade = S().clockAnim === 'cascade';
    let landAt = -1, fallAt = 0, n = 0, big = false;
    // Right to left (seconds before minutes before hours, units before tens): the order a real flip clock turns.
    for (const g of [...groups].reverse()) {
      for (let i = g.cells.length - 1; i >= 0; i--) {
        const cell = g.cells[i], d = v[g.u][i];
        if (d === undefined || d === cell.d) continue;
        const delay = cascade ? n * 110 : n * 35;
        if (g.u !== 's') big = true;
        const l = flip(cell, d, g.u === 'h' && i === 0 ? v.ampm : '', delay);
        if (landAt < 0) fallAt = delay / 1000;
        landAt = Math.max(landAt, l);
        n++;
      }
    }
    if (landAt >= 0 && (!secs || S().clockSoundEvery === 'all' || big)) { sound(fallAt, landAt); haptic(landAt); }
  }

  function show() {
    if (shown) return;
    shown = true;
    secs = S().clockSeconds;
    lastKey = '';
    build();
    tick();
  }
  function hide() { shown = false; }
  // Tap: seconds on / off (Fliqlo). Double tap: back to the lyrics.
  function onTap() {
    const now = performance.now();
    if (now - tapT < 320) { tapT = 0; return 'dismiss'; }
    tapT = now;
    setTimeout(() => { if (tapT === now) { secs = !secs; Settings.set('clockSeconds', secs, false); lastKey = ''; build(); tick(); } }, 330);
    return null;
  }
  addEventListener('resize', layout);
  setInterval(tick, 250);
  return { show, hide, onTap, rebuild: () => { if (shown) { lastKey = ''; build(); tick(); } }, layout, digits: D, cardSvg: CARD };
})();
