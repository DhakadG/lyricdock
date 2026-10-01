# LyricDock cloud

One Cloudflare Worker (`cloud/`) that gives LyricDock animated album covers, an album/track index, and an
admin dashboard. No Apple developer key and no third-party API: everything comes from Apple's public web pages
and CDN, and runs on your own Cloudflare account.

| Host | What |
|---|---|
| `lyricdock.losthusky.qzz.io` | Public info page |
| `art.lyricdock.losthusky.qzz.io` | The API (`/v1/*`) and videos copied to R2 (`/m/*`) |
| `admin.lyricdock.losthusky.qzz.io` | Dashboard, password protected |

## The big picture

```
 app (phone / desktop)                       Worker                                         Apple (public)
 ─────────────────────                       ──────                                         ──────────────
 device cache hit? ── yes ─▶ play from disk
        │ no
        ▼
 GET /v1/cover ─────────────▶ 1 edge cache (Cache API, per Cloudflare location, free)
                               │ miss
                               ▼
                             2 KV index  l:<artist|album> -> a:<album id>
                               │ miss
                               ▼
                             3 Apple ──────────────────────────────▶ music.apple.com/us/search?term=…
                               │   (once per album)                  music.apple.com/us/album/…  (embedded JSON)
                               │                                     mvod.itunes.apple.com/…m3u8 (variant list)
                               ▼
                             pick the variant that fits the screen
                             answer: R2 URL if the file is "hot", else Apple's own URL
        ▼
 play it, save a copy on the device in the background

 every request ─▶ Analytics Engine (one data point, no database)
 every 30 min  ─▶ cron: count plays (Analytics Engine) -> copy hot files to R2, delete cold ones
```

### Why no database on the request path

| Need | Cloudflare product | Why |
|---|---|---|
| Repeat questions | **Cache API** (`caches.default`) | Free, at the edge, answers in ~10 ms without touching storage |
| The index (albums, lookups, which files are in R2) | **Workers KV** | Reads are cached at the edge (`cacheTtl`); written only when an album is first found or a file is promoted |
| Activity, metrics, play counts | **Workers Analytics Engine** | Built for one write per request; non-blocking; free tier covers it; queried with SQL from the dashboard |
| Hot video files | **R2** | No egress fees |

## How a cover is found (no key, no token)

1. **Search:** `music.apple.com/us/search?term=<artist album>` is a normal web page whose data is embedded as JSON
   (`<script id="serialized-server-data">`). Album results are matched by name (`matchScore` in `cloud/src/apple.js`):
   - an exact name match wins,
   - "Plastic Beach" also matches "Plastic Beach (Deluxe Version)",
   - compilations: Spotify names the track artist, Apple "Various Artists", so the album name must match exactly.
2. **Album page:** the same embedded JSON has everything we index:
   - the still cover (`containerArtwork`, up to 3000 px),
   - the motion poster (up to 3840 px),
   - the square video (`motionDetailSquare`) and the tall 3:4 video (`motionDetailTall`) as HLS playlists,
   - editorial notes, audio badges (lossless, Atmos), the colour palette, genre, release date and copyright,
   - the full track list (title, number, duration, composer, 30-second preview URL).
3. **Variants:** each HLS playlist lists ~29 encodes (H.264 360p–1080p, HEVC 360p–2160p). Apple stores each one as a
   single fragmented MP4 (`<name>-.mp4`) that the playlist addresses by byte range, so that file is a complete,
   loopable video. No HLS player and no ffmpeg needed.

The iTunes Search API is **not** used: it rate-limits Cloudflare's shared IPs (HTTP 429).

## Size ladder ("compression")

Apple already encodes every size, so the Worker picks instead of re-encoding (`choose()` in `cloud/src/store.js`):

1. The app sends `px`, the pixels it will actually show (cover width × pixel ratio), and `hevc=1` if it can decode HEVC.
2. The Worker takes the **smallest resolution ≥ px**, and at that resolution the **lowest bitrate** (`q=max`: the highest).

Real numbers (Plastic Beach, square):

| Client | Gets | Size |
|---|---|---|
| Phone cover (Galaxy M01: 253 css px × 2, no HEVC) | 768p H.264 | ~3–5 MB (was 26 MB) |
| Small cover (≤ 486 px) | 486p H.264 | ~2 MB |
| 4K desktop (`px=2160&hevc=1`) | 2160p HEVC | ~21 MB |
| 4K desktop, best (`&q=max`) | 2160p HEVC, top bitrate | ~63 MB |

`max_px` (setting) caps what anyone gets.

## Storage ladder (R2 only for what you replay)

* Every `/v1/cover` answer is logged with its **media key** `<album id>/<square|tall>/<variant>`.
* **Promotion** (cron, every 30 min): a key played ≥ `promote_hits` times in `promote_days` days is streamed from
  Apple into R2 (`m/<key>.mp4`), and KV `m:<key>` records it. Later answers point to `art.lyricdock…/m/<key>.mp4`.
* **Cold files** are never stored. The app streams them from Apple's CDN, so they cost you nothing.
* **Eviction** (same cron): R2 copies not played for `evict_days` are deleted, unless pinned. If R2 is still over
  `r2_budget_gb`, the least recently played go next.
* **Self-healing:** if a cached answer still points to an R2 file that was evicted, `/m/…` redirects (302) to Apple.
* **Pinning** (dashboard) copies a file now and keeps it forever.

## Device cache (in the app)

`android/app/src/main/assets/features.js` → "Animated covers":

* **First play** streams from the network right away, and a copy is saved in the background to Cache Storage
  (`dock-videos`).
* **Replays** play from the device (`blob:` URL) with zero data. The cache key is `album/shape/variant`, so it
  doesn't download again when the cloud moves the file from Apple to R2.
* **Limit:** about 300 MB, least recently played deleted first (index in `localStorage['dock:videos']`).
* **Still covers** (Spotify's `i.scdn.co` images) are already kept by the WebView's HTTP cache (long `max-age`).
* **Still asks the cloud each play:** the app still calls `/v1/cover` for every song, even for a replay it plays
  from its own cache. That call is tiny and mostly answered at the edge, and it's what counts plays for promotion
  and the dashboard.

App settings:
- *Now playing → Animated covers (Apple Music)*: the square video inside the cover.
- *Background → Animated cover (Apple Music)*: the tall video full screen, the way Spotify Canvas works.

## API

All endpoints are `GET` with open CORS.
- `artist` and `album` are required. For `"A, B"` the first artist is used.
- Optional `d` (device id) and `v` (app version) only feed the dashboard.

| Endpoint | Extra params | Returns |
|---|---|---|
| `/v1/cover` | `px`, `hevc=1`, `shape=square\|tall`, `q=max` | `{ album, still, poster, colors, video, variant }`. `still` = real cover (up to px), `poster` = video's first frame. 404 when Apple has no such album. |
| `/v1/album` | | `{ album, tracks }`: every indexed field + all variants (without URLs) |
| `/v1/track` | `title` (prefix match) | `{ track, album }` |
| `/v1/ping` | `px`, `hevc` | `{ ok }`: heartbeat for "active devices" |
| `/v1/health` | | `{ ok }` |

## Storage layout

| Where | Key | Value |
|---|---|---|
| KV | `cfg` | Settings (dashboard → Settings) |
| KV | `l:<norm artist>\|<norm album>` | `{ a: album id \| null, at }`. `null` = Apple has nothing (re-asked after `neg_days`) |
| KV | `a:<album id>` | Full album record + tracks + variants (metadata: name, artist, motion, genre, … for listing) |
| KV | `m:<album>/<shape>/<variant>` | A file in R2 (or pinned): `{ tier, bytes, at, pin }` |
| R2 `lyricdock-covers` | `m/<album>/<shape>/<variant>.mp4` | The promoted videos |
| Analytics Engine `lyricdock_events` | one row per request | blobs: kind, path, ladder tier, album id, media key, country, city, colo, app version, device model, error, album, artist · doubles: status, ms, bytes, lat, lon, px, hevc · index: device id |

`norm()` lowercases, strips accents, drops `(…)`, `[…]` and ` - …` suffixes. So "Midnights (3am Edition)" is "midnights".

## Dashboard (`admin.lyricdock.losthusky.qzz.io`)

| Tab | What |
|---|---|
| Overview | Requests, devices (total / active now), latency, bytes served from R2, index size, R2 use vs budget; charts per hour/day; which ladder rung answered; top albums; countries; recent errors |
| Map | Requests per city on a world map (geo from Cloudflare's edge, never from the device) |
| Live | Last 200 requests, refreshed every 5 s, filter by kind |
| Albums | Everything indexed: search, filter by motion art, sort by plays. Click for still + square + tall preview, all variants with their tier and plays, tracks with previews; re-fetch or delete |
| Cache | R2 use, promotion and eviction rules, every media file with plays, promotion window count and tier (pin / copy / evict), the lookup index (incl. negatives), raw R2 listing |
| Devices | Every device: model, app version, place, HEVC, cover px, calls, first/last seen; block / unblock |
| Settings | All ladder knobs (below), API kill switch; run promotion + eviction now; forget negative lookups |

### Settings

| Key | Default | Meaning |
|---|---|---|
| `api_enabled` | on | Off = the public API answers 503 |
| `promote_hits` / `promote_days` | 3 / 14 | Plays within the window before a file is copied to R2 |
| `evict_days` | 30 | Unplayed R2 copies are deleted after this |
| `r2_budget_gb` | 10 | R2 cap; least recently played go first |
| `neg_days` | 7 | How long "Apple has nothing" is believed |
| `refresh_days` | 30 | Albums without motion art are re-checked after this |
| `max_px` | 2160 | Biggest video side handed out |
| `allow_hevc` | on | Offer HEVC to devices that say they decode it |
| `edge_ttl` | 600 | Seconds an answer stays in the edge cache (also how long a setting change can take to show) |

## One-time setup (secrets)

Both are needed by the dashboard. The public API works without them.

1. **Admin password** (run in `cloud/`):
   ```
   npx wrangler secret put ADMIN_PASSWORD
   ```
2. **Analytics read token**, which the dashboard and the promotion cron use to query Analytics Engine:
   1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom.
   2. Permission: *Account → Account Analytics → Read*, for your account.
   3. Run `npx wrangler secret put CF_API_TOKEN` and paste the token.

   Until it is set, promotion to R2 doesn't run, so every file streams from Apple. That's safe, just no R2 tier.

## Operating it

Run from `cloud/`:

| Task | Command |
|---|---|
| Deploy | `npx wrangler deploy` |
| Live logs | `npx wrangler tail` |
| Tests | `node ../tests/cloud.test.mjs` |
| Look at a record | `npx wrangler kv key get --namespace-id f93a89cd48b744afab7b6f3d7e226377 --remote "a:<album id>"` |
| Roll back | `npx wrangler rollback` |

## Limits

* **Unofficial:** Apple's page format can change. Parsing looks for stable key names (`videoArtwork`,
  `motionDetailSquare`, `containerArtwork`, `trackNumber`), not fixed positions. If covers stop appearing, check
  `wrangler tail` for "no serialized-server-data" or match failures.
* **Personal use:** artwork and metadata belong to their owners.
* **Matching is by name:** a Spotify album that Apple names very differently won't match.
* **Analytics Engine** keeps 3 months of data and samples at very high volume. Counts use `_sample_interval`, so
  they stay correct.
