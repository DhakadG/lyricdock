// LyricDock's sign-in check for its Workers (app., admin. ... .lyricdock.losthusky.qzz.io). auth.lyricdock.losthusky.qzz.io
// (auth/src/index.js) signs a session cookie scoped to lyricdock.losthusky.qzz.io with its private key; this file only
// holds the PUBLIC key, so a leaked or compromised app Worker can read sessions but never mint one. Usage:
//   import { session, signIn } from '../../auth/sso.js';
//   const me = await session(req);              // { email, name, pic, sub, exp } or null
//   if (!me) return signIn(req);                // 302 to Google sign-in, then straight back to this URL
//   const u = await appUser(req);               // API calls from the apps: Bearer app token (or the cookie)

export const AUTH = 'https://auth.lyricdock.losthusky.qzz.io';
export const COOKIE = '__Secure-ld_sso';
// Rotating the key: add the new one here, deploy every app, then switch auth's SSO_PRIVATE_JWK.
const KEYS = {
  mupbl6zw: { kty: 'EC', crv: 'P-256', x: 'N3QT-RrKM0k9I-D28CR-gSTNBtfh8OsYrdQlsTbQ5J8', y: '_L91gMUJR2anKrfACItzn6XIDYURac5cROMlGfWN8m4' },
};

const imported = new Map();
const key = kid => {
  if (!Object.hasOwn(KEYS, kid)) return null;
  if (!imported.has(kid)) imported.set(kid, crypto.subtle.importKey('jwk', KEYS[kid], { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
  return imported.get(kid);
};

export const b64u = {
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
};

export function cookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// A compact ES256 JWT -> its claims, or null. Strict: ES256 only (no "none", no HMAC confusion), known key id,
// our issuer, the expected audience, and inside its lifetime.
export async function verify(token, aud = 'session') {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || token.length > 4096) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64u.dec(parts[0])));
    if (head.alg !== 'ES256' || head.typ !== 'JWT') return null;
    const k = await key(head.kid);
    if (!k) return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await k, b64u.dec(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(b64u.dec(parts[1])));
    const now = Date.now() / 1000;
    if (c.iss !== AUTH || c.aud !== aud || !(c.exp > now) || !(c.iat <= now + 60) || typeof c.email !== 'string') return null;
    return c;
  } catch {
    return null;
  }
}

export const session = req => verify(cookie(req, COOKIE));

// The apps' API calls: "Authorization: Bearer <app token>" (auth's /token; the phone has no cookie), else the cookie.
export async function appUser(req) {
  const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.get('authorization') || '');
  return (m && await verify(m[1], 'app')) || session(req);
}

// Send the browser to sign in and bring it back to the page it asked for.
export function signIn(req) {
  const u = new URL(req.url);
  const accept = req.headers.get('accept') || '';
  if (req.method !== 'GET' || !accept.includes('text/html')) return new Response('Sign in required', { status: 401, headers: { 'cache-control': 'no-store' } });
  return new Response(null, { status: 302, headers: { location: `${AUTH}/login?rd=${encodeURIComponent(u.href)}`, 'cache-control': 'no-store' } });
}

// Comma/space-separated allowlist ("" = nobody). For admin-only pages: isAllowed(me, env.ADMIN_EMAILS).
export const isAllowed = (me, list) => !!me && String(list || '').toLowerCase().split(/[\s,]+/).filter(Boolean).includes(me.email.toLowerCase());
