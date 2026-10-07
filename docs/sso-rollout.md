# LyricDock sign-in (SSO) rollout - tooling, secrets guide, takeover doc

Any session can continue from the first unchecked box. Never print or paste a secret's value.

## State (2026-10-08)

- **Branch** `web-fixes-apple` merged into `main` and pushed (2026-10-08). Gates still off.
- **Sign-in belongs to LyricDock, not the apex domain.**
  - It runs at `auth.lyricdock.losthusky.qzz.io` (Worker `lyricdock-auth`).
  - The session cookie `__Secure-ld_sso` is scoped to `lyricdock.losthusky.qzz.io`, so only `app.`, `admin.` and `art.`
    under lyricdock receive it.
  - Sign-in only ever returns to `*.lyricdock.losthusky.qzz.io` pages (tests/sso.test.mjs checks the apex and ntfy are
    refused).
  - The earlier apex Worker `losthusky-auth` (`auth.losthusky.qzz.io`) was deleted on 2026-10-08.
- **Deployed**:
  - `lyricdock-auth` (no secrets yet, so it shows "Sign-in is not set up yet").
  - `lyricdock-app` and `lyricdock-cloud` with their gates switched off: web `vars.SSO` and cloud `vars.ADMIN_SSO` are
    `"off"`.
- **ntfy** (`ntfy.losthusky.qzz.io`) is an apex service, so it doesn't use LyricDock's sign-in.
  - Its owner access is the `PUBLISH_TOKEN`: `Bearer` from scripts, or the browser's password prompt with any user name
    and the token as password.
  - That gate is not deployed yet.

## 0. Tooling (done 2026-10-08 unless unchecked)

- [x] **Google Cloud CLI 588**, per-user install (winget `Google.CloudSDK`).
  - Path: `%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin`, on PATH for new terminals.
  - The Claude Code session that installed it predates that PATH change.
- [x] **MCP `gcloud`** (Google's official `@google-cloud/gcloud-mcp`), user scope (`~/.claude.json`): runs any gcloud
  command for Claude.
  - It connects in a Claude Code started from a new terminal. Its startup check is `where.exe gcloud`, which needs
    gcloud on PATH.
  - Check: `claude mcp get gcloud` should say Connected.
- [x] **CLI signed in** as `ghanisht.kumawat@gmail.com` (`gcloud auth login`). That account owns every project and
  the Search Console properties. Default project: `youtubedata-lyricsdockapp`.
- [x] **Search Console access**: Application Default Credentials with the read-only scope `webmasters.readonly`
  (Google allowed it on gcloud's own client).
  - Quota project: `lost-husky`, with `searchconsole.googleapis.com` enabled. The apex project now holds apex-wide
    tooling; LyricDock's things live in the LyricDock project.
  - Properties: `sc-domain:losthusky.qzz.io`, `sc-domain:arth.shop`, `sc-domain:baunafier.qzz.io` (all siteOwner).
  - Read it with:
    ```powershell
    $tok = (gcloud auth application-default print-access-token).Trim()
    Invoke-RestMethod https://searchconsole.googleapis.com/webmasters/v3/sites -Headers @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = 'lost-husky' }
    ```
    Search analytics: `POST .../sites/sc-domain%3Alosthusky.qzz.io/searchAnalytics/query` with
    `{startDate, endDate, dimensions:['page'|'query'], rowLimit}`.
- **Google projects** (`gcloud projects list`):
  - `youtubedata-lyricsdockapp` "YoutubeData - LyricsDockApp": LyricDock. In organisation `ghanisht-kumawat-org`
    (537814365098, no Workspace directory). Owner ghanisht.kumawat@gmail.com. Only the YouTube Data API is enabled.
  - `lost-husky` "Lost Husky": no organisation, apex tooling (Search Console quota).
  - The organisation's policies are Google's secure-by-default set (no service-account keys, uniform bucket access,
    ...). None of them affect a sign-in client.
- **What the CLI can't do**: create the OAuth consent screen and the Web client for "Sign in with Google". There is no
  public API for that, so it's console-only (docs/setup-guide.md part 1). Projects, APIs, IAM and logs are all CLI/MCP.
- **Already connected in Claude Code**: Gmail, Google Drive, Google Calendar (claude.ai connectors).
- **TURN keys can't be made by Claude's tools**: wrangler has no TURN command, and none of its OAuth scopes cover
  Realtime. The Cloudflare plugin's `cloudflare-api` MCP asks for read-only scopes. Hence
  `scripts/new-turn-key.ps1` (API token with Calls/Realtime Edit) or the dashboard.

## 1. The secrets

The owner's step-by-step guide (Google console, TURN, browser control) is **docs/setup-guide.md**. This table is the state.

| Secret | Goes to | Source | Status |
|---|---|---|---|
| `SSO_PRIVATE_JWK` | auth Worker | `secrets/SSO_PRIVATE_JWK.json` | done (matches `auth/sso.js`, kid `mupbl6zw`) |
| `PUBLISH_TOKEN` | ntfy Worker + your PC | `secrets/PUBLISH_TOKEN.txt` | done (random) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | auth Worker | `secrets/google-client.json`: the client's downloaded JSON, `.web.client_id` and `.web.client_secret` | **user**, setup-guide part 1 |
| `TURN_KEY_ID`, `TURN_KEY_TOKEN` | web Worker | `secrets/TURN_KEY_ID.txt`, `secrets/TURN_KEY_TOKEN.txt` | **user**, setup-guide part 2 (dashboard or `scripts/new-turn-key.ps1`) |
| `ADMIN_PASSWORD`, `CF_API_TOKEN` | cloud Worker | already set | unchanged |

Google client facts (for checking the user's setup):
- Project `youtubedata-lyricsdockapp`, consent screen `LyricDock`, **External**, published.
- Authorized domain `losthusky.qzz.io`, home page `https://lyricdock.losthusky.qzz.io/`.
- Web client `LyricDock sign-in` with redirect URI `https://auth.lyricdock.losthusky.qzz.io/callback`.

### Decisions (defaults are fine)

- **Who may sign in** (`auth/wrangler.jsonc` → `ALLOWED_EMAILS`): `""` (default) lets in any Google account with a
  verified email; a comma list lets in only those people.
- **Who may open admin** (`cloud/wrangler.jsonc` → `ADMIN_EMAILS`, decided 2026-10-08): only
  `ghanisht.kumawat@gmail.com`. The Claude account's email (which an earlier session had put there) was removed; never
  take an address from Claude Code's "user's email" for config.
- **Spicy Lyrics in the browser (optional)**: allow origin `https://app.lyricdock.losthusky.qzz.io` for your key in
  the Spicy Lyrics developer dashboard.

## 2. Rollout (Claude, once the files exist)

PowerShell, repo root, branch `web-fixes-apple`.

- [x] **Files present** (2026-10-08; first TURN pair was an SFU app by mistake, replaced with a real TURN key):
  `Test-Path secrets/google-client.json, secrets/TURN_KEY_ID.txt, secrets/TURN_KEY_TOKEN.txt, secrets/SSO_PRIVATE_JWK.json, secrets/PUBLISH_TOKEN.txt`
  - Also check the JSON is the right client: `.web.redirect_uris` contains `https://auth.lyricdock.losthusky.qzz.io/callback`
    and `.web.project_id` is `youtubedata-lyricsdockapp`. Print only those two fields, never the secret.
- [x] **Secrets into Cloudflare** (2026-10-08: auth 3, web 2; ntfy PUBLISH_TOKEN + LYRICDOCK_PUBLISH_TOKEN go in with the ntfy deploy). If auto mode blocks `wrangler secret put`, the user runs these lines:
  ```powershell
  function put($dir, $name, $file) { Push-Location $dir; try { (Get-Content $file -Raw).Trim() | npx wrangler secret put $name } finally { Pop-Location } }
  $g = (Get-Content secrets/google-client.json -Raw | ConvertFrom-Json).web
  Push-Location auth; try { $g.client_id | npx wrangler secret put GOOGLE_CLIENT_ID; $g.client_secret | npx wrangler secret put GOOGLE_CLIENT_SECRET } finally { Pop-Location }
  put auth SSO_PRIVATE_JWK      ../secrets/SSO_PRIVATE_JWK.json
  put web  TURN_KEY_ID          ../secrets/TURN_KEY_ID.txt
  put web  TURN_KEY_TOKEN       ../secrets/TURN_KEY_TOKEN.txt
  put ntfy PUBLISH_TOKEN        ../secrets/PUBLISH_TOKEN.txt
  [Environment]::SetEnvironmentVariable('LYRICDOCK_PUBLISH_TOKEN', (Get-Content secrets/PUBLISH_TOKEN.txt -Raw).Trim(), 'User')
  ```
  Check with `npx wrangler secret list` in each folder: auth 3 names, web 2, ntfy 1 (names only).
- [x] **Sign-in works on its own** (2026-10-08, owner signed in with Google):
  - `$env:SSO_KEY_FILE='secrets/SSO_PRIVATE_JWK.json'; node tests/sso.test.mjs` prints `sso ok`.
  - The user opens https://auth.lyricdock.losthusky.qzz.io/login, signs in, and the auth page shows their name.
  - `/me` returns their email.
  - Errors: `cd auth; npx wrangler tail`.
- [ ] **Web gate on**: `web/wrangler.jsonc` → `"SSO": "on"`, then `./scripts/build-web.ps1 -Deploy`.
  - A private window to https://app.lyricdock.losthusky.qzz.io goes to Google and comes back.
  - `/turn` returns `iceServers` with `turn:` URLs when signed in, 401 when signed out.
  - `/manifest.webmanifest` and `/sw.js` still load signed out.
- [ ] **Admin gate on**: `cloud/wrangler.jsonc` → `"ADMIN_SSO": "on"`, then `cd cloud; npx wrangler deploy`.
  - https://admin.lyricdock.losthusky.qzz.io asks for Google, lets ghanisht.kumawat@gmail.com in and refuses any other
    account.
- [ ] **ntfy owner gate**: `cd ntfy; npm i; npx wrangler deploy` (Cloudflare Containers; see docs/ntfy.md).
  - `./scripts/ping-update.ps1` says "Update ping sent".
  - A phone and the web app still pair (the `ld*` topics stay open).
  - https://ntfy.losthusky.qzz.io/ asks for a password (the token).
- [ ] **Rollback if anyone is locked out**: set the switch back to `"off"` and redeploy that Worker
  (ntfy: `npx wrangler rollback`).
- [x] **Merge and sync** (2026-10-08, before the gates, so the owner can test sign-in from main):
  ```powershell
  git checkout main; git merge --ff-only web-fixes-apple   # if main moved: git merge web-fixes-apple
  git push origin main; git branch -d web-fixes-apple
  ```
  - The phone app and the Spotify extension get the shared changes with the next `scripts/release.ps1`.
- [ ] **Clean up**:
  - Delete `%TEMP%\lh_sso_priv.json` once the secret is set.
  - Update memory `sso-and-links.md`.
  - Optionally delete `docs/web-fixes-handover.md`.

## Notes

- Rotating the SSO key: add the new public key to `KEYS` in `auth/sso.js`, deploy every Worker that imports it (auth,
  web, cloud), then switch the `SSO_PRIVATE_JWK` secret.
- Sessions last 14 days. When one expires in the installed web app, `rtc.js` sends the page to
  `auth.lyricdock.../login` (on `/turn`'s 401) and back.
- Web review fixes and the Apple-device audit: `docs/web-fixes-handover.md`.
