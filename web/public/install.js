// LyricDock web app: service worker + updates, the "install as an app" prompt, and anonymous usage events.
// Loaded after the app scripts (web build only). Docs: docs/web-app.md.
(() => {
  const ping = (e, detail) => window.cloudPing?.(e, detail);
  const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

  // ---- service worker: offline shell, updates on our terms
  // The first install claims the page (sw.js clients.claim), which also fires controllerchange: not an update.
  let reloading = false, hadController = !!navigator.serviceWorker?.controller;
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
      if (!hadController) { hadController = true; return; }
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
    if (document.getElementById('installChip') || window.Setup?.isOpen()) return; // the setup screen has its own steps
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
    setTimeout(() => chip('Install LyricDock as an app: its own window, no browser bars', 'Install', promptInstall), 8000); // after the first song is on screen
  });
  // The browser's prompt can be shown once: the chip and Settings -> Install share it.
  async function promptInstall() {
    const d = deferred;
    if (!d) return;
    deferred = null;
    document.getElementById('installChip')?.remove();
    d.prompt();
    const { outcome } = await d.userChoice;
    ping(outcome === 'accepted' ? 'install-accepted' : 'install-dismissed');
  }
  addEventListener('appinstalled', () => { document.getElementById('installChip')?.remove(); ping('installed'); });
  // iPadOS says it's a Mac: a Mac with a touch screen is an iPad. Safari 17+ on a Mac has File -> Add to Dock instead.
  const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const macSafari = !ipad && /Macintosh/.test(navigator.userAgent) && /Version\/1[7-9]|Version\/[2-9]\d/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent);
  // The Home Screen app keeps its own storage, apart from Safari: say so, or the second sign-in is a surprise.
  if ((ios || ipad) && !standalone()) setTimeout(() => chip('Add LyricDock to your Home Screen: tap Share, then "Add to Home Screen". You sign in once more inside it.'), 8000);
  else if (macSafari && !standalone()) setTimeout(() => chip('Add LyricDock to your Dock: File → "Add to Dock"'), 8000);
  window.lyricdockInstall = () => !!deferred && (promptInstall(), true);

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
  // ensure(): the browser's own prompt, right away and once per session, if it hasn't been answered yet. Resolves to the state.
  let asked = null;
  const ensure = async () => await lnaState() === 'prompt' ? (asked ||= lnaRequest()) : lnaState();
  window.lyricdockLna = { state: lnaState, request: lnaRequest, ensure };
  // Asked as soon as LyricDock starts looking for Spotify on a computer - not for account-only setups. While the setup
  // screen is up it asks instead, when "Use Spotify on your computer" is picked.
  // A screen that follows only a Spotify account and never met Spotify on a computer isn't asked at all.
  const pcSeen = () => { try { return !!localStorage.getItem('dock:pcSeen'); } catch (e) { return false; } };
  setTimeout(() => { if (Settings.S.source !== 'web' && !window.Setup?.isOpen() && (!window.Web?.loggedIn() || pcSeen())) ensure(); }, 1000);

  // ---- full screen (desktop / Android browsers; a gesture is required, so it's offered, not forced). Safari before
  // 16.4 only has the webkit-prefixed call (iPhone has none for pages).
  window.lyricdockFullscreen = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  };
  const fullscreenEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const exitFullscreen = () => (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);

  // ---- mouse / trackpad: moving the pointer shows the controls (they fade, and the cursor hides, after the usual delay).
  let moved = 0;
  addEventListener('mousemove', () => {
    const t = performance.now();
    if (t - moved < 250 || !matchMedia('(pointer: fine)').matches || window.lyricdockPanelOpen?.()) return;
    moved = t;
    window.showUi?.(true);
  }, { passive: true });

  // ---- keyboard, for computers (the phone's swipes have no mouse equivalent): Space play/pause, arrows skip, F full screen.
  // A mouse click leaves no focus on a button, so Space can't re-press the last one clicked (keyboard focus stays).
  addEventListener('click', e => { if (e.detail) e.target.closest?.('button')?.blur(); }, true);
  window.lyricdockPanelOpen = () => window.Setup?.isOpen() || document.body.matches('.settings-open, .lists-open, .qs-open, .news-open, .pair-ask');
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, button, [contenteditable]') || window.lyricdockPanelOpen()) return;
    const k = { ' ': 'pp', ArrowRight: 'next', ArrowLeft: 'prev' }[e.key];
    if (k) { e.preventDefault(); document.getElementById(k)?.click(); }
    else if (e.key === 'f' || e.key === 'F') fullscreenEl() ? exitFullscreen() : window.lyricdockFullscreen();
  });

  // ---- anonymous usage: opened (with how), and errors (message + file:line only, never user data)
  addEventListener('load', () => setTimeout(() => ping('open'), 3000));
  addEventListener('error', e => ping('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
  addEventListener('unhandledrejection', e => ping('error', `promise: ${String(e.reason?.message || e.reason).slice(0, 200)}`));
})();
