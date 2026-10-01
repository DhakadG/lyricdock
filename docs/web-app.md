# LyricDock web app

**https://app.lyricdock.losthusky.qzz.io** is the same app as the phone, running in any browser (Windows, Mac, Linux,
Android, and later iPhone). It can be installed as an app with its own window and icon, and works offline once loaded.
Background and decisions: `docs/web-and-iphone-plan.md`.

## How it's built

There is no fork. The web build is the phone app's assets plus a thin web layer:

```
android/app/src/main/assets/   the app (shared with the phone, unchanged)
web/public/                    the web layer
  shim.js                      stands in for the phone's native bridge (window.Dock)
  install.js                   service worker + updates, "install as an app" prompt, anonymous events, Spotify /callback
  sw.js                        offline cache of the app shell, one cache per version
  manifest.webmanifest, icons/ install metadata (full screen, icons, maskable icon)
  player.html                  music-video background wrapper (the phone serves it from PageClient.java)
  web.css                      install chip
  _headers                     no-cache for the page, the service worker and the manifest
web/wrangler.jsonc             assets-only Worker "lyricdock-app" (no Worker code: requests are free)
scripts/build-web.ps1          builds web/dist and, with -Deploy, publishes it
```

`build-web.ps1` copies the assets, then adds the web layer:
- **`index.html`:** the manifest, icons and `shim.js` go into the head, so the shim runs before the app. `install.js`
  goes at the end of the body.
- **`sw.js`:** stamped with the version (from `extension/version.json`) and the full file list.

The app checks `window.LYRICDOCK_WEB` only where web and phone differ:
- the Spotify sign-in redirect;
- the music-video wrapper URL;
- the analytics platform;
- the web-only settings rows.

## The shim (`window.Dock` in a browser)

| Phone call | In the browser |
|---|---|
| `keepAwake` | Screen Wake Lock, taken again when the tab comes back |
| `battery` | `navigator.getBattery()` (Chromium), cached as `pct,charging` |
| `insets` | the browser's safe areas, measured through CSS `env(safe-area-inset-*)` |
| `setOrientation` | `screen.orientation.lock()` (works only in full screen, mostly Android Chrome) |
| `vibrate` | `navigator.vibrate` |
| `checkUpdate` | service worker update. A new version is applied by "Update automatically", or by the user in Settings → Updates |
| `login` | full-page redirect to Spotify, back to `/callback`. The PKCE state is kept in `localStorage` |
| `model` | "Windows browser", "Android browser", … (the name in Spotify's device list) |
| `version` | stamped at build time |
| everything else (`brightness`, `media`, `wake`, `kioskOn`, `webCacheBytes`, …) | a harmless no-op / `false` / `0` |

## Getting music into the web app

- **Spotify on your computer** (the LyricDock extension): pairs over WebRTC, exactly like the phone. Works in every browser.
- **Sign in with Spotify** (account mode):
  1. In your Spotify developer app, add `https://app.lyricdock.losthusky.qzz.io/callback` as a redirect URI.
  2. Enter the Client ID in LyricDock and sign in.

  Spotify's 2026 rules for development-mode apps: the app owner must have Premium, and at most 5 users.

## Install as an app

- **Chrome, Edge and Android:** a small chip appears about 8 s after opening ("Install LyricDock as an app"), using
  the browser's own install prompt. "Not now" hides it for 14 days.
  - It is also under *Settings → Updates → Install as an app*.
  - *Full screen* is on the same page.
- **iPhone / iPad Safari:** the chip explains *Share → Add to Home Screen*, since iOS has no install prompt.
- **Already installed** (standalone or full-screen display mode): nothing is shown.
- The manifest asks for `fullscreen`, falling back to `standalone`, with any orientation and a black theme.

## Updates

- **Every stable release** (`scripts/release.ps1`) also runs `build-web.ps1 -Deploy`.
- **The new service worker** installs in the background and is applied right away when "Update automatically" is on.
  Otherwise a notice points to Settings → Updates.
- **Open tabs** check for a new version every 30 min.
- **Deploy by hand:** `./scripts/build-web.ps1 -Deploy`.

## Anonymous analytics

The web app and the phone send the same anonymous signals to `art.lyricdock.losthusky.qzz.io/v1/ping`. It has no
accounts, no song data in events, and no IP storage.

| Param | Example | Meaning |
|---|---|---|
| `d` | random UUID | per-install id (`localStorage['dock:device']`), never linked to a person |
| `v` | `1.8.4` | app version |
| `plat` | `android` / `web` / `pwa` | where it runs (`pwa` = installed web app) |
| `scr` | `1920x1080@1.5` | screen size and pixel ratio |
| `tz`, `lang` | `Asia/Kolkata`, `en-IN` | time zone and language (for the map, localisation) |
| `e` | `open`, `install-shown`, `install-accepted`, `install-dismissed`, `installed`, `update`, `error` | app events |
| `x` | `TypeError … @ app.js:212` | error message + file:line only |

- **Heartbeats:** every 10 minutes, giving "active devices".
- **Country and city:** come from Cloudflare's edge, not the device.
- **Dashboard:**
  - Overview → *Platforms & app events*.
  - Devices → *Platform* and *Screen* columns.
