// Blends (after Spicy Lyrics Mobile's LyricsBlender): the best-written lyrics a song has (Apple Music / Spotify / LRCLIB
// text, synced by line or not at all) with the word timing of a catalogue that has it (NetEase / Kugou, whose own text is
// often worse: no punctuation, other spellings). The two are lined up word by word (longest common subsequence over the
// whole song); matched words take the donor's times, the rest are spread over the gaps between them. Too few matches
// (another edit, another language) and there is no blend. Shown as "Blend" in Settings -> Lyrics sources.
const Blend = (() => {
  const DONORS = ['NetEase', 'Kugou'],
    CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}',
    TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+`, 'gu');
  const norm = s =>
    String(s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const isCjk = s => new RegExp(`^[${CJK}]$`, 'u').test(s);

  // The donor's words, syllables joined into words, with their times.
  function donorWords(d) {
    const out = [];
    for (const l of d.lines)
      for (let i = 0; i < (l.w?.length ?? 0); i++) {
        const w = l.w[i],
          prev = out[out.length - 1];
        if (prev?.open) Object.assign(prev, { s: prev.s + w.s, e: w.e, open: !!w.p });
        else out.push({ s: w.s, t: w.t, e: w.e, open: !!w.p && !isCjk(w.s) });
      }
    return out.map(w => ({ ...w, k: norm(w.s) })).filter(w => w.k);
  }

  // Longest common subsequence of two key lists: for each a, the matched index in b (or -1).
  function lcs(a, b) {
    const n = a.length,
      m = b.length,
      L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const at = new Int32Array(n).fill(-1);
    for (let i = 0, j = 0; i < n && j < m;)
      if (a[i] === b[j]) at[i++] = j++;
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    return at;
  }

  // Evenly through [from, to] for k words (at least 120 ms each).
  const spread = (k, from, to) => {
    const step = Math.max(120, (to - from) / Math.max(1, k));
    return Array.from({ length: k }, (_, i) => [from + i * step, from + (i + 1) * step]);
  };

  function blend(base, donor) {
    const dw = donorWords(donor);
    if (!dw.length) return null;
    const lines = base.lines
      .map(l => ({ l, toks: (String(l.s ?? '').match(TOKEN) ?? []).map(s => ({ s, k: norm(s), cjk: isCjk(s) })) }))
      .filter(x => x.toks.length);
    const flat = lines.flatMap((x, li) => x.toks.map(t => ({ ...t, li })));
    const at = lcs(
      flat.map(t => t.k),
      dw.map(w => w.k),
    );
    const matched = [...at].filter(j => j >= 0).length;
    if (!flat.length || matched / flat.length < 0.6) return null;
    flat.forEach((t, i) => at[i] >= 0 && Object.assign(t, { t: dw[at[i]].t, e: dw[at[i]].e }));

    // per line: matched words keep their times; the others fill the gaps around them
    const out = [];
    lines.forEach((x, li) => {
      const toks = flat.filter(t => t.li === li),
        anchors = toks.filter(t => t.t != null);
      const prevEnd = out[out.length - 1]?.e ?? 0;
      if (!anchors.length) {
        // nothing matched: the base line's own time, else after the line before
        const from = Number.isFinite(x.l.t) ? x.l.t : prevEnd,
          to = Number.isFinite(x.l.e) ? x.l.e : from + 300 * toks.length;
        spread(toks.length, from, to).forEach(([t, e], i) => Object.assign(toks[i], { t, e }));
      } else
        for (let i = 0; i < toks.length;) {
          if (toks[i].t != null) {
            i++;
            continue;
          }
          let j = i;
          while (j < toks.length && toks[j].t == null) j++;
          const before = toks[i - 1],
            after = toks[j];
          const from = before ? before.e : Math.max(prevEnd, after.t - 300 * (j - i)),
            to = after ? after.t : before.e + 300 * (j - i);
          spread(j - i, from, Math.max(from + 120 * (j - i), to)).forEach(([t, e], k) =>
            Object.assign(toks[i + k], { t, e }),
          );
          i = j;
        }
      // a word is part of the next one only inside CJK runs (no spaces there)
      const w = toks.map((t, i) => ({
        s: t.s,
        t: Math.round(t.t),
        e: Math.round(Math.max(t.e, t.t + 60)),
        p: t.cjk && !!toks[i + 1]?.cjk,
      }));
      out.push({ t: w[0].t, e: w[w.length - 1].e, opp: !!x.l.opp, w, bg: [] });
    });
    return {
      kind: 'word',
      lines: out,
      writers: base.writers ?? [],
      source: 'Blend',
      via: `${base.source} words, ${donor.source} timing`,
      contributors: base.contributors ?? [],
    };
  }

  // From the versions a song has: the best-ranked text that isn't a donor's, with the best-ranked donor timing.
  function of(have, rank) {
    if (have.some(h => h.kind === 'word' && !DONORS.includes(h.source) && h.source !== 'Blend')) return null; // real word sync
    const by = list => list.sort((a, b) => rank(b) - rank(a))[0];
    const donor = by(have.filter(h => h.kind === 'word' && DONORS.includes(h.source))),
      base = by(
        have.filter(h => ['line', 'static'].includes(h.kind) && !DONORS.includes(h.source) && h.source !== 'Blend'),
      );
    return donor && base ? blend(base, donor) : null;
  }

  return { blend, of };
})();
