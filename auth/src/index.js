// auth.lyricdock.losthusky.qzz.io: LyricDock's Google sign-in, for its apps on *.lyricdock.losthusky.qzz.io.
//   /login?rd=<url>     Google (OAuth code + PKCE + nonce, state bound to this browser) -> session cookie -> back to rd
//   /login?app=<hash>   the phone app (system browser): after Google, back into the app via lyricdock://signed-in?code=,
//                       a 5-minute code only the app that sent <hash> = base64url(SHA-256(verifier)) can redeem.
//                       Already signed in on this browser: one "Continue as ..." tap (POST, our own origin only), no Google
//                       round trip - never silently, or any app claiming lyricdock:// could collect codes. &switch=1: pick another account.
//   /token  (POST)      app token (Bearer, 90 days) for the apps' API calls, from: code+verifier (phone), token (renewal),
//                       or the session cookie (web app; also renews the cookie, so people who use LyricDock stay signed in).
//                       Renewal stops AUTH_MAX after the last real Google sign-in (claim `at`): a stolen token can't live forever.
//   /logout?rd=<url>    clears the session everywhere (POST; GET shows a confirm button)
//   /me                 the signed-in user as JSON (CORS for our own subdomains, with credentials)
// The session is an ES256 JWT in a cookie on lyricdock.losthusky.qzz.io, so every LyricDock subdomain (and none of the
// other losthusky.qzz.io sites) receives it and checks it with
// the public key in ../sso.js. Only this Worker holds the private key (secret SSO_PRIVATE_JWK).
import { AUTH, COOKIE, b64u, cookie, verify } from '../sso.js';
import { ICON_LINKS, icon } from '../brand.js';

const ROOT = 'lyricdock.losthusky.qzz.io'; // the session cookie's domain, and the only sites sign-in returns to
const INFO = `https://${ROOT}`; // the info site: home page, /privacy, /terms (cloud/src)
const APP = `https://app.${ROOT}/`; // the web app
const APP_LINK = 'lyricdock://signed-in'; // the phone app's return address (intent filter in AndroidManifest.xml)
const STATE = '__Host-ld_st'; // host-only, so another subdomain can't plant or read it
const SESSION_TTL = 14 * 86400;
const APP_TTL = 90 * 86400; // renewed by the apps while in use (account.js), so only a dock unused for 90 days signs in again
const CODE_TTL = 300;
const STATE_TTL = 600;
const AUTH_MAX = 365 * 86400; // a Google sign-in at least once a year
const GOOGLE_ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const SEC = {
  'cache-control': 'no-store',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin', // nothing leaves for other sites; our own POSTs keep their Origin header (checked below)
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const withCookies = (headers, cookies) => { const h = new Headers(headers); cookies.forEach(c => h.append('set-cookie', c)); return h; };
const redirect = (location, cookies = []) => new Response(null, { status: 303, headers: withCookies({ ...SEC, location }, cookies) });
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const LOGO = '<svg class=logo viewBox="0 0 512 512" aria-hidden=true><defs><linearGradient id=g x1=0 y1=0 x2=1 y2=1><stop offset=0 stop-color="#1b1f2a"/><stop offset=1 stop-color="#0b0c10"/></linearGradient></defs><rect width=512 height=512 rx=112 fill="url(#g)"/><g transform="translate(64 64) scale(16)" fill=none stroke-linecap=round stroke-linejoin=round><path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-8A2.5 2.5 0 0 1 4.5 4z" stroke="#fff" stroke-width="1.6"/><path d="M6 9h9" stroke="#3ddc97" stroke-width="2.2"/><path d="M6 12.8h6" stroke="#fff" stroke-opacity=".45" stroke-width="2.2"/><path d="M12 17v2.6M8.6 20.6h6.8" stroke="#fff" stroke-width="1.6"/></g></svg>';
const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden=true><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#ececf1;
background:radial-gradient(120% 80% at 0% 0%,#14241a 0%,#0b0b0e 55%) #0b0b0e}main{width:100%;max-width:360px;text-align:center;animation:in .35s ease-out}@keyframes in{from{opacity:0;transform:translateY(6px)}}
.logo{width:64px;height:64px;border-radius:15px;box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08)}.av{width:72px;height:72px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 3px #0b0b0e,0 0 0 5px #3ddc97}
h1{margin:18px 0 6px;font-size:1.45rem;font-weight:700;letter-spacing:-.02em;line-height:1.2}p{margin:0;color:#8d8d98}p b{color:#ececf1;font-weight:600}
.acts{display:grid;gap:10px;margin-top:26px}.b{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:0;border-radius:999px;padding:13px 20px;font:650 .95rem system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;text-decoration:none;transition:transform .12s,filter .15s}
.b:active{transform:scale(.98)}.b:hover{filter:brightness(1.08)}.p{background:#3ddc97;color:#04120b}.w{background:#fff;color:#1f1f1f}.g{background:rgba(255,255,255,.07);color:#ececf1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}.b svg{width:20px;height:20px}
.s{margin-top:14px;font-size:.82rem}.s a,.f a{color:#8d8d98}.s a:hover,.f a:hover{color:#ececf1}.f{margin-top:36px;font-size:.78rem;color:#5d5d68}form{margin:0}`;
const page = (body, { status = 200, head = '', cookies = [] } = {}) => new Response(`<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>LyricDock sign-in</title>${ICON_LINKS}${head}<style>${CSS}</style></head>
<body><main>${body}<p class=f><a href="${INFO}/">LyricDock</a> · <a href="${INFO}/privacy">Privacy</a> · <a href="${INFO}/terms">Terms</a></p></main></body></html>`,
  { status, headers: withCookies({ ...SEC, 'content-type': 'text/html; charset=utf-8' }, cookies) });
const who = me => `${me.pic ? `<img class=av src="${esc(me.pic)}" alt="" referrerpolicy=no-referrer>` : LOGO}`;

// Only https pages on our own domain may be returned to: anything else becomes the auth home page (no open redirect).
function safeRd(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === ROOT || u.hostname.endsWith(`.${ROOT}`))) return u.href;
  } catch {}
  return `${AUTH}/`;
}

const rand = n => b64u.enc(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => b64u.enc(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
function same(a, b) { // constant-time string compare
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return d === 0;
}
const allowed = (env, email) => { const l = String(env.ALLOWED_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean); return !l.length || l.includes(email); };

let signKey;
async function sign(env, claims) {
  if (!env.SSO_PRIVATE_JWK) throw new Error('SSO_PRIVATE_JWK is not set');
  const jwk = JSON.parse(env.SSO_PRIVATE_JWK);
  signKey ??= crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => b64u.enc(new TextEncoder().encode(JSON.stringify(o)));
  const body = `${enc({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signKey, new TextEncoder().encode(body));
  return `${body}.${b64u.enc(sig)}`;
}
const now = () => Math.floor(Date.now() / 1000);
const sessionCookie = (v, age) => `${COOKIE}=${v}; Domain=${ROOT}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const stateCookie = (v, age) => `${STATE}=${v}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
// What moves from one token to the next. `at`: when Google last confirmed this person (tokens from before it existed: their iat).
const user = me => ({ sub: me.sub, email: me.email, name: me.name, pic: me.pic || '', at: me.at || me.iat });
const stale = me => now() - (me.at || me.iat) > AUTH_MAX;
// A POST from one of our own pages (a cross-site form can't make the browser send this Origin).
const ours = req => req.headers.get('origin') === AUTH;
const newSession = (env, me) => sign(env, { iss: AUTH, aud: 'session', ...user(me), iat: now(), exp: now() + SESSION_TTL, sid: me.sid || rand(12) });

async function login(req, env, url) {
  const app = url.searchParams.get('app');
  if (app !== null && !/^[\w-]{43}$/.test(app)) return page('<h1>That sign-in link is broken</h1><p>Go back to LyricDock and tap Sign in again.</p>', { status: 400 });
  const rd = safeRd(url.searchParams.get('rd'));
  let me = url.searchParams.has('switch') ? null : await verify(cookie(req, COOKIE));
  if (me && stale(me)) me = null; // time for a real Google sign-in
  if (me && !app) return redirect(rd); // already signed in on this browser
  if (me) return req.method === 'POST' && ours(req) ? backToApp(req, env, me, app) : page(`${who(me)}<h1>Continue to LyricDock?</h1>
<p>Sign the LyricDock app in as<br><b>${esc(me.name)}</b><br>${esc(me.email)}</p>
<form method=post action="/login?app=${app}" class=acts><button class="b p">Continue as ${esc(me.name.split(' ')[0])}</button></form>
<p class=s><a href="/login?app=${app}&amp;switch=1">Use another account</a></p>`);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return page('<h1>Sign-in is not set up yet</h1>', { status: 503 });
  const state = rand(24), nonce = rand(24), cv = rand(48);
  const st = await sign(env, { iss: AUTH, aud: 'state', iat: now(), exp: now() + STATE_TTL, email: '', state, nonce, cv, rd, app: app || '' });
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${AUTH}/callback`, response_type: 'code', scope: 'openid email profile',
    prompt: 'select_account', access_type: 'online', state, nonce, code_challenge: await sha256(cv), code_challenge_method: 'S256',
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, [stateCookie(st, STATE_TTL)]);
}

// The phone app's sign-in ends here: a one-time code back into the app. The browser jumps by itself; the button is for
// browsers that won't open an app without a tap.
// Android browsers open the app most reliably through an intent: link naming the package.
async function backToApp(req, env, me, challenge, cookies = []) {
  const code = await sign(env, { iss: AUTH, aud: 'code', ...user(me), ch: challenge, iat: now(), exp: now() + CODE_TTL });
  const android = /Android/.test(req.headers.get('user-agent') || '');
  const link = esc(android ? `intent://signed-in?code=${code}#Intent;scheme=lyricdock;package=com.you.lyricdock;end` : `${APP_LINK}?code=${code}`);
  return page(`${who(me)}<h1>You're signed in</h1><p><b>${esc(me.name)}</b><br>${esc(me.email)}</p>
<div class=acts><a class="b p" href="${link}">Return to LyricDock</a></div>
<p class=s>LyricDock should open by itself. If it doesn't, tap the button.<br><a href="/login?app=${challenge}&amp;switch=1">Use another account</a></p>`,
  { head: `<meta http-equiv=refresh content="0;url=${link}">`, cookies });
}

async function callback(req, env, url) {
  const st = await verify(cookie(req, STATE), 'state');
  const clear = stateCookie('', 0);
  const again = st?.app ? `/login?app=${st.app}&switch=1` : `/login?rd=${encodeURIComponent(st?.rd || APP)}`;
  const fail = msg => page(`${LOGO}<h1>Sign-in didn't finish</h1><p>${esc(msg)}</p><div class=acts><a class="b w" href="${esc(again)}">${GOOGLE}Try again</a></div>`, { status: 400, cookies: [clear] });
  // The state must match the one this browser was given (stops login CSRF / session fixation).
  if (!st || !same(url.searchParams.get('state') || '', st.state)) return fail('This sign-in link expired or was opened in another browser.');
  const code = url.searchParams.get('code');
  if (!code) return fail('Sign-in was cancelled.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${AUTH}/callback`, grant_type: 'authorization_code', code_verifier: st.cv }),
  });
  if (!res.ok) { console.error('token exchange', res.status, (await res.text()).slice(0, 200)); return fail('Google refused the sign-in. Try again.'); }
  // The id_token came straight from Google's token endpoint over TLS, so its claims are trusted (OIDC 3.1.3.7);
  // still check every one of them.
  let id;
  try { id = JSON.parse(new TextDecoder().decode(b64u.dec((await res.json()).id_token.split('.')[1]))); } catch { return fail('Google sent an unreadable answer.'); }
  if (!GOOGLE_ISS.has(id.iss) || id.aud !== env.GOOGLE_CLIENT_ID || !(id.exp > now()) || !same(id.nonce || '', st.nonce)
    || id.email_verified !== true || typeof id.email !== 'string' || !id.sub) return fail('Google could not confirm this account.');
  const email = id.email.toLowerCase();
  if (!allowed(env, email)) return fail(`${email} is not allowed here.`);

  const me = { sub: String(id.sub), email, name: String(id.name || email.split('@')[0]).slice(0, 100), pic: /^https:\/\//.test(id.picture || '') ? id.picture.slice(0, 500) : '', at: now() };
  const cookies = [sessionCookie(await newSession(env, me), SESSION_TTL), clear];
  return st.app ? backToApp(req, env, me, st.app, cookies) : redirect(st.rd, cookies);
}

function cors(req, open) {
  const o = req.headers.get('origin') || '';
  if (o && safeRd(`${o}/`) === `${o}/`) return { 'access-control-allow-origin': o, 'access-control-allow-credentials': 'true', vary: 'origin' };
  return open ? { 'access-control-allow-origin': '*', vary: 'origin' } : { vary: 'origin' };
}

// An app token. Form body (a "simple" request: no CORS preflight) with code + verifier, or token; else the cookie.
async function token(req, env) {
  const h = { ...SEC, ...cors(req, true), 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
  const out = (body, status = 200, cookies = []) => new Response(JSON.stringify(body), { status, headers: withCookies(h, cookies) });
  if (req.method !== 'POST') return out({ error: 'POST only' }, 405);
  const f = new URLSearchParams((await req.text()).slice(0, 8192));
  let me;
  const cookies = [];
  if (f.get('code')) { // the phone, back from the browser: the code is only good with the verifier behind its challenge
    const c = await verify(f.get('code'), 'code');
    if (!c || !same(await sha256(f.get('verifier') || ''), c.ch)) return out({ error: 'This sign-in expired. Sign in again.' }, 400);
    me = c;
  } else if (f.get('token')) { // renewal while in use
    me = await verify(f.get('token'), 'app');
    if (!me) return out({ error: 'signed out' }, 401);
  } else { // the web app: the session cookie, renewed once half of it is used up
    me = await verify(cookie(req, COOKIE));
    if (!me) return out({ error: 'signed out' }, 401);
    if (me.exp - now() < SESSION_TTL / 2) cookies.push(sessionCookie(await newSession(env, me), SESSION_TTL));
  }
  if (!allowed(env, me.email)) return out({ error: `${me.email} is not allowed` }, 403);
  if (stale(me)) return out({ error: 'Sign in again (once a year).' }, 401);
  const exp = now() + APP_TTL;
  const t = await sign(env, { iss: AUTH, aud: 'app', ...user(me), iat: now(), exp });
  return out({ token: t, ...user(me), exp }, 200, cookies);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ic = icon(url.pathname);
    if (ic) return ic;
    try {
      switch (url.pathname) {
        case '/login': return await login(req, env, url);
        case '/callback': return await callback(req, env, url);
        case '/token': return await token(req, env);
        // POST from our own confirm page only: neither a link nor a form on another site can sign people out. GET asks first.
        case '/logout': {
          const rd = safeRd(url.searchParams.get('rd'));
          if (req.method === 'POST') return ours(req) ? redirect(rd, [sessionCookie('', 0)]) : new Response('Forbidden', { status: 403, headers: SEC });
          const me = await verify(cookie(req, COOKIE));
          if (!me) return redirect(rd);
          return page(`${who(me)}<h1>Sign out?</h1><p>This signs <b>${esc(me.email)}</b> out of LyricDock in this browser.</p>
<form method=post action="/logout?rd=${encodeURIComponent(rd)}" class=acts><button class="b w">Sign out</button><a class="b g" href="${esc(rd === `${AUTH}/` ? APP : rd)}">Cancel</a></form>`);
        }
        case '/me': {
          const me = await verify(cookie(req, COOKIE));
          return new Response(JSON.stringify(me ? { email: me.email, name: me.name, pic: me.pic, exp: me.exp } : null),
            { status: me ? 200 : 401, headers: { ...SEC, ...cors(req), 'content-type': 'application/json' } });
        }
        case '/': {
          const me = await verify(cookie(req, COOKIE));
          return page(me
            ? `${who(me)}<h1>${esc(me.name)}</h1><p>${esc(me.email)}</p>
<div class=acts><a class="b p" href="${APP}">Open LyricDock</a><a class="b g" href="/login?switch=1&amp;rd=${encodeURIComponent(APP)}">Use another account</a></div>
<p class=s><a href="/logout">Sign out</a></p>`
            : `${LOGO}<h1>LyricDock</h1><p>Sign in to use LyricDock on your phone, tablet or browser.</p>
<div class=acts><a class="b w" href="/login?rd=${encodeURIComponent(APP)}">${GOOGLE}Sign in with Google</a></div>`);
        }
        default: return new Response('Not found', { status: 404, headers: SEC });
      }
    } catch (e) {
      console.error(e);
      return page(`${LOGO}<h1>Something went wrong</h1><p>Try again in a moment.</p>`, { status: 500 });
    }
  },
};
