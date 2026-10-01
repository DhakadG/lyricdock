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
| `ntfy/src/index.js` | `Container` class (entrypoint `ntfy serve`, settings as env vars) + the Worker that forwards every request to the one server |
| `ntfy/package.json` | `@cloudflare/containers` |

Settings (env vars in `src/index.js`):

| Setting | Value | Meaning |
|---|---|---|
| `NTFY_BASE_URL` | `https://ntfy.losthusky.qzz.io` | |
| `NTFY_BEHIND_PROXY` | `true` | rate limits per real visitor (the Worker passes `X-Forwarded-For`) |
| `NTFY_CACHE_DURATION` | `12h` | in memory: clients reconnecting with `?since=` get what they missed |
| `NTFY_ENABLE_SIGNUP` / `NTFY_ENABLE_LOGIN` | `false` | open, anonymous topics (pick unguessable topic names) |

## Use it

```
curl -d "Backup finished" https://ntfy.losthusky.qzz.io/my-secret-topic     # publish
curl -s https://ntfy.losthusky.qzz.io/my-secret-topic/json                  # stream
```

In the ntfy phone app: Settings → Default server → `https://ntfy.losthusky.qzz.io`, then subscribe to a topic.

## LyricDock

- **Who uses it:** `rtc.js` (phone + web app) and `extension/dock-bridge.js` (Spotify) put it first in their relay
  list (`LDR`), then the relay chosen in settings, then ntfy.sh as a last fallback.
- **Listening:** displays subscribe on every relay in the list.
- **Sending:** Spotify rotates its offers across them.
- **Tested end to end:** a display (the web app) and Spotify's offer code (a test harness running `rtcOpen`'s
  steps) paired through it on the first attempt. Offer → answer → WebRTC data channel → song shown.

## Operate

| Task | Command (in `ntfy/`) |
|---|---|
| Deploy / update the image tag | `npm i && npx wrangler deploy` |
| Logs | `npx wrangler tail` |
| Health | `curl https://ntfy.losthusky.qzz.io/v1/health` → `{"healthy":true}` |

- **Cost:** the server sleeps after 2 h without requests (`sleepAfter`). Docks keep a subscription open, so in
  practice it runs all the time. On the `lite` instance that is roughly a couple of dollars a month at Containers
  pricing; check the Cloudflare dashboard → Containers.
- **Restarts:** a container restart drops the in-memory cache and open connections, and clients reconnect on their
  own. For persistent message history or users/ACLs, add `NTFY_CACHE_FILE` / `NTFY_AUTH_FILE` with persistent
  storage (not set up).
