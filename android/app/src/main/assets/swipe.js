// Cover swipe. Only the cover (Default / TV view / Cover + clock) or the song card (Player card, Compact, Cinema, Now Bar)
// changes songs - a sideways drag anywhere else does nothing, so scrolling or resting a hand never skips.
//  - The cover follows the finger 1:1 on a strip of cards: up to 3 next songs on the right, 3 previous on the left
//    (next = the preloaded song + the queue, previous = what this phone showed). Drag further to reach further;
//    the card nearest the middle is the one that plays, and it is drawn a little brighter.
//  - A tab slides in from the screen edge (like Android's back gesture, but big): "Next" / "Previous", +2 / +3 when
//    reaching further, the song's name, and it turns solid white (with a tick of vibration) once letting go commits.
//  - Let go: the strip carries on at the finger's speed and the chosen card lands exactly where the cover was; the
//    cover takes its image in the same frame and title, lyrics and colours switch with it. Covers leaving the middle
//    shrink and fade as they go, so nothing is left hanging. Let go early and it springs back.
//  - A new touch while a swipe is still settling finishes that one at once (same end state), then starts fresh, so
//    quick left-right-left swipes never mix covers. Commands go out in order (app.js swipeTo), and the songs a swipe
//    passes through never reach the screen.
//  - A tap on the cover shows / hides the controls; a double tap likes the song (with the heart burst); a swipe up
//    plays / pauses.
(() => {
  const $ = id => document.getElementById(id), body = document.body, S = Settings.S;
  const COVER = ['split', 'tv', 'clocksplit'], CARD = ['player', 'compact', 'cinema', 'nowbar'];
  const coverMode = () => COVER.includes(S.layout);
  const zone = () => coverMode() ? $('artbox') : CARD.includes(S.layout) ? (S.layout === 'player' ? $('meta') : $('left')) : null;
  const artEl = $('art'), box = $('artbox');
  const url = u => u ? `url("${u}")` : 'none';
  const log = (...a) => window.__swlog?.push(a.join(' ')); // dev trace: set window.__swlog = [] over CDP
  const buzz = () => { try { Dock.vibrate(30); } catch (e) {} }; // under ~30 ms the M01's motor isn't felt

  const peeks = [0, 1, 2].map(() => { const d = document.createElement('div'); d.className = 'art-peek'; box.append(d); return d; });
  const cue = document.createElement('div');
  cue.id = 'swipeCue';
  cue.innerHTML = '<div class="sc-tab"><svg viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg><span class="sc-word"></span><b class="sc-n"></b></div><div class="sc-name"></div>';
  body.append(cue);
  const cueTab = cue.firstChild, cueWord = cue.querySelector('.sc-word'), cueN = cue.querySelector('.sc-n'), cueName = cue.querySelector('.sc-name');

  let g = null;      // the gesture in progress
  let run = null;    // the settle animation in progress: { raf, finish }
  let tapT = 0, lastTapAt = 0;

  const scaleOf = el => { const t = getComputedStyle(el).transform; return t && t !== 'none' ? Math.hypot(...new DOMMatrix(t).toFloat32Array().slice(0, 2)) : 1; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function begin(t, z) {
    const cov = coverMode(), w = cov ? artEl.offsetWidth : z.offsetWidth;
    const step = cov ? w * 1.08 : Math.max(110, Math.min(w * 0.55, innerWidth * 0.3));
    const m = cov ? getComputedStyle(artEl).transform : 'none';
    g = { x0: t.clientX, y0: t.clientY, t0: performance.now(), on: false, x: 0, v: 0, lx: t.clientX, ly: t.clientY, lt: performance.now(), z, cov, w, step,
      next: [], prev: [], base: m && m !== 'none' ? m + ' ' : '', s0: cov ? scaleOf(artEl) : 1, side: 0, k: 0 };
  }
  // how far each side can reach: the songs we know (1 unknown one is allowed: it lands empty and Spotify fills it in)
  const depth = side => Math.min(3, Math.max(1, (side > 0 ? g.next : g.prev).length));
  const target = (side, k) => (side > 0 ? g.next : g.prev)[k - 1] || null;
  // rubber band past the last song on that side
  const band = x => { const lim = depth(x < 0 ? 1 : -1) * g.step, a = Math.abs(x); return a <= lim ? x : Math.sign(x) * (lim + (a - lim) * 0.22); };
  // the card that would play if the finger let go now: nothing before 32 % of a card, then the nearest one
  const aim = x => { const a = Math.abs(x) / g.step, side = x < 0 ? 1 : -1; return a < 0.32 ? 0 : side * clamp(Math.round(a), 1, depth(side)); };

  function fillPeeks(side) {
    if (!g.cov || g.side === side) return;
    g.side = side;
    const list = side > 0 ? g.next : g.prev;
    peeks.forEach((p, i) => { const a = list[i]?.art || ''; if (p.dataset.u !== a) { p.dataset.u = a; p.style.backgroundImage = url(a); } p.classList.toggle('blank', !a); });
  }

  // Draw the strip at offset x (px, negative = towards next).
  function render(x, k) {
    if (g.cov) {
      const side = x < 0 ? 1 : x > 0 ? -1 : g.side || 1;
      fillPeeks(side);
      const card = (el, X, lit) => {
        const p = Math.min(2, Math.abs(X) / g.step);
        const sc = 1 - Math.min(1, p) * 0.1, op = Math.max(0, 1 - p * 0.55 - Math.max(0, p - 1) * 0.6) * (lit ? 1 : 0.92);
        el.style.transform = `${g.base}translateX(${X / g.s0}px) rotate(${X / g.w * 2.5}deg) scale(${sc})`;
        el.style.opacity = op.toFixed(3);
      };
      card(artEl, x, k === 0);
      peeks.forEach((p, i) => { const n = i + 1; if (n > depth(side)) { p.style.opacity = '0'; return; } card(p, side * n * g.step + x, Math.abs(k) === n && Math.sign(k) === side); });
    } else {
      g.z.style.transform = `translateX(${x * 0.35}px)`;
      g.z.style.opacity = (1 - Math.min(0.45, Math.abs(x) / g.step * 0.3)).toFixed(3);
    }
    showCue(x, k);
  }

  function showCue(x, k) {
    const side = x < 0 ? 1 : -1, p = clamp(Math.abs(x) / (g.step * 0.32), 0, 1);
    if (Math.abs(x) < 4) { cue.className = ''; return; }
    const r = g.z.getBoundingClientRect();
    cue.className = `on ${side > 0 ? 'right' : 'left'}${k ? ' armed' : ''}`;
    cue.style.top = `${Math.round(clamp(r.top + r.height / 2, 60, innerHeight - 60))}px`;
    cue.style.setProperty('--p', p.toFixed(3));
    cueWord.textContent = side > 0 ? 'Next' : 'Previous';
    cueN.textContent = Math.abs(k) > 1 ? `+${Math.abs(k)}` : '';
    const t = k ? target(side, Math.abs(k)) : null;
    cueName.textContent = t?.title || '';
    if (k !== g.k) { if (Math.abs(k) > Math.abs(g.k)) buzz(); g.k = k; }
  }

  function reset() {
    for (const el of [artEl, ...peeks]) { el.style.transform = ''; el.style.opacity = ''; }
    if (g?.z && !g.cov) { g.z.style.transform = ''; g.z.style.opacity = ''; g.z.style.transition = ''; }
    cue.className = '';
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('art-dragging')));
  }

  // meta + lyrics step back while the strip settles, and come in with the new song - back to whatever the page wants
  // them at (the title is hidden while the controls are up, the lyrics dimmed behind a centred pill), never past it.
  const others = () => [$('meta'), $('lyrics')].filter(Boolean);
  let dims = [];
  const dim = d => { dims = others().map(el => { const o = +getComputedStyle(el).opacity; return el.animate([{ opacity: o }, { opacity: Math.min(o, 0.12) }], { duration: d, easing: 'ease-in', fill: 'forwards' }); }); };
  const undim = () => {
    const from = others().map(el => +getComputedStyle(el).opacity);
    dims.forEach(a => a.cancel()); dims = [];
    others().forEach((el, i) => { const to = +getComputedStyle(el).opacity; if (Math.abs(to - from[i]) > 0.01) el.animate([{ opacity: from[i] }, { opacity: to }], { duration: ms(320), easing: 'cubic-bezier(.2,.8,.2,1)' }); });
  };

  // Settle from the current offset to the chosen card (k) - or back to the middle (k = 0).
  function settle(k) {
    const s = g, from = s.x, to = s.cov ? -k * s.step : 0, dist = Math.abs(to - from), v = Math.max(Math.abs(s.v), 0.6);
    // an ease-out starts at 3x its average speed: pick the time that makes that the release speed
    const d = ms(k ? clamp(3 * dist / v, 200, 420) : 380), t0 = performance.now();
    const ease = k ? (t => 1 - Math.pow(1 - t, 3)) : (t => { const c = 1.25; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }); // back: a tiny overshoot
    let song = null;
    if (k) { song = window.swipeTo?.(k) ?? null; dim(d * 0.7); }
    const done = () => {
      run = null;
      if (k) land(k, song, s); else reset();
      g = null;
    };
    const frame = now => {
      const t = Math.min(1, (now - t0) / d), x = from + (to - from) * ease(t);
      s.x = x; render(x, k);
      if (t < 1) run.raf = requestAnimationFrame(frame); else done();
    };
    if (!s.cov && k) cue.classList.add('armed');
    run = { raf: requestAnimationFrame(frame), finish: () => { cancelAnimationFrame(run.raf); s.x = to; render(to, k); done(); } };
  }

  // The chosen card is exactly where the cover was: hand over in one frame.
  function land(k, song, s) {
    if (s.cov) {
      artEl.style.backgroundImage = url(song?.art);
      artEl.classList.toggle('art-wait', !song);
    }
    reset();
    if (song) window.swipeLand?.(song);
    undim();
  }

  const blocked = e => e.target.closest?.('button, input, select, a, #ctl, #tl, #deck');
  addEventListener('touchstart', e => {
    const z = zone();
    log('start', z?.id, e.target.id || e.target.className, !!run);
    // (Settings -> Swipe the cover to skip only turns the sideways swipe off: taps and the swipe up still work.)
    if (!z || document.body.classList.contains('clock') || e.touches.length !== 1 || !z.contains(e.target) || blocked(e)) {
      if (e.touches.length > 1 && g?.on) { if (g.up) upEnd(false); else { g.x = 0; settle(0); } }
      return;
    }
    if (run) run.finish(); // a swipe still settling: finish it now, then this touch starts a fresh one
    begin(e.touches[0], z);
  }, { capture: true, passive: true });

  // Swipe up on the cover (or the song card): play / pause. It lifts with the finger on a rubber band, ticks once letting
  // go would toggle, and on release glides back into its new pose (the paused shrink) while the play / pause pulse runs.
  const LIFT = 9; // vmin: the most it rises
  const upEl = () => g.cov ? artEl : g.z;
  function upMove(dy) {
    const most = LIFT * Math.min(innerWidth, innerHeight) / 100, y = -most * (1 - Math.exp(Math.min(0, dy) / (most * 1.6)));
    upEl().style.transform = `${g.base}translateY(${(y / g.s0).toFixed(2)}px)`;
    const armed = dy < -most * 1.25 || (dy < -most * 0.5 && g.v < -0.6); // ~11 vmin, or a flick
    if (armed !== !!g.armed) { g.armed = armed; if (armed) buzz(); }
  }
  function upEnd(go) {
    const el = upEl(), last = el.style.transform;
    if (go) $('pp').onclick(); // same path as the button: optimistic state, the pulse, the command
    reset(); g = null;
    // offset 0: FROM the lifted pose to wherever CSS now puts it. A lone keyframe is the END of an animation - the cover
    // jumped to its new pose, rose back to the lifted one and snapped down again (two moves for one swipe).
    if (last) el.animate([{ transform: last, offset: 0 }], { duration: ms(520), easing: 'cubic-bezier(.34,1.45,.64,1)' });
  }

  addEventListener('touchmove', e => {
    if (!g || run || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.on) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ay > 12 && ay > ax) { if (dy > 0) { g = null; return; } g.up = true; } // down: not ours; up: play / pause
      else if (ax < 10 || ax < ay * 1.3) return;
      else if (!S.swipe) { g = null; return; }
      if (!Gesture.claim('cover')) { g = null; return; }
      g.on = true; g.x0 = t.clientX; g.y0 = t.clientY; // start from here: no jump by the distance it took to decide
      if (!g.up) { // read the neighbours now, not on finger-down: a swipe finished by this touch has swapped the song since
        const nb = window.neighbours?.() || { next: [], prev: [] }; g.next = nb.next; g.prev = nb.prev;
      }
      if (g.cov) { const m = getComputedStyle(artEl).transform; g.base = m && m !== 'none' ? m + ' ' : ''; g.s0 = scaleOf(artEl); }
      if (g.cov) body.classList.add('art-dragging');
      else g.z.style.transition = 'none'; // #left eases its transform (clock view): the drag must follow the finger 1:1
      clearTimeout(tapT); tapT = 0;
    }
    const now = performance.now();
    if (g.up) { g.v = g.v * 0.4 + 0.6 * (t.clientY - g.ly) / Math.max(1, now - g.lt); g.ly = t.clientY; g.lt = now; return upMove(t.clientY - g.y0); }
    g.v = g.v * 0.4 + 0.6 * (t.clientX - g.lx) / Math.max(1, now - g.lt); g.lx = t.clientX; g.lt = now;
    g.x = band(t.clientX - g.x0);
    render(g.x, aim(g.x));
  }, { capture: true, passive: true });

  addEventListener('touchend', e => {
    log('end', !!g, !!run, g?.on, g && Math.round(g.x), g && g.v.toFixed(2));
    if (!g || run || e.touches.length) return;
    const s = g, t = e.changedTouches[0];
    if (!s.on) { g = null; if (s.cov && s.z.contains(e.target)) tap(t, s); return; }
    if (s.up) return upEnd(!!s.armed);
    // where it would end up at this speed; a flick counts even when short, a flick back cancels
    let k = aim(band(s.x + s.v * 130));
    const flick = Math.abs(s.v) > 0.5 && Math.abs(s.x) > s.step * 0.06;
    if (flick && Math.sign(s.v) !== Math.sign(s.x)) k = 0;
    else if (flick && !k) k = s.x < 0 ? 1 : -1;
    settle(k);
  }, { capture: true, passive: true });
  addEventListener('touchcancel', () => { if (g?.up && g.on) upEnd(false); else if (g?.on && !run) settle(0); else if (!run) g = null; }, { capture: true, passive: true });

  // A tap on the cover: show / hide the controls - a double tap likes instead (the first tap waits a moment for it).
  function tap(t, s) {
    log('tap', Gesture.tap(), Math.round(t.clientX - s.x0), Math.round(t.clientY - s.y0), Math.round(performance.now() - s.t0), !!tapT);
    if (!Gesture.tap() || Math.abs(t.clientX - s.x0) > 12 || Math.abs(t.clientY - s.y0) > 12 || performance.now() - s.t0 > 350) return;
    const toggle = () => window.showUi(!body.classList.contains('ui'));
    if (!(S.doubleTapLike && S.showLiked)) return toggle();
    const now = performance.now();
    if (tapT && now - lastTapAt < 320) { clearTimeout(tapT); tapT = 0; window.likeTap?.(t.clientX, t.clientY); return; }
    lastTapAt = now;
    tapT = setTimeout(() => { tapT = 0; toggle(); }, 300);
  }
})();
