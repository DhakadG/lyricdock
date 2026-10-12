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

// Word / syllable-synced lyrics for the web app, so nobody needs their own key: the Spicy Lyrics developer API with
// LyricDock's secret key, kept here (its terms: "running your own server that calls the API and serves results to your
// own users is expected and fine"). Signed-in users only - never a public endpoint (that would be redistribution) - with a
// per-account limit, and an edge cache of 7 days (the terms cap stored data at 30). Secret: SPICY_KEY (sl_sk_...,
// developers.spicylyrics.org -> your application -> secret key). The page credits the source under the lyrics (lyrics.js).
async function lyrics(req, env, ctx, id) {
  const no = (status, e) => new Response(JSON.stringify({ error: e }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return no(400, 'bad id');
  const me = await session(req);
  if (!me) return no(401, 'sign in');
  if (!env.SPICY_KEY) return no(503, 'lyrics not configured');
  const key = new Request(`https://lyrics.cache.invalid/v1/${id}`), hit = await caches.default.match(key);
  if (hit) return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
  if (env.LYRICS_LIMIT && !(await env.LYRICS_LIMIT.limit({ key: me.email })).success) return no(429, 'slow down');
  const r = await fetch(`https://api.spicylyrics.org/v1/lyrics/${id}`, { headers: { authorization: `Bearer ${env.SPICY_KEY}`, accept: 'application/json' } }).catch(() => null);
  if (!r) return no(502, 'lyrics unreachable');
  const body = await r.text();
  // Found (7 days) and "no lyrics" (1 day: a sync may get uploaded) are kept; errors and rate limits never are.
  if (r.ok || r.status === 404) ctx.waitUntil(caches.default.put(key, new Response(body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': `max-age=${r.ok ? 7 * 86400 : 86400}` } })));
  return new Response(body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
}

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    const ic = icon(pathname); // /favicon.ico etc. -> /icons/ (public)
    if (ic) return ic;
    if (pathname === '/turn') return turn(req, env);
    if (pathname.startsWith('/lyrics/')) return lyrics(req, env, ctx, pathname.slice(8));
    if (pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname.startsWith('/icons/') || (await session(req))) return env.ASSETS.fetch(req);
    return signIn(req);
  },
};
