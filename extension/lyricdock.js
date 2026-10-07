// LyricDock loader - the only file installed into Spicetify. Same idea as Spicy Lyrics' entrypoint:
// 1. ask GitHub which version is current (extension/version.json on main),
// 2. load that exact tagged build from jsDelivr (@vX.Y.Z is immutable, so it is cached for good) - only if its
//    signature (dock-bridge.js.sig, made by scripts/sign-extension.mjs at release) checks out against KEY below,
// 3. keep the last build that loaded, so Spotify still gets LyricDock when offline or when GitHub is down,
// 4. while Spotify runs, check every 30 min and offer the update (the settings panel shows it too).
// Development: scripts/install-extension.ps1 -Dev installs extension/dock-bridge.js directly instead.
(async function lyricdockLoader() {
  const REPO = 'DhakadG/lyricdock', CODE = 'lyricdock:build', VER = 'lyricdock:build-version';
  const ls = window.localStorage; // Spicetify.LocalStorage may not exist yet this early
  const isVer = v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  // The release signing key (public half; the private one never leaves the maintainer's PC). A repo or CDN compromise
  // alone can't put code into Spotify: it would need this key's signature.
  const KEY = { kty: 'EC', crv: 'P-256', x: '5Jt4no0pL1EAzLRkZTz_qTWC6wW3BVZIS7jE0J12umI', y: 'EZC3pygg0nHSsSTbCBcTYPh0FVb_fpH6znz1AdoK1_8' };
  async function signed(buf, sig) {
    try {
      const k = await crypto.subtle.importKey('jwk', KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const s = Uint8Array.from(atob(sig.trim().replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, s, buf);
    } catch { return false; }
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

  // The build to run: a version pinned in the LyricDock panel (rollback), else the newest on the chosen channel
  // (version.json: { version, beta }).
  async function latest() {
    const pin = ls.getItem('lyricdock:pin');
    if (isVer(pin)) return pin;
    const r = await withTimeout(fetch(`https://raw.githubusercontent.com/${REPO}/main/extension/version.json?t=${Date.now()}`, { cache: 'no-store' }), 6000);
    const j = await r.json(), v = ls.getItem('lyricdock:channel') === 'beta' && isVer(j.beta) && newer(j.beta, j.version) ? j.beta : j.version;
    if (!isVer(v)) throw new Error('bad version.json');
    return v;
  }
  async function download(v) {
    const at = `https://cdn.jsdelivr.net/gh/${REPO}@v${v}/extension/dock-bridge.js`;
    for (let i = 0; i < 3; i++) {
      let buf, sig;
      try {
        const [r, s] = await withTimeout(Promise.all([fetch(at), fetch(`${at}.sig`)]), 10000);
        if (r.ok && s.ok) [buf, sig] = await Promise.all([r.arrayBuffer(), s.text()]);
      } catch {}
      if (buf) {
        if (await signed(buf, sig)) return new TextDecoder().decode(buf);
        throw new Error(`v${v}: signature check failed - not running it`); // no retry: a bad signature won't get better
      }
      await new Promise(res => setTimeout(res, 1000 * 2 ** i));
    }
    throw new Error('download failed');
  }
  // Run a build: as a module from a blob (no network needed), falling back to an inline script.
  async function run(code, v, source) {
    window.__lyricdock = { version: v, source, loader: 3, latest: v };
    try { await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); }
    catch { const s = document.createElement('script'); s.textContent = code; document.head.append(s); }
    console.log(`[LyricDock] v${v} loaded (${source})`);
  }

  let current = ls.getItem(VER), cached = ls.getItem(CODE);
  try {
    const v = await latest();
    if (v !== current || !cached) { cached = await download(v); ls.setItem(CODE, cached); ls.setItem(VER, v); current = v; }
    await run(cached, current, 'github');
  } catch (e) {
    if (cached && isVer(current)) await run(cached, current, 'offline copy');
    else console.error('[LyricDock] could not load and no offline copy yet:', e);
    return;
  }

  // Mid-session update check.
  setInterval(async () => {
    try {
      const v = await latest();
      if (v === window.__lyricdock.version || v === window.__lyricdock.latest) return;
      const code = await download(v);
      ls.setItem(CODE, code); ls.setItem(VER, v); // next start uses it even if the user ignores the notice
      window.__lyricdock.latest = v;
      window.Spicetify?.showNotification?.(`LyricDock ${v} is ready - it loads next time Spotify starts (or Update now in the LyricDock panel)`);
      window.dispatchEvent(new Event('lyricdock:update'));
    } catch {}
  }, 30 * 60 * 1000);
})();
