// One touch = one gesture. Every touch handler asks here before acting: the first one to claim a touch owns it (lyrics
// scroll, skip swipe, cover swipe, timeline scrub, layout swipe...) and everything else stands down until the finger lifts.
// A "tap" is a touch nobody claimed that barely moved, was short and used one finger: only taps show the controls, seek a
// tapped line or count towards a double-tap. Without this, scrolling the lyrics also showed the controls, lifting the
// finger seeked to the line under it, and a slightly diagonal scroll could skip the song.
const Gesture = (() => {
  let g = null;
  const opt = { capture: true, passive: true };
  addEventListener('touchstart', e => {
    const t = e.touches[0];
    if (e.touches.length === 1) g = { x: t.clientX, y: t.clientY, t: performance.now(), end: 0, owner: null, moved: false, multi: false };
    else if (g) g.multi = true;
  }, opt);
  addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (g && t && Math.hypot(t.clientX - g.x, t.clientY - g.y) > 10) g.moved = true;
  }, opt);
  addEventListener('touchend', e => { if (g && !e.touches.length) g.end = performance.now(); }, opt);
  return {
    // true = this handler owns the touch now (or already did); false = someone else has it
    claim: name => !g || (g.owner ?? (g.owner = name)) === name,
    owner: () => g?.owner ?? null,
    // What the finger did so far: dx/dy from where it went down.
    delta: e => { const t = e.touches?.[0] ?? e.changedTouches?.[0] ?? e; return g ? { dx: t.clientX - g.x, dy: t.clientY - g.y } : { dx: 0, dy: 0 }; },
    // The last touch was a plain tap (mouse clicks in the browser preview count too).
    tap: () => !g || (!g.owner && !g.moved && !g.multi && (g.end || performance.now()) - g.t < 450),
  };
})();

// Lyrics renderer: builds lines from the bridge's normalized payload and drives
// word / line highlighting and scrolling every frame.
const Lyrics = (() => {
  const $ = id => document.getElementById(id);
  const BOX = $('lyrics'), LIST = $('lines');
  let lines = [];      // { el, t, e, state, cool?, lk?, dots?, syl?: [{ el, t, e, sp, g? }], bg?: [...] }
  let synced = false, anchor = -2, onSeek = null, data;
  // A just-sung line keeps animating this long, so the glow and lift of its last words spring back instead of being
  // cut off the moment the line ends (Spicy keeps stepping a sung line until the next one is done).
  const COOL = 1200;

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
        const g = document.createElement('span'), ch = Array.from(text);
        // The letters share [start, end - 250 ms] (Spicy): the last one has landed before the word is over.
        const end = x.e - 250 > x.t + 300 ? x.e - 250 : x.e, step = (end - x.t) / ch.length;
        const grp = { ls: [], t: x.t, e: end, at: NaN, act: -1, pct: 0 };
        g.className = 'wg lw';
        ch.forEach((c, k) => {
          const el = document.createElement('span');
          el.className = 'sy lt';
          el.textContent = c;
          el.dataset.t = c; // the glow copy (style.css .sy::after)
          g.append(el);
          const L = { el, t: x.t + step * k, e: x.t + step * (k + 1), g: grp, k };
          grp.ls.push(L);
          out.push(L);
        });
        container.append(g);
        if (i < syls.length - 1) container.append(' ');
        return;
      }
      const el = document.createElement('span');
      el.className = 'sy' + (x.p ? ' pw' : '') + (syls[i - 1]?.p ? ' pn' : ''); // joined pieces of one word (see style.css)
      el.textContent = text;
      el.dataset.t = text;
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

  const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/; // escapes, not literals: an NFC pass once split U+FB1D and the range swallowed Devanagari
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

  // ---- scrolling: a critically damped spring on #lines' transform (Spicy's smooth scroll). Unlike a CSS transition it keeps
  // its velocity when the target changes mid-flight, so quick line changes read as one glide, and it moves in sub-pixels.
  const FEEL = { smooth: [1.05, 1], spring: [1.5, 0.62], snappy: [2.4, 1] }; // [frequency Hz, damping ratio] (Settings -> Lyrics scroll)
  const sc = { sp: new Anim.Spring(0, 1, 1), on: false };
  let curY = 0, free = false, backT = 0, drag = null, fling = 0;
  const writeY = y => { LIST.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`; };
  function scrollStep(dt) {
    if (!sc.on || free) return;
    const [f, d] = FEEL[Settings.S.scroll] ?? FEEL.smooth;
    sc.sp.f = f * Settings.S.animSpeed; sc.sp.d = d;
    curY = sc.sp.step(dt);
    if (Math.abs(curY - sc.sp.g) < 0.05 && Math.abs(sc.sp.v) < 0.3) { curY = sc.sp.g; sc.on = false; }
    writeY(curY);
  }

  function build(lyr) {
    data = lyr;
    lines = [];
    anchor = -2;
    sc.on = false; sc.sp.set(0, true); curY = 0;
    BOX.classList.remove('static', 'placeholder');
    document.body.classList.toggle('nolyrics', !!lyr && (lyr.kind === 'none' || !lyr.lines?.length));
    window.fitArt?.();
    LIST.style.transform = '';
    LIST.classList.toggle('duet', !!lyr?.lines?.some(l => l.opp));
    if (!lyr) {
      synced = false;
      BOX.classList.add('placeholder');
      LIST.replaceChildren(...[.9, .7, .8].map(w => { const s = div('ln skel'); s.style.width = w * 100 + '%'; return s; }));
      return;
    }
    if (lyr.kind === 'none' || !lyr.lines?.length) {
      synced = false;
      BOX.classList.add('placeholder');
      LIST.replaceChildren(div('ln empty', 'No lyrics for this song'));
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
      } else {
        el.textContent = pick(ln.s, ln.r, mode(ln.s || '')) || '♪';
        if (synced) { entry.lk = true; el.classList.add('lk'); }
      }
      // A tap seeks a little before the line: Spotify fades the audio in after a seek, so landing exactly on the first
      // syllable swallows it (Spicy: 300 ms).
      if (synced) el.onclick = () => Settings.S.tapSeek && Gesture.tap() && onSeek?.(Math.max(0, ln.t - (Settings.S.seekComp ? 300 : 0)));
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
    LIST.replaceChildren(...frag);
    if (!synced) BOX.classList.add('static');
    LIST.offsetHeight;
    if (synced) scrollTo(0, true);
  }

  // A line that stopped animating: springs back to rest and the inline styles go, so the next pass starts clean.
  function settle(x, sung) {
    x.cool = 0;
    x.el.classList.remove('cool');
    if (x.syl) { Anim.rest(x.syl, sung); if (x.bg) Anim.rest(x.bg, sung); }
    if (x.lk) Anim.restLine(x);
    if (x.dots) Anim.restDots(x);
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
        const was = x.state;
        x.state = state;
        x.el.classList.toggle('on', state === 'on');
        x.el.classList.toggle('sung', state === 'sung');
        if (was === 'on') {
          if (state === 'sung' && (x.syl || x.lk)) { x.cool = p + COOL; x.el.classList.add('cool'); } // let the glow settle
          else settle(x, false);
        } else if (state === 'on' && x.syl) { Anim.rest(x.syl, false); if (x.bg) Anim.rest(x.bg, false); } // a seek landed here: start at rest
      }
      if (x.cool && (state !== 'sung' || p >= x.cool)) settle(x, state === 'sung');
      if (state !== 'on' && !x.cool) continue;
      if (x.syl) {
        for (const w of x.syl) (w.g ? Anim.letter : Anim.word)(w, p, dt, opts);
        if (x.bg) for (const w of x.bg) (w.g ? Anim.letter : Anim.word)(w, p, dt, opts);
      } else if (x.lk) {
        Anim.line(x, p, dt, opts);
      } else if (x.dots) {
        Anim.dotGroup(x.grp, p, dt);
        if (x.cd) { const r = Math.ceil((x.e - p) / 1000), v = S.countdown && r <= 3 && r > 0 ? String(r) : ''; if (x.cd.textContent !== v) x.cd.textContent = v; }
        for (const d of x.dd) Anim.dot(d, p, dt);
      }
    }
    if (a !== anchor || jumped) scrollTo(a, jumped || anchor === -2);
    scrollStep(dt);
  }

  // ---- free scroll (Spicy Lyrics): drag the lyrics up/down to read ahead or back, with a flick; all lines show
  // clearly while free, and the view glides back to the sung line S.scrollBack seconds after the finger lifts.
  const clampY = y => { const h = BOX.clientHeight, total = LIST.offsetHeight; return Math.min(h * 0.5, Math.max(h * 0.5 - total, y)); };
  const setY = y => { curY = clampY(y); sc.on = false; writeY(curY); };
  function release() {
    clearTimeout(backT);
    backT = setTimeout(() => { free = false; BOX.classList.remove('free'); if (synced) scrollTo(anchor, false); }, Settings.S.scrollBack * 1000);
  }
  BOX.addEventListener('touchstart', e => {
    if (!synced || e.touches.length !== 1) return;
    cancelAnimationFrame(fling);
    drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, y0: curY, on: false, t: performance.now(), v: 0, ly: e.touches[0].clientY };
  }, { passive: true });
  BOX.addEventListener('touchmove', e => {
    if (drag && e.touches.length > 1) { if (drag.on) release(); drag = null; } // a multi-finger gesture: not a scroll
    if (!drag) return;
    const t = e.touches[0], dx = t.clientX - drag.x, dy = t.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) > Math.abs(dy) || Math.abs(dy) < 10) return; // horizontal = swipe to skip (features.js)
      if (!Gesture.claim('lyrics')) { drag = null; return; } // a skip swipe or the cover got it first
      drag.on = true; free = true; clearTimeout(backT); BOX.classList.add('free');
    }
    const now = performance.now();
    drag.v = (t.clientY - drag.ly) / Math.max(1, now - drag.t); drag.t = now; drag.ly = t.clientY;
    setY(drag.y0 + dy);
  }, { passive: true });
  BOX.addEventListener('touchend', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    let v = d.v * 16; // px per frame
    const step = () => { if (Math.abs(v) < 0.4) return release(); setY(curY + v); v *= 0.94; fling = requestAnimationFrame(step); };
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
    const y = BOX.clientHeight * frac - el.offsetTop - el.offsetHeight / 2;
    if (instant) { sc.sp.set(y, true); sc.on = false; curY = y; writeY(y); return; }
    if (!sc.on) sc.sp.set(curY, true); // start from wherever the list really is, at rest
    sc.sp.set(y);
    sc.on = true;
  }

  // How busy the vocals are around p, 0..1 (null without synced lyrics): drives 'Move with the music' now that
  // Spotify's audio analysis is gone. Singing = lively, faster words = livelier, instrumental gaps = calm.
  function energy(p) {
    if (!synced) return null;
    let on = false, starts = 0;
    for (const x of lines) {
      if (x.dots) continue;
      if (p >= x.t && p < x.e) on = true;
      if (x.syl) { for (const w of x.syl) if (!(w.g && w.k) && w.t <= p && w.t > p - 2000) starts++; } // one start per letter group
      else if (x.t <= p && x.t > p - 2000) starts += 4; // line-synced: a line start counts as a few words
    }
    return on ? Math.min(1, 0.45 + starts / 12) : 0.12;
  }

  // Widgets / lock screen: the line being sung at p (ms) and its neighbours, as plain text. Instrumental gaps -> ''.
  function lineAt(p) {
    if (!synced || !lines.length) return null;
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= p; k++) i = k;
    const text = x => (x && !x.dots ? x.el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '');
    const on = i >= 0 && p < lines[i].e + 1500; // a little after the line ends, then the gap shows as empty
    return { i, text: on ? text(lines[i]) : '', t: lines[i]?.t, e: lines[i]?.e, prev: text(lines[i - 1]), next: [text(lines[i + 1]), text(lines[i + 2])].filter(Boolean) };
  }

  return {
    energy,
    build,
    update,
    lineAt,
    fromSpicy,
    rank,
    rebuild: () => build(data),
    refresh: () => synced && scrollTo(anchor, true),
    isFree,
    onSeek: f => { onSeek = f; },
  };
})();
