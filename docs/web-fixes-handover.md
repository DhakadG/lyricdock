# Web app fixes - handover (2026-10-07)

Started from a full web-app review. If this session ran out, pick up the unchecked items. Each line: file, what to do.
After the code is done: `node --check` the edited JS, `node tests/sso.test.mjs` (needs `SSO_KEY_FILE`), `./scripts/build-web.ps1`.

## Review fixes
- [x] 1 Expired SSO strands installed users: `web/src/worker.js` serves `/sw.js` without a session; `rtc.js` fetchTurn: a 401 on the web sends the page to `auth.lyricdock.losthusky.qzz.io/login?rd=<page>`.
- [x] 2 First visit reloads (clients.claim fires controllerchange): `web/public/install.js` reloads only when a controller existed before.
- [x] 3 `/turn` mints TURN creds for any Google account: rate limit per email (`ratelimits` binding `TURN_LIMIT` in `web/wrangler.jsonc`), TTL 6 h.
- [x] 4 Spicy API dead on web: `shim.js` gets `fetchLyrics` (fetch `https://api.spicylyrics.org/v1/lyrics/<id>`, Bearer key) answering `dock({type:'api', id, status, text})`. The key's allowed origins must include the web app's origin.
- [x] 5 Update race with "Update automatically" off: `shim.js` checkUpdate waits for the new worker to finish installing before applying; `app.js` no "vnew" text.
- [x] 6 `spotify.js` fresh(): one shared refresh promise.
- [x] 7 `spotify.js` poll(): generation counter so kick() can't leave two poll chains.
- [x] 8 Mouse: click on the cover toggles the controls (`app.js` click handler + `lyrics.js` Gesture.touch()); double-click likes (`features.js` dblclick).
- [x] 9 Keyboard (`install.js`, `mini.js`): mouse clicks don't leave focus on buttons; no shortcuts while a panel is open; M ignores selects.
- [x] 10 `mini.js` double-open race: pagehide only clears its own window; one requestWindow at a time.
- [x] 11 `install.js` install prompt used once (shared promptInstall()).
- [x] 12 `style.css` #setup / qpanel: `100dvh` after the `100vh` line.
- [x] 13 `settings.js`: phone-only rows hidden on web (Reopen, brightness, volume keys, notification, lock screen, widgets, web cache, connection path, update channel; helper relay option; battery without getBattery). `app.js` pollVersion ignores beta on web.
- [x] 14 `app.js` kawarp: WebGL context lost/restored handled.
- [x] 15 `mini.js` Safari canvas: no ctx.filter (downscale blur + dark overlay instead).
- [x] 16 `app.js` pairing hint not shown in account mode.
- [x] 17 `auth/src/index.js` /logout: GET shows a confirm form, POST signs out.
- [x] 18 `scripts/build-web.ps1` hash via MemoryStream (same hash, fast).
- [x] 19 Docs: `docs/web-app.md` (worker, auth gate, /turn), shim header comment, settings autoUpdate text.

## Friend's report (MacBook Air, Brave, account mode, iPhone playing)
- [x] A `spotify.js` control(): Spotify's refusals are shown (PREMIUM_REQUIRED = Free account can't be controlled, NO_ACTIVE_DEVICE, VOLUME_CONTROL_DISALLOW, rate limit) and logged as `control-fail` pings (status + reason only).
- [x] B `spotify.js` poll(): iPhones report `supports_volume:false` -> no volume sent -> slider hidden.
- [x] C `spotify.js` Lrclib: exact `/api/get` first, then search with cleaned titles (feat. / - Remastered / brackets).
- Likely cause of "nothing controls the iPhone": the friend's account is Free (Spotify answers 403 PREMIUM_REQUIRED to every player command; reading works). The app swallowed the error. Unconfirmed: no logs exist for it (the analytics only had window errors; AE needs the CF_API_TOKEN secret).

## Apple-device audit (separate Opus agent, read-only)
- Applied (2026-10-07): control failures undo the optimistic skip / play state; 404 re-activates the last device once; volume sends at most every 300 ms; 429 backs off 10 s..5 min; LRCLIB: first artist from Spotify, 6 s timeout, instrumental, multi-timestamp lines, plain lyrics within 8 s, next song's lyrics prefetched; Safari: -webkit-user-select, touch-callout, overscroll-behavior none, dvh on the settings sheet, webkit fullscreen fallback, HEVC via canPlayType when there is no MediaSource; iPad trackpad clicks no longer judged by the last touch; mouse move shows the controls and the cursor hides with them; focus rings; right-click swaps the clock colour; LNA prompt skipped for account-only screens; storage.persist after sign-in; iOS install chip says you sign in again; videos shown on `playing` (Low Power Mode); a stale /callback is ignored when signed in.
- Skipped: NoSleep video for iOS < 18.4 home-screen apps, iOS corner radii for the edge bar, Brave fake getBattery, artist check on LRCLIB title-only hits.

## Status at handover
- All items 1-19 and A-C are done in the working tree (not committed, not deployed). Checked: `node --check` on every
  edited JS file, `./scripts/build-web.ps1` builds (1 s now), auth /logout GET = confirm page, POST = signs out.
- Not run: `node tests/sso.test.mjs` (needs `SSO_KEY_FILE`), any browser test.
- Deploy order: `cd cloud; npx wrangler deploy` (accepts the new `control-fail` event), `cd auth; npx wrangler deploy`,
  `./scripts/build-web.ps1 -Deploy` (adds the TURN_LIMIT rate-limit binding). The phone gets the shared asset changes
  with the next APK release.
- Spicy Lyrics key on the web: in the Spicy Lyrics developer dashboard, allow origin https://app.lyricdock.losthusky.qzz.io.
- Friend's report: after deploying, a failed control shows Spotify's reason on screen and lands in the dashboard as a
  `control-fail` event (e.g. `next 403 PREMIUM_REQUIRED`).

## Deployed 2026-10-07
- cloud (lyricdock-cloud), auth (then losthusky-auth; moved to lyricdock-auth on auth.lyricdock 2026-10-08, see
  docs/sso-rollout.md), web (lyricdock-app) are live with all of the above.
- The SSO gates are OFF by switch, because the auth Worker has no secrets / Google client yet:
  `web/wrangler.jsonc` vars.SSO = "off" (app public, /turn answers 503), `cloud/wrangler.jsonc` vars.ADMIN_SSO = "off"
  (admin keeps the ADMIN_PASSWORD login). Turn on: set the auth secrets (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  SSO_PRIVATE_JWK) and the web TURN secrets (TURN_KEY_ID, TURN_KEY_TOKEN), then flip both to "on" and redeploy.
- ntfy is NOT deployed (its gate needs PUBLISH_TOKEN); ping-update.ps1 sends the token only when it is set.
- A test ping (e=control-fail, x=test, device 00000000-...) was sent once to check the endpoint; ignore it.
