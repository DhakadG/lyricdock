// app.lyricdock.losthusky.qzz.io: the web app's files, only for someone signed in with the shared Google sign-in
// (auth.lyricdock.losthusky.qzz.io, ../../auth/sso.js). The manifest and icons stay public: browsers fetch them without cookies.
// sw.js stays public too: an installed app keeps running from its cache after the 14-day session ends, and its update
// check must still work (the page itself goes to sign-in when /turn answers 401, see rtc.js).
import { session, signIn } from '../../auth/sso.js';
import { icon } from '../../auth/brand.js';

// Short-lived TURN credentials (Cloudflare Realtime) for rtc.js: signed-in users only, so nobody else relays through
// our quota. Secrets: TURN_KEY_ID, TURN_KEY_TOKEN (Cloudflare dashboard -> Realtime -> TURN).
async function turn(req, env) {
  const no = (status, e) => new Response(JSON.stringify({ error: e }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const me = await session(req);
  if (!me) return no(401, 'sign in');
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return no(503, 'TURN not configured');
  // Any Google account can sign in: cap how often one account mints credentials (rtc.js asks every 4 h).
  if (env.TURN_LIMIT && !(await env.TURN_LIMIT.limit({ key: me.email })).success) return no(429, 'slow down');
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST', headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 6 * 3600 }),
  }).catch(() => null);
  if (!r) return no(502, 'TURN unreachable');
  if (!r.ok) return no(502, `TURN ${r.status}`);
  const { iceServers } = await r.json();
  // Port 53 is blocked by browsers; drop those URLs (Cloudflare's own advice).
  const clean = [].concat(iceServers || []).map(s => ({ ...s, urls: [].concat(s.urls).filter(u => !/:53(\?|$)/.test(u)) })).filter(s => s.urls.length);
  return new Response(JSON.stringify({ iceServers: clean }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    const ic = icon(pathname); // /favicon.ico etc. -> /icons/ (public)
    if (ic) return ic;
    if (pathname === '/turn') return turn(req, env);
    if (pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname.startsWith('/icons/') || (await session(req))) return env.ASSETS.fetch(req);
    return signIn(req);
  },
};
