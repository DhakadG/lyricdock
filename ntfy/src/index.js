// ntfy.losthusky.qzz.io: the official open-source ntfy server (https://ntfy.sh, docker.io/binwiederhier/ntfy) running
// in a Cloudflare Container, with this Worker in front. Usable by any app (curl, the ntfy Android/iOS apps, the web
// app at the root). LyricDock uses it for pairing signals. Docs: docs/ntfy.md
import { Container, getContainer } from '@cloudflare/containers';

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

export default {
  async fetch(req, env) {
    const fwd = new Request(req);
    fwd.headers.set('X-Forwarded-For', req.headers.get('CF-Connecting-IP') || '');
    return getContainer(env.NTFY, 'main').fetch(fwd); // one server: every subscriber shares its topics
  },
};
