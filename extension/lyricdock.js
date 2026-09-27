// LyricDock loader - the only file installed into Spicetify. Same idea as Spicy Lyrics' entrypoint:
// 1. ask GitHub which version is current (extension/version.json on main),
// 2. load that exact tagged build from jsDelivr (@vX.Y.Z is immutable, so it is cached for good),
// 3. keep the last build that loaded, so Spotify still gets LyricDock when offline or when GitHub is down,
// 4. while Spotify runs, check every 30 min and offer the update (the settings panel shows it too).
// Development: scripts/install-extension.ps1 -Dev installs extension/dock-bridge.js directly instead.
(async function lyricdockLoader() {
  const REPO = 'DhakadG/lyricdock', CODE = 'lyricdock:build', VER = 'lyricdock:build-version';
  const ls = window.localStorage; // Spicetify.LocalStorage may not exist yet this early
  const isVer = v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

  async function latest() {
    const r = await withTimeout(fetch(`https://raw.githubusercontent.com/${REPO}/main/extension/version.json?t=${Date.now()}`, { cache: 'no-store' }), 6000);
    const v = (await r.json()).version;
    if (!isVer(v)) throw new Error('bad version.json');
    return v;
  }
  async function download(v) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await withTimeout(fetch(`https://cdn.jsdelivr.net/gh/${REPO}@v${v}/extension/dock-bridge.js`), 10000);
        const code = await r.text();
        if (r.ok && code.includes('function dockBridge')) return code;
      } catch {}
      await new Promise(res => setTimeout(res, 1000 * 2 ** i));
    }
    throw new Error('download failed');
  }
  // Run a build: as a module from a blob (no network needed), falling back to an inline script.
  async function run(code, v, source) {
    window.__lyricdock = { version: v, source, loader: true, latest: v };
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
      if (!newer(v, window.__lyricdock.version) || v === window.__lyricdock.latest) return;
      const code = await download(v);
      ls.setItem(CODE, code); ls.setItem(VER, v); // next start uses it even if the user ignores the notice
      window.__lyricdock.latest = v;
      window.Spicetify?.showNotification?.(`LyricDock ${v} is ready - it loads next time Spotify starts (or Update now in the LyricDock panel)`);
      window.dispatchEvent(new Event('lyricdock:update'));
    } catch {}
  }, 30 * 60 * 1000);
})();
