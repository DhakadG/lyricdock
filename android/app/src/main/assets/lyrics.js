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
  const pick = (s = '', r, m, cap = true) =>
    m === 'orig' ? (s || r || '') : (r ?? (Roman.isIndic(s) ? Roman.translit(s, cap) : s));

  function syllables(container, syls, m) {
    const out = [];
    let group = null;
    syls.forEach((x, i) => {
      const el = document.createElement('span');
      el.className = 'sy';
      el.textContent = pick(x.s, x.r, m, i === 0);
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

  const div = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; return d; };

  // Interlude: three dots, each owning a third of the gap (Spicy's musical-line / dotGroup).
  function dots(t, e) {
    const el = div('ln dots'), group = div('dotGroup');
    const third = (e - t) / 3;
    const dd = [0, 1, 2].map(i => ({ el: div('dt'), t: t + third * i, e: t + third * (i + 1) }));
    group.append(...dd.map(d => d.el));
    el.append(group);
    lines.push({ el, t, e, dots: true, grp: { el: group, t, e }, dd });
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
    if (synced && lyr.lines[0].t > 3000) frag.push(dots(0, lyr.lines[0].t));
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
      lines.push(entry);
      frag.push(el);
      const next = lyr.lines[i + 1];
      if (synced && next && next.t - ln.e > 4000) frag.push(dots(ln.e, next.t));
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
  function update(p, dt) {
    if (!synced) return;
    const opts = { lift: Settings.S.lift, glow: Settings.S.glow };
    let a = -1;
    for (let i = 0; i < lines.length; i++) {
      const x = lines[i];
      const state = p < x.t ? 'ns' : p >= x.e ? 'sung' : 'on';
      if (x.t <= p) a = i;
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
        for (const d of x.dd) Anim.dot(d, p, dt);
      }
    }
    if (a !== anchor) scrollTo(a);
  }

  function scrollTo(a, instant) {
    anchor = a;
    const i = Math.max(a, 0);
    lines.forEach((x, k) => {
      const d = Math.min(3, Math.abs(k - i));
      if (x.d !== d) { x.d = d; x.el.dataset.d = d; }
      x.el.classList.toggle('past', k < a);
    });
    const el = lines[i]?.el;
    if (!el) return;
    const frac = document.body.classList.contains('layout-cinema') ? 0.5 : Settings.S.anchor;
    const y = $('lyrics').clientHeight * frac - el.offsetTop - el.offsetHeight / 2;
    const list = $('lines');
    if (instant) list.style.transition = 'none';
    list.style.transform = `translate3d(0, ${y}px, 0)`;
    if (instant) { list.offsetHeight; list.style.transition = ''; }
  }

  return {
    build,
    update,
    fromSpicy,
    rank,
    rebuild: () => build(data),
    refresh: () => synced && scrollTo(anchor, true),
    onSeek: f => { onSeek = f; },
  };
})();
