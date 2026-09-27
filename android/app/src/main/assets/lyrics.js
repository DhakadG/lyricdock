// Lyrics renderer: builds lines from the bridge's normalized payload and drives
// word / line highlighting and scrolling every frame.
const Lyrics = (() => {
  const $ = id => document.getElementById(id);
  let lines = [];      // { el, t, e, state, dots?, syl?: [{ el, t, e, sp }], bg?: [...] }
  let synced = false, anchor = -2, onSeek = null, data;

  // 'orig' keeps the original script; 'roman' prefers the provider's romanization, else our own.
  const mode = text => {
    const r = Settings.S.roman;
    if (r === 'off') return 'orig';
    return r === 'smart' && Roman.hasDeva(text) ? 'orig' : 'roman'; // Hindi (even partly) stays as is
  };
  const pick = (s = '', r, m, cap = true) => (window.cleanWords ?? (t => t))(
    m === 'orig' ? (s || r || '') : (r ?? (Roman.isIndic(s) ? Roman.translit(s, cap) : s)));

  // Spicy's letter mode: a long-held short word glows and lifts letter by letter, each letter owning an equal
  // slice of the word's time. Scripts with combining marks (Indic, Arabic...) stay whole - splitting breaks them.
  const letterable = (text, x) => Settings.S.letters && x.e - x.t >= Settings.S.lettersMin && !x.p && !(x.i > 0 && x.prevP) &&
    /^[\p{L}\p{N}'’!?,.-]{2,12}$/u.test(text) && !/\p{M}/u.test(text);

  function syllables(container, syls, m) {
    const out = [];
    let group = null;
    syls.forEach((x, i) => {
      const text = pick(x.s, x.r, m, i === 0);
      if (letterable(text, { ...x, i, prevP: syls[i - 1]?.p })) {
        const g = document.createElement('span'), ch = Array.from(text), step = (x.e - x.t) / ch.length;
        g.className = 'wg lw';
        ch.forEach((c, k) => {
          const el = document.createElement('span');
          el.className = 'sy lt';
          el.textContent = c;
          g.append(el);
          out.push({ el, t: x.t + step * k, e: x.t + step * (k + 1), emph: true });
        });
        container.append(g);
        if (i < syls.length - 1) container.append(' ');
        return;
      }
      const el = document.createElement('span');
      el.className = 'sy';
      el.textContent = text;
      // IsPartOfWord joins a syllable to the next one: keep the word together, no space.
      if (x.p || (syls[i - 1]?.p && group)) {
        if (!group) { group = document.createElement('span'); group.className = 'wg'; container.append(group); }
        group.append(el);
        if (!x.p) group = null;
      } else container.append(el);
      if (!x.p && i < syls.length - 1) container.append(' ');
      out.push({ el, t: x.t, e: x.e });
    });
    return out;
  }

  const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  const div = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; return d; };

  // Interlude: three dots, each owning a third of the gap (Spicy's musical-line / dotGroup).
  function dots(t, e) {
    const el = div('ln dots'), group = div('dotGroup');
    const third = (e - t) / 3;
    const dd = [0, 1, 2].map(i => ({ el: div('dt'), t: t + third * i, e: t + third * (i + 1) }));
    group.append(...dd.map(d => d.el));
    el.append(group);
    // Intro only: 3 · 2 · 1 above the dots in the last three seconds (Settings -> Countdown before singing).
    const cd = t === 0 ? div('cd') : null;
    if (cd) el.prepend(cd);
    lines.push({ el, t, e, dots: true, grp: { el: group, t, e }, dd, cd });
    return el;
  }

  // ---- normalization shared by the desktop cache (via the bridge) and the Spicy Lyrics API (api.js).
  const PROVIDERS = [['spicy_lyrics', 'Spicy Lyrics'], ['apple_music', 'Apple Music'], ['spotify', 'Spotify'],
    ['spl', 'Spicy Lyrics'], ['aml', 'Apple Music'], ['spt', 'Spotify'], ['ldb', 'Local DB']];
  const provider = src => typeof src === 'string'
    ? PROVIDERS.find(([k]) => src.toLowerCase().includes(k))?.[1] ?? 'Unknown source' : 'Unknown source';
  // Community syncs credit their uploader and maker (required by the API terms); other sources have none.
  const contributors = a => [['Synced by', a?.Maker], ['Uploaded by', a?.Uploader]]
    .filter(([, p]) => p?.username).map(([role, p]) => ({ role, name: p.username, url: p.url }));

  function fromSpicy(L) {
    const syl = s => ({ s: s.Text, r: s.TransliteratedText, t: s.StartTime * 1000, e: s.EndTime * 1000, p: !!s.IsPartOfWord });
    const vocal = (L?.Content ?? []).filter(v => v.Type === 'Vocal');
    let kind, lines;
    if (L?.Type === 'Syllable') {
      kind = 'word';
      lines = vocal.map(v => ({ t: v.Lead.StartTime * 1000, e: v.Lead.EndTime * 1000, opp: !!v.OppositeAligned,
        w: v.Lead.Syllables.map(syl), bg: (v.Background ?? []).flatMap(b => b.Syllables.map(syl)) }));
    } else if (L?.Type === 'Line') {
      kind = 'line';
      lines = vocal.map(v => ({ t: v.StartTime * 1000, e: v.EndTime * 1000, opp: !!v.OppositeAligned, s: v.Text, r: v.TransliteratedText }));
    } else if (L?.Type === 'Static') {
      kind = 'static';
      lines = (L.Lines ?? []).map(l => ({ s: l.Text, r: l.TransliteratedText }));
    } else return null;
    return lines.length ? { kind, lines, writers: L.SongWriters ?? [], source: provider(L.source),
      contributors: contributors(L.UploadAttribution) } : null;
  }
  const rank = l => ({ word: 3, line: 2, static: 1 })[l?.kind] ?? 0;

  function build(lyr) {
    data = lyr;
    lines = [];
    anchor = -2;
    const box = $('lyrics'), list = $('lines');
    box.classList.remove('static');
    list.style.transition = 'none';
    list.style.transform = '';
    if (!lyr) {
      synced = false;
      list.replaceChildren(...[.9, .7, .8].map(w => { const s = div('ln skel'); s.style.width = w * 100 + '%'; return s; }));
      return;
    }
    if (lyr.kind === 'none' || !lyr.lines?.length) {
      synced = false;
      list.replaceChildren(div('ln empty', 'No lyrics for this song'));
      return;
    }
    synced = lyr.kind !== 'static';
    const frag = [];
    const S = Settings.S, gap = S.dotsGap * 1000;
    if (synced && S.dots && lyr.lines[0].t > Math.min(3000, gap)) frag.push(dots(0, lyr.lines[0].t));
    lyr.lines.forEach((ln, i) => {
      const el = div('ln' + (ln.opp ? ' opp' : ''));
      const entry = { el, t: ln.t, e: ln.e };
      if (lyr.kind === 'word') {
        const main = div('main');
        el.append(main);
        entry.syl = syllables(main, ln.w, mode(ln.w.map(x => x.s).join('')));
        if (ln.bg?.length) {
          const b = div('bgv');
          el.append(b);
          entry.bg = syllables(b, ln.bg, mode(ln.bg.map(x => x.s).join('')));
        }
      } else el.textContent = pick(ln.s, ln.r, mode(ln.s || '')) || '♪';
      if (synced) el.onclick = () => Settings.S.tapSeek && onSeek?.(ln.t);
      if (Roman.isIndic(el.textContent)) el.classList.add('indic'); // taller line box for matras
      if (RTL.test(el.textContent)) { el.dir = 'rtl'; el.classList.add('rtl'); } // Urdu / Arabic / Hebrew kept in script
      lines.push(entry);
      frag.push(el);
      const next = lyr.lines[i + 1];
      if (synced && S.dots && next && next.t - ln.e > gap) frag.push(dots(ln.e, next.t));
    });
    // Provider is always shown when known (API terms: attribution goes wherever the lyrics are).
    if (lyr.writers?.length || lyr.source) {
      const c = div('credits');
      if (Settings.S.credits && lyr.writers?.length) c.append(div('writers', `Written by: ${lyr.writers.join(', ')}`));
      if (lyr.source) c.append(div('provider', `Provided by: ${lyr.source}`));
      for (const p of lyr.contributors ?? []) {
        const row = div('provider'), a = document.createElement('a');
        a.textContent = p.name;
        if (/^https:\/\//.test(p.url || '')) a.href = p.url;
        a.onclick = e => e.preventDefault(); // kiosk: no browser to open, the link is for credit
        row.append(`${p.role} `, a);
        c.append(row);
      }
      frag.push(c);
    }
    list.replaceChildren(...frag);
    if (!synced) box.classList.add('static');
    list.offsetHeight;
    list.style.transition = '';
    if (synced) scrollTo(0, true);
  }

  // Line states mirror Spicy Lyrics: NotSung / Active / Sung. Words in active lines run Spicy's springs.
  // Scroll lead: like Spicy, the list starts moving to the next line a moment before it is sung, so the eye is
  // already there. A seek (position jumps against the clock) snaps instead of sweeping through every line.
  let lastP = null;
  function update(p, dt) {
    if (!synced) return;
    const jumped = lastP !== null && Math.abs(p - lastP - dt * 1000) > 1500;
    lastP = p;
    const S = Settings.S, opts = { lift: S.lift, glow: S.glow, liftK: S.liftAmount, glowK: S.glowStrength };
    let a = -1;
    for (let i = 0; i < lines.length; i++) {
      const x = lines[i];
      const state = p < x.t ? 'ns' : p >= x.e ? 'sung' : 'on';
      if (x.t <= p + S.scrollLead) a = i;
      if (state !== x.state) {
        if (x.state === 'on' && x.syl) { Anim.rest(x.syl, state === 'sung'); if (x.bg) Anim.rest(x.bg, state === 'sung'); }
        if (x.state === 'on' && x.dots) Anim.restDots(x);
        x.state = state;
        x.el.classList.toggle('on', state === 'on');
        x.el.classList.toggle('sung', state === 'sung');
      }
      if (state !== 'on') continue;
      if (x.syl) {
        for (const w of x.syl) Anim.word(w, p, dt, opts);
        if (x.bg) for (const w of x.bg) Anim.word(w, p, dt, opts);
      } else if (x.dots) {
        Anim.dotGroup(x.grp, p, dt);
        if (x.cd) { const r = Math.ceil((x.e - p) / 1000), v = S.countdown && r <= 3 && r > 0 ? String(r) : ''; if (x.cd.textContent !== v) x.cd.textContent = v; }
        for (const d of x.dd) Anim.dot(d, p, dt);
      }
    }
    if (a !== anchor || jumped) scrollTo(a, jumped);
  }

  // ---- free scroll (Spicy Lyrics): drag the lyrics up/down to read ahead or back, with a flick; all lines show
  // clearly while free, and the view glides back to the sung line S.scrollBack seconds after the finger lifts.
  let curY = 0, free = false, backT = 0, drag = null, fling = 0;
  const box = () => $('lyrics'), list = () => $('lines');
  const clampY = y => { const h = box().clientHeight, total = list().offsetHeight; return Math.min(h * 0.5, Math.max(h * 0.5 - total, y)); };
  const setY = (y, ease) => { curY = clampY(y); list().style.transition = ease ? '' : 'none'; list().style.transform = `translate3d(0, ${curY}px, 0)`; };
  function release() {
    clearTimeout(backT);
    backT = setTimeout(() => { free = false; box().classList.remove('free'); if (synced) scrollTo(anchor, false); }, Settings.S.scrollBack * 1000);
  }
  box().addEventListener('touchstart', e => {
    if (!synced || e.touches.length !== 1) return;
    cancelAnimationFrame(fling);
    drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, y0: curY, on: false, t: performance.now(), v: 0, ly: e.touches[0].clientY };
  }, { passive: true });
  box().addEventListener('touchmove', e => {
    if (!drag) return;
    const t = e.touches[0], dx = t.clientX - drag.x, dy = t.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) > Math.abs(dy) || Math.abs(dy) < 10) return; // horizontal = swipe to skip (features.js)
      drag.on = true; free = true; clearTimeout(backT); box().classList.add('free');
    }
    const now = performance.now();
    drag.v = (t.clientY - drag.ly) / Math.max(1, now - drag.t); drag.t = now; drag.ly = t.clientY;
    setY(drag.y0 + dy, false);
  }, { passive: true });
  box().addEventListener('touchend', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    let v = d.v * 16; // px per frame
    const step = () => { if (Math.abs(v) < 0.4) return release(); setY(curY + v, false); v *= 0.94; fling = requestAnimationFrame(step); };
    step();
  }, { passive: true });
  const isFree = () => free;

  function scrollTo(a, instant) {
    anchor = a;
    if (free) { // keep the line states, leave the scroll where the finger put it
      lines.forEach((x, k) => x.el.classList.toggle('past', k < a));
      return;
    }
    const i = Math.max(a, 0);
    lines.forEach((x, k) => {
      const d = Math.min(3, Math.abs(k - i));
      if (x.d !== d) { x.d = d; x.el.dataset.d = d; }
      x.el.classList.toggle('past', k < a);
      x.el.classList.toggle('far', Math.abs(k - i) > Settings.S.renderDistance); // off screen: skip painting it (long songs)
    });
    const el = lines[i]?.el;
    if (!el) return;
    const frac = document.body.classList.contains('layout-cinema') ? 0.5 : Settings.S.anchor;
    const y = $('lyrics').clientHeight * frac - el.offsetTop - el.offsetHeight / 2;
    const ls = $('lines');
    curY = y;
    if (instant) ls.style.transition = 'none'; else ls.style.transition = '';
    ls.style.transform = `translate3d(0, ${y}px, 0)`;
    if (instant) { ls.offsetHeight; ls.style.transition = ''; }
  }

  // How busy the vocals are around p, 0..1 (null without synced lyrics): drives 'Move with the music' now that
  // Spotify's audio analysis is gone. Singing = lively, faster words = livelier, instrumental gaps = calm.
  function energy(p) {
    if (!synced) return null;
    let on = false, starts = 0;
    for (const x of lines) {
      if (x.dots) continue;
      if (p >= x.t && p < x.e) on = true;
      if (x.syl) { for (const w of x.syl) if (w.t <= p && w.t > p - 2000) starts++; }
      else if (x.t <= p && x.t > p - 2000) starts += 4; // line-synced: a line start counts as a few words
    }
    return on ? Math.min(1, 0.45 + starts / 12) : 0.12;
  }

  return {
    energy,
    build,
    update,
    fromSpicy,
    rank,
    rebuild: () => build(data),
    refresh: () => synced && scrollTo(anchor, true),
    isFree,
    onSeek: f => { onSeek = f; },
  };
})();
