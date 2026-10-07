// ntfy.losthusky.qzz.io: the official open-source ntfy server (https://ntfy.sh, docker.io/binwiederhier/ntfy) running
// in a Cloudflare Container, with this Worker in front. Usable by any app (curl, the ntfy Android/iOS apps, the web
// app at the root). LyricDock uses it for pairing signals. Docs: docs/ntfy.md
import { Container, getContainer } from '@cloudflare/containers';
import { session, signIn, isAllowed } from '../../auth/sso.js';

export class Ntfy extends Container {
  defaultPort = 80;
  sleepAfter = '2h'; // open subscriptions keep it awake; an idle server stops and starts again on the next request
  entrypoint = ['ntfy', 'serve'];
  envVars = {
    NTFY_BASE_URL: 'https://ntfy.losthusky.qzz.io',
    NTFY_LISTEN_HTTP: ':80',
    NTFY_BEHIND_PROXY: 'true', // rate limits per real visitor (X-Forwarded-For below), not per Worker
    NTFY_CACHE_DURATION: '12h', // in memory: missed messages are replayed to clients that reconnect with ?since=
    NTFY_ENABLE_SIGNUP: 'false',
    NTFY_ENABLE_LOGIN: 'false',
    NTFY_LOG_LEVEL: 'warn',
  };
}

// Who may use what. Not a public ntfy: anything that isn't LyricDock's own traffic needs the shared Google sign-in
// (auth.losthusky.qzz.io) as one of OWNER_EMAILS, or "Authorization: Bearer <PUBLISH_TOKEN>" for scripts.
//  - Pairing / lobby topics (ld, ldn, lda + 24 hex: hashes of a pairing code / network / account, see rtc.js): open,
//    because Spotify and the phone must reach them before anyone signs in. Unguessable, and every message is
//    AES-GCM sealed with a key from the pairing code, so the server only relays noise.
//  - The update ping: anyone may listen (every LyricDock does); only the owner / release script may publish.
const APP_TOPIC = /^\/(ld[an]?[0-9a-f]{24})(\/(ws|json|sse|raw))?$/;
const PING = /^\/lyricdock-update-ping-v1(\/(ws|json|sse|raw))?$/;
const subscribing = (req, sub) => !!sub && req.method === 'GET';
const publishing = (req, sub) => !sub && (req.method === 'POST' || req.method === 'PUT');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': '*' };

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}
async function owner(req, env) {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (env.PUBLISH_TOKEN && tok && await sameSecret(tok, env.PUBLISH_TOKEN)) return true;
  return isAllowed(await session(req), env.OWNER_EMAILS);
}
async function allowed(req, env, path) {
  let m = APP_TOPIC.exec(path);
  if (m) return subscribing(req, m[2]) || publishing(req, m[2]);
  m = PING.exec(path);
  if (m && subscribing(req, m[1])) return true;
  return owner(req, env);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!(await allowed(req, env, new URL(req.url).pathname))) return (await session(req)) ? new Response('Not allowed', { status: 403 }) : signIn(req);
    const fwd = new Request(req);
    fwd.headers.delete('authorization'); // ours, not ntfy's (ntfy would reject an unknown token)
    fwd.headers.set('X-Forwarded-For', req.headers.get('CF-Connecting-IP') || '');
    return getContainer(env.NTFY, 'main').fetch(fwd); // one server: every subscriber shares its topics
  },
};
