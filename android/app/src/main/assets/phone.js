// Sources that know a song only by name - another app on this phone (Phone, below) or on the PC (pc.js) - send the same
// track / pos messages as the other sources. Named() adds their lyrics: the Spicy API when the player names a Spotify
// track (Spotify's own app does), else LRCLIB by title, artist and length. (app.js topUp asks NetEase / QQ / Kugou too.)
// The Spotify track for a song known by name, so the Spicy API's word-synced lyrics work for it too. Searched with the
// signed-in Spotify account (spotify.js), else through LyricDock's server (web/src/worker.js /lyrics/spotify). Cautious:
// title and an artist must match, the length within 5 s, and a live / remix / acoustic... version never stands in for
// the studio one (no lyrics beat the wrong song's). Weights 55/30/15 title/artist/length, after SpotMatch.
const Match = (() => {
  const norm = s =>
    String(s || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/\s*[([][^)\]]*[)\]]/g, '')
      .replace(/\s+-\s+.*$/, '')
      .replace(/\s(feat|ft|with)\.?\s.*$/, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const artists = s =>
    String(s || '')
      .split(/[、/&,;，]|\sx\s|\sand\s|\sfeat\.?\s|\sft\.?\s/i)
      .map(norm)
      .filter(Boolean);
  const VERSION =
    /\b(live|remix|mix|acoustic|instrumental|karaoke|sped up|slowed|reverb|nightcore|cover|demo|version|8d)\b/i;
  const versions = s =>
    new Set(
      (
        String(s || '')
          .toLowerCase()
          .match(new RegExp(VERSION.source, 'gi')) ?? []
      ).map(x => x.toLowerCase()),
    );
  function score(want, c) {
    const a = norm(want.title),
      b = norm(c.title);
    const t = a === b ? 1 : a && b && (a.startsWith(b + ' ') || b.startsWith(a + ' ')) ? 0.7 : 0;
    const ar = artists(want.artist).some(x => artists(c.artist).includes(x)) ? 1 : 0;
    const d =
      !want.dur || !c.dur
        ? 0.5
        : Math.abs(want.dur - c.dur) <= 2000
          ? 1
          : Math.abs(want.dur - c.dur) <= 5000
            ? 0.5
            : -9;
    const vw = versions(want.title),
      vc = versions(c.title);
    if (!t || !ar || d < 0 || vw.size !== vc.size || [...vw].some(v => !vc.has(v))) return 0;
    return 0.55 * t + 0.3 * ar + 0.15 * d;
  }
  async function candidates(q) {
    const own = await window.Web?.search(q).catch(() => null);
    if (own) return own;
    if (!(window.LYRICDOCK_WEB || window.Account?.user())) return [];
    return fetch('https://app.lyricdock.losthusky.qzz.io/lyrics/spotify?' + new URLSearchParams({ q }), {
      headers: { Accept: 'application/json', ...(window.Account?.headers() ?? {}) },
    })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  const seen = new Map(); // title|artist|length -> Promise<id|null>
  function find(t) {
    const k = `${t.title}|${t.artist}|${Math.round((t.dur || 0) / 2000)}`;
    if (!seen.has(k)) {
      const a1 = artists(t.artist)[0] ?? '';
      seen.set(
        k,
        (async () => {
          // An ISRC (Shazam gives one, listen.js) names the recording itself: its first hit is the one.
          if (t.isrc) {
            const hit = (await candidates(`isrc:${t.isrc}`))[0];
            if (hit) return hit;
          }
          for (const q of [`track:"${norm(t.title)}" artist:"${a1}"`, `${t.title} ${a1}`]) {
            const best = (await candidates(q))
              .map(c => [score(t, c), c])
              .filter(([s]) => s >= 0.7)
              .sort((x, y) => y[0] - x[0])[0];
            if (best) return best[1];
          }
          return null;
        })(),
      );
      if (seen.size > 30) seen.delete(seen.keys().next().value);
    }
    return seen.get(k);
  }
  return { find, score };
})();

function Named() {
  let out = () => {},
    cur = null,
    lyr = null, // the lyrics found for cur: a later message for the same song (its cover) must carry them too
    asked = null,
    wait = 0,
    sharp = null; // {id, art}: Spotify's 640 px cover for the song, once Match found it (players' own are often 120 px)
  // The Spicy API by the Spotify ID (the player's own, or Match's) and LRCLIB side by side; each answer offered as it lands
  // (app.js keeps whichever ranks higher). Api.get ignores ids that aren't Spotify's.
  const find = t => {
    clearTimeout(wait);
    asked = t.id;
    const give = l => {
      if (!l || cur?.id !== t.id) return;
      if (!lyr || Lyrics.rank(l) > Lyrics.rank(lyr)) lyr = l;
      out({ ...cur, lyrics: l });
    };
    if (/^[A-Za-z0-9]{22}$/.test(t.id)) Api.get(t.id).then(give);
    else
      Match.find(t).then(c => {
        if (!c && !t.dur && cur?.id === t.id) Lrclib.get(t).then(give); // no match and no length: LRCLIB as it is
        if (!c || cur?.id !== t.id) return;
        // Spotify's cover, and its length where the source has none (Listen): the clock and LRCLIB need it
        sharp = { id: t.id, art: c.art || cur.art, dur: cur.dur || c.dur };
        cur = { ...cur, art: sharp.art, dur: sharp.dur };
        out({ ...cur, lyrics: lyr });
        Api.get(c.id).then(give);
        if (!t.dur) Lrclib.get(cur).then(give);
      });
    // Without a length LRCLIB can't tell same-named songs apart: then it waits for Spotify's (above)
    if (t.dur) Lrclib.get(t).then(give);
  };
  return {
    msg(m) {
      if (m.type !== 'track') return out(cur?.dur && !m.dur ? { ...m, dur: cur.dur } : m);
      const same = cur?.id === m.id; // the same song again: its cover or length came in late, or the page reloaded
      if (sharp?.id === m.id) m = { ...m, art: sharp.art, dur: m.dur || sharp.dur };
      cur = m;
      if (!same) lyr = null;
      out({ ...m, lyrics: lyr });
      if (asked === m.id) return;
      // YouTube Music names the song a moment before its length. Without the length LRCLIB can't tell songs of the same
      // name apart ("Hypnotized" found somebody else's), so the lookup waits for it - up to 2 s, for players that never say.
      // A song with an ISRC (Listen) never gets one from its source: Spotify's comes through Match at once.
      if (m.dur || m.isrc) find(m);
      else if (!same) {
        clearTimeout(wait);
        wait = setTimeout(() => cur?.id === m.id && asked !== m.id && find(cur), 2000);
      }
    },
    app: () => cur?.appName || '',
    dur: () => cur?.dur || 0,
    onMessage: f => (out = f),
  };
}

// Playback source "Any app on this phone" (Android only): PlayerWatch.java follows the media session of whatever plays
// on the phone (YouTube Music, Apple Music, Spotify, a browser...) and calls phoneMsg().
const Phone = (() => {
  const n = Named();
  window.phoneMsg = n.msg;
  const call = (f, ...a) => {
    try {
      return window.Dock?.[f]?.(...a);
    } catch (e) {}
  };
  return {
    available: () => !window.LYRICDOCK_WEB && typeof window.Dock?.phoneAccess === 'function',
    allowed: () => !!call('phoneAccess'),
    openAccess: () => call('openPhoneAccess'),
    control: (c, arg) => call('phoneCmd', c, +arg || 0),
    app: n.app,
    onMessage: f => {
      n.onMessage(f);
      call('phoneResend'); // a song already playing is sent again now that someone listens
    },
  };
})();
window.Phone = Phone;
