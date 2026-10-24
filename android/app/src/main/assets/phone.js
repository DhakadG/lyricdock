// Playback source "Any app on this phone" (Android only): PlayerWatch.java follows the media session of whatever plays
// on the phone (YouTube Music, Apple Music, Spotify, a browser...) and calls phoneMsg() with the same track / pos
// messages as the other sources. Lyrics are looked up here: the Spicy API when the player names a Spotify track (Spotify's
// own app does), else LRCLIB by title, artist and length.
const Phone = (() => {
  let out = () => {},
    cur = null,
    lyr = null; // the lyrics found for cur: a later message for the same song (its cover) must carry them too
  const lyrics = async t => (Api.enabled() ? await Api.get(t.id) : null) ?? (await Lrclib.get(t)); // Api.get ignores ids that aren't Spotify's
  let asked = null,
    wait = 0;
  const find = t => {
    clearTimeout(wait);
    asked = t.id;
    lyrics(t).then(l => {
      if (!l || cur?.id !== t.id) return;
      lyr = l;
      out({ ...cur, lyrics: l });
    });
  };
  window.phoneMsg = m => {
    if (m.type !== 'track') return out(m);
    const same = cur?.id === m.id; // the same song again: its cover or length came in late, or the page reloaded
    cur = m;
    if (!same) lyr = null;
    out({ ...m, lyrics: lyr });
    if (asked === m.id) return;
    // YouTube Music names the song a moment before its length. Without the length LRCLIB can't tell songs of the same
    // name apart ("Hypnotized" found somebody else's), so the lookup waits for it - up to 2 s, for players that never say.
    if (m.dur) find(m);
    else if (!same) {
      clearTimeout(wait);
      wait = setTimeout(() => cur?.id === m.id && asked !== m.id && find(cur), 2000);
    }
  };
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
    app: () => cur?.appName || '',
    onMessage: f => {
      out = f;
      call('phoneResend'); // a song already playing is sent again now that someone listens
    },
  };
})();
window.Phone = Phone;
