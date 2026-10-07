// auth.lyricdock.losthusky.qzz.io: LyricDock's Google sign-in, for its apps on *.lyricdock.losthusky.qzz.io.
//   /login?rd=<url>    Google (OAuth code + PKCE + nonce, state bound to this browser) -> session cookie -> back to rd
//   /logout?rd=<url>   clears the session everywhere (POST; GET shows a confirm button)
//   /me                the signed-in user as JSON (CORS for our own subdomains, with credentials)
// The session is an ES256 JWT in a cookie on lyricdock.losthusky.qzz.io, so every LyricDock subdomain (and none of the
// other losthusky.qzz.io sites) receives it and checks it with
// the public key in ../sso.js. Only this Worker holds the private key (secret SSO_PRIVATE_JWK).
import { AUTH, COOKIE, b64u, cookie, verify } from '../sso.js';

const ROOT = 'lyricdock.losthusky.qzz.io'; // the session cookie's domain, and the only sites sign-in returns to
const STATE = '__Host-ld_st'; // host-only, so another subdomain can't plant or read it
const SESSION_TTL = 14 * 86400;
const STATE_TTL = 600;
const GOOGLE_ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const SEC = {
  'cache-control': 'no-store',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const redirect = (location, cookies = []) => {
  const h = new Headers({ ...SEC, location });
  cookies.forEach(c => h.append('set-cookie', c));
  return new Response(null, { status: 303, headers: h });
};
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const page = (body, status = 200) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>LyricDock sign-in</title>
<style>body{font:16px system-ui,sans-serif;background:#0d0d0f;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:340px;padding:24px;text-align:center}
.b{border:0;font:inherit;cursor:pointer}a.b,.b{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:10px;background:#fff;color:#111;text-decoration:none;font-weight:600}img{width:56px;height:56px;border-radius:50%}p{color:#aaa}</style>
<main>${body}</main>`, { status, headers: { ...SEC, 'content-type': 'text/html; charset=utf-8' } });

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

async function login(req, env, url) {
  const rd = safeRd(url.searchParams.get('rd'));
  if (await verify(cookie(req, COOKIE))) return redirect(rd); // already signed in
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return page('<h2>Sign-in is not set up yet</h2>', 503);
  const state = rand(24), nonce = rand(24), cv = rand(48);
  const st = await sign(env, { iss: AUTH, aud: 'state', iat: now(), exp: now() + STATE_TTL, email: '', state, nonce, cv, rd });
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${AUTH}/callback`, response_type: 'code', scope: 'openid email profile',
    prompt: 'select_account', access_type: 'online', state, nonce, code_challenge: await sha256(cv), code_challenge_method: 'S256',
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, [stateCookie(st, STATE_TTL)]);
}

async function callback(req, env, url) {
  const st = await verify(cookie(req, STATE), 'state');
  const clear = stateCookie('', 0);
  const fail = msg => new Response(page(`<h2>Sign-in failed</h2><p>${esc(msg)}</p><a class=b href="/login?rd=${encodeURIComponent(st?.rd || AUTH + '/')}">Try again</a>`, 400).body,
    { status: 400, headers: { ...SEC, 'content-type': 'text/html; charset=utf-8', 'set-cookie': clear } });
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
  const allow = String(env.ALLOWED_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (allow.length && !allow.includes(email)) return fail(`${email} is not allowed here.`);

  const s = await sign(env, {
    iss: AUTH, aud: 'session', sub: String(id.sub), email, name: String(id.name || email.split('@')[0]).slice(0, 100),
    pic: /^https:\/\//.test(id.picture || '') ? id.picture.slice(0, 500) : '', iat: now(), exp: now() + SESSION_TTL, sid: rand(12),
  });
  return redirect(st.rd, [sessionCookie(s, SESSION_TTL), clear]);
}

function cors(req) {
  const o = req.headers.get('origin') || '';
  return o && safeRd(`${o}/`) === `${o}/` ?{ 'access-control-allow-origin': o, 'access-control-allow-credentials': 'true', vary: 'origin' } : {};
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case '/login': return await login(req, env, url);
        case '/callback': return await callback(req, env, url);
        // POST only: a plain link on another site must not be able to sign people out. GET asks first.
        case '/logout': return req.method === 'POST' ? redirect(safeRd(url.searchParams.get('rd')), [sessionCookie('', 0)])
          : page(`<h2>Sign out?</h2><p>This signs you out of LyricDock on this browser.</p><form method=post action="/logout?rd=${encodeURIComponent(safeRd(url.searchParams.get('rd')))}"><button class=b>Sign out</button></form>`);
        case '/me': {
          const me = await verify(cookie(req, COOKIE));
          return new Response(JSON.stringify(me ? { email: me.email, name: me.name, pic: me.pic, exp: me.exp } : null),
            { status: me ? 200 : 401, headers: { ...SEC, ...cors(req), 'content-type': 'application/json' } });
        }
        case '/': {
          const me = await verify(cookie(req, COOKIE));
          return page(me
            ? `${me.pic ? `<img src="${esc(me.pic)}" alt="">` : ''}<h2>${esc(me.name)}</h2><p>${esc(me.email)}</p><a class=b href="/logout">Sign out</a>`
            : '<h2>LyricDock</h2><p>Sign in to use the LyricDock web app.</p><a class=b href="/login">Sign in with Google</a>');
        }
        default: return new Response('Not found', { status: 404, headers: SEC });
      }
    } catch (e) {
      console.error(e);
      return page('<h2>Something went wrong</h2><p>Try again in a moment.</p>', 500);
    }
  },
};
