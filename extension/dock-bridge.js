// LyricDock bridge (Spicetify extension). Pushes the playing track, lyrics, position, liked state and audio
// quality to the LyricDock phone app, preloads the next track, stores the phone's settings/presets, and takes
// playback commands back.
//
// Transport: always ws://127.0.0.1:8975. Chromium refuses ws:// from Spotify's https page to a LAN address, so
// the phone is reached through adb's port forward - over USB, or wireless adb when the cable is out
// (scripts/link.ps1 switches between them).
(function dockBridge() {
  if (!Spicetify?.Player?.addEventListener || !Spicetify.CosmosAsync || !Spicetify.Platform || !Spicetify.LocalStorage)
    return setTimeout(dockBridge, 300);

  const URL_ = 'ws://127.0.0.1:8975';
  const P = Spicetify.Player, LS = Spicetify.LocalStorage;
  let ws = null, track = null, preload = null, busy = false, lastRx = 0;
  let last = { pos: 0, at: 0, playing: false };

  const send = o => ws?.readyState === 1 && ws.send(JSON.stringify(o));
  const safe = (f, d) => { try { return f(); } catch { return d; } }; // getProgress throws before anything loads
  const sleep = t => new Promise(r => setTimeout(r, t));
  const readJson = (k, d) => safe(() => JSON.parse(LS.get(k)) ?? d, d);

  // ---- audio quality, best effort across Spotify client versions
  const QUALITY = { lossless: 'Lossless', hifi: 'Lossless', very_high: 'Very high', veryhigh: 'Very high', high: 'High', normal: 'Normal', low: 'Low' };
  function quality() {
    const st = safe(() => Spicetify.Platform.PlayerAPI._state, null);
    for (const q of [P.data?.playbackQuality, st?.playbackQuality, P.data?.playback_quality]) {
      const v = typeof q === 'string' ? q : q?.bitrateLevel ?? q?.level ?? q?.hifiStatus;
      if (v != null && v !== '') return QUALITY[String(v).toLowerCase()] ?? String(v).replace(/_/g, ' ').toLowerCase();
    }
    return '';
  }

  function beat() {
    const pos = safe(() => P.getProgress(), 0), playing = safe(() => P.isPlaying(), false);
    last = { pos, at: Date.now(), playing };
    send({ type: 'pos', pos, playing, dur: safe(() => P.getDuration(), 0), liked: safe(() => P.getHeart(), undefined), quality: quality(),
      volume: safe(() => Math.round(P.getVolume() * 100), undefined) });
  }

  // ---- link. The phone sends {type:'alive'} every second; an adb-forwarded socket can look open after the
  // phone end died (cable pulled, app restarted), so 2.5s of silence means dead: drop it and reconnect.
  const tryOpen = ms => new Promise(res => {
    const s = new WebSocket(URL_);
    const t = setTimeout(() => { s.onopen = null; s.close(); res(null); }, ms);
    s.onopen = () => { clearTimeout(t); res(s); };
    s.onerror = () => { clearTimeout(t); res(null); };
  });

  function drop() { const dead = ws; ws = null; if (dead) { dead.onclose = null; dead.close(); } }
  async function ensureLink() {
    if (ws?.readyState === 1 && Date.now() - lastRx > 2500) drop();
    if (busy || ws?.readyState === 1) return;
    busy = true;
    try {
      const s = await tryOpen(1500);
      if (!s) return;
      ws = s;
      s.onclose = () => { if (ws === s) { ws = null; ensureLink(); } };
      s.onmessage = e => { lastRx = Date.now(); onMessage(e.data); };
      lastRx = Date.now();
      console.log('[dock] linked');
      send({ type: 'hello', last: readJson(SETTINGS_KEY, null), presets: readJson(PRESETS_KEY, {}) });
      if (track) send(track);
      if (preload) send(preload);
      beat();
    } finally { busy = false; }
  }

  // Spotify's page timers get throttled to ~1/min while minimized; a Worker's timers don't, and its messages
  // wake the page. Falls back to setInterval if the client's CSP refuses blob workers.
  function every100ms(fn) {
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 100)'], { type: 'text/javascript' })));
      w.onmessage = fn;
    } catch { setInterval(fn, 100); }
  }

  // ---- phone settings + presets live here too, so a new phone (or a reinstall) starts configured.
  const SETTINGS_KEY = 'lyricdock:settings', PRESETS_KEY = 'lyricdock:presets';
  const okSettings = s => s && typeof s === 'object' && !Array.isArray(s) && JSON.stringify(s).length < 20000;

  function onMessage(data) {
    const m = safe(() => JSON.parse(data), null);
    if (!m || typeof m !== 'object') return;
    if (m.type === 'settings' && okSettings(m.S)) LS.set(SETTINGS_KEY, JSON.stringify(m.S));
    else if (m.type === 'preset' && typeof m.name === 'string' && m.name.length <= 40) {
      const presets = readJson(PRESETS_KEY, {});
      if (m.action === 'save' && okSettings(m.S)) { const { apiKey, ...rest } = m.S; presets[m.name] = rest; } // keys stay out of presets
      else if (m.action === 'delete') delete presets[m.name];
      LS.set(PRESETS_KEY, JSON.stringify(presets));
      send({ type: 'presets', presets });
    }
    else if (m.type === 'cmd') {
      if (m.cmd === 'toggle') P.togglePlay();
      else if (m.cmd === 'next') P.next();
      else if (m.cmd === 'prev') P.back();
      else if (m.cmd === 'heart') P.toggleHeart();
      else if (m.cmd === 'seek' && Number.isFinite(m.ms)) P.seek(Math.max(0, m.ms));
      else if (m.cmd === 'volume' && Number.isFinite(m.v)) P.setVolume(Math.max(0, Math.min(1, m.v / 100)));
      setTimeout(beat, 80);
    }
  }

  // ---- lyrics, fastest local source first, never blocking on the network:
  //   1. Spicy Lyrics' own cache (already on this PC)        -> sent raw ({spicy}), the phone normalizes it
  //   2. Spotify's lyrics (the client's own endpoint)         -> immediately, while Spicy may still be fetching
  //   3. LRCLIB                                               -> only if Spotify has none
  // then: Spicy's cache is watched for a minute and its (word-synced) lyrics replace the fallback when they land.
  // The phone can additionally use the Spicy Lyrics developer API with the user's own key (api.js).
  // Never call api.spicylyrics.org's internal client API: it is Spicy's own (418 to others) and extra requests
  // on the same account trip Spicy's rate limit on the desktop.
  const NONE = { kind: 'none', lines: [], writers: [], source: null };

  async function token() {
    try {
      const s = await Spicetify.Platform.AuthorizationAPI?.getState?.();
      if (s?.token?.accessToken) return s.token.accessToken;
    } catch {}
    return Spicetify.Platform.Session?.accessToken;
  }

  // Spicy Lyrics' ExpireStore (Cache Storage). 'none' = Spicy looked and found nothing.
  async function spicyCache(id) {
    try {
      const r = await (await caches.open('SpicyLyrics_LyricsStore_g1')).match('/' + id);
      const c = r && (await r.json())?.Content;
      return !c ? null : c.Value === 'NO_LYRICS' ? 'none' : c;
    } catch { return null; }
  }

  const withEnds = lines => lines.map((l, i) => ({ ...l, e: l.e ?? lines[i + 1]?.t ?? l.t + 5000 }));

  async function spotifyLyrics(id) {
    const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`;
    let r = await Spicetify.CosmosAsync.get(url).catch(() => null);
    if (!r?.lyrics) {
      const tok = await token();
      if (tok) r = await fetch(url, { headers: { authorization: `Bearer ${tok}`, 'app-platform': 'WebPlayer' } })
        .then(x => x.ok ? x.json() : null).catch(() => null);
    }
    const L = r?.lyrics;
    if (!L?.lines?.length) return null;
    if (L.syncType !== 'LINE_SYNCED') return { kind: 'static', lines: L.lines.map(x => ({ s: x.words })), writers: [], source: 'Spotify' };
    return { kind: 'line', lines: withEnds(L.lines.map(x => ({ t: +x.startTimeMs, s: x.words }))), writers: [], source: 'Spotify' };
  }

  // Search, not exact /get: artist spellings differ (Spotify "Harrdy Sandhu" vs LRCLIB "Hardy Sandhu").
  async function lrclib(m) {
    const dur = (+m.duration || 0) / 1000;
    const search = q => fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)
      .then(x => x.ok ? x.json() : []).catch(() => []);
    let hits = await search(`${m.title} ${m.artist_name}`);
    if (!hits.length) hits = await search(m.title || '');
    if (dur) hits = hits.filter(h => Math.abs(h.duration - dur) < 5); // title-only search can hit other songs
    const r = hits.sort((a, b) => !!b.syncedLyrics - !!a.syncedLyrics || Math.abs(a.duration - dur) - Math.abs(b.duration - dur))[0];
    if (r?.syncedLyrics) {
      const lines = r.syncedLyrics.split('\n').map(s => s.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/))
        .filter(Boolean).map(([, mm, ss, s]) => ({ t: Math.round((+mm * 60 + +ss) * 1000), s }));
      return { kind: 'line', lines: withEnds(lines), writers: [], source: 'LRCLIB' };
    }
    if (r?.plainLyrics) return { kind: 'static', lines: r.plainLyrics.split('\n').map(s => ({ s })), writers: [], source: 'LRCLIB' };
    return null;
  }

  // Spicy-sourced lyrics per track id (fallbacks aren't kept: they may be upgraded).
  const ready = new Map();
  const remember = (id, L) => { ready.set(id, L); if (ready.size > 40) ready.delete(ready.keys().next().value); };
  async function fromSpicyCache(id) {
    if (ready.has(id)) return ready.get(id);
    const c = await spicyCache(id);
    if (!c || c === 'none') return null;
    const L = { spicy: c };
    remember(id, L);
    return L;
  }

  // ---- track info
  const img = u => (u || '').replace('spotify:image:', 'https://i.scdn.co/image/');
  const item = () => P.data?.item ?? P.data?.track;
  const artists = (it, m) => {
    const names = (it?.artists ?? []).map(a => a?.name).filter(Boolean);
    if (names.length) return names.join(', ');
    return Object.keys(m).filter(k => /^artist_name(:\d+)?$/.test(k))
      .sort((a, b) => (+a.split(':')[1] || 0) - (+b.split(':')[1] || 0)).map(k => m[k]).join(', ');
  };
  const info = (it, m) => ({ id: it.uri.split(':')[2], uri: it.uri, title: m.title, artist: artists(it, m), album: m.album_title,
    art: img(m.image_xlarge_url || m.image_large_url || m.image_url), dur: +m.duration || 0 });

  // Next vs previous: going back to the track before this one = previous (the phone slides the other way).
  let hist = [];
  function direction(id) {
    if (hist.length > 1 && hist[hist.length - 2] === id) { hist.pop(); return -1; }
    if (hist[hist.length - 1] !== id) hist = [...hist, id].slice(-50);
    return 1;
  }

  async function sendTrack() {
    const it = item();
    if (!it?.uri) return;
    const base = info(it, it.metadata || {});
    const dir = direction(base.id);
    track = { type: 'track', ...base, dir, lyrics: await fromSpicyCache(base.id) }; // cache read: a few ms
    send(track);
    beat();
    send({ type: 'diag', quality: quality(), pd: Object.keys(P.data || {}),
      pq: safe(() => JSON.stringify([P.data?.playbackQuality, Spicetify.Platform.PlayerAPI._state?.playbackQuality]).slice(0, 400), '') });
    preloadNext();
    if (track.lyrics) return;
    const lyrics = (await spotifyLyrics(base.id)) ?? (await lrclib(it.metadata || {})) ?? NONE;
    if (item()?.uri !== it.uri) return; // skipped meanwhile
    if (!track.lyrics) { track = { ...track, lyrics }; send(track); }
    upgradeFromSpicy(it.uri, base, dir);
  }

  // Spicy fetches the playing track itself; its word-synced lyrics replace the fallback as soon as they land.
  async function upgradeFromSpicy(uri, base, dir) {
    for (let i = 0; i < 60 && item()?.uri === uri; i++) {
      await sleep(1000);
      const L = await fromSpicyCache(base.id);
      if (!L || item()?.uri !== uri) continue;
      track = { type: 'track', ...base, dir, lyrics: L };
      send(track);
      return;
    }
  }

  // Preload: cover + whatever Spicy already has for the next track (no network).
  async function preloadNext() {
    const n = (Spicetify.Queue?.nextTracks ?? []).map(t => t?.contextTrack).find(t => t?.uri?.startsWith('spotify:track:'));
    if (!n) return;
    const base = info(n, n.metadata || {});
    preload = { type: 'preload', ...base, lyrics: await fromSpicyCache(base.id) };
    send(preload);
  }

  // ---- sync: events + 500ms heartbeat + 100ms drift check (catches seeks instantly) + 1s link check.
  P.addEventListener('songchange', sendTrack);
  P.addEventListener('onplaypause', beat);
  let tick = 0;
  every100ms(() => {
    tick++;
    const pos = safe(() => P.getProgress(), 0), playing = safe(() => P.isPlaying(), false);
    const expected = last.pos + (last.playing ? Date.now() - last.at : 0);
    if (tick % 5 === 0 || playing !== last.playing || Math.abs(pos - expected) > 250) beat();
    if (tick % 10 === 0) ensureLink();
  });
  ensureLink();
  sendTrack();
})();
