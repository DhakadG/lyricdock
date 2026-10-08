// Account sync: what a LyricDock sign-in carries to every screen signed in with the same Google account (phone, web,
// installed app). Kept in LyricDock's cloud (art.lyricdock.../v1/sync, encrypted at rest), keyed by the account.
// Settings -> Playback source -> Sync with your LyricDock account:
//   all  (default) settings + keys + Spotify sign-in; never this device's own screen, performance and storage settings
//   keys the Spicy Lyrics key, the video key, the Spotify Client ID and the Spotify sign-in only
//   off  nothing leaves this screen
// Last writer wins: a screen pulls on start, when it comes back on screen and every 10 min, and pushes 2 s after a
// change. A screen pushes only once it has pulled, so a fresh one never overwrites the account with its defaults.
// Spotify turns its refresh token over on each use: every screen pushes the new one, and a screen whose token was
// turned over elsewhere takes the newer one from here instead of signing out (spotify.js -> Sync.rescue).
const Sync = (() => {
  const API = 'https://art.lyricdock.losthusky.qzz.io/v1/sync', SEEN = 'dock:syncSeen';
  const KEYS = ['apiKey', 'videoKey', 'spClientId'];
  const LOCAL_GROUPS = new Set(['Screen', 'Performance', 'Storage']); // this device's hardware, not the person's taste
  const LOCAL_KEYS = new Set(['syncScope', 'orientation', 'edgeMode', 'notchPad', 'edgePad', 'cornerPad', 'linkPath', 'relay', 'relayUrl', 'ice']);
  let pulled = false, applying = false, pushT = 0, busy = null;
  const scope = () => Settings.S.syncScope || 'all';
  const seen = () => +(localStorage.getItem(SEEN) || 0);
  const setSeen = v => { try { localStorage.setItem(SEEN, String(v)); } catch (e) {} };

  // Which settings travel: walk the schema's groups (the keys it lists under Screen / Performance / Storage stay here).
  const shared = () => {
    let g = '';
    const out = [];
    for (const x of Settings.schema()) { if (x.group) g = x.group; else if (x.k && !LOCAL_GROUPS.has(g) && !LOCAL_KEYS.has(x.k)) out.push(x.k); }
    return out;
  };
  const pack = () => {
    const S = Settings.S, sc = scope();
    const keys = sc === 'all' ? shared() : KEYS;
    return { scope: sc, settings: Object.fromEntries(keys.filter(k => k in S).map(k => [k, S[k]])), spotify: Web.syncToken() };
  };

  async function call(method, body) {
    const h = Account.headers();
    if (!h.Authorization) return null;
    const r = await fetch(API, { method, headers: { ...h, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body), cache: 'no-store' }).catch(() => null);
    return r?.ok ? r.json().catch(() => null) : null;
  }

  function apply(remote) {
    const d = remote.data || {};
    applying = true;
    try {
      const allowed = new Set(scope() === 'all' ? shared() : KEYS);
      const s = d.settings || {};
      for (const k of Object.keys(s)) if (allowed.has(k) && k in Settings.defaults && typeof s[k] === typeof Settings.defaults[k] && Settings.S[k] !== s[k]) Settings.set(k, s[k], false);
      if (d.spotify?.refresh) Web.adopt(d.spotify);
      Settings.render();
    } finally { applying = false; }
    setSeen(remote.v);
  }

  async function pull() {
    if (scope() === 'off' || !Account.user()) return false;
    const r = await call('GET');
    if (!r) return false;
    pulled = true;
    if (r.v > seen() && r.data) apply(r);
    else if (!r.v) push(); // first screen on this account: it seeds the account
    return true;
  }
  function push() {
    clearTimeout(pushT);
    pushT = setTimeout(async () => {
      if (!pulled || scope() === 'off') return;
      const v = Math.max(Date.now(), seen() + 1);
      const r = await call('PUT', { v, data: pack() });
      if (r?.v) setSeen(r.v);
    }, 2000);
  }
  const changed = () => { if (!applying && pulled) push(); };

  // Spotify said invalid_grant: another screen used (and so replaced) the refresh token. The newest one is pushed
  // within a few seconds of that, so look twice.
  async function rescue(old) {
    if (scope() === 'off') return null;
    for (const wait of [0, 4000]) {
      await new Promise(r => setTimeout(r, wait));
      const r = await call('GET');
      const t = r?.data?.spotify;
      if (t?.refresh && t.refresh !== old) { setSeen(Math.max(seen(), r.v)); return t; }
    }
    return null;
  }

  if (!window.LYRICDOCK_MINI) { // the miniplayer is this same screen
    Settings.onChange(k => { if (k === 'syncScope') { if (Settings.S.syncScope !== 'off') pull().then(push); } else changed(); });
    // Signed in a moment after start (web: the cookie buys the app token), so keep trying until the first pull lands.
    const first = setInterval(async () => { if (pulled || scope() === 'off') return clearInterval(first); if (await pull()) clearInterval(first); }, 2000);
    setInterval(pull, 10 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && pulled) pull(); });
  }
  return { pull, push: changed, rescue, status: () => (scope() === 'off' ? 'Off' : pulled ? `Synced${seen() ? ` · ${new Date(seen()).toLocaleString()}` : ''}` : 'Waiting for sign-in') };
})();
window.Sync = Sync;
