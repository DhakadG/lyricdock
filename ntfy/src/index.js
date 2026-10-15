// ntfy.losthusky.qzz.io: the official open-source ntfy server (https://ntfy.sh, docker.io/binwiederhier/ntfy) running
// in a Cloudflare Container, with this Worker in front. Usable by any app (curl, the ntfy Android/iOS apps, the web
// app at the root). LyricDock uses it for pairing signals. Docs: docs/ntfy.md
import { Container, getContainer } from '@cloudflare/containers';
import { same } from '../../auth/sso.js';

export class Ntfy extends Container {
  defaultPort = 80;
  sleepAfter = '2h'; // open subscriptions keep it awake; an idle server stops and starts again on the next request
  // Settings as command-line flags, not env vars: NTFY_* env vars set here never showed up in ntfy (a freshly started
  // server still cut a visitor off at the default 60 requests), while the entrypoint demonstrably runs.
  entrypoint = [
    'ntfy',
    'serve',
    '--base-url',
    'https://ntfy.losthusky.qzz.io',
    '--listen-http',
    ':80',
    '--behind-proxy', // rate limits per real visitor (X-Forwarded-For below), not per Worker
    '--cache-duration',
    '12h', // in memory: missed messages are replayed to clients that reconnect with ?since=
    '--enable-signup=false',
    '--enable-login=false',
    '--log-level',
    'warn',
    // Per visitor IP. ntfy's defaults (60-request burst, then 1 per 5 s; 30 open subscriptions) fit one phone, not a
    // home behind one IP: Spotify re-dialing an offline paired screen every 10 s (subscribe + post) is 1 per 5 s on
    // its own, so screens' subscriptions got HTTP 429. 300 burst, 5/s sustained (also sets the daily message cap:
    // one day / 200 ms = 432k), 150 open subscriptions.
    '--visitor-request-limit-burst',
    '300',
    '--visitor-request-limit-replenish',
    '200ms',
    '--visitor-subscription-limit',
    '150',
  ];
}

// Who may use what. Not a public ntfy: anything that isn't LyricDock's own traffic needs the owner token (secret
// PUBLISH_TOKEN): "Authorization: Bearer <token>" from scripts, or in a browser the password prompt (any user name,
// the token as password). ntfy sits on the apex domain, so it doesn't use LyricDock's sign-in (auth.lyricdock...).
//  - Pairing / lobby topics (ld, ldn, lda + 24 hex: hashes of a pairing code / network / account, see rtc.js): open,
//    because Spotify and the phone must reach them before anyone signs in. Unguessable, and every message is
//    AES-GCM sealed with a key from the pairing code, so the server only relays noise.
//  - The update ping: anyone may listen (every LyricDock does); only the owner / release script may publish.
const APP_TOPIC = /^\/(ld[an]?[0-9a-f]{24})(\/(ws|json|sse|raw))?$/;
const PING = /^\/lyricdock-update-ping-v1(\/(ws|json|sse|raw))?$/;
const subscribing = (req, sub) => !!sub && req.method === 'GET';
const publishing = (req, sub) => !sub && (req.method === 'POST' || req.method === 'PUT');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT',
  'Access-Control-Allow-Headers': '*',
};

function owner(req, env) {
  const [kind, value = ''] = (req.headers.get('authorization') || '').split(' ');
  let tok = kind === 'Bearer' ? value : '';
  if (kind === 'Basic')
    try {
      tok = atob(value).split(':').slice(1).join(':');
    } catch (e) {} // user:token, the user name ignored
  return !!env.PUBLISH_TOKEN && !!tok && same(tok, env.PUBLISH_TOKEN);
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
    const path = new URL(req.url).pathname;
    if (!(await allowed(req, env, path)))
      return new Response('Owner only', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="ntfy owner", charset="UTF-8"', 'cache-control': 'no-store' },
      });
    // The settings above reach a running server only when it starts again (a deploy doesn't restart it): stop it, and
    // the next request starts it with them. Owner only (allowed() above); /v1/ is ntfy's API space, never a topic.
    if (path === '/v1/restart' && req.method === 'POST') {
      await getContainer(env.NTFY, 'main').stop();
      return new Response('Restarting\n');
    }
    const fwd = new Request(req);
    fwd.headers.delete('authorization'); // ours, not ntfy's (ntfy would reject an unknown token)
    fwd.headers.set('X-Forwarded-For', req.headers.get('CF-Connecting-IP') || '');
    return getContainer(env.NTFY, 'main').fetch(fwd); // one server: every subscriber shares its topics
  },
};
