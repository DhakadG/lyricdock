# LyricDock sign-in (SSO) rollout - tooling, secrets guide, takeover doc

Any session can continue from the first unchecked box. Never print or paste a secret's value.

## State (2026-10-08)

- **Branch** `web-fixes-apple`, not merged, not pushed.
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
  public API for that, so it's console-only (guide A). Projects, APIs, IAM and logs are all CLI/MCP.
- **Already connected in Claude Code**: Gmail, Google Drive, Google Calendar (claude.ai connectors).
- **Optional**: the Cloudflare plugin's `cloudflare-api` MCP needs a one-time sign-in (`/mcp`). With it, Claude can
  create the TURN key itself instead of guide B.

## 1. The secrets

| Secret | Goes to | Who | Status |
|---|---|---|---|
| `SSO_PRIVATE_JWK` | auth Worker | done | `secrets/SSO_PRIVATE_JWK.json` (matches `auth/sso.js`, kid `mupbl6zw`) |
| `PUBLISH_TOKEN` | ntfy Worker + your PC | done | `secrets/PUBLISH_TOKEN.txt` (random) |
| `GOOGLE_CLIENT_ID` | auth Worker | **you** | guide A |
| `GOOGLE_CLIENT_SECRET` | auth Worker | **you** | guide A |
| `TURN_KEY_ID` | web Worker | **you** (or Claude via the Cloudflare MCP) | guide B |
| `TURN_KEY_TOKEN` | web Worker | **you** (or Claude via the Cloudflare MCP) | guide B |
| `ADMIN_PASSWORD`, `CF_API_TOKEN` | cloud Worker | already set | unchanged |

`secrets/` is gitignored. Save each value as a plain text file (only the value, no quotes):
`secrets/GOOGLE_CLIENT_ID.txt`, `secrets/GOOGLE_CLIENT_SECRET.txt`, `secrets/TURN_KEY_ID.txt`,
`secrets/TURN_KEY_TOKEN.txt`. Then say "secrets are in". Don't paste them into the chat.

### Guide A - LyricDock's Google sign-in client (about 10 minutes)

The domain is already done: Search Console has the **Domain** property `losthusky.qzz.io` verified, and it covers every
subdomain. Use **ghanisht.kumawat@gmail.com** in the Cloud console: Google checks that the project's owner verified
the domain, and that account is both (checked 2026-10-08).

1. **Project**: use the LyricDock one, `YoutubeData - LyricsDockApp` (id `youtubedata-lyricsdockapp`, organisation
   `ghanisht-kumawat-org`). Optionally rename its display name to `LyricDock` (IAM & Admin → Settings). The id can't
   change, and nothing depends on it. The `lost-husky` project isn't used for sign-in; it holds apex-wide tooling.
2. **Consent screen**: https://console.cloud.google.com/auth/overview?project=youtubedata-lyricsdockapp → **Get started**.
   - App name `LyricDock`, user support email = yours.
   - Audience **External**. The project sits in an organisation, so **Internal** would only let that organisation's
     accounts sign in.
   - Contact email = yours → agree → **Create**.
   - If it says a consent screen already exists, check that its user type is External and continue with step 3.
3. **Branding**: https://console.cloud.google.com/auth/branding?project=youtubedata-lyricsdockapp
   - App home page `https://lyricdock.losthusky.qzz.io/`.
   - Authorized domains → `losthusky.qzz.io`. That's the registrable domain; the lyricdock subdomains are covered.
   - No logo: a logo triggers Google's brand review → Save.
4. **Data access**: nothing to add (`openid email profile` are the defaults).
5. **Audience**: https://console.cloud.google.com/auth/audience?project=youtubedata-lyricsdockapp → **Publish app** →
   Confirm ("In production"). With only these basic scopes there is no Google review.
6. **Client**: https://console.cloud.google.com/auth/clients?project=youtubedata-lyricsdockapp → **Create client**
   - Application type **Web application**, name `LyricDock sign-in`.
   - **Authorized redirect URIs** → `https://auth.lyricdock.losthusky.qzz.io/callback` (exactly; no JavaScript origins).
   - **Create** → copy **Client ID** and **Client secret**. The secret is shown in full only now: **Download JSON** as a
     backup.
7. Save them as `secrets/GOOGLE_CLIENT_ID.txt` and `secrets/GOOGLE_CLIENT_SECRET.txt`.

### Guide B - Cloudflare TURN relay (about 3 minutes)

1. https://dash.cloudflare.com → your account → **Realtime** → **TURN Server** → **Create**. If the menu differs,
   search the dashboard for "TURN".
2. Name it `lyricdock` → Create → copy the **Turn Token ID** and the **API Token** (the token is shown once).
3. Save them as `secrets/TURN_KEY_ID.txt` and `secrets/TURN_KEY_TOKEN.txt`.
4. Usage: only relayed connections count; same-Wi-Fi links are direct. `/turn` is rate-limited to 10 requests a minute
   per signed-in account. TURN has a free monthly allowance; check the Realtime page for current pricing.

### Decisions (defaults are fine)

- **Who may sign in** (`auth/wrangler.jsonc` → `ALLOWED_EMAILS`): `""` (default) lets in any Google account with a
  verified email; a comma list lets in only those people.
- **Who may open admin** (`cloud/wrangler.jsonc` → `ADMIN_EMAILS`): currently only `ghanishth.tes@gmail.com`. The
  Google account used for Cloud and Search Console is `ghanisht.kumawat@gmail.com`. **Open question for the user**: add
  it, or switch to it, before `ADMIN_SSO` goes on.
- **Spicy Lyrics in the browser (optional)**: allow origin `https://app.lyricdock.losthusky.qzz.io` for your key in
  the Spicy Lyrics developer dashboard.

## 2. Rollout (Claude, once the files exist)

PowerShell, repo root, branch `web-fixes-apple`.

- [ ] **Files present**:
  `Test-Path secrets/GOOGLE_CLIENT_ID.txt, secrets/GOOGLE_CLIENT_SECRET.txt, secrets/TURN_KEY_ID.txt, secrets/TURN_KEY_TOKEN.txt, secrets/SSO_PRIVATE_JWK.json, secrets/PUBLISH_TOKEN.txt`
- [ ] **Secrets into Cloudflare**. If auto mode blocks `wrangler secret put`, the user runs these lines:
  ```powershell
  function put($dir, $name, $file) { Push-Location $dir; try { (Get-Content $file -Raw).Trim() | npx wrangler secret put $name } finally { Pop-Location } }
  put auth GOOGLE_CLIENT_ID     ../secrets/GOOGLE_CLIENT_ID.txt
  put auth GOOGLE_CLIENT_SECRET ../secrets/GOOGLE_CLIENT_SECRET.txt
  put auth SSO_PRIVATE_JWK      ../secrets/SSO_PRIVATE_JWK.json
  put web  TURN_KEY_ID          ../secrets/TURN_KEY_ID.txt
  put web  TURN_KEY_TOKEN       ../secrets/TURN_KEY_TOKEN.txt
  put ntfy PUBLISH_TOKEN        ../secrets/PUBLISH_TOKEN.txt
  [Environment]::SetEnvironmentVariable('LYRICDOCK_PUBLISH_TOKEN', (Get-Content secrets/PUBLISH_TOKEN.txt -Raw).Trim(), 'User')
  ```
  Check with `npx wrangler secret list` in each folder: auth 3 names, web 2, ntfy 1 (names only).
- [ ] **Sign-in works on its own**:
  - `$env:SSO_KEY_FILE='secrets/SSO_PRIVATE_JWK.json'; node tests/sso.test.mjs` prints `sso ok`.
  - The user opens https://auth.lyricdock.losthusky.qzz.io/login, signs in, and the auth page shows their name.
  - `/me` returns their email.
  - Errors: `cd auth; npx wrangler tail`.
- [ ] **Web gate on**: `web/wrangler.jsonc` → `"SSO": "on"`, then `./scripts/build-web.ps1 -Deploy`.
  - A private window to https://app.lyricdock.losthusky.qzz.io goes to Google and comes back.
  - `/turn` returns `iceServers` with `turn:` URLs when signed in, 401 when signed out.
  - `/manifest.webmanifest` and `/sw.js` still load signed out.
- [ ] **Admin gate on**: `cloud/wrangler.jsonc` → `"ADMIN_SSO": "on"`, then `cd cloud; npx wrangler deploy`.
  - https://admin.lyricdock.losthusky.qzz.io asks for Google, lets ghanishth.tes@gmail.com in and refuses others.
- [ ] **ntfy owner gate**: `cd ntfy; npm i; npx wrangler deploy` (Cloudflare Containers; see docs/ntfy.md).
  - `./scripts/ping-update.ps1` says "Update ping sent".
  - A phone and the web app still pair (the `ld*` topics stay open).
  - https://ntfy.losthusky.qzz.io/ asks for a password (the token).
- [ ] **Rollback if anyone is locked out**: set the switch back to `"off"` and redeploy that Worker
  (ntfy: `npx wrangler rollback`).
- [ ] **Merge and sync**:
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
