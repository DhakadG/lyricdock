// Standalone source: the phone reads playback straight from the Spotify Web API, for when Spotify is playing
// somewhere without the Spicetify bridge (your phone, a speaker, the web player...). Uses the user's own
// Spotify app (Client ID in settings) with Authorization Code + PKCE - there is no client secret anywhere.
// Emits the same messages as the bridge (track / pos / preload), so everything downstream is shared.
const Web = (() => {
  // Phone: LoginClient.java catches the loopback redirect. Browser: a real page, /callback on the app's own origin.
  const REDIRECT = window.LYRICDOCK_WEB ? `${location.origin}/callback` : 'http://127.0.0.1:8976/callback', KEY = 'dock:spotify', PENDING = 'dock:spPending';
  const SCOPES = 'user-read-playback-state user-read-currently-playing user-modify-playback-state user-library-read user-library-modify';
  let tok = {}, pending = null, status = '', backoff = 0, wanted = false, timer = null, cur = null, state = {}, hist = [], out = () => {};
  try { tok = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tok)); } catch (e) {} };
  const cid = () => (Settings.S.spClientId || '').trim();
  const loggedIn = () => !!tok.refresh && tok.cid === cid();
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const say = s => { status = s; Settings.render(); };

  // ---- auth
  async function login() {
    if (!/^[0-9a-f]{32}$/.test(cid())) return say('Enter your Spotify Client ID first');
    const verifier = rand(48), st = rand(12);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    pending = { verifier, state: st };
    try { localStorage.setItem(PENDING, JSON.stringify(pending)); } catch (e) {} // the web sign-in reloads the page
    const q = new URLSearchParams({ client_id: cid(), response_type: 'code', redirect_uri: REDIRECT,
      code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state: st });
    say('Signing in…');
    Dock.login('https://accounts.spotify.com/authorize?' + q);
  }

  async function onAuth(m) {
    let p = pending;
    try { p ||= JSON.parse(localStorage.getItem(PENDING) || 'null'); localStorage.removeItem(PENDING); } catch (e) {}
    pending = null;
    if (!m.url || !p) return say('Sign-in cancelled');
    const u = new URL(m.url);
    if (u.searchParams.get('state') !== p.state) return say('Sign-in failed (state mismatch)');
    const code = u.searchParams.get('code');
    if (!code) return say(`Sign-in failed: ${u.searchParams.get('error') || 'no code'}`);
    if (await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: cid(), code_verifier: p.verifier })) kick();
  }

  async function token(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) {
      if (j.error === 'invalid_grant' || j.error === 'invalid_client') { tok = {}; save(); }
      say(`Spotify: ${j.error_description || j.error || (r ? r.status : 'offline')}`);
      return false;
    }
    tok = { ...tok, cid: cid(), access: j.access_token, refresh: j.refresh_token || tok.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
    save();
    say('Signed in');
    if (!tok.uid) api('GET', '/me').then(r => { if (r?.json?.id) { tok.uid = r.json.id; save(); } }); // for account auto-pairing
    return true;
  }

  const fresh = async () => (tok.access && Date.now() < tok.exp) ||
    (loggedIn() && token({ grant_type: 'refresh_token', refresh_token: tok.refresh, client_id: cid() }));

  function logout() { tok = {}; save(); cur = null; state = {}; say('Signed out'); }

  async function api(method, path, body) {
    if (Date.now() < backoff || !(await fresh())) return null;
    const t0 = performance.now();
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + tok.access, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!r) return null;
    const rtt = performance.now() - t0;
    if (r.status === 401) { tok.exp = 0; return null; } // refreshes on the next call
    if (r.status === 429) { backoff = Date.now() + (+r.headers.get('Retry-After') || 5) * 1000; return null; }
    if (r.status === 204) return { status: 204, rtt };
    return { status: r.status, json: await r.json().catch(() => null), rtt };
  }

  // ---- playback
  const info = it => ({ id: it.id, uri: it.uri, title: it.name, artist: (it.artists || []).map(a => a.name).join(', '),
    album: it.album?.name, year: (it.album?.release_date || '').slice(0, 4), artistId: it.artists?.[0]?.id, art: [...(it.album?.images || [])].sort((a, b) => b.width - a.width)[0]?.url || null, dur: it.duration_ms });

  function direction(id) {
    if (hist.length > 1 && hist[hist.length - 2] === id) { hist.pop(); return -1; }
    if (hist[hist.length - 1] !== id) hist = [...hist, id].slice(-50);
    return 1;
  }

  // Poll every second while playing (3s paused, 5-10s idle). Position = progress + half the round trip.
  async function poll() {
    clearTimeout(timer);
    if (!wanted || !loggedIn()) return;
    let delay = 10000;
    const r = await api('GET', '/me/player');
    const s = r?.json, it = s?.item;
    if (r?.status === 200 && it?.type === 'track') {
      state = { playing: s.is_playing, device: s.device?.name, volume: s.device?.volume_percent, shuffle: s.shuffle_state, repeat: { off: 0, context: 1, track: 2 }[s.repeat_state] ?? 0 };
      if (it.id !== cur?.id) newTrack(it);
      out({ type: 'pos', pos: s.progress_ms + (s.is_playing ? r.rtt / 2 : 0), playing: s.is_playing, dur: it.duration_ms,
        liked: cur.liked, volume: state.volume, device: state.device, shuffle: state.shuffle, repeat: state.repeat });
      delay = s.is_playing ? 1000 : 3000;
    } else if (r) { state = { playing: false }; delay = 5000; }
    if (wanted) timer = setTimeout(poll, delay);
  }
  const kick = (ms = 0) => { clearTimeout(timer); timer = setTimeout(poll, ms); };

  async function newTrack(it) {
    cur = { ...info(it), liked: undefined };
    const t = cur;
    out({ type: 'track', ...t, dir: direction(t.id), lyrics: null });
    out({ type: 'album', id: t.id, album: t.album, year: t.year });
    api('GET', '/me/library/contains?uris=' + encodeURIComponent(t.uri)).then(r => { if (Array.isArray(r?.json)) t.liked = !!r.json[0]; });
    if (t.artistId) api('GET', '/artists/' + t.artistId).then(r => { // for the 'Artist image' background
      const img = [...(r?.json?.images || [])].sort((a, b) => b.width - a.width)[0]?.url;
      if (img) out({ type: 'artist', id: t.id, img });
    });
    // Lyrics: the Spicy API (app.js topUp, if a key is set), else LRCLIB.
    const l = (Api.enabled() ? await Api.get(t.id) : null) ?? await Lrclib.get(t);
    if (l && cur === t) out({ type: 'track', ...t, lyrics: l });
    const q = await api('GET', '/me/player/queue');
    const n = q?.json?.queue?.find(x => x?.type === 'track');
    if (n && cur === t) out({ type: 'preload', ...info(n), lyrics: null });
  }

  // ---- controls (Premium). Poll right after so the screen follows immediately.
  async function control(cmd, arg) {
    if (!loggedIn()) return;
    if (cmd === 'toggle') await api('PUT', state.playing ? '/me/player/pause' : '/me/player/play');
    else if (cmd === 'next') await api('POST', '/me/player/next');
    else if (cmd === 'prev') await api('POST', '/me/player/previous');
    else if (cmd === 'seek') await api('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(arg))}`);
    else if (cmd === 'volume') await api('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(arg)))}`);
    else if (cmd === 'shuffle') await api('PUT', `/me/player/shuffle?state=${!state.shuffle}`);
    else if (cmd === 'repeat') await api('PUT', `/me/player/repeat?state=${['off', 'context', 'track'][Number.isFinite(arg) ? arg % 3 : ((state.repeat || 0) + 1) % 3]}`);
    else if (cmd === 'play' && arg?.uri) { if (arg.shuffle) await api('PUT', '/me/player/shuffle?state=true'); await api('PUT', '/me/player/play', /^spotify:(playlist|album|artist|show|collection)/.test(arg.uri) ? { context_uri: arg.uri }
      : arg.ctx && !/^spotify:collection/.test(arg.ctx) ? { context_uri: arg.ctx, offset: { uri: arg.uri } } : { uris: [arg.uri] }); }
    else if (cmd === 'heart' && cur) {
      const r = await api(cur.liked ? 'DELETE' : 'PUT', '/me/library?uris=' + encodeURIComponent(cur.uri));
      if (r && r.status < 300) cur.liked = !cur.liked;
    }
    kick(250);
  }

  function setWanted(w) {
    if (w === wanted) return;
    wanted = w;
    if (w) kick(); else clearTimeout(timer);
  }

  // Lists for the phone's slide-over panel (friend activity isn't in the public Web API).
  const small = im => [...(im || [])].sort((a, b) => (a.width || 0) - (b.width || 0)).find(i => (i.width || 300) >= 64)?.url || im?.[0]?.url || '';
  const trk = (t, art) => t && ({ uri: t.uri, title: t.name, sub: (t.artists || []).map(a => a.name).join(', '), art: art ?? small(t.album?.images), dur: t.duration_ms });
  const box = (uri, title, sub, art, round) => ({ uri, title, sub, art, box: true, round });
  async function liked(items) {
    const uris = items.filter(x => /^spotify:track:/.test(x.uri)).map(x => x.uri).slice(0, 40);
    if (!uris.length) return items;
    const r = await api('GET', '/me/library/contains?uris=' + encodeURIComponent(uris.join(',')));
    if (!Array.isArray(r?.json)) return items;
    const set = new Set(uris.filter((u, i) => r.json[i]));
    return items.map(x => ({ ...x, liked: set.has(x.uri) || x.liked }));
  }
  // Browse a playlist / album / artist / Liked Songs (Web API). Spotify limits playlist items for new developer
  // apps to playlists you own or follow.
  async function browse(uri) {
    const [, type, id] = uri.split(':');
    if (type === 'collection') {
      const r = await api('GET', '/me/tracks?limit=50');
      const items = (r?.json?.items || []).map(x => ({ ...trk(x.track), liked: true }));
      return { head: { uri, title: 'Liked Songs', sub: `${r?.json?.total ?? items.length} songs`, art: 'liked' }, ctx: uri, items };
    }
    if (type === 'playlist') {
      const [m, r] = await Promise.all([api('GET', `/playlists/${id}?fields=name,images,owner(display_name),tracks(total)`), api('GET', `/playlists/${id}/tracks?limit=100`)]);
      if (!r?.json) return { items: [], error: 'Spotify did not return this playlist' };
      return { head: { uri, title: m?.json?.name, sub: [m?.json?.owner?.display_name, `${m?.json?.tracks?.total ?? ''} songs`].filter(Boolean).join(' · '), art: small(m?.json?.images) },
        ctx: uri, items: await liked((r.json.items || []).map(x => trk(x.track || x.item)).filter(x => x?.uri)) };
    }
    if (type === 'album') {
      const a = (await api('GET', `/albums/${id}`))?.json, art = small(a?.images);
      return { head: { uri, title: a?.name, sub: [(a?.artists || []).map(x => x.name).join(', '), (a?.release_date || '').slice(0, 4)].filter(Boolean).join(' · '), art },
        ctx: uri, items: await liked((a?.tracks?.items || []).map(t => trk(t, art))) };
    }
    if (type === 'artist') {
      const [a, t, al] = await Promise.all([api('GET', `/artists/${id}`), api('GET', `/artists/${id}/top-tracks?market=from_token`), api('GET', `/artists/${id}/albums?limit=40`)]);
      return { head: { uri, title: a?.json?.name, sub: 'Artist', art: small(a?.json?.images), round: true }, ctx: uri,
        items: await liked([...(t?.json?.tracks || []).map(x => ({ ...trk(x), section: 'Popular' })),
          ...(al?.json?.items || []).map(x => ({ ...box(x.uri, x.name, [x.album_type, (x.release_date || '').slice(0, 4)].join(' · '), small(x.images)), section: 'Releases' }))]) };
    }
    return { items: [], error: 'Not browsable' };
  }
  async function search(q) {
    const r = (await api('GET', `/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=8`))?.json || {};
    return { items: await liked([
      ...(r.tracks?.items || []).map(t => ({ ...trk(t), section: 'Songs' })),
      ...(r.artists?.items || []).map(a => ({ ...box(a.uri, a.name, 'Artist', small(a.images), true), section: 'Artists' })),
      ...(r.albums?.items || []).map(a => ({ ...box(a.uri, a.name, `Album · ${a.artists.map(x => x.name).join(', ')}`, small(a.images)), section: 'Albums' })),
      ...(r.playlists?.items || []).filter(Boolean).map(p => ({ ...box(p.uri, p.name, `Playlist · ${p.owner?.display_name || ''}`, small(p.images)), section: 'Playlists' }))]) };
  }
  // Row actions. The Web API can add to the queue but not remove or reorder it.
  async function act(cmd, uri) {
    if (!loggedIn()) return { ok: false, error: 'not signed in' };
    let r = null;
    if (cmd === 'queueAdd') r = await api('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`);
    else if (cmd === 'like' || cmd === 'unlike') r = await api(cmd === 'like' ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent(uri));
    else return { ok: false, error: 'the Spotify Web API cannot change the queue order' };
    return r && r.status < 300 ? { ok: true } : { ok: false, error: r ? `HTTP ${r.status}` : 'offline' };
  }

  async function list(which, arg) {
    if (!loggedIn()) return { items: [], error: 'Sign in to your Spotify account first (Settings → Playback source).' };
    if (which === 'friends') return { items: [], error: 'Friend activity is only available through Spotify on your computer (desktop mode).' };
    if (which === 'tracks') return arg ? browse(arg) : { items: [] };
    if (which === 'search') return arg ? search(arg) : { items: [] };
    if (which === 'queue') {
      const big = im => [...(im || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || ''; // full size for the cover swipe
      const r = await api('GET', '/me/player/queue'), m = x => ({ uri: x.uri, title: x.name, sub: (x.artists || [x.show]).filter(Boolean).map(a => a.name).join(', '),
        art: small(x.album?.images || x.images), big: big(x.album?.images || x.images), dur: x.duration_ms });
      return { now: r?.json?.currently_playing ? m(r.json.currently_playing) : null, items: (r?.json?.queue || []).map(m) };
    }
    if (which === 'recent') {
      const r = await api('GET', '/me/player/recently-played?limit=50');
      return { items: (r?.json?.items || []).map(x => ({ uri: x.track.uri, ctx: x.context?.uri, title: x.track.name, sub: x.track.artists.map(a => a.name).join(', '), art: small(x.track.album.images), time: Date.parse(x.played_at) })) };
    }
    const [pl, al] = await Promise.all([api('GET', '/me/playlists?limit=50'), api('GET', '/me/albums?limit=50')]);
    return { items: [box('spotify:collection:tracks', 'Liked Songs', 'Playlist', 'liked'),
      ...(pl?.json?.items || []).filter(Boolean).map(p => box(p.uri, p.name, `Playlist · ${p.owner?.display_name || ''}`, small(p.images))),
      ...(al?.json?.items || []).map(a => box(a.album.uri, a.album.name, `Album · ${a.album.artists.map(x => x.name).join(', ')}`, small(a.album.images)))] };
  }

  return {
    login, logout, onAuth, control, setWanted, loggedIn, list, act,
    userId: () => (loggedIn() ? tok.uid ?? null : null),
    refreshUserId: async () => { if (loggedIn() && !tok.uid) { const r = await api('GET', '/me'); if (r?.json?.id) { tok.uid = r.json.id; save(); } } },
    onMessage: f => { out = f; },
    status: () => status || (loggedIn() ? (state.device ? `Signed in · ${state.device}` : 'Signed in') : 'Not signed in'),
  };
})();

// LRCLIB fallback on the phone (same search strategy as the bridge: artist spellings differ between catalogues).
const Lrclib = (() => {
  const withEnds = lines => lines.map((l, i) => ({ ...l, e: lines[i + 1]?.t ?? l.t + 5000 }));
  async function get(t) {
    const dur = (t.dur || 0) / 1000, first = (t.artist || '').split(',')[0];
    const search = q => fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`).then(x => x.ok ? x.json() : []).catch(() => []);
    let hits = await search(`${t.title} ${first}`);
    if (!hits.length) hits = await search(t.title || '');
    if (dur) hits = hits.filter(h => Math.abs(h.duration - dur) < 5);
    const r = hits.sort((a, b) => !!b.syncedLyrics - !!a.syncedLyrics || Math.abs(a.duration - dur) - Math.abs(b.duration - dur))[0];
    if (r?.syncedLyrics) {
      const lines = r.syncedLyrics.split('\n').map(s => s.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/))
        .filter(Boolean).map(([, mm, ss, s]) => ({ t: Math.round((+mm * 60 + +ss) * 1000), s }));
      return { kind: 'line', lines: withEnds(lines), writers: [], source: 'LRCLIB' };
    }
    if (r?.plainLyrics) return { kind: 'static', lines: r.plainLyrics.split('\n').map(s => ({ s })), writers: [], source: 'LRCLIB' };
    return null;
  }
  return { get };
})();
