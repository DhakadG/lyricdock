// Extras on top of app.js: marquee titles, album line, like badge, gestures (swipe / double-tap / long-press scrub),
// shuffle + repeat, up-next chip, source badge, fonts, clock screen, night mode, burn-in shift, battery, keep-awake,
// queue / recently played / library / friends panel, and the settings live preview.
// app.js calls the window.after* hooks; everything here reads Settings.S (S) and the playback state (P).
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtT = t => { t = Math.max(0, t) / 1000 | 0; return `${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`; };
  // control() (app.js), not Web.control: the miniplayer's copy must hand commands to the main copy - its own Web never
  // polls, so a toggle there (shuffle) read a blank state and could only ever switch on.
  const cmdOf = (c, extra = {}) => (P.source === 'web' ? control(c, 'ms' in extra ? extra.ms : 'v' in extra ? extra.v : extra) : send({ type: 'cmd', cmd: c, ...extra }));

  // ---- marquee: only text that does not fit scrolls, back and forth, with soft edges.
  function marquee(el) {
    const text = el.textContent;
    el.classList.remove('mq-on');
    el.innerHTML = `<span class="mq-in">${esc(text)}</span>`;
    if (!S.marquee) return;
    requestAnimationFrame(() => {
      const over = el.firstChild.scrollWidth - el.clientWidth;
      if (over < 3) return;
      el.style.setProperty('--mq', `${-over}px`);
      el.style.setProperty('--mqd', `${Math.max(6, over / 22 + 4).toFixed(1)}s`);
      el.classList.add('mq-on');
    });
  }
  const remarquee = () => ['title', 'artist', 'album'].forEach(id => marquee($(id)));

  // ---- track details: album · year, source badge, heart placement.
  const albums = new Map();
  function albumLine() {
    const a = albums.get(P.id) || {};
    $('album').textContent = S.albumLine ? [a.album || P.album, a.year].filter(Boolean).join(' · ') : '';
    marquee($('album'));
  }
  window.afterSwap = m => { fitArt(); document.documentElement.style.setProperty('--artimg', m.art ? `url("${m.art}")` : 'none'); P.album = m.album; if (P.next?.id === m.id) P.next = null; if (P.next2?.id === m.id) P.next2 = null; /* the bridge's preloads for the new song may already be here */ remarquee(); albumLine(); badge(); hideChip(); };
  window.afterPreload = m => { if (m.ahead === 2) P.next2 = m; else P.next = m; }; // ahead: 1 = next, 2 = the one after
  // Cover + title in the left column (Default / TV, landscape): the column is padded clear of the song times and
  // progress bar, and the cover is capped so cover + title + artist + album always fit between them.
  window.fitArt = () => requestAnimationFrame(() => {
    const st = document.documentElement.style, on = innerWidth > innerHeight && ['split', 'tv'].includes(S.layout);
    document.body.classList.toggle('fit-art', on);
    if (!on) return;
    // Auto margins (style.css) split the spare height evenly: above the cover, above the title block, below it. The empty
    // room the timeline leaves under itself is mirrored under the title block, so the gaps look equal, not just measure it.
    const vm = Math.min(innerWidth, innerHeight) / 100, pt = 2 * vm, gap = 3.5 * vm, meta = $('meta');
    // (getClientRects, not offsetParent: both are position: fixed)
    const low = [$('times'), $('bar')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect().top).filter(y => y > innerHeight / 2);
    const bottom = Math.min(innerHeight, ...low);
    const hasTl = $('tl').getClientRects().length;
    const tl = hasTl ? parseFloat(getComputedStyle($('artbox')).marginBottom) || 0 : 0; // the bar + times under the cover
    // offsets, not rects: with the controls up the timeline is moved by a transform
    const slack = hasTl ? Math.max(0, tl - ($('tl').offsetTop + $('tl').offsetHeight - $('art').offsetHeight)) : 0;
    const a = Math.max(0, gap - slack);
    st.setProperty('--left-pt', `${pt}px`);
    st.setProperty('--left-pb', `${innerHeight - bottom + slack}px`);
    st.setProperty('--art-max', `${Math.max(80, bottom - pt - tl - meta.offsetHeight - slack - 3 * a)}px`);
  });
  addEventListener('resize', fitArt);
  Settings.onChange(() => fitArt());
  function badge() {
    const src = P.lyrics?.source;
    $('srcBadge').textContent = S.sourceBadge && src ? src : '';
    $('srcBadge').classList.toggle('show', !!(S.sourceBadge && src));
    placeTags();
  }
  // Tags (quality, lyrics source): a quiet row under the album line where the layout has a title block, otherwise in the
  // top-left corner (dim; only while the controls are up unless Tag position says Corner).
  // Now playing (title, artist, album) holds song information only; the lyrics source is a quiet line in the top-left corner,
  // shown with the controls or all the time (Tag position). The credits at the end of the lyrics always name it too.
  function placeTags() {
    const t = $('tags');
    if (t.parentNode !== document.body) document.body.appendChild(t);
    document.body.classList.toggle('tags-corner', S.tagPos === 'corner');
    t.style.display = $('srcBadge').classList.contains('show') ? '' : 'none';
  }
  // The Lossless waveform: beside the song length under the cover when that bar is on screen, else in the status corner.
  function placeQw() {
    const q = $('qw'), inTl = S.qualityIcon === 'wave' && getComputedStyle($('tl')).display !== 'none', home = inTl ? $('tl') : $('stat');
    if (q.parentNode !== home) inTl ? home.appendChild(q) : home.prepend(q);
    const need = document.body.classList.contains('q-lossless') && S.showQuality && (S.qualityIcon === 'status' || (S.qualityIcon === 'wave' && !inTl));
    $('stat').classList.toggle('qshow', need);
  }
  window.qualityChanged = () => placeQw();
  function placeHeart() {
    const h = $('heart'), onArt = S.heartPos === 'art' && !['player', 'lyrics', 'nowbar'].includes(S.layout); // no big cover there / the Now Bar cover spins
    (onArt ? $('art') : $('titlerow')).appendChild(h);
    h.classList.toggle('badge', onArt);
  }

  // ---- shuffle / repeat state (from the bridge beat or the Web API poll)
  // After a tap, beats already in flight still carry the old mode: ignored for a moment so the button doesn't flick back.
  window.afterPos = m => {
    const locked = performance.now() < (P.modeLock || 0);
    if (typeof m.shuffle === 'boolean' && !locked) { P.shuffle = m.shuffle; $('shuf').classList.toggle('on', m.shuffle); }
    if (Number.isFinite(m.repeat) && !locked) { P.repeat = m.repeat; $('rep').classList.toggle('on', m.repeat > 0); $('rep').classList.toggle('one', m.repeat === 2); }
    lastPlayAt = m.playing ? Date.now() : lastPlayAt;
  };
  $('shuf').onclick = () => { P.modeLock = performance.now() + 1500; P.shuffle = $('shuf').classList.toggle('on'); cmdOf('shuffle'); };
  $('rep').onclick = () => { P.modeLock = performance.now() + 1500; const n = ((P.repeat || 0) + 1) % 3; P.repeat = n; $('rep').classList.toggle('on', n > 0); $('rep').classList.toggle('one', n === 2); cmdOf('repeat', { v: n }); };

  // ---- gestures: double-tap to like, long-press the progress bar to scrub (changing songs by swiping: swipe.js,
  // on the cover / song card only - a sideways drag anywhere else does nothing)
  const interactive = e => e.target.closest?.('button, input, #settings, #listPanel, #bar, #tl, #qs, #qpanel, #pairAsk, #setup, #news, #installChip, a');
  // Touch events, not pointer events: the WebView fires pointercancel as soon as it takes a drag for a pan.
  let down = null, lastTap = 0;
  // While the clock is up it owns every tap (seconds, double-tap to leave): no double-tap like.
  const clockUp = () => document.body.classList.contains('clock');
  const coverLayouts = ['split', 'tv', 'clocksplit'];
  addEventListener('touchstart', e => {
    const t = e.touches[0];
    if (clockUp()) { down = null; return; }
    const onCover = coverLayouts.includes(S.layout) && e.target.closest?.('#artbox');
    down = e.touches.length !== 1 || interactive(e) ? null : { x: t.clientX, y: t.clientY, t: performance.now(), cover: onCover };
  }, { capture: true, passive: true });
  addEventListener('touchend', e => {
    if (!down || e.touches.length) { down = null; return; }
    const t = e.changedTouches[0], dt = performance.now() - down.t, d0 = down;
    down = null;
    // Double-tap to like: two real taps, not on a lyric line (a line tap seeks) and not on the cover (swipe.js has its own).
    const onLine = S.tapSeek && e.target.closest?.('#lyrics:not(.static) .ln');
    if (Gesture.tap() && dt < 300 && !onLine && !d0.cover) {
      const now2 = performance.now();
      if (S.doubleTapLike && S.showLiked && now2 - lastTap < 320) { likeTap(t.clientX, t.clientY); lastTap = 0; }
      else lastTap = now2;
    } else lastTap = 0;
  }, { capture: true, passive: true });

  // Mouse / trackpad: a double-click likes (touch has its own double tap above and in swipe.js).
  addEventListener('dblclick', e => {
    if (Gesture.touch() || clockUp() || interactive(e) || !S.doubleTapLike || !S.showLiked || e.target.closest?.('#lyrics .ln')) return;
    likeTap(e.clientX, e.clientY);
  });

  // ---- four-finger swipe switches layouts (with a notice naming it): up / down in landscape (next / previous),
  // left / right in portrait. Four, not three: many phones take a three-finger swipe for screenshots. While more
  // than one finger is down, single-finger gestures (lyrics scroll, taps, cover swipe) stand down.
  let quad = null;
  const mid = ts => [...ts].reduce((a, t) => ({ x: a.x + t.clientX / ts.length, y: a.y + t.clientY / ts.length }), { x: 0, y: 0 });
  addEventListener('touchstart', e => {
    if (e.touches.length === 4) { const m = mid(e.touches); quad = { x: m.x, y: m.y, dx: 0, dy: 0, t: performance.now() }; }
  }, { capture: true, passive: true });
  addEventListener('touchmove', e => { if (quad && e.touches.length === 4) { const m = mid(e.touches); quad.dx = m.x - quad.x; quad.dy = m.y - quad.y; } }, { capture: true, passive: true });
  addEventListener('touchend', e => {
    if (!quad || e.touches.length) return;
    const s = quad; quad = null;
    const land = innerWidth > innerHeight, main = land ? s.dy : s.dx, cross = land ? s.dx : s.dy;
    if (Math.abs(main) < 50 || Math.abs(main) < Math.abs(cross) * 1.2 || performance.now() - s.t > 1200) return;
    if (!Gesture.claim('layout') && Gesture.owner() !== 'layout') return;
    const opts = Settings.schema().find(x => x.k === 'layout')?.opts || [];
    const i = opts.findIndex(([v]) => v === S.layout), next = opts[(i + (main < 0 ? 1 : -1) + opts.length) % opts.length];
    if (!next) return;
    Settings.set('layout', next[0]);
    window.notice?.(`Layout: ${next[1]}`, 1400);
  }, { capture: true, passive: true });

  // Double tap / double-click: the heart's own handler, called directly. A synthetic click would also reach app.js's tap
  // handler and pop the controls up (the cover shrinking under the heart burst). Unliking bursts a hollow heart.
  const likeTap = window.likeTap = (x, y) => { $('heart').onclick(); heartBurst(x, y, P.liked); }; // swipe.js: double tap on the cover
  function heartBurst(x, y, on) {
    const b = document.createElement('div');
    b.className = on ? 'burst' : 'burst off';
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    b.innerHTML = $('heart').querySelector('svg').outerHTML;
    document.body.append(b);
    b.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: .35 },
      { transform: 'translate(-50%,-80%) scale(1)', opacity: 0 }], { duration: ms(900), easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => b.remove();
  }
  // Long-press (350ms) on the progress bar: drag to scrub with a time bubble, release to seek.
  let scrub = null;
  $('bar').addEventListener('pointerdown', e => {
    const x0 = e.clientX, y0 = e.clientY;
    const t = setTimeout(() => { if (!Gesture.claim('scrub')) return; scrub = { id: e.pointerId }; $('bar').setPointerCapture(e.pointerId); document.body.classList.add('scrubbing'); move(e); }, 350);
    const cancel = () => clearTimeout(t);
    const drift = m => { if (!scrub && Math.hypot(m.clientX - x0, m.clientY - y0) > 10) { cancel(); $('bar').removeEventListener('pointermove', drift); } };
    $('bar').addEventListener('pointermove', drift);
    $('bar').addEventListener('pointerup', cancel, { once: true });
    $('bar').addEventListener('pointercancel', cancel, { once: true });
  });
  const frac = e => Math.min(1, Math.max(0, e.clientX / innerWidth));
  function move(e) { if (!scrub) return; const f = frac(e); $('bar').style.setProperty('--scrub', f); $('bar').dataset.time = fmtT(f * P.dur); }
  $('bar').addEventListener('pointermove', move);
  // seek() (app.js), like the timeline: beats still carrying the old position are ignored for a moment, so the bar doesn't jump back.
  $('bar').addEventListener('pointerup', e => { if (!scrub) return; scrub = null; setTimeout(() => document.body.classList.remove('scrubbing'), 0); seek(Math.round(frac(e) * P.dur)); });

  // ---- up-next chip
  function hideChip() { $('nextChip').classList.remove('show'); }
  // ---- fonts (Google Fonts, cached by the WebView after the first load)
  const loaded = new Set();
  function applyFont() {
    const f = S.font;
    if (f !== 'system' && !loaded.has(f)) {
      loaded.add(f);
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}:wght@400;500;600;700;800;900&display=swap`;
      document.head.append(l);
    }
    document.documentElement.style.setProperty('--font', f === 'system' ? 'system-ui' : `"${f}"`);
    setTimeout(remarquee, 600);
  }

  // ---- screen: clock, night, burn-in, battery, keep-awake (checked every second)
  let lastPlayAt = Date.now(), clockDismissedAt = 0, shift = 0;
  const call = (fn, ...a) => { try { return Dock[fn](...a); } catch (e) { return null; } };
  // Flip clock: tap toggles seconds, double tap goes back to the lyrics (the simple clock: any tap goes back).
  // In the Flip clock layout a double tap goes back to the layout used before it (Default if none this session).
  let layoutBeforeClock = 'split';
  // Long press (0.6 s) on the flip clock: swap the card colour (the cards flip over). The click after it is ignored.
  let lp = null, lpAt = 0;
  $('clockScreen').addEventListener('touchstart', e => {
    clearTimeout(lp?.timer); lp = null;
    if (e.touches.length !== 1 || !$('clockScreen').classList.contains('flip')) return;
    const t = e.touches[0];
    lp = { x: t.clientX, y: t.clientY, timer: setTimeout(() => {
      lpAt = performance.now();
      window.notice?.(Flip.toggleTheme() === 'light' ? 'Light cards' : 'Dark cards', 1400);
      call('vibrate', 30);
    }, 600) };
  }, { passive: true });
  $('clockScreen').addEventListener('touchmove', e => { const t = e.touches[0]; if (lp && Math.hypot(t.clientX - lp.x, t.clientY - lp.y) > 12) clearTimeout(lp.timer); }, { passive: true });
  $('clockScreen').addEventListener('touchend', () => clearTimeout(lp?.timer), { passive: true });
  // Mouse / trackpad: a right-click (two-finger click) swaps the colour, like the long press.
  $('clockScreen').addEventListener('contextmenu', e => {
    if (!$('clockScreen').classList.contains('flip')) return;
    e.preventDefault();
    window.notice?.(Flip.toggleTheme() === 'light' ? 'Light cards' : 'Dark cards', 1400);
  });
  $('clockScreen').onclick = () => {
    if (performance.now() - lpAt < 800) return;
    if (S.layout === 'clock') { if (Flip.onTap() === 'dismiss') { clockDismissedAt = Date.now(); Settings.set('layout', layoutBeforeClock); } return; }
    if (S.clockStyle === 'flip' && Flip.onTap() !== 'dismiss') return;
    clockDismissedAt = Date.now(); setClock(false);
  };
  // Clock <-> song view as one motion: entering, the song view sinks back while the clock fades up and its cards
  // flip from blank to the time; leaving, the cards flip back to blank first, then the song view rises in.
  let clockOn = false, clockBusy = null;
  function setClock(on) {
    if (on === clockOn) return;
    clockOn = on;
    const b = document.body;
    const flip = S.clockStyle === 'flip';
    if (on) { b.classList.add('clock'); if (flip) { Flip.mount($('clockScreen')); Flip.show(); } window.notice?.('Double-tap to go back · hold to change colour', 2200); return; }
    const go = () => { if (!clockOn) b.classList.remove('clock'); };
    if (flip && Flip.isShown()) { clockBusy = Flip.leave().then(go); } else go();
  }
  function everySecond() {
    if (S.layout !== 'clock') layoutBeforeClock = S.layout;
    const tNow = Date.now(), idleMin = (tNow - lastPlayAt) / 60000, h = new Date().getHours();
    // chip
    const left = P.dur - now();
    const n = P.next;
    if (S.nextChip && n && P.playing && P.dur && left > 0 && left < S.nextChipSecs * 1000) {
      $('nextChip').querySelector('b').textContent = `${n.title || ''}${n.artist ? ' · ' + n.artist : ''}`;
      $('nextChip').classList.add('show');
    } else hideChip();
    // clock
    // The "Flip clock" layout keeps it up; "Cover + clock" has its own; otherwise it's the idle screen.
    const wantClock = S.layout === 'clock' || (S.layout !== 'clocksplit' && S.clock !== 'off' && !P.playing && idleMin >= S.clockAfter
      && tNow - clockDismissedAt > S.clockAfter * 60000 && (S.clock === 'paused' ? !!P.id : true));
    $('clockScreen').classList.toggle('flip', S.clockStyle === 'flip' || S.layout === 'clock');
    setClock(wantClock);
    $('clkNext').style.display = S.clockCaption ? '' : 'none';
    if (wantClock) {
      const d = new Date();
      $('clkTime').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      $('clkDate').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
      $('clkNext').textContent = !P.id ? '' : P.playing ? `${$('title').textContent} · ${$('artist').textContent}` : `Paused · ${$('title').textContent}`;
    }
    // night
    const night = S.night && (S.nightFrom > S.nightTo ? h >= S.nightFrom || h < S.nightTo : h >= S.nightFrom && h < S.nightTo);
    if (night !== document.body.classList.contains('night')) {
      document.body.classList.toggle('night', night);
      if (night) kw?.stop(); else applyBg();
    }
    document.documentElement.style.setProperty('--nd', S.nightDim);
    document.documentElement.style.setProperty('--nw', S.nightWarm);
    // burn-in: nudge the whole layout a few px every 3 minutes
    if (S.burnIn && tNow - shift > 180000) {
      shift = tNow;
      const dx = Math.round(Math.random() * 8 - 4), dy = Math.round(Math.random() * 6 - 3);
      $('wrap').style.transform = `translate(${dx}px, ${dy}px)`;
      $('clockScreen').style.setProperty('--cx', `${Math.round(Math.random() * 40 - 20)}px`);
      $('clockScreen').style.setProperty('--cy', `${Math.round(Math.random() * 30 - 15)}px`);
    } else if (!S.burnIn) $('wrap').style.transform = '';
    // status cluster: battery (every 30s is plenty) and the time of day
    const bat = $('batt'), tn = $('tnow'), timeOn = S.timeStyle !== 'off';
    if (S.battery && tNow % 30000 < 1000 || S.battery && !bat.dataset.init) {
      bat.dataset.init = 1;
      const b = String(call('battery') || '').split(',');
      if (b.length === 2) {
        bat.querySelector('span').textContent = `${b[0]}%`;
        bat.style.setProperty('--lvl', b[0] / 100);
        bat.classList.toggle('charging', b[1] === '1');
        bat.classList.toggle('low', +b[0] < 20 && b[1] !== '1');
      }
    }
    for (const k of ['in', 'out', 'ring', 'bar', 'text']) bat.classList.toggle(`b-${k}`, S.battStyle === k);
    if (timeOn) {
      const txt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: S.clock24 !== '24' });
      if (tn.textContent !== txt) tn.textContent = txt;
      for (const k of ['small', 'pill', 'big']) tn.classList.toggle(`t-${k}`, S.timeStyle === k);
    }
    const stat = $('stat');
    stat.classList.toggle('bshow', !!S.battery);
    stat.classList.toggle('tshow', timeOn);
    stat.classList.toggle('show', !!S.battery || timeOn || stat.classList.contains('qshow'));
    document.body.classList.toggle('stat-on', stat.classList.contains('show'));
    // keep-awake
    const awake = S.awake === 'always' || (S.awake === 'playing' && (P.playing || idleMin < S.sleepAfter));
    if (awake !== window.__awake) { window.__awake = awake; call('keepAwake', awake); }
    badge();
  }
  setInterval(everySecond, 1000);
  function applyBg() { try { art(P.art).then(im => background(P.art, im)); } catch (e) {} }

  // ---- queue / recently played / library / search / friends, with browsing into playlists, albums and artists.
  // A view stack: the tab at the bottom, each opened playlist / album / artist on top (Back pops it).
  // Rows: tap a song to play it (in the list's context), tap a playlist / album / artist to open it.
  // Swipe right = add to queue (queue tab: move to the top), swipe left = like / unlike (queue tab: remove).
  const TABS = { queue: 'Nothing queued', recent: 'Nothing played yet', library: 'Your library is empty', search: 'Search songs, artists, albums and playlists', friends: 'No friend activity' };
  let stack = [{ which: 'queue' }], items = [], viewData = null, searchT = 0;
  const view = () => stack[stack.length - 1];
  const I = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
    add: '<svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-2v-3h2v3h3v2h-3v3h-2v-3h-3v-2z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
    top: '<svg viewBox="0 0 24 24"><path d="M5 4h14v2H5zm7 3 6 6h-4v7h-4v-7H6z"/></svg>',
    more: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6z"/></svg>',
  };
  document.querySelectorAll('#lists button').forEach(b => b.onclick = () => openList(b.dataset.list));
  document.querySelectorAll('#listTabs button').forEach(b => b.onclick = () => openList(b.dataset.tab));
  $('listClose').onclick = () => document.body.classList.remove('lists-open');
  $('listBack').onclick = () => { if (stack.length > 1) { stack.pop(); load(); } };
  function openList(which) { stack = [{ which }]; document.body.classList.add('lists-open'); load(); }
  function browse(uri, title) { stack.push({ which: 'tracks', uri, title }); document.body.classList.add('lists-open'); load(); }
  window.dockBrowse = uri => { if (/^spotify:/.test(uri || '')) browse(uri); };
  function load() {
    const v = view(), root = stack[0].which;
    document.querySelectorAll('#listTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === root));
    $('listPanel').classList.toggle('deep', stack.length > 1);
    $('listCrumb').textContent = stack.length > 1 ? v.title || '' : '';
    $('listBody').scrollTop = 0;
    if (v.which === 'search') {
      $('listBody').innerHTML = `<div class="li-search"><input id="liQ" type="search" placeholder="What do you want to play?" value="${esc(v.q || '')}" enterkeyhint="search"></div><div id="liRes"></div>`;
      const q = $('liQ');
      q.oninput = () => { clearTimeout(searchT); v.q = q.value; searchT = setTimeout(() => request(v), 450); };
      if (v.q) request(v); else $('liRes').innerHTML = `<div class="li-empty">${TABS.search}</div>`;
      if (!v.q) setTimeout(() => q.focus(), 350);
      return;
    }
    const hit = cached(v);
    if (hit) showList({ ...hit, which: v.which, uri: v.uri, cached: true }); else $('listBody').innerHTML = skeleton();
    request(v);
  }
  const skeleton = () => '<div class="li-skel">' + '<div class="li"><div class="li-main"><div class="li-art"></div><div class="li-txt"><i></i><i></i></div></div></div>'.repeat(7) + '</div>';
  function request(v) {
    const msg = { which: v.which, uri: v.uri, q: v.q };
    if (v.which === 'search' && !v.q?.trim()) return;
    if (v.which === 'search') $('liRes').innerHTML = skeleton();
    if (P.source === 'web') Web.list(v.which, v.uri || v.q).then(r => showList({ ...msg, ...r }));
    else send({ type: 'list', ...msg });
  }
  window.onExtra = m => {
    // The queue also feeds the cover swipe. A closed panel isn't drawn (~120 ms on a slow phone, mid song change):
    // opening it asks again anyway.
    if (m.type === 'list') { if (m.which === 'queue') window.onQueue?.(m); if (document.body.classList.contains('lists-open')) showList(m); }
    else if (m.type === 'acted') acted(m);
    else if (m.type === 'album' && m.id) { albums.set(m.id, m); if (m.id === P.id) albumLine(); }
  };
  const ago = t => { const m = (Date.now() - t) / 60000; return m < 1 ? 'now' : m < 60 ? `${m | 0} min` : m < 1440 ? `${m / 60 | 0} h` : `${m / 1440 | 0} d`; };
  const artBg = a => a === 'liked' ? ' liked' : '';
  // The URL goes inside CSS url('...'): percent-encode what could end it (esc alone is undone by the attribute parser).
  const artStyle = a => a && a !== 'liked' ? ` style="background-image:url('${esc(String(a).replace(/['"()\\\s]/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`))}')"` : '';
  // Warm cache: every list / playlist / album / artist view is kept (25 most recent, localStorage) and shown at once
  // on open, then refreshed in the background; the refresh only re-renders when something changed. Cover images
  // come from the WebView's HTTP cache.
  const LC = 'dock:lists';
  let lcache = {};
  try { lcache = JSON.parse(localStorage.getItem(LC)) || {}; } catch (e) {}
  const ckey = v => v.which === 'search' ? null : `${v.which}|${v.uri || ''}`;
  const cached = v => { const k = ckey(v); return k && lcache[k]; };
  function cacheSave(v, m) {
    const k = ckey(v);
    if (!k || m.error || !m.items?.length) return false;
    const { cached: _, ...clean } = m, same = lcache[k] && JSON.stringify(lcache[k].items) === JSON.stringify(clean.items) && JSON.stringify(lcache[k].head) === JSON.stringify(clean.head);
    lcache[k] = { ...clean, at: Date.now() };
    for (const x of Object.keys(lcache).sort((a, b) => lcache[b].at - lcache[a].at).slice(25)) delete lcache[x];
    try { localStorage.setItem(LC, JSON.stringify(lcache)); } catch (e) { lcache = { [k]: lcache[k] }; }
    return same;
  }
  function showList(m) {
    const v = view();
    if (m.which !== v.which || (v.uri && m.uri !== v.uri) || (v.which === 'search' && m.q !== v.q)) return; // stale answer
    const out = v.which === 'search' ? $('liRes') : $('listBody');
    if (!out) return;
    if (!m.cached && cacheSave(v, m) && viewData?.cached) { viewData = { ...m }; return; } // fresh = what's shown: keep it
    viewData = m;
    items = Array.isArray(m.items) ? m.items : [];
    if (m.head?.title && stack.length > 1) { v.title = m.head.title; $('listCrumb').textContent = m.head.title; }
    let html = '';
    if (m.head) html += `<div class="li-head"><div class="li-hart${artBg(m.head.art)}${m.head.round ? ' round' : ''}"${artStyle(m.head.art)}></div>
      <div class="li-htxt"><div class="li-ht">${esc(m.head.title)}</div><div class="li-hs">${esc(m.head.sub || '')}</div>
      <div class="li-hbtns"><button class="li-play" data-a="play">Play</button><button data-a="shuffle">Shuffle</button></div></div></div>`;
    if (!items.length) { out.innerHTML = html + `<div class="li-empty">${esc(m.error || TABS[stack[0].which] || 'Nothing here')}</div>`; wireHead(out, m); return; }
    if (v.which === 'queue' && m.now) html += `<h4>Now playing</h4>${row(m.now, -1)}`;
    let section = v.which === 'queue' ? null : '';
    items.forEach((x, i) => {
      const sec = v.which === 'queue' ? (x.queued ? 'Next in queue' : `Next from ${m.ctxName || 'this list'}`) : x.section || '';
      if (sec !== section) { section = sec; if (sec) html += `<h4>${esc(sec)}</h4>`; }
      html += row(x, i);
    });
    const top = out.scrollTop;
    out.innerHTML = html;
    out.scrollTop = top;
    wireHead(out, m);
    out.querySelectorAll('.li[data-i]').forEach(wireRow);
  }
  function wireHead(out, m) {
    out.querySelectorAll('.li-head button').forEach(b => b.onclick = () => {
      cmdOf('play', { uri: m.head.uri || m.ctx, shuffle: b.dataset.a === 'shuffle' });
      window.notice?.(`${b.dataset.a === 'shuffle' ? 'Shuffling' : 'Playing'} ${m.head.title}`);
      document.body.classList.remove('lists-open');
    });
  }
  const isTrack = x => /^spotify:(track|episode|local):/.test(x?.uri || '');
  function row(x, i) {
    const now = i < 0, tab = stack[0].which, v = view(), q = tab === 'queue' && v.which === 'queue';
    let right = '';
    if (x.friend) right = x.live ? '<span class="eq"><i></i><i></i><i></i></span>' : `<span class="li-time">${esc(ago(x.time))}</span>`;
    else if (x.box) right = `<span class="li-go">${I.more}</span>`;
    else if (isTrack(x) && !now) right = (q ? (x.queued ? `<button data-a="top" aria-label="Move to top">${I.top}</button><button data-a="remove" aria-label="Remove from queue">${I.x}</button>` : `<button data-a="add" aria-label="Add to queue">${I.add}</button>`)
      : `<button data-a="add" aria-label="Add to queue">${I.add}</button>`) + `<button data-a="like" class="${x.liked ? 'on' : ''}" aria-label="Like">${I.heart}</button>`;
    const time = x.time && !x.friend && tab === 'recent' ? `<span class="li-time">${esc(ago(x.time))}</span>` : '';
    return `<div class="li${now ? ' now' : ''}${x.box ? ' box' : ''}"${now ? '' : ` data-i="${i}"`}>
      <div class="li-swipe l">${q && x.queued ? I.x : I.heart}</div><div class="li-swipe r">${q && x.queued ? I.top : I.add}</div>
      <div class="li-main"><div class="li-art${artBg(x.art)}${x.round || x.friend ? ' round' : ''}"${artStyle(x.art)}>${x.live ? '<b></b>' : ''}</div>
      <div class="li-txt"><div class="li-t">${esc(x.title)}</div><div class="li-s">${esc(x.sub || '')}</div>${x.ctxName ? `<div class="li-c">${esc(x.ctxName)}</div>` : ''}</div>
      <div class="li-r">${time}${right}</div></div></div>`;
  }
  // Row gestures: horizontal drag reveals the swipe action; a short tap plays / opens.
  function wireRow(el) {
    const x = items[+el.dataset.i], main = el.querySelector('.li-main');
    if (!x?.uri) return;
    const q = stack[0].which === 'queue' && view().which === 'queue' && x.queued;
    el.querySelectorAll('button[data-a]').forEach(b => b.onclick = e => { e.stopPropagation(); doAct(b.dataset.a, x, el); });
    let sx = 0, sy = 0, dx = 0, drag = false, id = null;
    main.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; dx = 0; drag = false; id = e.pointerId; });
    main.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - sx, my = e.clientY - sy;
      if (!drag && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5 && isTrack(x)) { drag = true; main.setPointerCapture(id); el.classList.add('dragging'); }
      if (!drag) return;
      dx = Math.max(-140, Math.min(140, mx));
      main.style.transform = `translateX(${dx}px)`;
      el.classList.toggle('arm-r', dx > 80); el.classList.toggle('arm-l', dx < -80);
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      if (drag) {
        el.classList.remove('dragging', 'arm-r', 'arm-l');
        main.style.transform = '';
        if (dx > 80) doAct(q ? 'top' : 'add', x, el);
        else if (dx < -80) doAct(q ? 'remove' : 'like', x, el);
        return;
      }
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) return; // a scroll
      if (x.box) return browse(x.uri, x.title);
      const ctx = x.ctx || viewData?.ctx;
      cmdOf('play', { uri: x.uri, ctx });
      window.notice?.(`Playing ${x.title}`);
      document.body.classList.remove('lists-open');
    };
    main.addEventListener('pointerup', end);
    main.addEventListener('pointercancel', e => { if (e.pointerId === id) { id = null; el.classList.remove('dragging', 'arm-r', 'arm-l'); main.style.transform = ''; } });
  }
  function doAct(a, x, el) {
    const cmd = { add: 'queueAdd', remove: 'queueRemove', top: 'queueTop', like: x.liked ? 'unlike' : 'like' }[a];
    if (a === 'like') { x.liked = !x.liked; el.querySelector('button[data-a=like]')?.classList.toggle('on', x.liked); heartPop(el); }
    if (a === 'remove') el.classList.add('gone');
    window.notice?.({ queueAdd: `Added ${x.title} to the queue`, queueRemove: `Removed ${x.title}`, queueTop: `${x.title} plays next`, like: `Liked ${x.title}`, unlike: `Removed ${x.title} from Liked Songs` }[cmd]);
    if (P.source === 'web') Web.act(cmd, x.uri).then(r => acted({ cmd, uri: x.uri, ...r }));
    else send({ type: 'cmd', cmd, uri: x.uri, uid: x.uid });
  }
  function heartPop(el) { el.querySelector('button[data-a=like]')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: ms(320), easing: 'cubic-bezier(.3,1.6,.5,1)' }); }
  function acted(m) {
    if (m.ok === false) window.notice?.(`Couldn't do that: ${m.error || 'failed'}`);
    if (view().which === 'queue' && ['queueRemove', 'queueTop', 'queueAdd'].includes(m.cmd)) setTimeout(() => request(view()), 350);
  }

  // ---- settings live preview: the sheet slides to one side so the player behind it shows every change live.
  $('speek').onclick = () => {
    const on = document.body.classList.toggle('settings-peek');
    $('speek').setAttribute('aria-pressed', on);
    $('speek').textContent = on ? 'Full view' : 'Preview';
  };

  // ---- timeline under the cover: touch or drag anywhere on it to seek. The fill follows the finger 1:1 (no transition), the
  // time shows where you would land, and the seek happens on release (app.js then ignores stale beats for a moment).
  const tlHit = $('tlhit');
  let tls = null;
  const tlAt = e => { const r = $('tltrack').getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  function tlMove(e) {
    tls.f = tlAt(e);
    $('tlfill').style.transform = `translateX(${(tls.f - 1) * 100}%)`;
    $('tlcur').textContent = fmtT(tls.f * P.dur);
  }
  const tlStart = e => {
    tls.on = true;
    document.body.classList.add('tl-drag');
    $('tlfill').style.transition = 'none';
    tlMove(e);
  };
  tlHit.addEventListener('pointerdown', e => {
    if (!P.dur || tls) return;
    tls = { id: e.pointerId, f: 0, x: e.clientX, y: e.clientY, on: false };
    tlHit.setPointerCapture(e.pointerId);
  });
  tlHit.addEventListener('pointermove', e => {
    if (!tls || e.pointerId !== tls.id) return;
    if (!tls.on) {
      const dx = e.clientX - tls.x, dy = e.clientY - tls.y;
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { tls = null; return; } // vertical: not a scrub
      if (Math.abs(dx) < 6 || !Gesture.claim('timeline')) return;
      tlStart(e);
    }
    tlMove(e);
  });
  const tlEnd = e => {
    if (!tls || e.pointerId !== tls.id) return;
    if (!tls.on) { // a plain tap: seek there
      if (e.type !== 'pointerup' || !Gesture.tap()) { tls = null; return; }
      tlStart(e);
    }
    const at = Math.round(tls.f * P.dur), ok = e.type === 'pointerup';
    tls = null;
    document.body.classList.remove('tl-drag');
    if (ok) seek(at); // the next frame re-syncs the bar from the new position
    call('vibrate', 30);
  };
  tlHit.addEventListener('pointerup', tlEnd);
  tlHit.addEventListener('pointercancel', tlEnd);

  // ---- quick bar: a few one-tap actions per layout next to the gear, and a compact sheet with the settings that matter here.
  const LAYOUTS = () => Settings.schema().find(x => x.k === 'layout')?.opts || [];
  const layoutName = () => LAYOUTS().find(([v]) => v === S.layout)?.[1] || '';
  const SVG = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const CLOCKY = () => ['clock', 'clocksplit'].includes(S.layout);
  const cycle = (k, list, names) => { const v = list[(list.indexOf(S[k]) + 1) % list.length]; Settings.set(k, v); window.notice?.(names[v], 1400); };
  const QB = {
    swap: { html: SVG('<path d="M6 8h12m0 0-3.5-3.5M18 8l-3.5 3.5M18 16H6m0 0 3.5-3.5M6 16l3.5 3.5"/>'), tip: 'Swap cover side',
      run: () => { const v = S.artSide === 'left' ? 'right' : 'left'; Settings.set('artSide', v); window.notice?.(`Cover on the ${v}`, 1400); } },
    roman: { html: 'Aa', tip: 'Romanization', on: () => S.roman !== 'off',
      run: () => cycle('roman', ['smart', 'always', 'off'], { smart: 'Romanize · keep Hindi', always: 'Romanize everything', off: 'Original script' }) },
    layout: { html: SVG('<path d="M4 5.5h16v13H4zM10 5.5v13"/>'), tip: 'Choose a layout', run: () => openQuick('layouts') },
    theme: { html: SVG('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>'), tip: 'Card colour',
      run: () => cycle('clockTheme', ['dark', 'light', 'auto'], { dark: 'Dark cards', light: 'Light cards', auto: 'Automatic card colour' }) },
    secs: { html: 'ss', tip: 'Seconds', on: () => S.clockSeconds,
      run: () => { Settings.set('clockSeconds', !S.clockSeconds); window.notice?.(S.clockSeconds ? 'Seconds on' : 'Seconds off', 1200); } },
    h24: { html: () => (S.clock24 === '24' ? '24' : '12'), tip: '12 / 24 hour',
      run: () => { Settings.set('clock24', S.clock24 === '24' ? '12' : '24'); window.notice?.(S.clock24 === '24' ? '24-hour clock' : '12-hour clock', 1200); } },
    tune: { html: SVG('<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle cx="15" cy="7" r="2.4"/><circle cx="9" cy="17" r="2.4"/>'), tip: 'Quick settings', run: () => openQuick() },
  };
  const QBAR = { split: ['swap', 'roman', 'layout', 'tune'], tv: ['swap', 'roman', 'layout', 'tune'], player: ['roman', 'layout', 'tune'], lyrics: ['roman', 'layout', 'tune'],
    compact: ['roman', 'layout', 'tune'], cinema: ['roman', 'layout', 'tune'], nowbar: ['roman', 'layout', 'tune'],
    clocksplit: ['swap', 'theme', 'secs', 'layout', 'tune'], clock: ['theme', 'secs', 'h24', 'layout', 'tune'] };
  // Keys are Settings schema keys; a row only shows while its own "when" holds.
  const LYR = ['roman', 'size', 'align', 'weight', 'lineGap', 'lineOpacity', 'blurLines', 'glow', 'scroll'];
  const STATUS = ['timeStyle', 'battery', 'battStyle', 'statPos'];
  const CLK = ['clockTheme', 'clockSeconds', 'clock24', 'clockLayout', 'clockAnim', 'clockIntro', 'clockCards', 'clockScale', 'clockDigitGap', 'clockGroupGap', 'clockDim', 'clockSound', 'clockVolume', 'clockHaptic'];
  const QUICK = {
    split: ['artSide', 'progress', ...LYR], tv: ['artSide', 'progress', ...LYR], player: [...LYR, ...STATUS],
    lyrics: [...LYR, ...STATUS], compact: [...LYR, ...STATUS], cinema: [...LYR, ...STATUS], nowbar: ['spin', ...LYR, ...STATUS],
    clocksplit: ['artSide', ...CLK], clock: [...CLK, ...STATUS],
  };
  function renderQs() {
    const box = $('qs'), ids = QBAR[S.layout] || ['layout', 'tune'];
    box.replaceChildren(...ids.map(id => {
      const q = QB[id], b = document.createElement('button');
      b.dataset.q = id; b.title = q.tip; b.setAttribute('aria-label', q.tip);
      b.innerHTML = typeof q.html === 'function' ? q.html() : q.html;
      if (q.on?.()) b.classList.add('on');
      return b;
    }));
  }
  $('qs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { QB[b.dataset.q]?.run(); showUi(true); } });
  // ---- layout picker (the quick bar's layout button, and the top of Settings -> Layout): every layout as a small,
  // true-to-scale sketch of where its blocks sit - measured on the phone in both orientations (docs/layout-map.md) -
  // with its name; the current one is ringed. A tap switches at once and the sheet stays, so trying them is quick.
  const THUMBS = { land: { split: { cover: [8.8, 3.3, 30.5, 64.4], np: [6.7, 79.7, 35, 15.8], lyr: [43.6, 0, 50, 100], tl: [8.8, 69.7, 30.5, 2.8] },
    player: { np: [6.2, 19.4, 41.4, 18.9], lyr: [49.1, 0, 44.5, 100], tl: [8, 42.8, 37.6, 5], deck: [6.7, 40.3, 40.5, 38.9] }, lyrics: { lyr: [6.7, 0, 86.8, 100], tl: [2.5, 96.1, 95, 0.8] },
    compact: { cover: [6.7, 3.3, 7.1, 15], np: [15.1, 4.2, 82.1, 13.3], lyr: [6.7, 21.9, 86.8, 77.5], tl: [2.5, 96.1, 95, 0.8] },
    tv: { cover: [10.7, 3.6, 30.7, 64.7], np: [6.7, 78.9, 38.7, 16.4], lyr: [47.2, 0, 46.3, 100], tl: [10.7, 70, 30.7, 2.8] },
    cinema: { cover: [6.7, 78.3, 4.7, 10], np: [12.4, 77.8, 10.5, 11.1], lyr: [8.8, 0, 82.6, 100], tl: [2.5, 96.1, 95, 0.8] },
    nowbar: { pill: [40, 75.6, 20.7, 13.3], lyr: [6.7, 0, 86.8, 86.1], tl: [2.5, 96.1, 95, 0.8] },
    clocksplit: { cover: [9.5, 4.7, 29.3, 61.9], np: [6.7, 78.3, 35, 15.8], clock: [43.6, 0, 55.3, 100], tl: [9.5, 68.3, 29.3, 2.8] }, clock: { clock: [0, 0, 100, 100] } },
  port: { split: { cover: [18.1, 10, 61.9, 29.3], np: [5.3, 44.5, 88.1, 7.5], lyr: [5.3, 52.9, 88.1, 43.8], tl: [18.1, 40.1, 61.9, 1.3] },
    player: { np: [3.1, 10, 96.7, 10.7], lyr: [3.1, 21.7, 91.9, 61.8], tl: [6.1, 85.7, 86.1, 2.4], deck: [3.1, 84.5, 91.9, 13.6] }, lyrics: { lyr: [4.2, 10, 91.4, 90], tl: [5.3, 98.2, 89.4, 0.4] },
    compact: { cover: [4.2, 10, 15, 7.1], np: [22.2, 10.4, 70.6, 6.3], lyr: [4.2, 18.8, 91.4, 81.2], tl: [5.3, 98.2, 89.4, 0.4] },
    tv: { cover: [10.3, 10, 78.1, 37], np: [5.3, 52, 88.1, 7.8], lyr: [5.3, 60.8, 88.1, 35.9], tl: [10.3, 47.8, 78.1, 1.3] },
    cinema: { cover: [4.2, 90, 10, 4.7], np: [16.1, 89.7, 22.2, 5.3], lyr: [8.6, 10, 82.5, 82.4], tl: [5.3, 98.2, 89.4, 0.4] },
    nowbar: { pill: [27.2, 88.7, 43.6, 6.3], lyr: [4.2, 10, 91.4, 75.8], tl: [5.3, 98.2, 89.4, 0.4] },
    clocksplit: { cover: [18.1, 10, 61.9, 29.3], np: [5.3, 44.5, 88.1, 7.5], clock: [5.3, 52.9, 88.1, 43.8], tl: [18.1, 40.1, 61.9, 1.3] }, clock: { clock: [0, 0, 100, 100] } } };
  const HINT = { split: 'Cover beside the lyrics', player: 'Mini player + lyrics', lyrics: 'Just the lyrics', compact: 'Song on top, lyrics below', tv: 'Big cover and type',
    cinema: 'Huge centred lyrics', nowbar: 'Lyrics + floating pill', clocksplit: 'Cover + flip clock', clock: 'Flip clock, full screen' };
  function sketch(L) {
    const land = innerWidth > innerHeight, t = THUMBS[land ? 'land' : 'port'][L] || {}, H = land ? 47.4 : 211;
    const box = (r, cls, rx = 1.4) => { const [x, y, w, h] = [r[0], r[1] * H / 100, r[2], r[3] * H / 100]; return { x, y, w, h, svg: `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>` }; };
    const bar = (x, y, w, h, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(1, w)}" height="${h}" rx="${h / 2}"/>`;
    let s = '';
    if (t.cover) s += box(t.cover, 'c').svg;
    if (t.pill) { const p = box(t.pill, 'p', t.pill[3] * H / 200); s += p.svg + `<circle class="c" cx="${p.x + p.h / 2}" cy="${p.y + p.h / 2}" r="${p.h * .34}"/>` + bar(p.x + p.h, p.y + p.h * .3, p.w * .45, p.h * .16, 't1') + bar(p.x + p.h, p.y + p.h * .56, p.w * .3, p.h * .12, 't'); }
    if (t.np) { const n = box(t.np, 'x'), mid = ['split', 'tv', 'clocksplit'].includes(L), h = Math.min(n.h * .24, 3.2), w1 = n.w * .5, w2 = n.w * .34;
      s += bar(mid ? n.x + (n.w - w1) / 2 : n.x + 1, n.y + n.h * .14, w1, h, 't1') + bar(mid ? n.x + (n.w - w2) / 2 : n.x + 1, n.y + n.h * .52, w2, h * .8, 't'); }
    if (t.lyr) { const l = box(t.lyr, 'x'), h = Math.min(l.h * .07, land ? 4.2 : 6), gap = h * 1.9, cx = L === 'cinema';
      [.78, .55, .92, .6, .7, .5].forEach((f, i) => { const y = l.y + l.h * .12 + i * gap; if (y + h > l.y + l.h - 1) return; const w = l.w * f * .92; s += bar(cx ? l.x + (l.w - w) / 2 : l.x + 1, y, w, h, i === 1 ? 'l1' : 'l'); }); }
    if (t.clock) { const k = box(t.clock, 'x'), rows = !land && k.h > k.w ? 2 : 1, per = 4 / rows, cw = Math.min(k.w * .9 / per / 1.06, k.h * .8 / rows / 1.45), ch = cw * 1.45, g = cw * .1;
      const W = per * cw + (per - 1) * g + (rows === 1 ? cw * .3 : 0), x0 = k.x + (k.w - W) / 2, y0 = k.y + (k.h - rows * ch - (rows - 1) * g * 2) / 2;
      for (let i = 0; i < 4; i++) { const r = rows === 1 ? 0 : i >> 1, c = rows === 1 ? i : i & 1; s += `<rect class="k" x="${x0 + c * (cw + g) + (rows === 1 && i > 1 ? cw * .3 : 0)}" y="${y0 + r * (ch + g * 2)}" width="${cw}" height="${ch}" rx="${cw * .12}"/>`; } }
    if (t.deck) { const d = box(t.deck, 'd', 2.4); s += d.svg; [.3, .5, .7].forEach((f, i) => { s += `<circle class="${i === 1 ? 't1' : 't'}" cx="${d.x + d.w * f}" cy="${d.y + d.h * .55}" r="${Math.min(d.h, d.w) * (i === 1 ? .14 : .08)}"/>`; }); }
    if (t.tl) { const b = box(t.tl, 'x'), h = Math.max(.8, Math.min(b.h, 1.4)); s += bar(b.x, b.y + (b.h - h) / 2, b.w, h, 'tl') + bar(b.x, b.y + (b.h - h) / 2, b.w * .35, h, 'tf'); }
    return `<svg viewBox="0 0 100 ${H}" aria-hidden="true">${s}</svg>`;
  }
  window.layoutGrid = () => {
    const g = document.createElement('div');
    g.className = 'lp-grid';
    g.innerHTML = LAYOUTS().map(([v, name]) => `<button class="lp-card${v === S.layout ? ' on' : ''}" data-l="${v}" aria-pressed="${v === S.layout}">${sketch(v)}<b>${name}</b><small>${HINT[v] || ''}</small></button>`).join('');
    g.addEventListener('click', e => {
      const c = e.target.closest('.lp-card');
      if (!c || c.dataset.l === S.layout || !Gesture.tap()) return;
      Settings.set('layout', c.dataset.l);
      $('wrap').animate([{ opacity: 0.2, scale: 0.985 }, { opacity: 1, scale: 1 }], { duration: ms(380), easing: 'cubic-bezier(.2,.8,.2,1)' });
      g.querySelectorAll('.lp-card').forEach(x => { x.classList.toggle('on', x === c); x.setAttribute('aria-pressed', x === c); });
    });
    // the portrait carousel opens on the current layout
    requestAnimationFrame(() => { const c = g.querySelector('.lp-card.on'); if (c && g.scrollWidth > g.clientWidth) g.scrollLeft = c.getBoundingClientRect().left - g.getBoundingClientRect().left + g.scrollLeft - (g.clientWidth - c.offsetWidth) / 2; });
    return g;
  };
  let qMode = 'settings';
  function renderQuick() {
    const body = $('qbody'), top = body.scrollTop;
    $('qtitle').innerHTML = qMode === 'layouts' ? `Layout<small>${layoutName()}</small>` : `Quick settings<small>${layoutName()}</small>`;
    body.replaceChildren(...(qMode === 'layouts' ? [window.layoutGrid()] : Settings.rows(QUICK[S.layout] || ['roman', 'size'])));
    body.scrollTop = top;
  }
  const quickOpen = () => document.body.classList.contains('qs-open');
  function openQuick(mode = 'settings') { qMode = mode; document.body.classList.toggle('qs-layouts', mode === 'layouts'); document.body.classList.add('qs-open'); renderQuick(); showUi(true); }
  function closeQuick() { document.body.classList.remove('qs-open'); showUi(true); }
  $('qclose').onclick = closeQuick;
  document.addEventListener('pointerdown', e => { if (quickOpen() && !e.target.closest('#qpanel, #qs')) closeQuick(); }, true);
  window.onSettingsRender = () => { if (quickOpen()) renderQuick(); };

  // ---- block names: an overlay outlining every [data-block] (docs/layout-map.md), refreshed while it is on
  function blocks() {
    const ov = $('blkov');
    if (!S.showBlocks) { if (ov.firstChild) ov.replaceChildren(); return; }
    const out = [];
    document.querySelectorAll('[data-block]').forEach(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.opacity === '0' || r.right < 0 || r.left > innerWidth) return;
      const d = document.createElement('div'), t = document.createElement('span');
      d.className = 'bk';
      d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      t.textContent = el.dataset.block;
      d.append(t);
      out.push(d);
    });
    ov.replaceChildren(...out);
  }
  setInterval(blocks, 700);
  addEventListener('resize', blocks);

  // ---- settings -> page (runs after app.js apply)
  window.afterApply = k => {
    const b = document.body;
    b.classList.toggle('hide-shuffle', !S.showShuffle);
    b.classList.toggle('hide-lists', !S.showLists);
    b.classList.toggle('line-accent', S.lineColor === 'accent');
    b.classList.toggle('duet', S.duetColors);
    b.classList.toggle('outline', S.outline);
    b.classList.toggle('drift', S.bgDrift && (S.bg === 'blur' || S.bg === 'canvas' || S.bg === 'motion' || S.bg === 'motionblur'));
    call('setVolKeys', !!S.volKeys);
    b.classList.toggle('qs-on', !!S.qsEnabled);
    b.classList.toggle('show-blocks', !!S.showBlocks);
    for (const p of ['tr', 'tl', 'br', 'bl']) b.classList.toggle(`stat-${p}`, S.statPos === p);
    for (const k of ['wave', 'status', 'glow', 'led']) b.classList.toggle(`qi-${k}`, S.showQuality && S.qualityIcon === k);
    placeHeart();
    placeTags();
    placeQw();
    renderQs();
    blocks();
    if (!k || k === '*' || k === 'font') applyFont();
    if (!k || k === '*' || ['marquee', 'layout', 'size'].includes(k)) setTimeout(remarquee, 50);
    if (k === 'albumLine') albumLine();
    if (k === 'hideExplicit') Lyrics.rebuild();
    if (['clockScale', 'clockDim', 'clockDigitGap', 'clockGroupGap'].includes(k)) Flip.layout(); // size / dim: CSS variables only, no rebuild while dragging
    else if (k && /^clock/.test(k)) { Flip.rebuild(); Flip.layout(); }
    // Cover + clock: the flip clock (HH:MM) lives where the lyrics would be.
    if (!k || k === '*' || k === 'layout') {
      if (S.layout === 'clocksplit') { Flip.mount($('clockPane'), { secs: false }); Flip.show(); }
      else if (clockOn && S.layout !== 'clock') setClock(false); // leaving the Flip clock layout: the cards roll out first
      else { Flip.hide(); Flip.mount($('clockScreen')); clockOn = false; document.body.classList.remove('clock'); }
      setTimeout(() => Flip.layout(), 60);
    }
  };
  window.afterApply('*');
  addEventListener('resize', () => setTimeout(remarquee, 100));

  // ---- music-video background (ivLyrics-style): the song's YouTube video, muted, cover-scaled behind the lyrics,
  // kept in sync with the song. The blurred cover shows until (and if) a video is found.
  const vids = new Map();
  let vidFor = null, vidAt = 0;
  // fetch with a timeout (public instances can hang forever; AbortSignal.timeout needs Chrome 103+).
  const tfetch = (u, ms = 6000) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
    return fetch(u, { signal: c.signal }).then(x => x.ok ? x.json() : null).catch(() => null).finally(() => clearTimeout(t)); };
  async function findVideo(title, artist) {
    const q = `${title} ${String(artist || '').split(',')[0]} official video`;
    if (S.videoKey) {
      const r = await tfetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(q)}&key=${encodeURIComponent(S.videoKey)}`);
      const id = r?.items?.[0]?.id?.videoId;
      if (id) return id;
    }
    // Public Piped instances come and go: a known-good one first, then the live instance list.
    let hosts = ['https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks'];
    const live = (await tfetch('https://piped-instances.kavin.rocks/', 4000)) || [];
    hosts = [...new Set([...hosts, ...live.filter(i => i.api_url).map(i => i.api_url)])].slice(0, 8);
    for (const host of hosts) {
      const r = await tfetch(`${host}/search?q=${encodeURIComponent(q)}&filter=videos`);
      const u = r?.items?.find(i => i.url?.includes('watch?v='))?.url;
      if (u) return u.split('v=')[1].slice(0, 11);
    }
    return null;
  }
  function ytCmd(func, args = []) { $('yt')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); }
  async function video() {
    const want = S.bg === 'video' && !document.body.classList.contains('night') ? P.id : null;
    if (want === vidFor) return;
    vidFor = want;
    document.getElementById('yt')?.remove();
    if (!want) return;
    const title = $('title').textContent, artist = $('artist').textContent;
    const id = vids.has(want) ? vids.get(want) : await findVideo(title, artist);
    vids.set(want, id);
    if (vidFor !== want || !id) { if (!id) window.notice?.('No music video found for this song'); return; }
    const f = document.createElement('iframe');
    f.id = 'yt';
    f.allow = 'autoplay; encrypted-media';
    const host = window.LYRICDOCK_WEB ? location.origin : 'https://video.lyricdock.app'; // phone: PageClient.java; web: player.html
    f.src = `${host}/player?v=${id}&t=${Math.max(0, now() / 1000 | 0)}`;
    $('bg').after(f); // above the blurred-cover fallback, below the dim layer and the lyrics
    vidAt = Date.now();
  }
  setInterval(() => {
    video();
    if (!document.getElementById('yt') || !S.videoSync) return;
    // The embed reports nothing without the IFrame API handshake; re-seek every 20s (and on pause/play) to stay close.
    if (P.playing) { ytCmd('playVideo'); if (Date.now() - vidAt > 20000) { vidAt = Date.now(); ytCmd('seekTo', [now() / 1000, true]); } }
    else ytCmd('pauseVideo');
  }, 2000);

  // ---- Spotify Canvas background: the song's short looping video (sent by the bridge), over the blurred cover.
  const canvases = new Map(), baseExtra = window.onExtra;
  window.onExtra = m => {
    if (m.type !== 'canvas') return baseExtra(m);
    if (typeof m.id !== 'string' || !/^https:\/\/[^"'\s]+\.mp4(\?\S*)?$/.test(m.url || '')) return;
    canvases.set(m.id, m.url);
    if (canvases.size > 20) canvases.delete(canvases.keys().next().value);
    canvasTick();
  };
  // The background video slot (#cv): Spotify Canvas, or the album's animated cover (sharp or blurred).
  function canvasTick() {
    const night = document.body.classList.contains('night');
    const mirror = !night && S.bg === 'motionblur' && S.motionArt; // blur copies the cover video's frames: no second <video>
    if (mirror) blurMirror(); else $('cvb')?.remove();
    const want = night || mirror ? null : S.bg === 'canvas' ? canvases.get(P.id) : S.bg === 'motion' ? motion.get(`bg:${P.id}`) : S.bg === 'motionblur' ? motion.get(`cover:${P.id}`) : null;
    let v = document.getElementById('cv');
    if (!want) { v?.remove(); return; }
    if (v?.dataset.src === want) { if (P.playing && v.paused) v.play().catch(() => {}); else if (!P.playing && !v.paused) v.pause(); return; }
    v?.remove();
    v = Object.assign(document.createElement('video'), { id: 'cv', muted: true, loop: true, autoplay: true, playsInline: true, src: want });
    v.dataset.src = want;
    v.onplaying = () => v.classList.add('on'); // shown once it really plays (iOS Low Power Mode refuses autoplay: the still cover stays)
    $('bg').after(v);
  }
  setInterval(canvasTick, 1000);
  // Blurred animated background while the cover is animated: its frames are copied (~15 fps) into a tiny canvas that
  // CSS scales up and blurs. One download and one decoder - two <video>s streaming the same file block each other,
  // and a second decoder is heavy on 2 GB phones.
  let blurT = 0;
  function blurMirror() {
    if (!$('cvb')) $('bg').after(Object.assign(document.createElement('canvas'), { id: 'cvb', width: 64, height: 32 }));
    if (blurT) return;
    blurT = setInterval(() => {
      const c = $('cvb'), v = $('mv');
      if (!c) { clearInterval(blurT); blurT = 0; return; }
      if (!v || v.readyState < 2) { c.classList.remove('on'); return; } // no animated cover: the blurred still shows
      const h = Math.max(8, Math.round(64 * innerHeight / innerWidth)), sh = v.videoWidth * h / 64;
      if (c.height !== h) c.height = h;
      c.getContext('2d').drawImage(v, 0, Math.max(0, (v.videoHeight - sh) / 2), v.videoWidth, Math.min(sh, v.videoHeight), 0, 0, 64, h);
      c.classList.add('on');
    }, 66);
  }

  // ---- Animated covers from LyricDock cloud: Apple Music's motion artwork (docs/lyricdock-cloud.md).
  // Two slots: 'cover' (square, in the cover; also feeds the blurred background - same file, no extra data) and
  // 'bg' (the sharp 'Animated cover' background: tall in portrait, square in landscape, sized to the screen).
  // Size asked = pixels shown x the quality setting; the cloud picks the matching Apple encode.
  const ART_API = 'https://art.lyricdock.losthusky.qzz.io/v1';
  // iPhones have no MediaSource (only ManagedMediaSource) but play HEVC: ask the video element too.
  const HEVC = (() => { try { return window.MediaSource ? MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L153.B0"') : document.createElement('video').canPlayType('video/mp4; codecs="hvc1"') !== ''; } catch (e) { return false; } })();
  const DEVICE = (() => { try { let d = localStorage.getItem('dock:device'); if (!d) localStorage.setItem('dock:device', d = crypto.randomUUID()); return d; } catch (e) { return ''; } })();
  const who = () => `&hevc=${HEVC ? 1 : 0}&d=${DEVICE}&v=${encodeURIComponent(appVersion)}`;
  const QUALITY = { saver: 0.75, auto: 1, sharp: 1.5, max: 2 };
  const timed = (url, ms, headers) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal, headers }).finally(() => clearTimeout(t)); };
  const cloud = (url, ms) => timed(url, ms, window.Account?.headers()); // the cover API answers signed-in apps only (account.js)
  const motion = window.dockMotion = new Map(); // `${slot}:${song id}` -> playable URL, '' = none / looking (exposed for debugging)
  const lookupUrl = (t, slot, warm) => {
    const portrait = innerHeight > innerWidth, q = QUALITY[S.motionQuality] || 1;
    const shape = slot === 'bg' ? (portrait ? 'tall' : 'square') : coverTall() ? 'tall' : 'square';
    const shown = slot === 'bg' ? Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio, 1.5) : ($('art').offsetWidth || 300) * devicePixelRatio;
    return [shape, `${ART_API}/cover?artist=${encodeURIComponent(t.artist)}&album=${encodeURIComponent(t.album)}&shape=${shape}&px=${Math.round(shown * q)}${S.motionQuality === 'max' ? '&q=max' : ''}${warm ? '&warm=1' : ''}${who()}`];
  };
  async function lookup(t, slot, warm) {
    const [asked, url] = lookupUrl(t, slot, warm), r = await cloud(url, 15000), j = r.ok ? await r.json() : null;
    const shape = j?.shape || asked; // a tall request falls back to square when the album has no tall cover
    return typeof j?.video === 'string' && /^https:\/\/[^"'\s]+\.mp4$/.test(j.video) ? { url: j.video, key: `${j.album.id}/${shape}/${j.variant.n}`, shape } : null;
  }
  // Warming (like the still covers): while a song plays, the next one's animated cover is looked up, and downloaded
  // too when the keep setting would save it on this play anyway. Logged as 'warm', so it never counts as a play.
  // Cover shape: 'auto' = tall (3:4) in portrait where the height is free, square in landscape.
  const coverTall = () => S.coverShape === 'tall' || (S.coverShape === 'auto' && innerHeight > innerWidth);
  const tallOf = new Map(); // `cover:${song id}` -> the playing cover video is the tall one
  const warmed = window.dockWarm = new Map(); // `${slot}:${song id}` -> { url, key } | null
  async function warm(t, slot) {
    const k = `${slot}:${t?.id}`;
    if (!t?.id || !t.artist || !t.album || warmed.has(k) || motion.has(k)) return;
    warmed.set(k, null);
    try {
      const w = await lookup(t, slot, true);
      warmed.set(k, w);
      if (w && (S.motionKeep === 'first' || (S.motionKeep === 'second' && (vcIdx()[vcId(w.key)]?.[2] || 0) >= 1))) save(w.url, w.key);
    } catch (e) { warmed.delete(k); }
    while (warmed.size > 8) warmed.delete(warmed.keys().next().value);
  }
  async function motionFor(t, slot) {
    const k = `${slot}:${t?.id}`;
    if (!t?.id || !t.artist || !t.album || motion.has(k)) return;
    motion.set(k, '');
    try {
      let w = warmed.get(k);
      if (w) cloud(lookupUrl(t, slot)[1], 15000).catch(() => {}); // already known: just count the play
      else w = await lookup(t, slot);
      if (w) { motion.set(k, await playable(w.url, w.key)); tallOf.set(k, w.shape === 'tall'); }
    } catch (e) { setTimeout(() => motion.get(k) === '' && motion.delete(k), 60000); } // offline / slow: ask again in a minute
    while (motion.size > 12) { const old = motion.keys().next().value; if (motion.get(old)?.startsWith('blob:')) URL.revokeObjectURL(motion.get(old)); motion.delete(old); }
    motionTick(); canvasTick();
  }

  // Device copies (Cache Storage, size cap = setting, least recently played out first), a ladder like the cloud's:
  // 'Save on the device' = second play (default: 1st play streams, 2nd downloads once, then free) / first play / never.
  // Keyed by album/shape/variant, so a file the cloud moves from Apple's CDN to R2 isn't fetched again.
  const vcId = key => `https://dock.local/${key}`, vcIdx = () => { try { return JSON.parse(localStorage.getItem('dock:videos') || '{}'); } catch (e) { return {}; } };
  const vcSave = idx => { try { localStorage.setItem('dock:videos', JSON.stringify(idx)); } catch (e) {} };
  async function playable(url, key) {
    const id = vcId(key), idx = vcIdx(), e = idx[id] || [0, 0, 0]; // [bytes, last played, plays]
    e[1] = Date.now(); e[2]++; idx[id] = e; vcSave(idx);
    let c;
    try { c = await caches.open('dock-videos'); } catch (err) { return url; } // no Cache Storage: stream
    const hit = await c.match(id).catch(() => null);
    if (hit) return URL.createObjectURL(await hit.blob());
    if (!inflight.has(id) && (S.motionKeep === 'never' || (S.motionKeep !== 'first' && e[2] < 2))) return url; // stream this time
    const blob = await save(url, key);
    return blob ? URL.createObjectURL(blob) : url; // too slow / failed: stream it instead of showing nothing
  }
  const inflight = new Map(); // device id -> Promise<Blob | null>
  function save(url, key) {
    const id = vcId(key);
    if (!inflight.has(id)) inflight.set(id, (async () => {
      try {
        const c = await caches.open('dock-videos'), hit = await c.match(id);
        if (hit) return await hit.blob();
        const r = await timed(url, 90000);
        if (!r.ok) return null;
        const blob = await r.blob();
        await c.put(id, new Response(blob, { headers: { 'content-type': 'video/mp4' } }));
        const idx = vcIdx(), e = idx[id] || [0, Date.now(), 0];
        e[0] = blob.size; idx[id] = e;
        let total = Object.values(idx).reduce((n, x) => n + (x[0] || 0), 0);
        for (const [u, x] of Object.entries(idx).sort((p, q) => p[1][1] - q[1][1])) {
          if (total <= S.motionCacheMB * 2 ** 20) break;
          if (u !== id && x[0]) { await c.delete(u); total -= x[0]; x[0] = 0; }
        }
        vcSave(idx);
        return blob;
      } catch (err) { return null; } finally { setTimeout(() => inflight.delete(id), 0); }
    })());
    return inflight.get(id);
  }

  function motionTick() {
    const want = S.motionArt && !document.body.classList.contains('night') ? motion.get(`cover:${P.id}`) : '';
    let v = $('mv');
    const live = !!want && !!v?.classList.contains('on') && v.dataset.src === want;
    $('art').classList.toggle('animated', live);
    const tall = live && !!tallOf.get(`cover:${P.id}`);
    if (tall !== document.body.classList.contains('cover-tall')) { document.body.classList.toggle('cover-tall', tall); fitArt(); }
    if (!want) { v?.remove(); return; }
    if (v?.dataset.src === want) { if (P.playing && v.paused) v.play().catch(() => {}); else if (!P.playing && !v.paused) v.pause(); return; }
    v?.remove();
    v = Object.assign(document.createElement('video'), { id: 'mv', muted: true, loop: true, autoplay: true, playsInline: true, src: want });
    v.dataset.src = want;
    // Fades in only once the song change has settled (app.js showArt): never pops in mid-transition.
    v.onplaying = () => { v.onplaying = null; setTimeout(() => { if (v.isConnected) { v.classList.add('on'); motionTick(); } }, Math.max(0, (P.settleAt || 0) - performance.now())); };
    $('art').prepend(v); // first child: the controls, ripple and heart badge stay on top
  }
  const swapBase = window.afterSwap;
  window.afterSwap = m => { swapBase(m); motionTick(); canvasTick(); }; // the old song's video leaves with its cover
  setInterval(() => {
    const cover = S.motionArt || S.bg === 'motionblur';
    if (cover) motionFor(P.cur, 'cover');
    if (S.bg === 'motion') motionFor(P.cur, 'bg');
    if (S.motionWarm && performance.now() - (P.curAt || 0) > 3000) for (const t of [P.next, P.next2]) { // the next two, once the current one has started
      if (cover) warm(t, 'cover');
      if (S.bg === 'motion') warm(t, 'bg');
    }
    motionTick();
  }, 1000);
  let wasTall = coverTall();
  const reshape = () => { const t = coverTall(); if (t !== wasTall) { for (const k of [...motion.keys()]) if (k.startsWith('cover:')) motion.delete(k); warmed.clear(); } wasTall = t; };
  addEventListener('resize', reshape); Settings.onChange(reshape);
  const swapAt = window.afterSwap;
  window.afterSwap = m => { P.curAt = performance.now(); swapAt(m); };

  // ---- Lyrics kept on the device (Cache Storage 'dock-lyrics', newest 500 songs): replays and offline start instantly.
  const lyId = id => `https://dock.local/lyrics/${id}`;
  window.lyricStore = {
    put(id, lyr) {
      if (!id || !Lyrics.rank(lyr)) return;
      let body;
      try { body = JSON.stringify(lyr); } catch (e) { return; } // now, before the renderer decorates the object
      caches.open('dock-lyrics').then(async c => {
        await c.put(lyId(id), new Response(body, { headers: { 'content-type': 'application/json' } }));
        const keys = await c.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - 500))) await c.delete(k);
      }).catch(() => {});
    },
    get: id => caches.open('dock-lyrics').then(c => c.match(lyId(id))).then(r => r ? r.json() : null).catch(() => null),
  };

  // ---- Settings -> Storage: what is kept on this phone, and clearing it.
  const fmtMB = b => b < 2 ** 20 ? `${Math.round(b / 1024)} KB` : `${(b / 2 ** 20).toFixed(b < 10 * 2 ** 20 ? 1 : 0)} MB`;
  const st = { at: 0 };
  async function measure() {
    st.at = Date.now();
    const vids = Object.values(vcIdx()).filter(x => x[0] > 0);
    st.videos = `${vids.length} saved · ${fmtMB(vids.reduce((n, x) => n + x[0], 0))}`;
    try {
      const c = await caches.open('dock-lyrics'), keys = await c.keys();
      let bytes = 0;
      for (const k of keys) bytes += (await (await c.match(k)).blob()).size;
      st.lyrics = `${keys.length} songs · ${fmtMB(bytes)}`;
    } catch (e) { st.lyrics = 'unavailable'; }
    try { st.web = fmtMB(Dock.webCacheBytes()); } catch (e) { st.web = 'unavailable'; }
    try { const e = await navigator.storage.estimate(); st.total = `${fmtMB(e.usage || 0)} used by the app's web storage`; } catch (e) { st.total = ''; }
    window.settingsRender?.();
  }
  window.dockStorage = {
    text: k => { if (Date.now() - st.at > 4000) measure(); return st[k] ?? 'Counting…'; },
    async clear(k) {
      if (k === 'videos' || k === 'all') { await caches.delete('dock-videos'); localStorage.removeItem('dock:videos'); }
      if (k === 'lyrics' || k === 'all') await caches.delete('dock-lyrics');
      if (k === 'web' || k === 'all') try { Dock.clearWebCache(); } catch (e) {}
      window.notice?.(k === 'all' ? 'Everything cleared' : 'Cleared');
      setTimeout(measure, 600);
    },
  };
  // Anonymous usage for the dashboard: which platform and screen, never who or what. Heartbeat every 10 min
  // ("active devices"), plus events from the web app (open / install / update / error).
  const env = () => {
    const app = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
    const plat = window.LYRICDOCK_WEB ? (app ? 'pwa' : 'web') : 'android';
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    return `&plat=${plat}&scr=${screen.width}x${screen.height}@${+devicePixelRatio.toFixed(2)}&tz=${encodeURIComponent(tz)}&lang=${encodeURIComponent(navigator.language || '')}`;
  };
  window.cloudPing = (e, detail) => timed(`${ART_API}/ping?px=${Math.round(($('art').offsetWidth || 300) * devicePixelRatio)}${e ? `&e=${e}` : ''}`
    + `${detail ? `&x=${encodeURIComponent(String(detail).slice(0, 300))}` : ''}${who()}${env()}`, 15000).catch(() => {});
  const ping = () => window.cloudPing();
  if (!window.LYRICDOCK_MINI) { setTimeout(ping, 5000); setInterval(ping, 10 * 60000); }

  // ---- phone hardware: volume keys (MainActivity forwards them while the setting is on), media notification,
  // brightness schedule, and "wake" from Spotify (Ctrl+Alt+W / right-click menu).
  window.volKey = d => {
    const v = Math.max(0, Math.min(100, Math.round(+$('vol').value + d * 5)));
    $('vol').value = v;
    P.volLock = performance.now() + 2000;
    cmdOf('volume', { v });
    window.notice?.(`Volume ${v}%`, 900);
    window.volMuted();
  };
  window.volMuted = () => $('volrow').classList.toggle('muted', +$('vol').value === 0); // the quiet speaker turns into "muted" at 0
  $('volDn').onclick = () => window.volKey(-2); // the speakers step by 10
  $('volUp').onclick = () => window.volKey(2);
  $('vol').addEventListener('input', window.volMuted);
  window.mediaCmd = c => { if (['toggle', 'next', 'prev'].includes(c)) cmdOf(c); };
  window.dockWake = () => {
    lastPlayAt = Date.now(); clockDismissedAt = Date.now();
    setClock(false);
    call('wake');
  };
  window.connLog = () => Rtc.log?.() ?? [];
  // Settings -> Connection: what this phone is connected to right now, how, and how Spotify can find it.
  window.connCard = () => {
    const card = document.createElement('div');
    card.className = 'cc';
    const p = Rtc.path?.(), linked = Rtc.open?.(), desk = Rtc.desk?.() || 'Spotify on your computer', vis = Rtc.discoverable?.() ?? {};
    let dockOn = false; try { dockOn = !!Dock.kioskOn(); } catch (e) {}
    const state = linked ? `Connected to ${desk}` : P.source === 'web' ? 'Following your Spotify account' : 'Not connected';
    const how = linked ? `${p?.relayed ? 'Through a TURN relay' : 'Same network'}${p?.rtt != null ? ` · ${Math.round(p.rtt * 1000)} ms` : ''}`
      : P.source === 'web' ? 'Spotify on your computer isn\'t linked. Playback comes from your account instead.'
      : 'Waiting for Spotify on your computer.';
    card.innerHTML = `<div class="cc-top"><i class="cc-dot${linked ? ' on' : P.source === 'web' ? ' mid' : ''}"></i><div><b>${esc(state)}</b><small>${esc(how)}</small></div></div>
      <div class="cc-grid">
        <div><small>Find it from Spotify</small><b>LyricDock button → Devices → Find devices</b><span>${vis.network ? '✓ Visible on this network' : '… checking the network'}${vis.account ? ' · ✓ your Spotify account' : ' · sign in (Playback source) to be found anywhere'}</span></div>
        <div><small>Or type this pairing code</small><div class="cc-coderow"><b class="cc-code">${esc(Rtc.code)}</b><button class="cc-copy" type="button">Copy</button></div><span>Spotify → LyricDock → Devices → Pairing code</span></div>
      </div>`;
    card.querySelector('.cc-copy').onclick = e => { e.stopPropagation(); copyText(Rtc.code); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); };
    return card;
  };
  // Clipboard from a file:// page: the async API may be refused, so fall back to a selected textarea + copy.
  function copyText(t, what = 'Pairing code') {
    const fallback = () => { const a = Object.assign(document.createElement('textarea'), { value: t }); a.style.position = 'fixed'; a.style.opacity = '0'; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch (x) {} a.remove(); };
    try { navigator.clipboard.writeText(t).catch(fallback); } catch (x) { fallback(); }
    window.notice?.(`${what} copied`, 1500);
  }

  // Setup screen: shown while nothing feeds this screen and it isn't set up yet - never connected to Spotify on a
  // computer and not signed in (signing out counts as not set up again). The sign-in is known from storage at once,
  // so the web shows it immediately; the phone first gives its adb bridge 3 s to say hello. A signed-in screen
  // never sees it and goes straight to "Waiting for Spotify…" while the first poll runs.
  const setup = (() => {
    let el = null, view = 'home', skipped = false, forced = false, wasIn = false, pcAt = 0, lna = '';
    const LS = 'dock:linked', web = !!window.LYRICDOCK_WEB;
    const ever = () => { try { return !!localStorage.getItem(LS); } catch (e) { return false; } };
    const mark = () => { try { localStorage.setItem(LS, '1'); } catch (e) {} };
    const back = '<button class="su-back" data-a="home" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>';
    // The phone's kiosk has no browser to open a link in: there the address is just shown.
    const link = (url, text) => web ? `<a class="su-link" href="${url}" target="_blank" rel="noopener">${text} ↗</a>` : `<b>${text}</b>`;
    const btnLink = (url, text) => web ? `<a class="su-go" href="${url}" target="_blank" rel="noopener">${text} ↗</a>` : `<span class="su-note">Open <b>${url.replace('https://', '')}</b> on a computer or phone</span>`;
    const DASH = 'https://developer.spotify.com/dashboard';
    // One field of Spotify's "Create app" form, the way it looks there, with the value to put in it.
    const field = (label, value, { req, hint } = {}) => `<div class="sx-f"><label>${label}${req ? ' <em>*</em>' : ''}</label>
      <div class="sx-v"><span>${esc(value)}</span><button class="sx-copy" data-a="cp" data-v="${esc(value)}" data-l="${label}">Copy</button></div>${hint ? `<small>${hint}</small>` : ''}</div>`;
    let wstep = 0; // 0: pick when first shown (straight to the Client ID if one was entered before)
    const wsteps = {
      1: () => `<ol class="su-steps">
            <li>Sign in at ${link(DASH, 'developer.spotify.com')} with your Spotify account. <b>Premium</b> is needed for the account that owns the app.</li>
            <li>Accept the <b>Developer Terms</b> when asked.</li>
            <li><b>Verify your email</b>: Spotify sends a link to your account's email. No email? Use the banner at the top of the dashboard to resend it. <b>Create app</b> stays hidden until this is done.</li></ol>
          <div class="su-row">${btnLink(DASH, 'Open the dashboard')}<button class="su-mini" data-a="w2">Done, next ›</button></div>`,
      2: () => `<p class="su-hint">In the dashboard click <b>Create app</b>, then fill it in like this:</p>
          <div class="sx-form">
            ${field('App name', 'LyricDock', { req: 1 })}
            ${field('App description', 'Synced lyrics for what I play on Spotify', { req: 1 })}
            ${field('Website', web ? location.origin : 'https://github.com/DhakadG/lyricdock', { hint: 'Optional' })}
            ${field('Redirect URIs', Web.redirect, { req: 1, hint: 'Paste it, then click <b>Add</b> next to the box - it must match exactly' })}
            <div class="sx-f"><label>Which API/SDKs are you planning to use?</label><div class="sx-checks"><span class="on">Web API</span><span>Web Playback SDK</span><span>Android</span><span>iOS</span><span>Ads API</span></div><small>Tick <b>Web API</b> only</small></div>
            <div class="sx-f"><div class="sx-checks"><span class="on">I understand and agree with Spotify's Developer Terms of Service and Design Guidelines</span></div></div>
            <div class="sx-save"><b>Save</b><small>at the bottom of the page</small></div>
          </div>
          <div class="su-row">${btnLink(`${DASH}/create`, 'Open Create app')}<button class="su-mini" data-a="w3">Saved, next ›</button></div>`,
      3: () => `<p class="su-hint">Spotify opens your app's <b>Basic Information</b>. Copy the <b>Client ID</b> (the copy icon next to it) and paste it here - not the client secret.</p>
          <div class="sx-form sx-basic"><div class="sx-f"><label>Client ID</label>
            <div class="su-field"><input id="suCid" placeholder="32 letters and numbers" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.spClientId || '')}">
              <button class="sx-copy" data-a="paste">Paste</button></div></div></div>
          <div class="su-row"><button class="su-go" data-a="login">Sign in with Spotify</button>${link(DASH, 'Your apps')}</div>
          <small class="su-msg" id="suMsg"></small>`,
    };
    const FAQ = [
      ['There is no "Create app" button', 'Verify your email first (step 1) and accept the Developer Terms. If it still doesn\'t show, Spotify isn\'t letting your account make apps: use a friend\'s Client ID instead. They add <b>your</b> Spotify email under <b>User Management</b> in their app.'],
      ['Do I need Premium?', 'The account that owns the app needs Premium (Spotify\'s rule for apps in development mode). Up to 5 people can use one app.'],
      ['"INVALID_CLIENT: Invalid redirect URI"', `The Redirect URI must be exactly <code>${esc(Web.redirect)}</code>. Open your app → <b>Edit</b>, paste it, click <b>Add</b>, then <b>Save</b> at the bottom.`],
      ['"User not registered in the Developer Dashboard"', 'You signed in with a different Spotify account than the app\'s. In the app open <b>User Management</b> and add that account\'s name and email, or sign in with the owner account.'],
      ['Spotify says "Something went wrong"', 'Wait a minute and try again: new apps can take a moment to activate. Check that <b>Web API</b> is ticked under <b>APIs used</b>.'],
      ['Do I need the client secret?', 'No. LyricDock signs in without it. Never paste the secret anywhere.'],
      ['What can LyricDock do with my account?', 'See what is playing and control playback - nothing else. You can remove it any time at spotify.com/account/apps.'],
    ];
    const views = {
      home: () => `<div class="su-side"><div class="su-logo"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h11M4 17h7"/></svg></div>
          <h1>Set up LyricDock</h1><p>Pick how this screen follows your music. You can change it later in Settings.</p>
          <button class="su-skip" data-a="skip">Skip for now</button></div>
        <div class="su-main">
          <button class="su-opt" data-a="web"><i class="su-ico g"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M7.5 9.5c3-1 6.5-.7 9 .8M8 12.8c2.5-.7 5.3-.4 7.3.7M8.6 15.8c2-.5 4-.3 5.6.5"/></svg></i>
            <span><b>Sign in with Spotify</b><small>Follows whatever you play: phone, speaker or web player. Needs a free Client ID.</small></span><em>›</em></button>
          <button class="su-opt" data-a="pc"><i class="su-ico b"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></i>
            <span><b>Use Spotify on your computer</b><small>Best lyrics and instant sync. Needs the LyricDock extension in Spotify desktop.</small></span><em>›</em></button>
        </div>`,
      // Three steps that mirror Spotify's own pages (developer dashboard -> Create app -> Basic Information), every value
      // with its own Copy button, and the questions people actually hit underneath.
      web: () => `<div class="su-side">${back}<h1>Sign in with Spotify</h1><p>Spotify lets LyricDock in only through an app you register. It's free, takes a few minutes, and needs no secret.</p>
          <div class="su-tabs">${['Account', 'Create app', 'Client ID'].map((t, i) => `<button data-a="w${i + 1}" class="${wstep === i + 1 ? 'on' : ''}"><i>${i + 1}</i>${t}</button>`).join('')}</div></div>
        <div class="su-main">${wsteps[wstep ||= S.spClientId ? 3 : 1]()}
          <details class="su-faq"><summary>Questions</summary>${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</details></div>`,
      pc: () => `<div class="su-side">${back}<h1>Use Spotify on your computer</h1><p>Spotify desktop with the LyricDock extension: ${link('https://github.com/DhakadG/lyricdock#readme', 'how to install it')}.</p></div>
        <div class="su-main"><ol class="su-steps">
            <li>In Spotify, click the <b>LyricDock</b> button</li>
            <li><b>Devices</b> → <b>Find devices</b>, then tap <b>Allow</b> here</li></ol>
          <div class="su-code"><small>Or enter this pairing code</small><b>${esc(Rtc.code)}</b><button class="su-go" data-a="copy">Copy</button></div>
          <div class="su-checks" id="suChecks"></div>
          <small class="su-msg"><i class="su-spin"></i>Looking for Spotify…</small></div>`,
    };
    function draw() {
      el.className = 'su-' + view;
      el.innerHTML = `<div class="su-card">${views[view]()}</div>`;
      if (view === 'pc') {
        pcAt = performance.now();
        if (web) window.lyricdockLna?.ensure?.().then(s => { lna = s; update(); }); // the browser asks now, not after a delay
      }
      update();
    }
    function open() {
      if (el) return;
      el = document.createElement('div');
      el.id = 'setup';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Set up LyricDock');
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-a]'), a = b?.dataset.a;
        if (!a) return;
        if (a === 'skip') { skipped = true; close(); }
        else if (a === 'copy') { copyText(Rtc.code); b.textContent = 'Copied'; }
        else if (a === 'cp') { copyText(b.dataset.v, b.dataset.l); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }
        else if (a === 'paste') navigator.clipboard?.readText?.().then(t => { el.querySelector('#suCid').value = t.trim(); }).catch(() => el.querySelector('#suCid').focus());
        else if (/^w\d$/.test(a)) { wstep = +a[1]; draw(); }
        else if (a === 'lna') window.lyricdockLna?.request().then(update);
        else if (a === 'login') {
          const v = el.querySelector('#suCid').value.trim().toLowerCase(), msg = el.querySelector('#suMsg');
          msg.classList.add('bad', 'local');
          if (!/^[0-9a-f]{32}$/.test(v)) { msg.textContent = 'That doesn\'t look like a Client ID: it is 32 letters and numbers (0-9, a-f).'; return; }
          msg.classList.remove('bad', 'local');
          Settings.set('spClientId', v);
          Web.login();
          update();
        } else { view = a; draw(); }
      });
      draw();
      document.body.append(el);
    }
    function close() { el?.remove(); el = null; view = 'home'; forced = false; }
    // What the open view shows live: the sign-in result, or what is (not) in the way of finding Spotify on the computer.
    function update() {
      if (!el) return;
      const msg = el.querySelector('#suMsg');
      if (msg && !msg.classList.contains('local')) {
        const s = Web.status();
        msg.textContent = s === 'Not signed in' ? '' : s;
        msg.classList.toggle('bad', /refused|failed|cancel|^Spotify:|first/i.test(s));
      }
      const box = el.querySelector('#suChecks');
      if (!box) return;
      const vis = Rtc.discoverable?.() ?? {}, rows = [];
      if (web && lna === 'prompt') rows.push(['!', 'Your browser must allow this page to reach your network.', '<button class="su-mini" data-a="lna">Allow</button>']);
      else if (web && lna === 'denied') rows.push(['✕', 'Local network is blocked for this site: allow it in the site settings (the icon left of the address), then reload.']);
      rows.push(vis.network ? ['✓', 'Visible to Spotify on this network'] : ['…', 'Announcing on this network']);
      rows.push(vis.account ? ['✓', 'Findable through your Spotify account'] : ['·', 'Signing in with Spotify too lets it be found from any network']);
      if (performance.now() - pcAt > 30000) rows.push(['?', 'Not found yet? Spotify desktop must be open with the LyricDock extension installed, and its LyricDock → Devices list open.']);
      box.innerHTML = rows.map(([i, t, x = '']) => `<div><i>${i}</i><span>${t}</span>${x}</div>`).join('');
    }
    // ponytail: 1 s poll, the same cadence as the "alive" beat.
    function tick() {
      const bridge = Rtc.open?.() || P.gotHello, signed = Web.loggedIn();
      if (bridge || signed) mark();
      if (forced) { if ((signed && !wasIn) || (bridge && view === 'pc')) return close(); } // opened on purpose: stays until done or closed
      else if (bridge || signed || P.id || ever() || skipped || window.LYRICDOCK_MINI || Web.busy() || (!web && performance.now() < 3000)) return close();
      else open();
      if (web && view === 'pc') window.lyricdockLna?.state().then(s => { lna = s; });
      update();
    }
    setInterval(tick, 1000);
    setTimeout(tick, 0); // after install.js has run (it hands the sign-in result over on load)
    return {
      open: (v = 'home') => { forced = true; wasIn = Web.loggedIn(); view = v; if (el) draw(); else open(); },
      close, isOpen: () => !!el,
    };
  })();
  window.Setup = setup;
  let mediaKey = null;
  function hardware(h) {
    const inNight = S.nightFrom > S.nightTo ? h >= S.nightFrom || h < S.nightTo : h >= S.nightFrom && h < S.nightTo;
    const b = S.bright === 'system' ? -1 : S.bright === 'schedule' && inNight ? S.brightNight : S.brightDay;
    if (b !== window.__bright) { window.__bright = b; call('brightness', b); }
    if (S.mediaNotif && S.lockLyric) return; // the lyric loop below owns the notification (the line replaces the artist)
    const mk = S.mediaNotif && P.id ? `${P.id}|${!!P.playing}|${$('title').textContent}` : '';
    if (mk !== mediaKey) { mediaKey = mk; call('media', mk ? $('title').textContent : '', $('artist').textContent, P.art || '', !!P.playing); }
  }
  setInterval(() => hardware(new Date().getHours()), 1000);

  // ---- Home-screen widgets + lock screen (docs/widgets-plan.md). The shared now-playing state (the same shape an iOS
  // Live Activity will use) goes to Android when the song, play state or sung line changes - and only while a widget
  // is placed or a lock-screen option is on. Throttling and drawing happen natively (NowPlaying.java).
  let widgets = false, sentKey = '', overLock = null;
  const checkWidgets = () => { widgets = !!call('hasWidgets'); };
  checkWidgets();
  setInterval(checkWidgets, 60000);
  window.dockWidgets = () => { checkWidgets(); sentKey = ''; }; // a widget was placed / resized (NowPlaying.redraw)
  function nowState() {
    const p = pos(), l = Lyrics.lineAt(p);
    return {
      v: 1, id: P.id, title: $('title').textContent, artist: $('artist').textContent, album: P.album || '', art: P.art || '',
      accent: S.widgetAccent ? getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() : '',
      playing: !!P.playing, posMs: Math.round(p), atMs: Date.now(), durMs: Math.round(P.dur || 0),
      line: l?.text ? { i: l.i, text: l.text, t: l.t, e: l.e } : null, prev: l?.prev || '', next: l?.next || [],
      src: P.source === 'web' ? 'webapi' : 'bridge',
    };
  }
  setInterval(() => {
    const lock = !!(S.lockShow && P.playing);
    if (lock !== overLock) { overLock = lock; call('showOverLock', lock); }
    const lockLine = S.mediaNotif && S.lockLyric;
    if (!P.id || (!widgets && !lockLine)) return;
    const s = nowState(), key = `${s.id}|${s.playing}|${s.line?.i ?? -1}|${s.accent}`;
    if (key === sentKey) return;
    sentKey = key;
    if (widgets) call('nowPlaying', JSON.stringify(s));
    if (lockLine) call('media', s.title, s.line?.text || s.artist, s.art, s.playing); // lock-screen player: the sung line
  }, 250);

  // ---- release notes: Settings -> Updates -> What's new, and once after the app updated itself.
  // **bold** and [text](link) -> bold / plain text (the input is already escaped).
  const inl = s => s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const md = t => '<ul>' + esc(t).split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#+\s*$/.test(l))
    .map(l => /^#+\s/.test(l) ? `</ul><b>${l.replace(/^#+\s*/, '')}</b><ul>` : `<li>${inl(l.replace(/^[-*]\s+/, ''))}</li>`).join('') + '</ul>';
  async function changelog() {
    const rs = await fetch('https://api.github.com/repos/DhakadG/lyricdock/releases?per_page=8').then(r => r.json()).catch(() => null);
    if (!Array.isArray(rs)) return window.notice?.('Could not load the release notes');
    $('newsBody').innerHTML = rs.map(r => `<h5>${esc(r.name || r.tag_name)}<small>${esc((r.published_at || '').slice(0, 10))}${r.prerelease ? ' · beta' : ''}</small></h5>${md(r.body || '')}`).join('');
    document.body.classList.add('news-open');
  }
  window.showChangelog = changelog;
  $('newsClose').onclick = () => document.body.classList.remove('news-open');
  try {
    const v = Dock.version(), seen = localStorage.getItem('dock:seenVersion');
    if (v && seen && seen !== v) setTimeout(changelog, 5000);
    if (v) localStorage.setItem('dock:seenVersion', v);
  } catch (e) {}

  // ---- explicit filter used by lyrics.js when building lines
  const BAD = /\b(f+u+c+k\w*|s+h+i+t+\w*|b+i+t+c+h\w*|a+s+s+h+o+l+e\w*|d+i+c+k\w*|p+u+s+s+y\w*|c+u+n+t\w*|n+i+g+g+\w*|m+o+t+h+e+r+f+u+c+k\w*|b+a+s+t+a+r+d\w*|w+h+o+r+e\w*|s+l+u+t\w*)/gi;
  window.cleanWords = t => (S.hideExplicit && t ? t.replace(BAD, w => w[0] + '*'.repeat(w.length - 1)) : t);
})();
