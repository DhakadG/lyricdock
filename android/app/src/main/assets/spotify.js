// Standalone source: the phone reads playback straight from the Spotify Web API, for when Spotify is playing
// somewhere without the Spicetify bridge (your phone, a speaker, the web player...). Uses the user's own
// Spotify app (Client ID in settings) with Authorization Code + PKCE - there is no client secret anywhere.
// Emits the same messages as the bridge (track / pos / preload), so everything downstream is shared.
const Web = (() => {
  const REDIRECT = 'http://127.0.0.1:8976/callback', KEY = 'dock:spotify';
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
    const q = new URLSearchParams({ client_id: cid(), response_type: 'code', redirect_uri: REDIRECT,
      code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state: st });
    say('Signing in…');
    Dock.login('https://accounts.spotify.com/authorize?' + q);
  }

  async function onAuth(m) {
    const p = pending;
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

  async function api(method, path) {
    if (Date.now() < backoff || !(await fresh())) return null;
    const t0 = performance.now();
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + tok.access } }).catch(() => null);
    if (!r) return null;
    const rtt = performance.now() - t0;
    if (r.status === 401) { tok.exp = 0; return null; } // refreshes on the next call
    if (r.status === 429) { backoff = Date.now() + (+r.headers.get('Retry-After') || 5) * 1000; return null; }
    if (r.status === 204) return { status: 204, rtt };
    return { status: r.status, json: await r.json().catch(() => null), rtt };
  }

  // ---- playback
  const info = it => ({ id: it.id, uri: it.uri, title: it.name, artist: (it.artists || []).map(a => a.name).join(', '),
    album: it.album?.name, artistId: it.artists?.[0]?.id, art: [...(it.album?.images || [])].sort((a, b) => b.width - a.width)[0]?.url || null, dur: it.duration_ms });

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
      state = { playing: s.is_playing, device: s.device?.name, volume: s.device?.volume_percent };
      if (it.id !== cur?.id) newTrack(it);
      out({ type: 'pos', pos: s.progress_ms + (s.is_playing ? r.rtt / 2 : 0), playing: s.is_playing, dur: it.duration_ms,
        liked: cur.liked, volume: state.volume, device: state.device });
      delay = s.is_playing ? 1000 : 3000;
    } else if (r) { state = { playing: false }; delay = 5000; }
    if (wanted) timer = setTimeout(poll, delay);
  }
  const kick = (ms = 0) => { clearTimeout(timer); timer = setTimeout(poll, ms); };

  async function newTrack(it) {
    cur = { ...info(it), liked: undefined };
    const t = cur;
    out({ type: 'track', ...t, dir: direction(t.id), lyrics: null });
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

  return {
    login, logout, onAuth, control, setWanted, loggedIn,
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
