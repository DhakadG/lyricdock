# LyricDock web app

**https://app.lyricdock.losthusky.qzz.io** is the same app as the phone, running in any browser (Windows, Mac, Linux,
Android, and later iPhone). It can be installed as an app with its own window and icon, and works offline once loaded.
Background and decisions: `docs/archive/web-and-iphone-plan.md`.

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
  mini.js                      the miniplayer (Picture-in-Picture)
  web.css                      install chip, mouse cursors and hover
  _headers                     no-cache for the page, the service worker and the manifest
web/src/worker.js              runs first on every request: the shared Google sign-in (auth/sso.js) gates the files
                               (manifest, icons and sw.js stay public); /turn hands signed-in users short-lived TURN
                               credentials, rate-limited per account (TURN_LIMIT)
web/wrangler.jsonc             Worker "lyricdock-app" + its static assets (every request runs the Worker)
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
| `fetchLyrics` | the Spicy Lyrics API straight from the browser (the key must allow this site's origin) |
| `model` | "Windows browser", "Android browser", … (the name in Spotify's device list) |
| `version` | stamped at build time |
| everything else (`brightness`, `media`, `wake`, `kioskOn`, `webCacheBytes`, …) | a harmless no-op / `false` / `0` |

## Getting music into the web app

- **Spotify on your computer** (the LyricDock extension): pairs over WebRTC, exactly like the phone. Works in every browser.
- **Sign in with Spotify** (account mode):
  1. In your Spotify developer app, add `https://app.lyricdock.losthusky.qzz.io/callback` as a redirect URI.
  2. Enter the Client ID in LyricDock and sign in.

  Spotify's 2026 rules for development-mode apps: the app owner must have Premium, and at most 5 users.

## Local network access (Chrome / Edge)

- **The rule:** browsers (2026) keep public sites away from this PC and the home network until the user allows it.
  Spotify-with-the-extension is there.
- **When it asks:** as soon as LyricDock starts looking for Spotify on the computer, the browser's own prompt appears
  (`lyricdockLna.ensure()`, once a session, only while the permission is still unanswered):
  - on opening, unless the source is "Spotify account" only or the setup screen is up;
  - on the setup screen, when *Use Spotify on your computer* is picked.
  - The prompt is triggered by knocking on `127.0.0.1` and the router range with `targetAddressSpace`.
  - If it's dismissed, the setup screen shows an **Allow** row, and it's also under *Settings → Connection → Local
    network access*.
- **What's logged:** the result goes to analytics (`lna-granted` / `lna-denied` / `lna-prompt`).

Pairing signals go through the self-hosted ntfy (`docs/ntfy.md`). Both ends also add public STUN servers, because a
browser hides its local addresses behind random `.local` names.

## Miniplayer and keyboard

- **Miniplayer** (*Settings → Miniplayer*, or press **M**): a small always-on-top window.
  - **Chrome, Edge, Brave, Opera (Windows, Mac, Linux):** Document Picture-in-Picture holding a second copy of the app
    (`/?mini=<channel>`, `window.LYRICDOCK_MINI`), so the lyrics are LyricDock's own (word effects, background, the
    screen's look). Around them `mini.js` draws a trimmed-down player: cover, song and like on top; timeline, shuffle,
    previous, play/pause, next and repeat at the bottom. The app's own controls, settings button, quick bar, clock and
    cover column are hidden. Short window (< 160 px): the top bar goes. Narrow (< 300 px): shuffle and repeat go.
    - It never connects to Spotify. The main copy hands it every message it hears (`app.js route` → `miniFeed`, over a
      BroadcastChannel) and carries out its commands (`send` / `control` → `miniHost`). Its own heartbeat, settings and
      pairing messages are dropped, so the desktop only ever sees the main copy.
    - Off in the miniplayer copy: pairing (`rtc.js` stub), Spotify polling and token refresh (it borrows the main
      copy's token), the sign-in screen, the setup screen, account sync, usage pings, the install prompt.
    - It takes the screen's settings on every open and forces the Lyrics only layout (saved apart, `dock:settings:mini`).
    - The main tab is usually hidden, and Chrome holds a hidden tab's timers back: the miniplayer pokes the main
      copy's Spotify polling once a second (`Web.poke`).
    - Chrome opens it by itself when the tab is left only for pages it counts as playing media, and only once the user
      allows *Automatic picture-in-picture* for the site; otherwise a click or M.
  - **Safari (Mac, iPad, iPhone):** drawn on a canvas, shown as picture-in-picture video; the system's play/skip
    buttons go through Media Session.
  - **Firefox:** no API for either, so the option is hidden.
- **Keyboard** (computers): Space play/pause, ←/→ previous/next, ↑/↓ Spotify's volume, F full screen. The mouse wheel
  scrolls the lyrics.
- **System media controls** (*Settings → Screen → System media controls*, on by default): the song goes into Media
  Session, so the OS media overlay and the keyboard's play / next / previous keys control Spotify. A browser shows a
  page's Media Session only while it plays audio, so a 10 s loop of -67 dBFS noise plays along (`shim.js` `media`,
  the phone's media-notification path): inaudible, but not digital silence, which browsers treat as not playing (and
  only a playing page may open the miniplayer by itself). With *Lyrics on the lock screen* the sung line replaces the
  artist. The computer's own volume keys can't be caught by a web page; ↑/↓ and the slider set Spotify's volume.
- **Tips** (`install.js`, each shown once, while a song plays):
  - Spotify on this computer (the extension's link is direct and under 1.5 ms): offer to turn System media controls
    off, since Spotify already shows in the system's controls.
  - Spotify on a phone or speaker (account mode, Spotify's device type isn't Computer) with them off: offer to turn
    them on.
  - Otherwise: offer to open the miniplayer. Browsers have no way to ask for picture-in-picture ahead of time; the
    click that opens it is the permission, and Chrome asks about *Automatic picture-in-picture* the first time it
    would open it by itself.

## Account sync

`sync.js`: what a LyricDock sign-in carries to every screen signed in with the same Google account.
- *Settings → Playback source → Sync with your LyricDock account*: **all** (default: settings, the Spicy Lyrics and
  YouTube keys, the Spotify Client ID, the Spotify sign-in), **keys** (the keys and the Spotify sign-in), **off**.
- Never synced: the Screen, Performance and Storage groups and device keys (orientation, edge padding, relay, TURN).
- Stored at `art.lyricdock…/v1/sync` (docs/lyricdock-cloud.md), one blob per account, last writer wins. A screen
  pulls on start, on coming back on screen and every 10 min; pushes 2 s after a change, and only after its first pull.
- Spotify replaces the refresh token on each use. Every screen pushes the new one, and a screen that gets
  `invalid_grant` takes the newer one from the account (`Sync.rescue`) instead of signing out.

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
