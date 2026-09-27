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
  let down = null, lastTap = 0;
  addEventListener('pointerdown', e => { down = interactive(e) ? null : { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
  addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t;
    down = null;
    if (S.swipe && Math.abs(dx) > 70 && Math.abs(dy) < 50 && dt < 700) { $(dx < 0 ? 'next' : 'prev').click(); return; }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300) {
      const now2 = performance.now();
      if (S.doubleTapLike && S.showLiked && now2 - lastTap < 320) { $('heart').click(); heartBurst(e.clientX, e.clientY); lastTap = 0; }
      else lastTap = now2;
    }
  }, true);
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
  $('clockScreen').onclick = () => { clockDismissedAt = Date.now(); document.body.classList.remove('clock'); };
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
    const wantClock = S.clock !== 'off' && !P.playing && idleMin >= S.clockAfter && tNow - clockDismissedAt > S.clockAfter * 60000
      && (S.clock === 'paused' ? !!P.id : true);
    document.body.classList.toggle('clock', wantClock);
    if (wantClock) {
      const d = new Date();
      $('clkTime').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      $('clkDate').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
      $('clkNext').textContent = P.id ? `Paused · ${$('title').textContent}` : '';
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

  // ---- queue / recently played / library / friends
  let tab = 'queue';
  const panel = $('listPanel');
  document.querySelectorAll('#lists button').forEach(b => b.onclick = () => openList(b.dataset.list));
  document.querySelectorAll('#listTabs button').forEach(b => b.onclick = () => openList(b.dataset.tab));
  $('listClose').onclick = () => document.body.classList.remove('lists-open');
  function openList(which) {
    tab = which;
    document.body.classList.add('lists-open');
    document.querySelectorAll('#listTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === which));
    $('listBody').innerHTML = '<div class="li-empty">Loading…</div>';
    if (P.source === 'web') Web.list(which).then(r => showList({ which, ...r }));
    else send({ type: 'list', which });
  }
  window.onExtra = m => {
    if (m.type === 'list') showList(m);
    else if (m.type === 'album' && m.id) { albums.set(m.id, m); if (m.id === P.id) albumLine(); }
  };
  const ago = t => { const m = (Date.now() - t) / 60000; return m < 1 ? 'now' : m < 60 ? `${m | 0} min` : m < 1440 ? `${m / 60 | 0} h` : `${m / 1440 | 0} d`; };
  function showList(m) {
    if (m.which !== tab) return;
    const items = Array.isArray(m.items) ? m.items : [];
    if (!items.length) { $('listBody').innerHTML = `<div class="li-empty">${esc(m.error || { queue: 'Nothing queued', recent: 'Nothing played yet', library: 'Your library is empty', friends: 'No friend activity' }[tab])}</div>`; return; }
    const head = tab === 'queue' && m.now ? `<h4>Now playing</h4>${row(m.now, -1)}<h4>Next up</h4>` : '';
    $('listBody').innerHTML = head + items.map((x, i) => row(x, i)).join('');
    $('listBody').querySelectorAll('.li[data-i]').forEach(el => {
      const x = items[+el.dataset.i];
      if (!x?.uri) return;
      el.onclick = () => { cmdOf('play', { uri: x.uri, ctx: x.ctx }); document.body.classList.remove('lists-open'); window.notice?.(`Playing ${x.title}`); };
    });
  }
  function row(x, i) {
    const now = i < 0;
    const right = tab === 'friends' ? (x.live ? '<span class="eq"><i></i><i></i><i></i></span>' : `<span>${esc(ago(x.time))}</span>`) : '';
    return `<div class="li${now ? ' now' : ''}"${now ? '' : ` data-i="${i}"`}>
      <div class="li-art${tab === 'friends' ? ' round' : ''}" style="background-image:url('${esc(x.art || '')}')">${x.live ? '<b></b>' : ''}</div>
      <div class="li-txt"><div class="li-t">${esc(x.title)}</div><div class="li-s">${esc(x.sub || '')}</div>${x.ctxName ? `<div class="li-c">${esc(x.ctxName)}</div>` : ''}</div>
      <div class="li-r">${right}</div></div>`;
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
    placeHeart();
    if (!k || k === '*' || k === 'font') applyFont();
    if (!k || k === '*' || ['marquee', 'layout', 'size'].includes(k)) setTimeout(remarquee, 50);
    if (k === 'albumLine') albumLine();
    if (k === 'hideExplicit') Lyrics.rebuild();
  };
  window.afterApply('*');
  addEventListener('resize', () => setTimeout(remarquee, 100));

  // ---- explicit filter used by lyrics.js when building lines
  const BAD = /\b(f+u+c+k\w*|s+h+i+t+\w*|b+i+t+c+h\w*|a+s+s+h+o+l+e\w*|d+i+c+k\w*|p+u+s+s+y\w*|c+u+n+t\w*|n+i+g+g+\w*|m+o+t+h+e+r+f+u+c+k\w*|b+a+s+t+a+r+d\w*|w+h+o+r+e\w*|s+l+u+t\w*)/gi;
  window.cleanWords = t => (S.hideExplicit && t ? t.replace(BAD, w => w[0] + '*'.repeat(w.length - 1)) : t);
})();
