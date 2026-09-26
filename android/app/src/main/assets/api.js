// Optional Spicy Lyrics developer API (https://developers.spicylyrics.org). Used only when the user has entered
// their own *publishable* key (sl_pk_, "No origin header" enabled) in settings. The request is made natively by
// the app (Dock.fetchLyrics) and answered through dock({type:'api'}). Responses are cached on the phone and
// dropped after 7 days - the API terms require refetch/discard within 30.
const Api = (() => {
  const KEY = 'dock:apicache', TTL = 7 * 864e5, MAX = 60;
  const waiting = new Map(); // id -> [resolve]
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  const now = Date.now();
  for (const [id, v] of Object.entries(cache)) if (!v || now - v.at > TTL) delete cache[id];
  const save = () => {
    const ids = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    for (const id of ids.slice(MAX)) delete cache[id];
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { cache = {}; }
  };

  const enabled = () => /^sl_pk_[\w-]+$/.test(Settings.S.apiKey || '');

  // Resolves to normalized lyrics or null. Never rejects; de-duplicates concurrent requests per track.
  function get(id) {
    if (!enabled() || !/^[A-Za-z0-9]{22}$/.test(id || '')) return Promise.resolve(null);
    const hit = cache[id];
    if (hit) return Promise.resolve(hit.lyr);
    if (waiting.has(id)) return new Promise(r => waiting.get(id).push(r));
    return new Promise(r => {
      waiting.set(id, [r]);
      try { Dock.fetchLyrics(id, Settings.S.apiKey); } catch (e) { done(id, null); }
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
      try { lyr = Lyrics.fromSpicy(JSON.parse(m.text)?.Body); } catch (e) {}
      if (lyr) { cache[m.id] = { at: Date.now(), lyr }; save(); }
    }
    Api.lastStatus = m.status;
    done(m.id, lyr);
  }

  return { get, onResponse, enabled, lastStatus: null };
})();
