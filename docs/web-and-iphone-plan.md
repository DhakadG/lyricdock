# LyricDock on the web and on iPhone: decision doc

Status: proposal (2026-10-01). Scope: a browser build (Windows/any device) and an iPhone build with no iPhone and no paid Apple account.

## TL;DR

1. **Ship the existing `android/app/src/main/assets` folder as a PWA** at `https://app.lyricdock.losthusky.qzz.io`, served as Workers Static Assets. No fork: add one guarded `web-shim.js` that defines `window.Dock` only when the Android bridge is absent, plus `manifest.webmanifest`, `sw.js`, and a `/player` page.
2. **Now-playing data in the browser = the WebRTC pairing that already exists** (`rtc.js` ↔ `extension/dock-bridge.js`, signalled over `https://ntfy.sh`). It needs no localhost, no mixed content and no LNA prompt. The second source is account mode (Spotify Web API, PKCE, redirect URI on the app domain).
3. **iPhone = the same PWA, added to the Home Screen.** A Capacitor wrapper is phase 3 and optional. It only pays off if the PWA gaps (orientation lock, reliable keep-awake, haptics) turn out to matter, and with a free Apple ID it can't be distributed beyond yourself and testers.
4. **Pay the $99 only for TestFlight or the App Store.** The App Store also carries review risk (WebView wrapper, third-party lyrics).

## 1. Browser web app

### 1.1 What the code does today (verified)

- The UI is plain HTML/JS: 5.3 MB of assets and about 5.2k lines of JS, with no build step. `index.html` already has `viewport-fit=cover`. Cache Storage (`dock-videos`, `dock-lyrics`) and `navigator.storage.estimate()` are already used, so they work in browsers as-is.
- Every native call is either wrapped in `try {}` or goes through `features.js:193 call(fn,...)`, which returns `null` on error. **With no `Dock` at all, the page already boots.** The shim exists only to improve behaviour.
- Native→JS goes through `dock(m)` (`app.js:343`) with types such as `auth`, `update` and `api`. The shim answers through the same function.
- On the phone, the **phone is the WebSocket server** (`DockServer.java`, port 8975, reached via `adb forward`). A browser page cannot listen on a port, so the adb/ws path does not exist on the web. It was dev-only anyway.
- Helper relay: `rtc.js` uses `http://<PC IP>:8977` (`relay.rs` binds `0.0.0.0:8977`).
- Spotify login uses a hard-coded `REDIRECT = 'http://127.0.0.1:8976/callback'` (`spotify.js:6`), and `LoginClient.java` intercepts it. Each user supplies their own Client ID (`Settings.S.spClientId`).
- The music-video background loads `https://video.lyricdock.app/player`, which is fabricated by `PageClient.java` (an inline HTML wrapper). On the web, the same HTML must be served for real.
- Latent bug: `features.js:983` reads `!!Dock.kioskOn` without calling it, so it is always true on Android. It should be `Dock.kioskOn()`.

### 1.2 Every `Dock.*` call, and its browser replacement

| Call (where) | Browser replacement |
|---|---|
| `send` (app.js:26) | No-op. `Rtc.send` on the same line already covers it. |
| `version` (app.js:410, features.js:1101) | Constant stamped at deploy from `extension/version.json`. |
| `lastCrash` (app.js:412) | Return `''`. Optionally keep the last `window.onerror` in localStorage. |
| `setChannel`, `checkUpdate` (app.js:418) | `navigator.serviceWorker.getRegistration().update()`, then answer `dock({type:'update',state:'current'\|'ready'})`. The install action reloads the page. |
| `model` (app.js:588, rtc.js:177) | UA-derived name ("Windows browser", "iPhone"). It shows as the device name in Spotify's "Find devices". |
| `ip` (app.js:589, rtc.js:97) | Return `''`. Browsers can't read the LAN IP; it was only a hint. |
| `insets` (app.js:607) | Throw, so the existing `applyInsets()` fallback runs. Use CSS `env(safe-area-inset-*)`. |
| `setOrientation` (app.js:681) | `screen.orientation.lock()`. It works only in fullscreen on Android Chrome and is unsupported on iOS and desktop, so swallow errors. |
| `webCacheBytes`, `clearWebCache` (features.js:939/948) | Return `0` / no-op. The browser HTTP cache isn't scriptable; the existing `storage.estimate` line covers the total. |
| `kioskOn`, `leaveKiosk` (settings.js:283-285, features.js:983) | `false` / no-op. The row hides itself through `when`. |
| `canReopen`, `askReopen` (settings.js:262-264) | `false` / no-op. Hide the row on the web. |
| `login` (spotify.js:26) | `location.assign(url)`: a full-page redirect to `https://app.lyricdock.losthusky.qzz.io/callback`. Two code changes: make `REDIRECT` `location.origin+'/callback'` when not in the WebView, and persist `pending` (verifier/state) in localStorage so it survives the redirect. On load with `?code=`, call `Web.onAuth({url: location.href})`. Use a redirect, not a popup: popups and `opener` are unreliable in an iOS standalone PWA. |
| `fetchLyrics` (api.js:28) | Drop for v1 (the existing 8 s timeout resolves `null`). The Spicy key requires "no Origin header", which a browser can't do. Later: a proxy route on the existing Worker. |
| `call('keepAwake')` (features.js:293) | **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`). Re-acquire on `visibilitychange`. |
| `call('vibrate')` (features.js:206, swipe.js:23, flipclock.js:164) | `navigator.vibrate` (Android Chrome only; a no-op on iOS and desktop). |
| `call('battery')` (features.js:272) | `navigator.getBattery()` (Chromium only), cached into a sync `"pct,charging"` string; `''` elsewhere. |
| `call('brightness')` (features.js:1081) | Drop. There is no web API. |
| `call('media')` (features.js:1083) | Drop. Media Session only surfaces while the page plays audio. |
| `call('setVolKeys')` (features.js:662) | Drop. Optionally map ArrowUp/ArrowDown keys to the existing `window.volKey`. |
| `call('wake')` (features.js:975) | No-op. A page cannot turn on the screen. |

Fullscreen: add a "Full screen" button that calls `document.documentElement.requestFullscreen()` (it needs a user gesture; works on desktop and Android, not on iPhone). Set the manifest to `display: "fullscreen"` with `"standalone"` as the fallback.

Shim pattern (the whole idea): `if (!window.Dock) window.Dock = { version: () => WEB_VERSION, login: u => location.assign(u), keepAwake: on => ..., ... };`. It ships inside `assets/`, so on Android it is a no-op.

### 1.3 Getting now-playing data into a browser page

| Path | Chrome/Edge | Firefox | Safari (mac/iOS) | Verdict |
|---|---|---|---|---|
| **WebRTC pairing via ntfy.sh** (`rtc.js`) | Yes | Yes | Yes | **Default.** Already built; the extension already supports several paired displays. Away from home it needs TURN (the existing `ice` setting). |
| **Account mode** (Web API, PKCE) | Yes | Yes | Yes | **Second source.** Needs no PC. The user adds `https://app.lyricdock.losthusky.qzz.io/callback` as a redirect URI in their own Spotify app. Since Feb/Mar 2026, dev-mode apps need the owner on **Premium**, 1 Client ID per developer and at most **5 users**. Bring-your-own-Client-ID keeps working. |
| Helper relay at `http://127.0.0.1:8977` (same PC) | Allowed (loopback isn't mixed content), but **LNA prompt** ("Apps on device"). WebSocket is covered since Chrome 147; Chrome 156 (20 Oct 2026) removes the enterprise opt-out. | Allowed | **Blocked** (Safari treats loopback http as mixed content) | Optional. Prompt friction; also accept `127.0.0.1` in the `relayUrl` check (it already matches the IP regex). |
| Helper relay at `http://<LAN IP>:8977` | Blocked (mixed content) | Blocked | Blocked | Doesn't work from an https page. It would need https/wss with a real certificate. |
| `ws://127.0.0.1:8975` (adb) | n/a | n/a | n/a | The page can't be a server. Dev-only; ignore. |

Side risk for the existing product: Spotify desktop is Chromium (CEF). If its CEF picks up LNA, the extension's `127.0.0.1:8977` helper connection may start prompting or failing. Watch the Spotify client updates.

### 1.4 Hosting, releases, updates

- **Host on Workers Static Assets, not Pages.** Cloudflare's 2026 guidance is "start with Workers". Create a new tiny Worker `lyricdock-app` (assets-only, so requests are free and unmetered) with a custom domain `app.lyricdock.losthusky.qzz.io`. Keep it out of `cloud/`: separate deploys, and `cloud/`'s cron/KV/R2 isn't needed.
- Assets dir = `android/app/src/main/assets` plus a small `web/` overlay (`manifest.webmanifest`, `sw.js`, `callback` → `index.html`, `player.html` = the `PageClient.java` wrapper HTML). Change `features.js:728` to use `location.origin + '/player'` when not in the WebView. One `wrangler.jsonc` in `web/`; `assets.directory` can't merge two dirs, so CI copies both into `dist/`.
- Updates: the service worker caches the shell under `lyricdock-<version>`. Settings → "Check for updates" calls `reg.update()`; a new SW means a toast and a reload. Release = the existing tag workflow plus one `wrangler deploy` job, secret `CLOUDFLARE_API_TOKEN`. Use a separate `beta.lyricdock…` hostname for the beta channel instead of `setChannel`.
- Headers: `Cache-Control: no-cache` on `index.html` and `sw.js`. Assets are content-addressed by the SW version.

### 1.5 Alternative: Windows window via the Tauri helper

| | Installed PWA (Edge/Chrome "Install app") | Tauri helper window |
|---|---|---|
| Own window, taskbar icon | Yes | Yes |
| Always-on-top, borderless, pick a monitor | No | Yes (a few lines of `WebviewWindow`) |
| Wake lock, battery, fullscreen | Web APIs | The same web APIs (WebView2); could add native commands |
| Updates | Instant (SW) | Load the hosted URL, so also instant |
| Works without the helper / on Mac, Linux, iOS | Yes | No |

**Decision: PWA first.** Later, add a helper menu item, "Open dock window", that opens the *hosted URL* in an always-on-top WebviewWindow (about 0.5 day). It shares one codebase and adds no second shim.

## 2. iPhone

### 2.1 (a) Home Screen PWA: what works on iOS 26 Safari

| Need | iOS status | Mitigation |
|---|---|---|
| Standalone (no browser chrome) | Yes. Since iOS 26, any site added to the Home Screen opens as a web app. | Add `apple-touch-icon` and a `black-translucent` status bar. |
| Fullscreen API | **Not on iPhone** (iPad only). The status bar stays visible. | Standalone + `viewport-fit=cover`. |
| Keep screen awake | Wake Lock in Home Screen apps since 18.4; regressions reported on 26.1. | Re-acquire on `visibilitychange`. Fallback: a muted looping inline `<video>` (NoSleep trick). |
| Orientation lock | **No** | The layout must handle both orientations (CSS). Hide the orientation setting on iOS. |
| Muted autoplay inline video | Yes, with `muted playsinline` | Already the pattern for animated covers. |
| Cache Storage / localStorage | Quota up to about 60% of disk per origin. LRU eviction under pressure. Home Screen apps are separate from Safari (log in again inside the app). | Cache is best-effort (it already is). Call `navigator.storage.persist()`. |
| WebRTC data channel | Yes | JS suspends when the screen locks or the app is backgrounded. Rely on the existing reconnect. |
| WebSocket to LAN IP from https | **Blocked** (mixed content). `wss://ntfy.sh` works. | The helper relay is unusable. Use ntfy (or later, signalling on our own Worker). |
| Vibrate, battery, brightness | No | Shim no-ops. |
| Web Push | Yes (16.4+, Home Screen only) | Not needed. |

Net: everything core works (lyrics, covers, RTC pairing, account mode). The losses are orientation lock, a hidden status bar, haptics and brightness. Wake lock is the one real risk.

### 2.2 (b) Native wrapper (Capacitor/WKWebView) without a Mac

- Build: Capacitor over the same assets. A GitHub Actions `macos-latest` runner (free for public repos) runs `xcodebuild archive CODE_SIGNING_ALLOWED=NO`, giving an **unsigned IPA**. The same job builds a **simulator `.app`** for testing.
- Install: sign on Windows with a free Apple ID via Sideloadly/AltServer, or SideStore on the device for refresh. Limits: **7-day expiry**, **3 apps** (including SideStore), 10 App IDs a week, iOS Developer Mode on. Each user must do this themselves, so it is not a distribution channel.
- What it adds over the PWA: orientation lock, `isIdleTimerDisabled` (reliable keep-awake), hidden status bar, haptics, and a native WS server like `DockServer` (with the Local Network permission). That last one means LAN data with no relay.
- Cost and risk: a second shim (Capacitor plugins) and an Xcode project to maintain, all built and shipped blind.

### 2.3 (c) What needs the paid $99/year account

TestFlight (external testers, 90-day builds), the App Store, ad-hoc distribution (100 devices), 1-year signing (no 7-day refresh), APNs push. That last one means Live Activities updated by push (widgets can be built free-signed, but they are pointless without distribution). App Store review risk: guideline 4.2 (a thin WebView wrapper) and third-party lyrics/Spotify trademark issues. **Do not pay until a PWA user base asks for native.**

### 2.4 Testing without an iPhone

| Tool | Catches | Cost |
|---|---|---|
| Playwright WebKit on Windows (CI) | WebKit JS/CSS engine bugs, layout | Free |
| iOS Simulator on a GH macOS runner (`xcrun simctl openurl` plus `simctl io screenshot`) | Real iOS Safari rendering, safe areas, screenshots per release | Free (public repo) |
| Appetize.io (upload the simulator `.app`) | The Capacitor build interactively in the browser, no signing | Free tier (minutes-limited) |
| BrowserStack / LambdaTest real iPhones | Wake lock, Add to Home Screen, WebRTC on real hardware | Trial; BrowserStack has an open-source program |
| A friend's iPhone + `?debug` loading Eruda (an in-page console) | Real-world sanity check | Free |

Not possible on Windows: Safari itself, or Web Inspector without a Mac.

### 2.5 Phased path (recommended)

| Phase | Deliverable | Effort | Risk |
|---|---|---|---|
| 1 | Web shim, redirect fix, manifest/SW, `/player`. Deploy to `app.lyricdock…`. Test in Edge/Chrome/Firefox with RTC pairing and account mode. | 1–2 days | Low. The page already tolerates missing `Dock`. |
| 2 | iOS PWA hardening: wake-lock fallback, orientation CSS, Home Screen install hint, Playwright-WebKit and simulator-screenshot CI, one real-device session. | 2–3 days | Medium. Wake lock and backgrounding behaviour can't be fully verified without hardware. |
| 3 (optional) | Helper "Open dock window" (always-on-top). | 0.5 day | Low |
| 4 (optional) | Capacitor iOS: unsigned IPA plus simulator build in CI, Appetize, Sideloadly/SideStore for testers. | 3–5 days | High. Blind builds and 7-day expiry. |
| 5 (only if demanded) | $99 account, TestFlight, then maybe the App Store. | 1–2 days plus review | High (review/legal) |

## 3. First 5 steps

1. Add `android/app/src/main/assets/web-shim.js`, guarded by `if (!window.Dock)`, implementing the table in 1.2. Load it first in `index.html`. Fix `features.js:983` (`Dock.kioskOn()`).
2. In `spotify.js`, make `REDIRECT` origin-aware and persist `pending` across the redirect. Handle `?code=` on load. In `features.js:728`, point the player URL at `location.origin + '/player'` on the web.
3. Create `web/` with `manifest.webmanifest`, `sw.js` (versioned shell cache), `player.html` (copied from `PageClient.java`), and `wrangler.jsonc` (assets-only Worker, custom domain `app.lyricdock.losthusky.qzz.io`). Test locally with `npx wrangler dev`.
4. Smoke-test on Windows. Edge: pair through ntfy with the Spicetify extension, then account mode with the new redirect URI. Firefox: the same. Playwright WebKit: boot with no console errors.
5. Add a `deploy-web` job to the release workflow (copy assets plus `web/` into `dist/`, `wrangler deploy`), plus a macOS-runner job that screenshots the page in the iOS Simulator. Then do Phase 2.

## Sources

- Chrome Local Network Access, WebSocket coverage (Chrome 147), Chrome 156 opt-out removal: https://github.com/getsentry/browser-updates-radar/issues/29, https://support.citrix.com/external/article/CTX696569/chrome-147-and-edge-147-local-network-ac.html, https://blog.openreplay.com/chrome-local-network-access-lna-permission/
- Safari blocks loopback http from https: https://bugs.webkit.org/show_bug.cgi?id=171934, https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content
- Spotify dev-mode changes (Feb/Mar 2026): https://www.techzine.eu/news/devops/138608/spotify-puts-the-brakes-on-developer-mode-with-stricter-api-rules/, https://vorplabs.com/agent-tools/spotify-api-changes
- iOS PWA capabilities: https://firt.dev/notes/pwa-ios/, https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide, https://www.mobiloud.com/blog/progressive-web-apps-ios/
- SideStore / free Apple ID limits, unsigned IPA on GitHub Actions: https://docs.sidestore.io/docs/faq, https://github.com/nadolc/IncomeMeter/pull/3
- Capacitor iOS without a Mac: https://capgo.app/blog/build-ios-app-from-windows-capacitor-capgo-build/, https://medium.com/@olubusadea/how-i-built-an-ios-ci-cd-pipeline-without-a-mac-using-github-actions-e0766f8b3263
- Cloudflare Workers static assets vs Pages: https://dev.to/rickcogley/cloudflare-pages-vs-workers-in-2026-migration-guide-ka7, https://mecanik.dev/en/posts/cloudflare-pages-vs-workers-which-to-use-in-2026/
