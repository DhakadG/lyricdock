# Self-hosted ntfy (ntfy.losthusky.qzz.io)

The official open-source [ntfy](https://ntfy.sh) server (`docker.io/binwiederhier/ntfy`), unmodified, running in a
**Cloudflare Container** behind a small Worker. It's a general notification / pub-sub service on your own domain:

- any app can use it (curl, scripts, the ntfy Android / iOS apps, the web app at https://ntfy.losthusky.qzz.io);
- LyricDock uses it for pairing signals: WebRTC offer/answer between Spotify and the screens, always AES-GCM encrypted.

**Why:** ntfy.sh's free tier has a **daily message quota per IP**. A home with Spotify, a few docks and a browser
display hit it ("limit reached: daily message quota reached"), so pairing codes were accepted but nothing connected.

## Files

| File | What |
|---|---|
| `ntfy/wrangler.jsonc` | Worker `ntfy`, custom domain, the container (image `binwiederhier/ntfy:v2.28.0`, `lite` instance, one instance) |
| `ntfy/src/index.js` | `Container` class (entrypoint `ntfy serve` + its settings as flags) + the Worker that forwards every request to the one server |
| `ntfy/package.json` | `@cloudflare/containers` |

Settings: flags to `ntfy serve` (the `entrypoint` in `src/index.js`). Not the Container's `envVars`: `NTFY_*` env
vars set there never took effect (checked 2026-10-15: a freshly started server still had the default limits).

| Flag | Value | Meaning |
|---|---|---|
| `--base-url` | `https://ntfy.losthusky.qzz.io` | |
| `--behind-proxy` | | rate limits per real visitor (the Worker passes `X-Forwarded-For`) |
| `--cache-duration` | `12h` | in memory: clients reconnecting with `?since=` get what they missed |
| `--enable-signup` / `--enable-login` | `false` | open, anonymous topics (pick unguessable topic names) |
| `--visitor-request-limit-burst` | `300` | requests a visitor IP may make at once (ntfy default 60) |
| `--visitor-request-limit-replenish` | `200ms` | then one more per 200 ms = 5/s (default 5 s). Also sets the daily message cap: one day / 200 ms = 432,000 (default 17,280) |
| `--visitor-subscription-limit` | `150` | open subscriptions per visitor IP (default 30) |

### Rate limits (HTTP 429)

ntfy limits per **visitor IP** (the Worker sets `X-Forwarded-For` to `CF-Connecting-IP`); the Worker itself has no
limit. Every request counts against the bucket: a WebSocket/SSE subscribe, a publish, a poll. When it's empty ntfy
answers `429 {"code":42901,"error":"limit reached: too many requests"}`, and a browser only logs
`WebSocket connection to 'wss://ntfy.../ld…/ws' failed`.

With ntfy's defaults (60 burst, then 1 per 5 s) one home behind one IP ran dry (seen 2026-10-15: a screen stuck on
"Reconnecting…", its topic sockets failing every 3 s, the update-ping SSE refused too):

- Spotify dials every paired screen that isn't connected every 10 s: a subscribe + an offer post = 1 request per 5 s
  per offline screen, the whole default budget on its own;
- each screen keeps 2-3 topic sockets (pairing code, network lobby, account lobby) plus the update ping;
- a screen retried a refused socket every 3 s for ever, so the bucket never refilled.

Fixes: the limits above (5/s sustained covers ~25 offline paired screens plus the screens' sockets), and `rtc.js`
backs off a refused handshake 3 s, 6 s, 12 s … 2 min with jitter, back to 3 s once a socket opens
(`tests/rtc-backoff.test.mjs`). The update ping already backed off (5 s doubling to 5 min, `app.js`).
Check from a shell in that home: `curl -s "https://ntfy.losthusky.qzz.io/ld000000000000000000000000/json?poll=1"`
returns nothing (200) when fine, the 42901 JSON when the bucket is empty.

## Use it

```
curl -d "Backup finished" https://ntfy.losthusky.qzz.io/my-secret-topic     # publish
curl -s https://ntfy.losthusky.qzz.io/my-secret-topic/json                  # stream
```

In the ntfy phone app: Settings → Default server → `https://ntfy.losthusky.qzz.io`, then subscribe to a topic.

## LyricDock

- **Who uses it:** `rtc.js` (phone + web app) and `extension/dock-bridge.js` (Spotify) put it first in their relay
  list (`LDR`), then the relay chosen in settings. Not ntfy.sh any more: a third party there could log topic names,
  which are hashes of pairing codes.
- **Listening:** displays subscribe on every relay in the list.
- **Sending:** Spotify rotates its offers across them.
- **Tested end to end:** a display (the web app) and Spotify's offer code (a test harness running `rtcOpen`'s
  steps) paired through it on the first attempt. Offer → answer → WebRTC data channel → song shown.

## Operate

| Task | Command (in `ntfy/`) |
|---|---|
| Deploy / update the image tag | `npm i && npx wrangler deploy` |
| Apply changed settings | deploy, then restart the server (a deploy doesn't): `curl -X POST -H "Authorization: Bearer $env:LYRICDOCK_PUBLISH_TOKEN" https://ntfy.losthusky.qzz.io/v1/restart`. Check: `/v1/stats` (owner token) `messages` starts again from 0 |
| Logs | `npx wrangler tail` |
| Health | `curl https://ntfy.losthusky.qzz.io/v1/health` → `{"healthy":true}` |

- **Cost:** the server sleeps after 2 h without requests (`sleepAfter`). Docks keep a subscription open, so in
  practice it runs all the time. On the `lite` instance that is roughly a couple of dollars a month at Containers
  pricing; check the Cloudflare dashboard → Containers.
- **Restarts:** a container restart drops the in-memory cache and open connections, and clients reconnect on their
  own. For persistent message history or users/ACLs, add `NTFY_CACHE_FILE` / `NTFY_AUTH_FILE` with persistent
  storage (not set up).
