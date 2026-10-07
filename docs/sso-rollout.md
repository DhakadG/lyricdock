# Sign-in (SSO) rollout - secrets guide and takeover doc

State on 2026-10-07: everything is deployed with the sign-in switched **off** and committed on branch
`web-fixes-apple` (commit b499f8c, not merged, not pushed). This doc gets the secrets in, switches sign-in on,
then merges into `main` and pushes. Any session can continue from the first unchecked box.

What turning it on does:
- **app.lyricdock**: Google sign-in required to open the web app; signed-in users get TURN relay credentials
  (connects to Spotify on a computer from another network).
- **admin.lyricdock**: Google sign-in for the emails in `ADMIN_EMAILS` (`cloud/wrangler.jsonc`) instead of the password.
- **ntfy**: only LyricDock's topics are open; the update ping needs `PUBLISH_TOKEN`.

## 1. The secrets

| Secret | Goes to | Who | Status |
|---|---|---|---|
| `SSO_PRIVATE_JWK` | auth Worker | done | `secrets/SSO_PRIVATE_JWK.json` (the Oct 1 key; matches `auth/sso.js`, `node tests/sso.test.mjs` passes) |
| `PUBLISH_TOKEN` | ntfy Worker + your PC | done | `secrets/PUBLISH_TOKEN.txt` (random, generated) |
| `GOOGLE_CLIENT_ID` | auth Worker | **you** | guide A |
| `GOOGLE_CLIENT_SECRET` | auth Worker | **you** | guide A |
| `TURN_KEY_ID` | web Worker | **you** | guide B |
| `TURN_KEY_TOKEN` | web Worker | **you** | guide B |
| `ADMIN_PASSWORD`, `CF_API_TOKEN` | cloud Worker | already set | unchanged |

`secrets/` is gitignored. **Don't paste secrets into the chat** (they'd sit in the transcript): save each one as a
plain text file - only the value, no quotes - and say "secrets are in". File names:
`secrets/GOOGLE_CLIENT_ID.txt`, `secrets/GOOGLE_CLIENT_SECRET.txt`, `secrets/TURN_KEY_ID.txt`, `secrets/TURN_KEY_TOKEN.txt`.

### Guide A - Google sign-in client (about 15 minutes)

`qzz.io` is on the Public Suffix List, so Google treats **losthusky.qzz.io** as your own domain.

1. **Project.** https://console.cloud.google.com → project picker (top left) → **New project** → name `Lost Husky` →
   Create → make sure it's the selected project. (A separate project keeps the consent screen saying "Lost Husky".)
2. **Prove you own the domain** (needed for the authorized domain):
   1. https://search.google.com/search-console → **Add property** → **Domain** → `losthusky.qzz.io` → Continue.
   2. Copy the `google-site-verification=...` TXT value.
   3. Cloudflare dashboard → `losthusky.qzz.io` → **DNS** → **Records** → **Add record**: Type `TXT`, Name `@`,
      Content = the copied value → Save.
   4. Back in Search Console → **Verify** (can take a few minutes).
3. **Consent screen.** Console → menu → **Google Auth Platform** (older UI: APIs & Services → OAuth consent screen) →
   **Get started**:
   - App name `Lost Husky`, user support email = yours → Next.
   - Audience: **External** → Next.
   - Contact email = yours → Next → agree → **Create**.
4. **Branding** (left menu):
   - App home page `https://auth.losthusky.qzz.io/`.
   - Authorized domains → **Add domain** → `losthusky.qzz.io`.
   - Developer contact = your email → Save.
   - Skip the logo: a logo forces Google's brand review.
5. **Data access**: nothing to add (`openid email profile` are the defaults).
6. **Audience** → **Publish app** → Confirm (status "In production").
   - Without this only listed test users can sign in.
   - With only these basic scopes, Google doesn't review the app.
7. **Client.** **Clients** → **Create client**:
   - Application type **Web application**, name `auth.losthusky`.
   - **Authorized redirect URIs** → Add URI → `https://auth.losthusky.qzz.io/callback` (exactly).
   - No JavaScript origins needed.
   - **Create** → copy **Client ID** and **Client secret**. The secret is shown in full only now: use **Download JSON**
     as a backup.
8. Save them as `secrets/GOOGLE_CLIENT_ID.txt` and `secrets/GOOGLE_CLIENT_SECRET.txt`.

### Guide B - Cloudflare TURN relay (about 3 minutes)

1. https://dash.cloudflare.com → your account → left menu **Realtime** → **TURN Server** → **Create**.
   - If the menu differs, search the dashboard for "TURN".
2. Name it `lyricdock` → Create.
3. Copy the **Turn Token ID** and the **API Token** (the token is shown once).
4. Save them as `secrets/TURN_KEY_ID.txt` and `secrets/TURN_KEY_TOKEN.txt`.
5. Billing: TURN has a free monthly allowance, then per-GB pricing (see the Realtime page). Only relayed connections
   count. Direct same-Wi-Fi links don't. `/turn` is rate-limited to 10 requests a minute per signed-in account.

### Decisions (defaults are fine)

- **Who may sign in** (`auth/wrangler.jsonc` → `ALLOWED_EMAILS`).
  - `""` (default) = any Google account with a verified email. Friends just sign in.
  - A comma list = only those people.
- **Spicy Lyrics in the browser (optional)**: in the Spicy Lyrics developer dashboard, allow origin
  `https://app.lyricdock.losthusky.qzz.io` for your publishable key.
- Earlier idea (memory, 2026-10-01): Cloudflare Access as the gate. Not used: the auth Worker does the gate and
  app.lyricdock stays reachable from anywhere. Say so if you still want Access.

## 2. Rollout (Claude does this once the files exist)

Run from the repo root in PowerShell, on branch `web-fixes-apple`. Never print a secret's value.

- [ ] **Files present**: `Test-Path secrets/GOOGLE_CLIENT_ID.txt, secrets/GOOGLE_CLIENT_SECRET.txt, secrets/TURN_KEY_ID.txt, secrets/TURN_KEY_TOKEN.txt, secrets/SSO_PRIVATE_JWK.json, secrets/PUBLISH_TOKEN.txt`
- [ ] **Secrets into Cloudflare** (if the auto-mode classifier blocks `wrangler secret put`, the user runs these lines):
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
  Check: `npx wrangler secret list` in auth (3 names), web (2), ntfy (1). Names only, never values.
- [ ] **Auth works on its own**:
  - `$env:SSO_KEY_FILE='secrets/SSO_PRIVATE_JWK.json'; node tests/sso.test.mjs` prints `sso ok`.
  - The user opens https://auth.losthusky.qzz.io/login, signs in with Google and lands on the auth home page showing
    their name.
  - https://auth.losthusky.qzz.io/me returns their email.
  - Sign-in errors: `cd auth; npx wrangler tail`.
- [ ] **Web gate on**:
  - `web/wrangler.jsonc` → `"vars": { "SSO": "on" }` → `./scripts/build-web.ps1 -Deploy`.
  - Check: a private window to https://app.lyricdock.losthusky.qzz.io goes to Google sign-in and comes back.
  - Check: `/turn` (signed in) returns `iceServers` with `turn:` URLs; signed out it returns 401.
  - Check: `/manifest.webmanifest` and `/sw.js` still load signed out.
- [ ] **Admin gate on**:
  - `cloud/wrangler.jsonc` → `"ADMIN_SSO": "on"` → `cd cloud; npx wrangler deploy`.
  - Check: https://admin.lyricdock.losthusky.qzz.io asks for Google, lets ghanishth.tes@gmail.com in, and refuses
    others.
  - Check: the dashboard still shows the `control-fail` events.
- [ ] **ntfy gate**:
  - `cd ntfy; npm i; npx wrangler deploy` (Cloudflare Containers; see docs/ntfy.md).
  - Check: `./scripts/ping-update.ps1` says "Update ping sent".
  - Check: a phone and the web app still pair (lobby topics `ld*` stay open).
- [ ] **Rollback, if anything locks people out**: set the switch back to `"off"` (web `SSO`, cloud `ADMIN_SSO`) and
  redeploy that Worker. ntfy: `cd ntfy; npx wrangler rollback`.
- [ ] **Merge and sync**:
  ```powershell
  git checkout main; git merge --ff-only web-fixes-apple   # main has no new commits since the branch
  git push origin main; git branch -d web-fixes-apple
  ```
  - If `--ff-only` fails because main moved: `git merge web-fixes-apple` and resolve.
  - The phone app and the Spotify extension pick up the shared changes in the next `scripts/release.ps1`.
- [ ] **Memory**: update `sso-and-links.md` (gates ON, date). Delete `docs/web-fixes-handover.md` if the user wants.

## Notes for whoever continues

- The public half of the SSO key is in `auth/sso.js` (kid `mupbl6zw`); the private half is only in
  `secrets/SSO_PRIVATE_JWK.json`.
  - The original copy is still at `%TEMP%\lh_sso_priv.json`. Delete it once the secret is set.
  - Rotating the key: add the new public key to `KEYS` in `auth/sso.js`, deploy every Worker, then switch the secret.
- Sessions last 14 days. When one expires in the installed web app, `rtc.js` sends the page back to sign-in (on the
  401 from `/turn`).
- Web review fixes and the Apple-device audit: `docs/web-fixes-handover.md`.
