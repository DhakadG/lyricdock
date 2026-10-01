// LyricDock in a browser: stands in for the Android app's `Dock` bridge (MainActivity.java).
// The web build (scripts/build-web.ps1) loads it before the app scripts; the phone app never ships it.
// Every method the app calls exists here - real web APIs where there is one, a harmless answer where there isn't.
// Docs: docs/web-app.md.
(() => {
  if (window.Dock) return;

  const VERSION = '__VERSION__'; // stamped at build time from extension/version.json
  const toPage = m => window.dock?.(m); // app.js: native -> page messages

  // Screen Wake Lock. Browsers drop it whenever the tab is hidden, so it's taken again on return.
  let lock = null, wantAwake = false;
  async function holdAwake() {
    if (!wantAwake || lock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch (e) { /* denied (battery saver, no gesture yet): tried again on the next visibility change */ }
  }
  document.addEventListener('visibilitychange', holdAwake);

  // Battery: async in the browser, read synchronously by the app every second -> keep a "pct,charging" copy.
  let battery = '';
  navigator.getBattery?.().then(b => {
    const read = () => { battery = `${Math.round(b.level * 100)},${b.charging ? 1 : 0}`; };
    read();
    b.addEventListener('levelchange', read);
    b.addEventListener('chargingchange', read);
  }).catch(() => {});

  // What Spotify's "Find devices" list shows for this screen.
  function model() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'Mac' : /Linux|CrOS/.test(ua) ? 'Linux' : 'Web';
    return `${os} browser`;
  }

  // Updates: a new service worker = a new version. Answer in the app's own update states.
  async function checkUpdate(install) {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return toPage({ type: 'update', state: 'current' });
    try { await reg.update(); } catch (e) { return toPage({ type: 'update', state: 'error', version: 'offline' }); }
    const next = reg.installing || reg.waiting;
    if (!next) return toPage({ type: 'update', state: 'current' });
    toPage({ type: 'update', state: install ? 'installing' : 'available', version: 'new' });
    if (install) window.lyricdockApplyUpdate?.();
  }

  window.Dock = {
    send() {}, // the WebRTC link carries everything (app.js sends to both)
    version: () => VERSION,
    lastCrash: () => '',
    setChannel() {},
    checkUpdate: install => { checkUpdate(install); },
    model,
    ip: () => '',
    insets() { // the browser's own safe areas (notch, home bar), read through CSS env() - same shape as the phone's
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
        + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.append(probe);
      const s = getComputedStyle(probe), px = v => parseFloat(v) || 0;
      const out = { l: px(s.paddingLeft), t: px(s.paddingTop), r: px(s.paddingRight), b: px(s.paddingBottom) };
      probe.remove();
      return JSON.stringify(out);
    },
    setOrientation(o) {
      try {
        if (o === 'auto') screen.orientation.unlock();
        else screen.orientation.lock(o).catch(() => {}); // only in fullscreen, mostly Android Chrome
      } catch (e) {}
    },
    webCacheBytes: () => 0, // the HTTP cache isn't readable from a page; Storage shows the total instead
    clearWebCache() {},
    kioskOn: () => false,
    leaveKiosk() {},
    canReopen: () => false,
    askReopen() {},
    login: url => location.assign(url), // Spotify sign-in: a full-page redirect back to /callback
    keepAwake(on) {
      wantAwake = !!on;
      if (wantAwake) holdAwake();
      else { lock?.release(); lock = null; }
    },
    vibrate: ms => navigator.vibrate?.(ms),
    battery: () => battery,
    brightness() {}, // no web API
    media() {}, // Media Session only shows while a page plays audio
    setVolKeys() {},
    wake() {}, // a page can't switch the screen on
  };
  window.LYRICDOCK_WEB = true;
})();
