// Standalone source: the phone reads playback straight from the Spotify Web API, for when Spotify is playing
// somewhere without the Spicetify bridge (your phone, a speaker, the web player...). Uses the user's own
// Spotify app (Client ID in settings) with Authorization Code + PKCE - there is no client secret anywhere.
// Emits the same messages as the bridge (track / pos / preload), so everything downstream is shared.
const Web = (() => {
  // Phone: LoginClient.java catches the loopback redirect. Browser: a real page, /callback on the app's own origin.
  const REDIRECT = window.LYRICDOCK_WEB ? `${location.origin}/callback` : 'http://127.0.0.1:8976/callback', KEY = 'dock:spotify', PENDING = 'dock:spPending';
  const SCOPES = 'user-read-playback-state user-read-currently-playing user-modify-playback-state user-library-read user-library-modify';
  // busy: this page load is the return from Spotify's sign-in page (web), so the setup screen waits for the result.
  let tok = {}, pending = null, status = '', backoff = 0, wait = 5, lastDevice = null, busy = location.pathname === '/callback', wanted = false, timer = null, cur = null, state = {}, hist = [], out = () => {};
  try { tok = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tok)); } catch (e) {} window.Sync?.push(); }; // a new refresh token goes to the account (sync.js)
  const cid = () => (Settings.S.spClientId || '').trim().toLowerCase();
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
    // Back-navigation (e.g. a trackpad swipe) through Spotify's page lands on /callback again: nothing to do if signed in.
    if (!p && loggedIn()) { busy = false; return; }
    const ok = await finish(m, p);
    if (ok) navigator.storage?.persist?.().catch(() => {}); // Safari would otherwise wipe the sign-in after 7 days unvisited
    busy = false;
    if (ok) { window.notice?.(status, 4000); kick(); }
    else window.Setup?.open('web'); // the error shows where the user signs in, not in a closed settings row
  }
  async function finish(m, p) {
    if (!m.url || !p) return say('Sign-in cancelled. Try again.'), false;
    const u = new URL(m.url);
    if (u.searchParams.get('state') !== p.state) return say('Sign-in failed (state mismatch). Try again.'), false;
    const code = u.searchParams.get('code'), err = u.searchParams.get('error');
    if (err === 'access_denied') return say('You cancelled the sign-in on Spotify\'s page.'), false;
    if (!code) return say(`Sign-in failed: ${err || 'no code'}`), false;
    tok = {}; // a new sign-in may be another account: drop the old one's id and name
    if (!(await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: cid(), code_verifier: p.verifier }))) return false;
    // A development-mode Spotify app hands tokens to anyone, then answers 403 for accounts missing from its
    // User Management list. Check now, or the screen would say "Signed in" and never show a song.
    const r = await api('GET', '/me');
    if (r?.status === 403) {
      tok = {}; save();
      return say('Spotify refused this account for that Client ID. The app\'s owner must add the email of THIS Spotify account under User Management in the developer dashboard (max 5 people).'), false;
    }
    if (r?.json?.id) { tok.uid = r.json.id; tok.name = r.json.display_name || r.json.id; save(); } // uid: account auto-pairing
    say(`Signed in${tok.name ? ` as ${tok.name}` : ''}`);
    return true;
  }

  async function token(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) {
      // Another screen on this LyricDock account used the refresh token (Spotify replaces it on each use): take theirs.
      if (j.error === 'invalid_grant' && params.grant_type === 'refresh_token') {
        const t = await window.Sync?.rescue(params.refresh_token);
        if (t) { tok = { ...tok, ...t, access: null, exp: 0 }; save(); return token({ ...params, refresh_token: t.refresh }); }
      }
      if (j.error === 'invalid_grant' || j.error === 'invalid_client') { tok = {}; save(); }
      say(`Spotify: ${j.error_description || j.error || (r ? r.status : 'offline')}`);
      return false;
    }
    tok = { ...tok, cid: cid(), access: j.access_token, refresh: j.refresh_token || tok.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
    save();
    return true;
  }

  // One refresh at a time: parallel calls share it. Two refreshes with the same token race, and the loser's
  // invalid_grant would sign the user out.
  let refreshing = null;
  // The miniplayer (mini.js) is a second copy of this screen: it borrows the main copy's token and never refreshes it,
  // or the two would race each other's refresh token.
  const fresh = async () => window.LYRICDOCK_MINI ? (() => { try { tok = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {} return !!tok.access && Date.now() < tok.exp; })() :
    (tok.access && Date.now() < tok.exp) ||
    (loggedIn() && (refreshing ??= token({ grant_type: 'refresh_token', refresh_token: tok.refresh, client_id: cid() }).finally(() => { refreshing = null; })));

  function logout() {
    tok = {}; save(); cur = null; state = {};
    try { localStorage.removeItem('dock:linked'); } catch (e) {} // signed out = not set up: the setup screen comes back
    say('Signed out');
  }

  async function api(method, path, body) {
    if (Date.now() < backoff || !(await fresh())) return null;
    const t0 = performance.now();
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + tok.access, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!r) return null;
    const rtt = performance.now() - t0;
    if (r.status === 401) { tok.exp = 0; return null; } // refreshes on the next call
    // Retry-After may be unreadable cross-origin: then back off 10 s, 20 s ... 5 min while it keeps refusing.
    if (r.status === 429) { backoff = Date.now() + (+r.headers.get('Retry-After') || (wait = Math.min(300, wait * 2))) * 1000; return null; }
    wait = 5;
    if (r.status === 204) return { status: 204, rtt };
    return { status: r.status, json: await r.json().catch(() => null), rtt };
  }

  // ---- playback
  const info = it => ({ id: it.id, uri: it.uri, title: it.name, artist: (it.artists || []).map(a => a.name).join(', '), a1: it.artists?.[0]?.name,
    album: it.album?.name, year: (it.album?.release_date || '').slice(0, 4), artistId: it.artists?.[0]?.id, art: [...(it.album?.images || [])].sort((a, b) => b.width - a.width)[0]?.url || null, dur: it.duration_ms });

  function direction(id) {
    if (hist.length > 1 && hist[hist.length - 2] === id) { hist.pop(); return -1; }
    if (hist[hist.length - 1] !== id) hist = [...hist, id].slice(-50);
    return 1;
  }

  // Poll every second while playing (3s paused, 5-10s idle). Position = progress + half the round trip.
  let pollGen = 0, dueAt = 0;
  async function poll() {
    clearTimeout(timer);
    if (!wanted || !loggedIn()) return;
    const my = ++pollGen; // a kick() while this one waits starts a newer poll: only the newest re-arms the timer
    dueAt = Date.now() + 10000; // in flight
    let delay = 10000;
    const r = await api('GET', '/me/player');
    const s = r?.json, it = s?.item;
    if (r?.status === 200 && it?.type === 'track') {
      // iPhones (and some speakers) set their own volume: supports_volume false = no slider (Spotify refuses the change).
      const vol = s.device?.supports_volume === false ? undefined : s.device?.volume_percent;
      if (s.device?.id) lastDevice = s.device.id; // to wake it again when Spotify drops it as the active device
      state = { playing: s.is_playing, device: s.device?.name, dtype: s.device?.type, volume: vol, shuffle: s.shuffle_state, repeat: { off: 0, context: 1, track: 2 }[s.repeat_state] ?? 0 };
      if (it.id !== cur?.id) newTrack(it);
      out({ type: 'pos', pos: s.progress_ms + (s.is_playing ? r.rtt / 2 : 0), playing: s.is_playing, dur: it.duration_ms,
        liked: cur.liked, volume: state.volume, device: state.device, shuffle: state.shuffle, repeat: state.repeat });
      delay = s.is_playing ? 1000 : 3000;
    } else if (r) { state = { playing: false }; delay = 5000; }
    if (wanted && my === pollGen) { timer = setTimeout(poll, delay); dueAt = Date.now() + delay; }
  }
  const kick = (ms = 0) => { clearTimeout(timer); timer = setTimeout(poll, ms); dueAt = Date.now() + ms; };

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
    // Lyrics (the Spicy API if a key is set, else LRCLIB) and the next song, side by side: a slow lyrics site must not
    // hold up the preload. The next song's lyrics are fetched now too, so a skip shows them at once.
    const lyrics = async s => (Api.enabled() ? await Api.get(s.id) : null) ?? await Lrclib.get(s);
    const [l, q] = await Promise.all([lyrics(t), api('GET', '/me/player/queue')]);
    if (l && cur === t) out({ type: 'track', ...t, lyrics: l });
    const n = q?.json?.queue?.find(x => x?.type === 'track');
    if (!n || cur !== t) return;
    const ni = info(n);
    out({ type: 'preload', ...ni, lyrics: null });
    const nl = await lyrics(ni);
    if (nl && cur === t) out({ type: 'preload', ...ni, lyrics: nl });
  }

  // ---- controls (Premium). Poll right after so the screen follows immediately.
  // Spotify's refusals used to vanish: a Free account (403 PREMIUM_REQUIRED) or an iPhone's volume looked like dead buttons.
  // They're shown now, and logged anonymously (command + status + reason, nothing else) for the dashboard.
  const refusal = r => {
    const e = r.json?.error || {}, reason = e.reason || '';
    return reason === 'PREMIUM_REQUIRED' ? 'Spotify only lets Premium accounts be controlled from other apps - this account can be followed, not controlled'
      : reason === 'NO_ACTIVE_DEVICE' || r.status === 404 ? 'No active Spotify device - press play in Spotify first'
      : reason === 'VOLUME_CONTROL_DISALLOW' ? 'This device sets its own volume (iPhones do) - change it there'
      : `Spotify refused that (${r.status}${e.message ? `: ${e.message}` : ''})`;
  };
  async function control(cmd, arg, retried) {
    if (!loggedIn()) return window.notice?.('Not signed in to Spotify - Settings → Playback source');
    let r = null;
    if (cmd === 'toggle') r = await api('PUT', state.playing ? '/me/player/pause' : '/me/player/play');
    else if (cmd === 'next') r = await api('POST', '/me/player/next');
    else if (cmd === 'prev') r = await api('POST', '/me/player/previous');
    else if (cmd === 'seek') r = await api('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(arg))}`);
    else if (cmd === 'volume') r = await api('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(arg)))}`);
    else if (cmd === 'shuffle') r = await api('PUT', `/me/player/shuffle?state=${!state.shuffle}`);
    else if (cmd === 'repeat') r = await api('PUT', `/me/player/repeat?state=${['off', 'context', 'track'][Number.isFinite(arg) ? arg % 3 : ((state.repeat || 0) + 1) % 3]}`);
    else if (cmd === 'play' && arg?.uri) { if (arg.shuffle) await api('PUT', '/me/player/shuffle?state=true'); r = await api('PUT', '/me/player/play', /^spotify:(playlist|album|artist|show|collection)/.test(arg.uri) ? { context_uri: arg.uri }
      : arg.ctx && !/^spotify:collection/.test(arg.ctx) ? { context_uri: arg.ctx, offset: { uri: arg.uri } } : { uris: [arg.uri] }); }
    else if (cmd === 'heart' && cur) {
      r = await api(cur.liked ? 'DELETE' : 'PUT', '/me/library?uris=' + encodeURIComponent(cur.uri));
      if (r && r.status < 300) cur.liked = !cur.liked;
    }
    // An idle iPhone stops being Spotify's active device (404): hand playback back to it once, then try again.
    if (r?.status === 404 && lastDevice && !retried && cmd !== 'heart') {
      const t = await api('PUT', '/me/player', { device_ids: [lastDevice] });
      if (t && t.status < 300) { await new Promise(res => setTimeout(res, 400)); return control(cmd, arg, true); }
    }
    const failed = (r && r.status >= 400) || (!r && Date.now() < backoff);
    if (r && r.status >= 400) {
      window.notice?.(refusal(r), 6000);
      window.cloudPing?.('control-fail', `${cmd} ${r.status} ${r.json?.error?.reason || ''}`);
    } else if (failed) window.notice?.(`Spotify is rate-limiting this app - try again in ${Math.ceil((backoff - Date.now()) / 1000)} s`);
    if (failed) window.controlFailed?.(); // the screen already showed the change: undo it
    kick(failed ? 0 : 250);
  }

  function setWanted(w) {
    if (window.LYRICDOCK_MINI) return; // the miniplayer is fed by the main copy (mini.js)
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
    // Account sync (sync.js): the sign-in without the short-lived access token, and taking one from another screen.
    syncToken: () => (tok.refresh ? { refresh: tok.refresh, cid: tok.cid, uid: tok.uid, name: tok.name } : null),
    adopt: t => { if (t.refresh === tok.refresh) return; tok = { ...t, access: null, exp: 0 }; try { localStorage.setItem(KEY, JSON.stringify(tok)); } catch (e) {} kick(); },
    // A hidden tab's timers can be held back to one a minute; the open miniplayer pokes once a second (mini.js).
    playingOn: () => ({ name: state.device, type: state.dtype }), // Spotify's device type: Computer, Smartphone, Speaker...
    poke: () => { if (wanted && Date.now() > dueAt + 300) kick(); },
    login, logout, onAuth, control, setWanted, loggedIn, list, act, redirect: REDIRECT,
    busy: () => busy || !!pending,
    userId: () => (loggedIn() ? tok.uid ?? null : null),
    refreshUserId: async () => { if (loggedIn() && !tok.name) { const r = await api('GET', '/me'); if (r?.json?.id) { tok.uid = r.json.id; tok.name = r.json.display_name || r.json.id; save(); } } },
    onMessage: f => { out = f; },
    // Signed in: who, and where it plays. Otherwise the last sign-in message.
    status: () => loggedIn() ? `Signed in${tok.name ? ` as ${tok.name}` : ''}${state.device ? ` · playing on ${state.device}` : ''}` : status || 'Not signed in',
  };
})();
window.Web = Web; // a top-level const is not a window property: settings.js reads window.Web

// LRCLIB fallback on the phone (same search strategy as the bridge: artist spellings differ between catalogues).
const Lrclib = (() => {
  const withEnds = lines => lines.map((l, i) => ({ ...l, e: lines[i + 1]?.t ?? l.t + 5000 }));
  // Spotify titles carry suffixes LRCLIB's don't: "Song - Remastered 2011", "Song (feat. X)", "Song [Live]".
  const bare = s => String(s || '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim() || String(s || '');
  async function get(t) {
    // a1: the first artist as Spotify lists it ("Tyler, The Creator" has a comma of its own)
    const dur = (t.dur || 0) / 1000, first = t.a1 || (t.artist || '').split(',')[0].trim();
    const json = (u, none) => { const c = new AbortController(), k = setTimeout(() => c.abort(), 6000); // a stuck request gives up
      return fetch(u, { signal: c.signal }).then(x => x.ok ? x.json() : none).catch(() => none).finally(() => clearTimeout(k)); };
    const search = q => json(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, []).then(h => Array.isArray(h) ? h : []);
    // Exact match first (title + artist + album + length, LRCLIB's own lookup), then searches from strict to loose.
    const exact = dur ? await json(`https://lrclib.net/api/get?${new URLSearchParams({ track_name: t.title || '', artist_name: first, album_name: t.album || '', duration: Math.round(dur) })}`, null) : null;
    let hits = exact?.id ? [exact] : await search(`${t.title} ${first}`);
    if (!hits.length && bare(t.title) !== t.title) hits = await search(`${bare(t.title)} ${first}`);
    if (!hits.length) hits = await search(bare(t.title));
    // Synced lyrics must match the length closely; plain text can be a little further off (another edit of the song).
    if (dur) hits = hits.filter(h => Math.abs(h.duration - dur) < (h.syncedLyrics ? 5 : 8));
    const r = hits.sort((a, b) => !!b.syncedLyrics - !!a.syncedLyrics || Math.abs(a.duration - dur) - Math.abs(b.duration - dur))[0];
    if (r?.instrumental) return { kind: 'static', lines: [{ s: '♪ Instrumental' }], writers: [], source: 'LRCLIB' };
    if (r?.syncedLyrics) {
      // A repeated line can carry several times: "[00:12.00][01:30.00]text" is one line at each time.
      const lines = r.syncedLyrics.split('\n').flatMap(s => {
        const m = /^((?:\[\d+:\d+(?:\.\d+)?\])+)\s*(.*)/.exec(s);
        return m ? [...m[1].matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)].map(([, mm, ss]) => ({ t: Math.round((+mm * 60 + +ss) * 1000), s: m[2] })) : [];
      }).sort((a, b) => a.t - b.t);
      return { kind: 'line', lines: withEnds(lines), writers: [], source: 'LRCLIB' };
    }
    if (r?.plainLyrics) return { kind: 'static', lines: r.plainLyrics.split('\n').map(s => ({ s })), writers: [], source: 'LRCLIB' };
    return null;
  }
  return { get };
})();
