// Spicetify extension: pushes track, word-synced lyrics and playback position to the LyricDock phone,
// preloads the next track, and takes playback commands back from it.
(function dockBridge() {
  if (!Spicetify?.Player?.addEventListener || !Spicetify.CosmosAsync || !Spicetify.Platform) return setTimeout(dockBridge, 300);

  // Wired first (adb forward over USB), then direct Wi-Fi to the phone.
  // The phone's Wi-Fi IP is never hardcoded: the phone reports it with every keep-alive (so one wired session
  // is enough), or set it from Spotify's profile menu -> "LyricDock". Stored in Spicetify's LocalStorage.
  const USB = 'ws://127.0.0.1:8975', IP_KEY = 'lyricdock:phoneIp';
  const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s || '');
  let phoneIp = Spicetify.LocalStorage.get(IP_KEY) || '';
  const setPhoneIp = ip => { if (isIp(ip) && ip !== phoneIp) { phoneIp = ip; Spicetify.LocalStorage.set(IP_KEY, ip); } };
  const urls = () => [USB, ...(isIp(phoneIp) ? [`ws://${phoneIp}:8975`] : [])];
  const P = Spicetify.Player;
  let ws = null, track = null, preload = null, busy = false;
  let last = { pos: 0, at: 0, playing: false };

  const send = o => ws?.readyState === 1 && ws.send(JSON.stringify(o));
  const safe = (f, d) => { try { return f(); } catch { return d; } }; // getProgress throws before anything loads

  function beat() {
    const pos = safe(() => P.getProgress(), 0), playing = safe(() => P.isPlaying(), false);
    last = { pos, at: Date.now(), playing };
    send({ type: 'pos', pos, playing, dur: safe(() => P.getDuration(), 0), via: ws?.url.startsWith(USB) ? 'usb' : 'wifi' });
  }

  // ---- link. Every second: on USB -> nothing to do; otherwise try USB, then Wi-Fi.
  const tryOpen = (u, ms) => new Promise(res => {
    const s = new WebSocket(u);
    const t = setTimeout(() => { s.onopen = null; s.close(); res(null); }, ms);
    s.onopen = () => { clearTimeout(t); res(s); };
    s.onerror = () => { clearTimeout(t); res(null); };
  });

  // The phone sends {type:'alive', ip} every second. An adb-forwarded socket can look open after the phone end
  // died (cable pulled, app restarted), so 2.5s of silence means dead: drop it and fail over.
  let lastRx = 0;
  function drop() { const dead = ws; ws = null; if (dead) { dead.onclose = null; dead.close(); } }
  async function ensureLink() {
    if (ws?.readyState === 1 && Date.now() - lastRx > 2500) drop();
    if (busy || (ws?.readyState === 1 && ws.url.startsWith(USB))) return;
    busy = true;
    try {
      for (const u of urls()) {
        if (ws?.readyState === 1 && ws.url.startsWith(u)) break; // already on this one, nothing better found
        const s = await tryOpen(u, u === USB ? 800 : 2000);
        if (!s) continue;
        const old = ws;
        ws = s;
        s.onclose = () => { if (ws === s) { ws = null; ensureLink(); } }; // fail over immediately
        s.onmessage = e => { lastRx = Date.now(); command(e.data); };
        lastRx = Date.now();
        if (old) { old.onclose = null; old.close(); }
        console.log('[dock] linked via', u);
        if (track) send(track);
        if (preload) send(preload);
        beat();
        break;
      }
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

  // Profile menu -> "LyricDock": set the phone's Wi-Fi IP by hand (Wi-Fi-only setups; the phone shows it).
  safe(() => new Spicetify.Menu.Item('LyricDock', false, () => {
    const box = document.createElement('div');
    box.innerHTML = '<p style="margin:0 0 8px">Phone Wi-Fi IP (shown on the phone while it waits):</p>'
      + '<input style="width:100%;padding:8px;font-size:15px;border-radius:6px;border:0" placeholder="192.168.1.50">'
      + `<p style="margin:10px 0 0;opacity:.7">Now: ${ws ? (ws.url.startsWith(USB) ? 'connected over USB' : 'connected over Wi-Fi') : 'not connected'}</p>`;
    const input = box.querySelector('input');
    input.value = phoneIp;
    input.onchange = () => { if (isIp(input.value.trim())) { setPhoneIp(input.value.trim()); ensureLink(); } };
    Spicetify.PopupModal.display({ title: 'LyricDock', content: box });
  }).register());

  function command(data) {
    const m = safe(() => JSON.parse(data), null);
    if (m?.type === 'alive') return setPhoneIp(m.ip);
    if (m?.type !== 'cmd') return;
    if (m.cmd === 'toggle') P.togglePlay();
    else if (m.cmd === 'next') P.next();
    else if (m.cmd === 'prev') P.back();
    else if (m.cmd === 'seek' && Number.isFinite(m.ms)) P.seek(Math.max(0, m.ms));
    setTimeout(beat, 60);
  }

  // ---- lyrics sources, best first: what Spicy Lyrics has already fetched (its local cache) -> Spotify -> LRCLIB.
  // Never call api.spicylyrics.org ourselves: it's Spicy's internal client API (returns 418 to other callers),
  // and extra requests on the same account trip Spicy's rate limit / circuit breaker on the desktop.
  const PROVIDERS = { spt: 'Spotify', aml: 'Apple Music', spl: 'Spicy Lyrics', ldb: 'Local DB' };
  const sleep = t => new Promise(r => setTimeout(r, t));

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

  // Spicy fetches the playing track itself; wait for it to land in its cache.
  async function spicyWait(id, ms) {
    for (const end = Date.now() + ms; ;) {
      const c = await spicyCache(id);
      if (c || Date.now() > end || item()?.uri?.split(':')[2] !== id) return c;
      await sleep(400);
    }
  }

  // Normalized shape sent to the phone:
  // { kind: 'word'|'line'|'static', lines: [{ t, e, opp, s, r, w: [{ s, r, t, e, p }], bg: [...] }], writers, source }
  function fromSpicy(L) {
    const source = typeof L.source === 'string'
      ? Object.entries(PROVIDERS).find(([k]) => L.source.toLowerCase().includes(k))?.[1] ?? null : null;
    const syl = s => ({ s: s.Text, r: s.TransliteratedText, t: s.StartTime * 1000, e: s.EndTime * 1000, p: !!s.IsPartOfWord });
    const vocal = (L.Content ?? []).filter(v => v.Type === 'Vocal');
    let kind, lines;
    if (L.Type === 'Syllable') {
      kind = 'word';
      lines = vocal.map(v => ({ t: v.Lead.StartTime * 1000, e: v.Lead.EndTime * 1000, opp: !!v.OppositeAligned,
        w: v.Lead.Syllables.map(syl), bg: (v.Background ?? []).flatMap(b => b.Syllables.map(syl)) }));
    } else if (L.Type === 'Line') {
      kind = 'line';
      lines = vocal.map(v => ({ t: v.StartTime * 1000, e: v.EndTime * 1000, opp: !!v.OppositeAligned, s: v.Text, r: v.TransliteratedText }));
    } else if (L.Type === 'Static') {
      kind = 'static';
      lines = (L.Lines ?? []).map(l => ({ s: l.Text, r: l.TransliteratedText }));
    } else return null;
    return lines.length ? { kind, lines, writers: L.SongWriters ?? [], source } : null;
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

  // Only Spicy-sourced lyrics are kept (fallbacks may get upgraded once Spicy's own fetch lands).
  const ready = new Map();
  const remember = (id, L) => { ready.set(id, L); if (ready.size > 40) ready.delete(ready.keys().next().value); };

  async function currentLyrics(id, meta) {
    if (ready.has(id)) return ready.get(id);
    const c = await spicyWait(id, 6000);
    const L = c && c !== 'none' ? fromSpicy(c) : null;
    if (L) { remember(id, L); return L; }
    return (await spotifyLyrics(id)) ?? (await lrclib(meta)) ?? { kind: 'none', lines: [], writers: [], source: null };
  }

  // Preload: whatever Spicy already has cached for the next track (replays, recently played) - no network.
  async function preloadLyrics(id) {
    if (ready.has(id)) return ready.get(id);
    const c = await spicyCache(id);
    const L = c && c !== 'none' ? fromSpicy(c) : null;
    if (L) remember(id, L);
    return L;
  }

  const img = u => (u || '').replace('spotify:image:', 'https://i.scdn.co/image/');
  const item = () => P.data?.item ?? P.data?.track;
  const info = (uri, m) => ({ id: uri.split(':')[2], uri, title: m.title, artist: m.artist_name, album: m.album_title,
    art: img(m.image_xlarge_url || m.image_large_url || m.image_url), dur: +m.duration || 0 });

  async function sendTrack() {
    const it = item();
    if (!it?.uri) return;
    const base = info(it.uri, it.metadata || {});
    track = { type: 'track', ...base, lyrics: ready.get(base.id) ?? null }; // instant if preloaded
    send(track);
    beat();
    preloadNext(); // cover art warms on the phone while this track's lyrics load
    if (!track.lyrics) {
      const lyrics = await currentLyrics(base.id, it.metadata || {});
      if (item()?.uri !== it.uri) return; // skipped while lyrics were loading
      track = { type: 'track', ...base, lyrics };
      console.log('[dock] track', base.title, '-', lyrics.kind, lyrics.lines.length, 'lines via', lyrics.source);
      send(track);
      if (!ready.has(base.id)) upgradeLater(it.uri, base);
    }
  }

  // A fallback was sent; if Spicy's own (word-synced) lyrics show up later (e.g. its queue retry), swap them in.
  async function upgradeLater(uri, base) {
    for (let i = 0; i < 30 && item()?.uri === uri; i++) {
      await sleep(2000);
      const c = await spicyCache(base.id);
      if (!c || c === 'none') continue;
      const L = fromSpicy(c);
      if (!L || item()?.uri !== uri) return;
      remember(base.id, L);
      track = { type: 'track', ...base, lyrics: L, upgrade: true };
      send(track);
      return;
    }
  }

  async function preloadNext() {
    const n = (Spicetify.Queue?.nextTracks ?? []).map(t => t?.contextTrack).find(t => t?.uri?.startsWith('spotify:track:'));
    if (!n) return;
    const base = info(n.uri, n.metadata || {});
    preload = { type: 'preload', ...base, lyrics: await preloadLyrics(base.id) };
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
