// Optional Spicy Lyrics developer API (https://developers.spicylyrics.org). Used only when the user has entered
// their own *publishable* key (sl_pk_, "No origin header" enabled) in settings. The request is made natively by
// the app (Dock.fetchLyrics) and answered through dock({type:'api'}). Responses are cached on the phone and
// dropped after 7 days - the API terms require refetch/discard within 30.
const Api = (() => {
  const KEY = 'dock:apicache',
    TTL = 7 * 864e5,
    MAX = 60;
  const waiting = new Map(); // id -> [resolve]
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {}
  const now = Date.now();
  for (const [id, v] of Object.entries(cache)) if (!v || now - v.at > TTL) delete cache[id];
  const save = () => {
    const ids = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    for (const id of ids.slice(MAX)) delete cache[id];
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (e) {
      cache = {};
    }
  };

  const own = () => /^sl_pk_[\w-]+$/.test(Settings.S.apiKey || '');
  // Built in: LyricDock's server (web/src/worker.js /lyrics) for the web app (its session cookie, shim.js) and for a
  // signed-in phone (its app token); a publishable key of the user's own goes straight to Spicy instead.
  const enabled = () => own() || !!window.LYRICDOCK_WEB || !!window.Account?.user();
  const SERVER = 'https://app.lyricdock.losthusky.qzz.io/lyrics/';

  // Resolves to normalized lyrics or null. Never rejects; de-duplicates concurrent requests per track.
  function get(id) {
    if (!enabled() || !/^[A-Za-z0-9]{22}$/.test(id || '')) return Promise.resolve(null);
    const hit = cache[id];
    if (hit) return Promise.resolve(hit.lyr);
    if (waiting.has(id)) return new Promise(r => waiting.get(id).push(r));
    return new Promise(r => {
      waiting.set(id, [r]);
      if (own() || window.LYRICDOCK_WEB)
        try {
          Dock.fetchLyrics(id, Settings.S.apiKey);
        } catch (e) {
          done(id, null);
        }
      else
        fetch(SERVER + id, { headers: { Accept: 'application/json', ...(window.Account?.headers() ?? {}) } }).then(
          async r => onResponse({ id, status: r.status, text: await r.text() }),
          () => done(id, null),
        );
      setTimeout(() => done(id, null), 8000); // no answer in 8s: give up quietly
    });
  }

  function done(id, lyr) {
    const rs = waiting.get(id);
    if (!rs) return;
    waiting.delete(id);
    rs.forEach(r => r(lyr));
  }

  // dock({type:'api', id, status, text}) from the native fetch.
  function onResponse(m) {
    let lyr = null;
    if (m.status === 200) {
      try {
        lyr = Lyrics.fromSpicy(JSON.parse(m.text)?.Body);
      } catch (e) {}
      if (lyr) {
        cache[m.id] = { at: Date.now(), lyr };
        save();
      }
    }
    Api.lastStatus = m.status;
    if (m.status === 429) notice('Spicy Lyrics API is rate-limiting - using other lyrics sources for now');
    else if ((m.status === 401 || m.status === 403) && own())
      notice('Spicy Lyrics API key was refused - check it in Settings → Advanced');
    done(m.id, lyr);
  }

  // NetEase / QQ Music / Kugou by name (web/src/cnlyrics.js on LyricDock's server): every version found, in the shape
  // collect() takes (the first, with the rest as alts). Once per song; never rejects.
  const found = new Map(); // title|artist|length -> Promise
  function find(t) {
    if (!(window.LYRICDOCK_WEB || window.Account?.user()) || !t?.title || !t?.artist) return Promise.resolve(null);
    const q = new URLSearchParams({ t: t.title, a: t.artist, d: Math.round(t.dur || 0) }),
      k = q.toString();
    if (!found.has(k)) {
      const c = new AbortController(),
        stop = setTimeout(() => c.abort(), 12000);
      found.set(
        k,
        fetch(SERVER + 'find?' + q, {
          headers: { Accept: 'application/json', ...(window.Account?.headers() ?? {}) },
          signal: c.signal,
        })
          .then(r => (r.ok ? r.json() : []))
          .then(all => (Array.isArray(all) && all.length ? { ...all[0], alts: all.slice(1) } : null))
          .catch(() => (found.delete(k), null)) // the network: ask again next time
          .finally(() => clearTimeout(stop)),
      );
      if (found.size > 30) found.delete(found.keys().next().value);
    }
    return found.get(k);
  }

  return { get, find, onResponse, enabled, lastStatus: null };
})();
