// LyricDock web app: service worker + updates, the "install as an app" prompt, and anonymous usage events.
// Loaded after the app scripts (web build only). Docs: docs/web-app.md.
(() => {
  const ping = (e, detail) => window.cloudPing?.(e, detail);
  const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

  // ---- service worker: offline shell, updates on our terms
  let reloading = false;
  window.lyricdockApplyUpdate = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.waiting?.postMessage('apply-update');
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state !== 'installed' || !navigator.serviceWorker.controller) return; // first install: nothing to replace
          if (Settings.S.autoUpdate) window.lyricdockApplyUpdate();
          else window.notice?.('A new version of LyricDock is ready - Settings -> Updates', 6000);
        });
      });
      setInterval(() => reg.update().catch(() => {}), 30 * 60000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      ping('update');
      location.reload();
    });
  }

  // ---- Spotify sign-in comes back here as /callback?code=...&state=...
  if (location.pathname === '/callback') {
    const url = location.href;
    history.replaceState(null, '', '/');
    addEventListener('load', () => window.dock?.({ type: 'auth', url }));
  }

  // ---- "Install as an app": Chrome / Edge / Android give us the prompt; iPhone needs Share -> Add to Home Screen.
  const SNOOZE = 'dock:installSnooze', snoozed = () => Date.now() < +(localStorage.getItem(SNOOZE) || 0);
  let deferred = null;
  const ios = /iPhone|iPad/.test(navigator.userAgent) && !window.MSStream;

  function chip(text, actionLabel, action, always = false) {
    if (!always && (standalone() || snoozed())) return;
    if (document.getElementById('installChip')) return;
    const el = document.createElement('div');
    el.id = 'installChip';
    el.innerHTML = `<img src="icons/icon-192.png" alt=""><span></span><button class="go"></button><button class="later" aria-label="Not now">✕</button>`;
    el.querySelector('span').textContent = text;
    const go = el.querySelector('.go');
    if (actionLabel) go.textContent = actionLabel; else go.remove();
    go.onclick = () => { el.remove(); action?.(); };
    el.querySelector('.later').onclick = () => {
      el.remove();
      localStorage.setItem(SNOOZE, String(Date.now() + 14 * 864e5));
      ping('install-dismissed');
    };
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
    ping('install-shown');
  }

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    setTimeout(() => chip('Install LyricDock as an app: its own window, no browser bars', 'Install', async () => {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      ping(outcome === 'accepted' ? 'install-accepted' : 'install-dismissed');
      deferred = null;
    }), 8000); // after the first song is on screen, not over the loading state
  });
  addEventListener('appinstalled', () => { document.getElementById('installChip')?.remove(); ping('installed'); });
  if (ios && !standalone()) setTimeout(() => chip('Add LyricDock to your Home Screen: tap Share, then "Add to Home Screen"'), 8000);
  window.lyricdockInstall = () => deferred ? (deferred.prompt(), true) : false;

  // ---- Local network access. Chrome / Edge (2026) let a public site reach this PC or the home network - where Spotify
  // with the LyricDock extension is - only after the user allows it. Explained first, then the browser's own prompt is
  // triggered by a request to this PC and to the router address range (it fails; only the permission matters).
  const LNA = ['local-network', 'loopback-network', 'local-network-access'];
  async function lnaState() {
    const states = [];
    for (const name of LNA) {
      try { states.push((await navigator.permissions.query({ name })).state); } catch (e) { /* not this browser */ }
    }
    if (!states.length) return 'unsupported'; // Firefox / Safari: nothing to ask
    return states.includes('denied') ? 'denied' : states.includes('prompt') ? 'prompt' : 'granted';
  }
  async function lnaRequest() {
    const knock = (url, space) => fetch(url, { mode: 'no-cors', cache: 'no-store', targetAddressSpace: space }).catch(() => {});
    await Promise.all([knock('http://127.0.0.1:8977/', 'loopback'), knock('http://192.168.1.1/', 'local')]);
    const s = await lnaState();
    ping(s === 'granted' ? 'lna-granted' : 'lna-' + s);
    window.notice?.(s === 'granted' ? 'Local network allowed - Spotify on your computer can connect' : s === 'denied'
      ? 'Blocked: allow "Local network" for this site in the address bar\'s site settings' : 'Not decided yet - you can allow it any time in Settings -> Connection', 6000);
    window.settingsRender?.();
    return s;
  }
  window.lyricdockLna = { state: lnaState, request: lnaRequest };
  // Asked once a session, while following (or looking for) Spotify on a computer - not for account-only setups.
  setTimeout(async () => {
    if (Settings.S.source === 'web' || await lnaState() !== 'prompt') return;
    chip('Allow LyricDock to reach Spotify on your computer (your browser will ask about the local network)', 'Allow', lnaRequest, true);
  }, 6000);

  // ---- full screen (desktop / Android browsers; a gesture is required, so it's offered, not forced)
  window.lyricdockFullscreen = () => document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});

  // ---- anonymous usage: opened (with how), and errors (message + file:line only, never user data)
  addEventListener('load', () => setTimeout(() => ping('open'), 3000));
  addEventListener('error', e => ping('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
  addEventListener('unhandledrejection', e => ping('error', `promise: ${String(e.reason?.message || e.reason).slice(0, 200)}`));
})();
