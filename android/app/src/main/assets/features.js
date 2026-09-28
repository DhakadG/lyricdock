// Extras on top of app.js: marquee titles, album line, like badge, gestures (swipe / double-tap / long-press scrub),
// shuffle + repeat, up-next chip, source badge, fonts, clock screen, night mode, burn-in shift, battery, keep-awake,
// queue / recently played / library / friends panel, and the settings live preview.
// app.js calls the window.after* hooks; everything here reads Settings.S (S) and the playback state (P).
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtT = t => { t = Math.max(0, t) / 1000 | 0; return `${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`; };
  const cmdOf = (c, extra = {}) => (P.source === 'web' ? Web.control(c, 'ms' in extra ? extra.ms : 'v' in extra ? extra.v : extra) : send({ type: 'cmd', cmd: c, ...extra }));

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
  window.afterSwap = m => { document.documentElement.style.setProperty('--artimg', m.art ? `url("${m.art}")` : 'none'); P.album = m.album; P.next = null; remarquee(); albumLine(); badge(); hideChip(); };
  window.afterPreload = m => { P.next = m; };
  function badge() {
    const src = P.lyrics?.source;
    $('srcBadge').textContent = S.sourceBadge && src ? src : '';
    $('srcBadge').classList.toggle('show', !!(S.sourceBadge && src));
  }
  function placeHeart() {
    const h = $('heart'), onArt = S.heartPos === 'art' && !['player', 'lyrics'].includes(S.layout); // no big cover there
    (onArt ? $('art') : $('titlerow')).appendChild(h);
    h.classList.toggle('badge', onArt);
    // Quality tag: vertical on the cover's edge; next to the title when there is no big cover.
    const q = $('quality'), cover = ['split', 'tv', 'clocksplit'].includes(S.layout);
    (cover ? $('art') : $('titlerow')).appendChild(q);
    q.classList.toggle('vert', cover); q.classList.toggle('inline', !cover);
  }

  // ---- shuffle / repeat state (from the bridge beat or the Web API poll)
  window.afterPos = m => {
    if (typeof m.shuffle === 'boolean') { P.shuffle = m.shuffle; $('shuf').classList.toggle('on', m.shuffle); }
    if (Number.isFinite(m.repeat)) { P.repeat = m.repeat; $('rep').classList.toggle('on', m.repeat > 0); $('rep').classList.toggle('one', m.repeat === 2); }
    lastPlayAt = m.playing ? Date.now() : lastPlayAt;
  };
  $('shuf').onclick = () => { $('shuf').classList.toggle('on'); cmdOf('shuffle'); };
  $('rep').onclick = () => { const n = ((P.repeat || 0) + 1) % 3; P.repeat = n; $('rep').classList.toggle('on', n > 0); $('rep').classList.toggle('one', n === 2); cmdOf('repeat', { v: n }); };

  // ---- gestures: swipe to skip, double-tap to like, long-press the progress bar to scrub
  const interactive = e => e.target.closest?.('button, input, #settings, #listPanel, #bar, #pairAsk, a');
  // Touch events, not pointer events: the WebView fires pointercancel as soon as it takes a drag for a pan, so a
  // pointer-based swipe never finished. Works anywhere, including on the album art (Default / TV view).
  let down = null, lastTap = 0;
  addEventListener('touchstart', e => {
    const t = e.touches[0];
    const onCover = swipeLayouts.includes(S.layout) && e.target.closest?.('#artbox');
    down = e.touches.length !== 1 || interactive(e) ? null : { x: t.clientX, y: t.clientY, t: performance.now(), cover: onCover };
  }, { capture: true, passive: true });
  addEventListener('touchend', e => {
    if (!down) return;
    const t = e.changedTouches[0], dx = t.clientX - down.x, dy = t.clientY - down.y, dt = performance.now() - down.t, d0 = down;
    down = null;
    if (S.swipe && !d0.cover && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 800) { swipeFx(dx < 0 ? -1 : 1); $(dx < 0 ? 'next' : 'prev').click(); return; }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300) {
      const now2 = performance.now();
      if (S.doubleTapLike && S.showLiked && now2 - lastTap < 320) { $('heart').click(); heartBurst(t.clientX, t.clientY); lastTap = 0; }
      else lastTap = now2;
    }
  }, { capture: true, passive: true });
  // ---- cover swipe (Default / TV / Cover + clock): the cover follows the finger 1:1 while the next (or previous)
  // cover slides in beside it. Past a third of the width (or a quick flick) it commits: the covers finish the move and
  // the song changes (app.js then leaves the cover alone - it is already the new one). Let go early: it springs back.
  const peek = document.createElement('div');
  peek.id = 'artPeek';
  $('artbox').append(peek);
  const swipeLayouts = ['split', 'tv', 'clocksplit'];
  let cs = null, csRevert = 0;
  const artUrl = u => u ? `url("${u}")` : 'none';
  $('artbox').addEventListener('touchstart', e => {
    if (!S.swipe || !swipeLayouts.includes(S.layout) || e.touches.length !== 1 || e.target.closest('button, input, #ctl')) return;
    const t = e.touches[0], w = $('art').offsetWidth;
    cs = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, on: false, w, gap: w * 0.08, lx: t.clientX, lt: performance.now(), v: 0 };
  }, { passive: true });
  $('artbox').addEventListener('touchmove', e => {
    if (!cs) return;
    const t = e.touches[0], dx = t.clientX - cs.x, dy = t.clientY - cs.y;
    if (!cs.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { cs = null; return; } // a vertical drag: not ours
      if (Math.abs(dx) < 8) return;
      cs.on = true;
      document.body.classList.add('art-dragging');
    }
    const now2 = performance.now();
    cs.v = (t.clientX - cs.lx) / Math.max(1, now2 - cs.lt); cs.lx = t.clientX; cs.lt = now2;
    cs.dx = dx;
    const dir = dx < 0 ? 1 : -1; // 1 = next (comes from the right), -1 = previous
    const nextArt = dir > 0 ? P.next?.art : P.prevArt;
    if (peek.dataset.url !== (nextArt || '')) { peek.dataset.url = nextArt || ''; peek.style.backgroundImage = artUrl(nextArt); }
    const p = Math.min(1, Math.abs(dx) / cs.w);
    $('art').style.transform = `translateX(${dx}px) rotate(${dx / cs.w * 4}deg) scale(${1 - p * 0.06})`;
    peek.style.transform = `translateX(${dir * (cs.w + cs.gap) + dx}px) scale(${0.94 + p * 0.06})`;
    peek.style.opacity = Math.min(1, p * 1.6);
  }, { passive: true });
  const endSwipe = () => {
    if (!cs) return;
    const s = cs; cs = null;
    if (!s.on) return;
    const dir = s.dx < 0 ? 1 : -1, p = Math.abs(s.dx) / s.w, fast = Math.abs(s.v) > 0.6 && Math.sign(s.v) === Math.sign(s.dx);
    const art = $('art'), ease = 'cubic-bezier(.2,.8,.2,1)';
    if (p > 0.33 || (fast && p > 0.1)) {
      const d = 260;
      art.animate([{ transform: art.style.transform }, { transform: `translateX(${-dir * (s.w + s.gap)}px) rotate(${-dir * 4}deg) scale(.94)` }], { duration: d, easing: ease, fill: 'forwards' });
      peek.animate([{ transform: peek.style.transform, opacity: peek.style.opacity }, { transform: 'none', opacity: 1 }], { duration: d, easing: ease, fill: 'forwards' }).onfinish = () => {
        // Hand over: the cover element becomes the new cover in place, the peek goes away - no visible jump.
        if (peek.dataset.url) art.style.backgroundImage = artUrl(peek.dataset.url);
        art.getAnimations().forEach(a => a.cancel()); peek.getAnimations().forEach(a => a.cancel());
        art.style.transform = ''; peek.style.transform = ''; peek.style.opacity = '';
        document.body.classList.remove('art-dragging');
        window.__swipe = { dir, at: performance.now() };
        $(dir > 0 ? 'next' : 'prev').click();
        // "Previous" can just restart the song: if nothing changes, put the real cover back.
        const id = P.id;
        clearTimeout(csRevert);
        csRevert = setTimeout(() => { if (P.id === id) { window.__swipe = null; art.style.backgroundImage = artUrl(P.art); } }, 2500);
      };
    } else {
      art.animate([{ transform: art.style.transform }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      peek.animate([{ transform: peek.style.transform, opacity: peek.style.opacity }, { transform: `translateX(${dir * (s.w + s.gap)}px) scale(.94)`, opacity: 0 }], { duration: 300, easing: ease });
      art.style.transform = ''; peek.style.transform = ''; peek.style.opacity = '';
      document.body.classList.remove('art-dragging');
    }
  };
  $('artbox').addEventListener('touchend', endSwipe, { passive: true });
  $('artbox').addEventListener('touchcancel', endSwipe, { passive: true });

  // ---- three-finger swipe switches layouts (with a notice naming it): up / down in landscape (next / previous),
  // left / right in portrait. Single-finger gestures ignore multi-touch, so this never also skips or scrolls.
  let tri = null;
  const mid = ts => [...ts].reduce((a, t) => ({ x: a.x + t.clientX / ts.length, y: a.y + t.clientY / ts.length }), { x: 0, y: 0 });
  addEventListener('touchstart', e => { if (e.touches.length === 3) { const m = mid(e.touches); tri = { x: m.x, y: m.y, dx: 0, dy: 0, t: performance.now() }; } }, { capture: true, passive: true });
  addEventListener('touchmove', e => { if (tri && e.touches.length === 3) { const m = mid(e.touches); tri.dx = m.x - tri.x; tri.dy = m.y - tri.y; } }, { capture: true, passive: true });
  addEventListener('touchend', e => {
    if (!tri || e.touches.length) return;
    const s = tri; tri = null;
    const land = innerWidth > innerHeight, main = land ? s.dy : s.dx, cross = land ? s.dx : s.dy;
    if (Math.abs(main) < 50 || Math.abs(main) < Math.abs(cross) * 1.2 || performance.now() - s.t > 1200) return;
    const opts = Settings.schema().find(x => x.k === 'layout')?.opts || [];
    const i = opts.findIndex(([v]) => v === S.layout), next = opts[(i + (main < 0 ? 1 : -1) + opts.length) % opts.length];
    if (!next) return;
    Settings.set('layout', next[0]);
    window.notice?.(`Layout: ${next[1]}`, 1400);
  }, { capture: true, passive: true });

  // A quick nudge of the cover in the swipe direction, so the gesture feels answered before the song changes.
  function swipeFx(dir) {
    $('artbox')?.animate([{ transform: 'none' }, { transform: `translateX(${dir * 4}vmin) rotate(${dir * 1.5}deg)`, opacity: .7 }, { transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.3,.7,.3,1)' });
  }
  function heartBurst(x, y) {
    const b = document.createElement('div');
    b.className = 'burst';
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    b.innerHTML = $('heart').querySelector('svg').outerHTML;
    document.body.append(b);
    b.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: .35 },
      { transform: 'translate(-50%,-80%) scale(1)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => b.remove();
  }
  // Long-press (350ms) on the progress bar: drag to scrub with a time bubble, release to seek.
  let scrub = null;
  $('bar').addEventListener('pointerdown', e => {
    const t = setTimeout(() => { scrub = { id: e.pointerId }; $('bar').setPointerCapture(e.pointerId); document.body.classList.add('scrubbing'); move(e); }, 350);
    const cancel = () => clearTimeout(t);
    $('bar').addEventListener('pointerup', cancel, { once: true });
    $('bar').addEventListener('pointercancel', cancel, { once: true });
  });
  const frac = e => Math.min(1, Math.max(0, e.clientX / innerWidth));
  function move(e) { if (!scrub) return; const f = frac(e); $('bar').style.setProperty('--scrub', f); $('bar').dataset.time = fmtT(f * P.dur); }
  $('bar').addEventListener('pointermove', move);
  $('bar').addEventListener('pointerup', e => { if (!scrub) return; scrub = null; document.body.classList.remove('scrubbing'); const t = Math.round(frac(e) * P.dur); cmdOf('seek', { ms: t }); P.pos = t; P.at = performance.now(); });

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
  $('clockScreen').onclick = () => {
    if (S.layout === 'clock') { Flip.onTap(); return; } // the clock IS the layout: taps only toggle seconds
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
    if (on) { b.classList.add('clock'); if (flip) { Flip.mount($('clockScreen')); Flip.show(); } return; }
    const go = () => { if (!clockOn) b.classList.remove('clock'); };
    if (flip && Flip.isShown()) { clockBusy = Flip.leave().then(go); } else go();
  }
  function everySecond() {
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
    // battery (every 30s is plenty)
    if (S.battery && tNow % 30000 < 1000 || S.battery && !$('batt').dataset.init) {
      $('batt').dataset.init = 1;
      const b = String(call('battery') || '').split(',');
      if (b.length === 2) {
        $('batt').querySelector('span').textContent = `${b[0]}%`;
        $('batt').style.setProperty('--lvl', b[0] / 100);
        $('batt').classList.toggle('charging', b[1] === '1');
      }
    }
    $('batt').classList.toggle('show', !!S.battery);
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
    if (m.type === 'list') showList(m);
    else if (m.type === 'acted') acted(m);
    else if (m.type === 'album' && m.id) { albums.set(m.id, m); if (m.id === P.id) albumLine(); }
  };
  const ago = t => { const m = (Date.now() - t) / 60000; return m < 1 ? 'now' : m < 60 ? `${m | 0} min` : m < 1440 ? `${m / 60 | 0} h` : `${m / 1440 | 0} d`; };
  const artBg = a => a === 'liked' ? ' liked' : '';
  const artStyle = a => a && a !== 'liked' ? ` style="background-image:url('${esc(a)}')"` : '';
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
  function heartPop(el) { el.querySelector('button[data-a=like]')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.3,1.6,.5,1)' }); }
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

  // ---- settings -> page (runs after app.js apply)
  window.afterApply = k => {
    const b = document.body;
    b.classList.toggle('hide-shuffle', !S.showShuffle);
    b.classList.toggle('hide-lists', !S.showLists);
    b.classList.toggle('line-accent', S.lineColor === 'accent');
    b.classList.toggle('duet', S.duetColors);
    b.classList.toggle('outline', S.outline);
    b.classList.toggle('drift', S.bgDrift && (S.bg === 'blur' || S.bg === 'canvas'));
    call('setVolKeys', !!S.volKeys);
    placeHeart();
    if (!k || k === '*' || k === 'font') applyFont();
    if (!k || k === '*' || ['marquee', 'layout', 'size'].includes(k)) setTimeout(remarquee, 50);
    if (k === 'albumLine') albumLine();
    if (k === 'hideExplicit') Lyrics.rebuild();
    if (['clockScale', 'clockDim', 'clockDigitGap', 'clockGroupGap'].includes(k)) Flip.layout(); // size / dim: CSS variables only, no rebuild while dragging
    else if (k && /^clock/.test(k)) { Flip.rebuild(); Flip.layout(); }
    // Cover + clock: the flip clock (HH:MM) lives where the lyrics would be.
    if (!k || k === '*' || k === 'layout') {
      if (S.layout === 'clocksplit') { Flip.mount($('clockPane'), { secs: false }); Flip.show(); }
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
    f.src = `https://video.lyricdock.app/player?v=${id}&t=${Math.max(0, now() / 1000 | 0)}`; // served by PageClient.java
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
  function canvasTick() {
    const want = S.bg === 'canvas' && !document.body.classList.contains('night') ? canvases.get(P.id) : null;
    let v = document.getElementById('cv');
    if (!want) { v?.remove(); return; }
    if (v?.dataset.src === want) { if (P.playing && v.paused) v.play().catch(() => {}); else if (!P.playing && !v.paused) v.pause(); return; }
    v?.remove();
    v = Object.assign(document.createElement('video'), { id: 'cv', muted: true, loop: true, autoplay: true, playsInline: true, src: want });
    v.dataset.src = want;
    v.oncanplay = () => v.classList.add('on');
    $('bg').after(v);
  }
  setInterval(canvasTick, 1000);

  // ---- phone hardware: volume keys (MainActivity forwards them while the setting is on), media notification,
  // brightness schedule, and "wake" from Spotify (Ctrl+Alt+W / right-click menu).
  window.volKey = d => {
    const v = Math.max(0, Math.min(100, Math.round(+$('vol').value + d * 5)));
    $('vol').value = v;
    P.volLock = performance.now() + 2000;
    cmdOf('volume', { v });
    window.notice?.(`Volume ${v}%`, 900);
  };
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
    let dockOn = false; try { dockOn = !!Dock.kioskOn; } catch (e) {}
    const state = linked ? `Connected to ${desk}` : P.source === 'web' ? 'Following your Spotify account' : 'Not connected';
    const how = linked ? `${p?.relayed ? 'Through a TURN relay' : 'Same network'}${p?.rtt != null ? ` · ${Math.round(p.rtt * 1000)} ms` : ''}`
      : P.source === 'web' ? 'Spotify on your computer isn\'t linked. Playback comes from your account instead.'
      : 'Waiting for Spotify on your computer.';
    card.innerHTML = `<div class="cc-top"><i class="cc-dot${linked ? ' on' : P.source === 'web' ? ' mid' : ''}"></i><div><b>${esc(state)}</b><small>${esc(how)}</small></div></div>
      <div class="cc-grid">
        <div><small>Find it from Spotify</small><b>LyricDock button → Devices → Find devices</b><span>${vis.network ? '✓ Visible on this network' : '… checking the network'}${vis.account ? ' · ✓ your Spotify account' : ' · sign in (Playback source) to be found anywhere'}</span></div>
        <div><small>Or type this pairing code</small><div class="cc-coderow"><b class="cc-code">${esc(Rtc.code)}</b><button class="cc-copy" type="button">Copy</button></div><span>Spotify → LyricDock → Devices → Pairing code</span></div>
      </div>`;
    card.querySelector('.cc-copy').onclick = e => { e.stopPropagation(); copyText(Rtc.code.replace(/-/g, '')); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); };
    return card;
  };
  // Clipboard from a file:// page: the async API may be refused, so fall back to a selected textarea + copy.
  function copyText(t) {
    const fallback = () => { const a = Object.assign(document.createElement('textarea'), { value: t }); a.style.position = 'fixed'; a.style.opacity = '0'; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch (x) {} a.remove(); };
    try { navigator.clipboard.writeText(t).catch(fallback); } catch (x) { fallback(); }
    window.notice?.('Pairing code copied', 1500);
  }
  let mediaKey = null;
  function hardware(h) {
    const inNight = S.nightFrom > S.nightTo ? h >= S.nightFrom || h < S.nightTo : h >= S.nightFrom && h < S.nightTo;
    const b = S.bright === 'system' ? -1 : S.bright === 'schedule' && inNight ? S.brightNight : S.brightDay;
    if (b !== window.__bright) { window.__bright = b; call('brightness', b); }
    const mk = S.mediaNotif && P.id ? `${P.id}|${!!P.playing}|${$('title').textContent}` : '';
    if (mk !== mediaKey) { mediaKey = mk; call('media', mk ? $('title').textContent : '', $('artist').textContent, P.art || '', !!P.playing); }
  }
  setInterval(() => hardware(new Date().getHours()), 1000);

  // ---- release notes: Settings -> Updates -> What's new, and once after the app updated itself.
  const md = t => '<ul>' + esc(t).split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#+\s*$/.test(l))
    .map(l => /^#+\s/.test(l) ? `</ul><b>${l.replace(/^#+\s*/, '')}</b><ul>` : `<li>${l.replace(/^[-*]\s*/, '')}</li>`).join('') + '</ul>';
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
