// LyricDock sign-in: required on every screen, the phone app and the web app (docs/sso-rollout.md).
//  - Phone: "Sign in with Google" opens auth.lyricdock in the phone's browser (Dock.signIn: Google refuses sign-in inside
//    an app's WebView). It comes back through lyricdock://signed-in?code= (MainActivity -> Dock.ssoResult), and the code
//    plus this page's PKCE verifier buy an app token. Already signed in on that browser: one tap, no Google page.
//  - Web: the page only loads signed in (web/src/worker.js); the session cookie buys the same app token, and an
//    installed app that runs from its cache goes to sign-in when the cookie has ended.
// The token rides along with every call to LyricDock's cloud (features.js), which answers signed-in apps only. It lasts
// 90 days and renews itself while the app is used, so a dock in daily use never asks again.
const Account = (() => {
  const AUTH = 'https://auth.lyricdock.losthusky.qzz.io', KEY = 'dock:account', PENDING = 'dock:ssoPending', BOUNCE = 'dock:ssoBounce';
  const web = !!window.LYRICDOCK_WEB, now = () => Date.now() / 1000;
  const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  let acc = null; // { token, sub, email, name, pic, exp, at }
  try { acc = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  const valid = () => !!acc?.token && acc.exp > now() + 60;
  const save = a => { acc = a; store(KEY, a && JSON.stringify(a)); };
  // The miniplayer (web/public/mini.js) opens only from a signed-in screen: it uses that screen's token and never asks.
  if (window.LYRICDOCK_MINI) return { user: () => (valid() ? acc : null), headers: () => (valid() ? { Authorization: `Bearer ${acc.token}` } : {}), check() {}, signIn() {}, signOut() {}, noBrowser() {} };
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // ---- the sign-in screen (over everything until signed in)
  const LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="siG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1f2a"/><stop offset="1" stop-color="#0b0c10"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#siG)"/><g transform="translate(64 64) scale(16)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-8A2.5 2.5 0 0 1 4.5 4z" stroke="#fff" stroke-width="1.6"/><path d="M6 9h9" stroke="#3ddc97" stroke-width="2.2"/><path d="M6 12.8h6" stroke="#fff" stroke-opacity=".45" stroke-width="2.2"/><path d="M12 17v2.6M8.6 20.6h6.8" stroke="#fff" stroke-width="1.6"/></g></svg>';
  const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  let gate = null;
  function show(msg = '', kind = '') {
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'signin';
      gate.innerHTML = `<div class="si-card">${LOGO}<h1>Sign in to LyricDock</h1>
<p>One step with your Google account${web ? '' : ' in your phone\'s browser'}. LyricDock only gets your name, email and picture.</p>
<button class="si-go">${GOOGLE}<span>Sign in with Google</span></button><div class="si-msg" role="status"></div>
<button class="si-alt" hidden>Use another account</button>
<p class="si-f">lyricdock.losthusky.qzz.io/privacy · /terms</p></div>`;
      gate.querySelector('.si-go').onclick = () => signIn();
      gate.querySelector('.si-alt').onclick = () => signIn(true);
      document.body.append(gate);
    }
    const m = gate.querySelector('.si-msg');
    m.className = `si-msg ${kind}`;
    m.innerHTML = kind === 'busy' ? '<i class="si-spin"></i>' : '';
    m.append(msg);
    gate.querySelector('.si-alt').hidden = kind !== 'bad';
  }
  function hide() { gate?.remove(); gate = null; }

  async function signIn(other) {
    if (web) return location.assign(`${AUTH}/login?rd=${encodeURIComponent(location.href)}${other ? '&switch=1' : ''}`);
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    store(PENDING, verifier); // the browser may outlive this page (the renderer can be restarted meanwhile)
    show('Finish in your browser, then come back here.', 'busy');
    if (!window.Dock?.signIn?.(`${AUTH}/login?app=${challenge}${other ? '&switch=1' : ''}`)) noBrowser();
  }

  const noBrowser = () => show('No web browser found on this phone. Install one (Chrome) and try again.', 'bad');

  async function post(body, withCookie) {
    try {
      const r = await fetch(`${AUTH}/token`, { method: 'POST', body: new URLSearchParams(body), credentials: withCookie ? 'include' : 'omit' });
      const j = await r.json().catch(() => ({}));
      return r.ok && j.token ? j : { status: r.status, error: j.error };
    } catch (e) { return { status: 0 }; } // offline
  }
  function signedIn(r, quiet) {
    save({ token: r.token, sub: r.sub, email: r.email, name: r.name, pic: r.pic, exp: r.exp, at: now() });
    store(BOUNCE, null);
    hide();
    if (!quiet) window.notice?.(`Signed in as ${r.name || r.email}`, 3000);
    if (typeof Settings === 'object') Settings.render();
  }

  // Phone: back from the browser. MainActivity calls this when the lyricdock:// link arrives; the page calls it on start
  // in case the link arrived before the page was ready.
  async function check() {
    const link = web ? '' : window.Dock?.ssoResult?.() || '';
    if (!link) return;
    let code = '';
    try { code = new URL(link).searchParams.get('code') || ''; } catch (e) {}
    const verifier = localStorage.getItem(PENDING);
    if (!code || !verifier) return show('That sign-in was for an earlier try. Sign in again.', 'bad');
    show('Signing in…', 'busy');
    const r = await post({ code, verifier });
    if (r.token) { store(PENDING, null); return signedIn(r); }
    show(r.status ? r.error || 'Sign-in failed. Try again.' : 'Can\'t reach LyricDock. Check the internet connection and try again.', 'bad');
  }

  // On start and every few hours. Web: the cookie decides (it may have been signed out in another tab). Phone: renew
  // the token once a day while the app runs; only a token the server refuses signs this screen out.
  async function refresh() {
    if (web) {
      const r = await post({}, true);
      if (r.token) return signedIn(r, true);
      if (r.status === 401) {
        save(null);
        // Normally straight to sign-in and back. If that just happened and we're still signed out, stop and ask.
        if (+localStorage.getItem(BOUNCE) > Date.now() - 60e3) return show('Sign-in didn\'t stick in this browser. Allow cookies for this site and try again.', 'bad');
        store(BOUNCE, String(Date.now()));
        return signIn();
      }
      if (r.status === 403) { save(null); return show(r.error || 'This account isn\'t allowed.', 'bad'); }
      if (!valid()) show('You\'re offline. Sign in once you\'re back online.');
      return;
    }
    if (!valid()) return show(acc ? 'Your sign-in ended. Sign in again.' : '');
    if (now() - (acc.at || 0) < 86400) return;
    const r = await post({ token: acc.token });
    if (r.token) signedIn(r, true);
    else if (r.status === 401 || r.status === 403) { save(null); show(r.error && r.status === 403 ? r.error : 'Your sign-in ended. Sign in again.', 'bad'); }
  }

  function signOut() {
    save(null);
    if (web) return location.assign(`${AUTH}/logout?rd=${encodeURIComponent(`${AUTH}/`)}`);
    if (typeof Settings === 'object') Settings.close();
    show('Signed out.');
  }

  if (!web && !valid()) show(acc ? 'Your sign-in ended. Sign in again.' : ''); // no flash of the app first
  check();
  refresh();
  setInterval(refresh, 6 * 3600e3);
  return {
    user: () => (valid() ? acc : null),
    headers: () => (valid() ? { Authorization: `Bearer ${acc.token}` } : {}), // for LyricDock's cloud only
    check, signIn, signOut, noBrowser,
  };
})();
window.Account = Account; // a top-level const is not a window property: MainActivity, settings.js and features.js read window.Account
