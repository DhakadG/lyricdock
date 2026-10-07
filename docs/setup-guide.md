# LyricDock setup guide: Google sign-in, TURN relay, browser control

This guide is for you (the owner), step by step. It gets the four values LyricDock still needs. Claude does
everything after that: loading the values into Cloudflare, switching sign-in on, testing, merging and pushing.

| Part | What you get | Time |
|---|---|---|
| 1 | LyricDock's "Sign in with Google" client (2 values, one downloaded file) | 10-15 min |
| 2 | The TURN relay key, for connecting from another network (2 values) | 3 min |
| 3 | Handing over to Claude | 1 min |
| 4 | Optional: letting Claude use a browser for you | 2-5 min |

Two rules for the whole guide:

- **Google account: `ghanisht.kumawat@gmail.com`.** It owns the LyricDock project and verified the domain, and Google
  only accepts the domain when the same account did both.
- **Secrets go in the repo's `secrets` folder, never into the chat:**
  `C:\Users\lost_husky\Downloads\Programs\VS Code Works\spotify-dock\secrets`
  - Git ignores the folder, so nothing in it is ever committed.
  - Two files are already there (`SSO_PRIVATE_JWK.json`, `PUBLISH_TOKEN.txt`). Leave them.

---

## Part 1 - LyricDock's Google sign-in

### 1.1 Open the right project (why the first link may have shown nothing)

Most likely the console opened as a different Google account, or in a different project.

1. **Open this link.** It forces the right account and project:
   https://console.cloud.google.com/auth/overview?project=youtubedata-lyricsdockapp&authuser=ghanisht.kumawat@gmail.com
2. **Check the account.** The round avatar at the top right should be ghanisht.kumawat@gmail.com. If it isn't, click it
   and switch account, then open the link again.
3. **Check the project.** The box at the top left, next to "Google Cloud", must say **YoutubeData - LyricsDockApp**.
   - If it shows another project, click it to open the project picker.
   - The picker has an organisation dropdown at its top left. Your earlier screenshot showed it set to
     **No organisation**, and that view hides the LyricDock project.
   - Switch the dropdown to **ghanisht-kumawat-org** (or use the **All** tab), then pick **YoutubeData - LyricsDockApp**.
4. **If the link still lands somewhere odd:**
   - Click the ☰ menu (top left) → **APIs & Services** → **OAuth consent screen**, or type `Google Auth Platform` in the
     search bar at the top.
   - Both lead to the same place.

You'll now see one of two screens:

- **"Google Auth Platform not configured yet"**, with a **Get started** button → do 1.2.
- **An "Overview" page with a left menu** (Overview, Branding, Audience, Clients, Data access, Verification centre,
  Settings) → it was set up before; skip to 1.3 and check each page.

### 1.2 Create the consent screen (only if you saw "Get started")

Click **Get started**. It's a short wizard of four steps:

1. **App information**
   - App name: `LyricDock`
   - User support email: pick `ghanisht.kumawat@gmail.com` from the list → **Next**
2. **Audience**
   - Choose **External** → **Next**.
   - Not Internal: the project belongs to your organisation, and Internal would only allow that organisation's accounts.
     Your friends couldn't sign in.
3. **Contact information**
   - Email addresses: `ghanisht.kumawat@gmail.com` → **Next**
4. **Finish**
   - Tick "I agree to the Google API Services: User Data Policy" → **Continue** → **Create**.

You land on the Overview page with the left menu.

### 1.3 Branding

Left menu → **Branding**, or open
https://console.cloud.google.com/auth/branding?project=youtubedata-lyricsdockapp&authuser=ghanisht.kumawat@gmail.com

| Field | Value |
|---|---|
| App name | `LyricDock` (already filled) |
| User support email | `ghanisht.kumawat@gmail.com` |
| App logo | upload `docs\brand\lyricdock-logo-120.png` (120×120 PNG, 9 KB, made from the app icon) |
| Application home page | `https://lyricdock.losthusky.qzz.io/` (describes the app and links to the two pages below) |
| Application privacy policy link | `https://lyricdock.losthusky.qzz.io/privacy` |
| Application terms of service link | `https://lyricdock.losthusky.qzz.io/terms` |
| Authorized domains | click **+ Add domain** → `losthusky.qzz.io` |
| Developer contact information | `ghanisht.kumawat@gmail.com` |

Click **Save** at the bottom.

- If saving complains that the domain isn't verified, you're in the console with a different account (see 1.1, step 2).
- Search Console already lists `losthusky.qzz.io` as a verified **Domain** property owned by
  ghanisht.kumawat@gmail.com, which covers `auth.lyricdock.losthusky.qzz.io` and every other subdomain.

### 1.4 Audience: publish the app

Left menu → **Audience**, or open
https://console.cloud.google.com/auth/audience?project=youtubedata-lyricsdockapp&authuser=ghanisht.kumawat@gmail.com

1. **User type** should say **External**.
2. Under **Publishing status** it says **Testing**. Click **Publish app** → in the dialog **Confirm**.
3. It now says **In production**.

While it was in "Testing", only accounts listed as test users could sign in. LyricDock only asks for name, email and
profile picture, so Google doesn't review the app; publishing is instant.

### 1.4b Brand verification (so the consent screen shows "LyricDock" and the logo)

With a logo, Google reviews the app's branding before showing it to users. Sign-in keeps working while the review runs.

1. Left menu → **Verification centre** → **Verify branding** (or **Prepare for verification**) → **Submit**.
2. Google checks these. All are in place:
   - The home page is on the verified domain and explains the app.
   - The home page links to the privacy policy.
   - The privacy policy is on the same domain and says what is done with Google user data.
3. Google emails `ghanisht.kumawat@gmail.com`, usually within a few working days.
   - If they ask for changes to the home page or the privacy policy, tell Claude: both live in `cloud/src/`.

### 1.5 Data access: nothing to do

Leave **Data access** as it is. The sign-in only uses `openid`, `email` and `profile`, which need no declaration.

### 1.6 Create the client

Left menu → **Clients**, or open
https://console.cloud.google.com/auth/clients?project=youtubedata-lyricsdockapp&authuser=ghanisht.kumawat@gmail.com

1. Click **+ Create client**.
2. **Application type**: **Web application**.
3. **Name**: `LyricDock sign-in`. Only you see this name.
4. **Authorized JavaScript origins**: leave empty.
5. **Authorized redirect URIs**: click **+ Add URI** and paste exactly this, with no space at the end and no extra
   slash:
   ```
   https://auth.lyricdock.losthusky.qzz.io/callback
   ```
6. Click **Create**.
7. A dialog **"OAuth client created"** shows the Client ID and the Client secret. Click **Download JSON**.
   - Google shows the secret in full only in this dialog.
   - If you close it without downloading, create a new secret later: Clients → LyricDock sign-in → **Add secret**.

### 1.7 Save the file

The download is in your Downloads folder, named like `client_secret_123456-abc....apps.googleusercontent.com.json`.

1. Move it into the `secrets` folder.
2. Rename it to `google-client.json`.

Or run this in PowerShell; it takes the newest such file from Downloads:

```powershell
$f = Get-ChildItem "$env:USERPROFILE\Downloads\client_secret_*.json" | Sort-Object LastWriteTime | Select-Object -Last 1
Move-Item $f.FullName "C:\Users\lost_husky\Downloads\Programs\VS Code Works\spotify-dock\secrets\google-client.json"
```

Claude reads the Client ID and secret out of that file. You don't need to copy them anywhere.

### If something goes wrong in Part 1

| You see | Fix |
|---|---|
| "You don't have permission" or "project not found" | Wrong Google account: switch to ghanisht.kumawat@gmail.com (1.1) |
| The project isn't in the picker | Switch the picker's organisation dropdown to ghanisht-kumawat-org, or use the **All** tab |
| "Authorized domain ... not verified" when saving Branding | Wrong account. Search Console ownership belongs to ghanisht.kumawat@gmail.com |
| No **Publish app** button | It's already "In production"; nothing to do |
| No **Create client** button, only "Create OAuth client" or "+ Create credentials" | Same thing in an older layout: choose **OAuth client ID** → Web application |

---

## Part 2 - The TURN relay key

TURN lets the web app connect to Spotify on your computer when the two are on different networks. Same-Wi-Fi
connections don't use it.

**Why not wrangler**: wrangler has no TURN command, and its login can't be given the Realtime/TURN permission (checked
with `wrangler login --scopes-list`). Cloudflare's own Claude connection only asks for read access, so it can't create
the key either. That leaves two ways: the dashboard, or a short script.

### Option A - Dashboard (recommended, about 2 minutes)

1. Open https://dash.cloudflare.com/?to=/:account/calls. It goes straight to **Realtime** in your account.
   - Or: dash.cloudflare.com → your account → left menu **Realtime** → **TURN Server**.
   - If your menu looks different, search the dashboard for `TURN`.
2. Click **Create** (it may say **Create TURN app** or **Create TURN key**).
3. Name: `lyricdock` → **Create**.
4. The page shows two values:
   - **Turn Token ID**: a long hex string.
   - **API Token**: shown **only once**. Copy it before leaving the page.
5. Save them as two text files in `secrets`, each holding only the value (no quotes, no spaces, no extra lines).
   Notepad is the safest way:
   ```powershell
   notepad "C:\Users\lost_husky\Downloads\Programs\VS Code Works\spotify-dock\secrets\TURN_KEY_ID.txt"
   notepad "C:\Users\lost_husky\Downloads\Programs\VS Code Works\spotify-dock\secrets\TURN_KEY_TOKEN.txt"
   ```
   Notepad asks to create each file → **Yes** → paste → **Ctrl+S** → close.

### Option B - Command line (`scripts/new-turn-key.ps1`)

The script creates the key through Cloudflare's API and writes both files for you. It needs a Cloudflare API token
that's allowed to manage TURN, which you make once in the dashboard.

1. **Make the token.**
   1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Custom token** → **Get started**.
   2. Name it `turn-key-maker`.
   3. Permissions: **Account** → **Calls** → **Edit**. Newer dashboards may call it **Realtime**; type "calls" or
      "realtime" in the box.
   4. Account resources: **Include** → your account.
   5. **Continue to summary** → **Create Token** → copy the token.
2. **Run the script** from the repo folder in PowerShell:
   ```powershell
   ./scripts/new-turn-key.ps1
   ```
   It asks for the token (typing stays hidden), creates the `lyricdock` TURN key, and saves `TURN_KEY_ID.txt` and
   `TURN_KEY_TOKEN.txt` in `secrets`.
3. **Delete the API token** afterwards (same API Tokens page → ⋯ → Delete). The TURN key keeps working without it.

Usage and cost: only relayed traffic counts. TURN has a free monthly allowance, then per-GB pricing; see the Realtime
page. LyricDock's `/turn` lets each signed-in account request credentials at most 10 times a minute.

---

## Part 3 - Hand over to Claude

1. Check that all files are there:
   ```powershell
   cd "C:\Users\lost_husky\Downloads\Programs\VS Code Works\spotify-dock"
   Test-Path secrets\google-client.json, secrets\TURN_KEY_ID.txt, secrets\TURN_KEY_TOKEN.txt, secrets\SSO_PRIVATE_JWK.json, secrets\PUBLISH_TOKEN.txt
   ```
   Every line should say `True`.
2. Tell Claude: **"secrets are in"**.

Claude then works through the checklist in `docs/sso-rollout.md`:

1. Puts the secrets into Cloudflare. If its permissions block that, it hands you a few lines to paste into PowerShell.
2. Tests the sign-in page. You sign in once at https://auth.lyricdock.losthusky.qzz.io/login to confirm.
3. Switches on the Google sign-in for the web app, then for admin (only ghanisht.kumawat@gmail.com gets into admin).
   It tests each step and can switch it back off in a minute if anything goes wrong.
4. Deploys ntfy's owner gate, then merges everything into `main` and pushes.

---

## Part 4 - Letting Claude use a browser for you (optional)

Three ways, from no setup to most capable:

### Option 1 - Playwright window (works now, no setup)

- Claude opens its own Chrome window and drives it: opens pages, clicks, types, reads the console, takes screenshots.
  It's how Claude tested the web app on 2026-10-08.
- It's a **separate Chrome profile**: your normal tabs and logins aren't in it. If Claude needs a site you're logged
  into, log in once inside that window yourself; the profile remembers it for next time.
- Best for: testing LyricDock, checking dashboards, filling forms you watch.

### Option 2 - Claude in Chrome (your real Chrome, most capable)

The Claude extension is already installed in your Chrome (version 1.0.99) and wired to Claude Code. It isn't
connected because **the extension is signed into a different Claude account than Claude Code**. They must match.

1. **See which account Claude Code uses**: type `/status` in Claude Code. It shows the logged-in account.
2. **See which account the extension uses**: click the puzzle icon in Chrome → **Claude** → it shows the account (or
   Settings in the panel).
3. **Make them the same**, whichever way you prefer:
   - Sign the extension out and back in with Claude Code's account, **or**
   - In Claude Code type `/login` and log in with the extension's account.
   - Use the account that has a paid plan: the browser connection needs Pro, Max, Team or Enterprise.
4. **Restart Chrome**: type `chrome://restart` in the address bar. Your tabs come back.
5. **In Claude Code**, type `/chrome` and make sure it's enabled.
6. Tell Claude **"chrome ready"**.
   - Claude works in its own tab group, so your tabs stay as they are.
   - It can record what it does as a GIF.

### Option 3 - Playwright on your real Chrome (no Claude account involved)

1. Install **Playwright MCP Bridge** (by Microsoft) from the Chrome Web Store: search "Playwright MCP Bridge".
2. Tell Claude **"set up the Playwright bridge"**. It adds a second browser connection
   (`npx @playwright/mcp@latest --extension`).
3. Restart Claude Code.
4. The first time Claude uses it, the extension asks which tab to share. You approve each time.

### What Claude will and won't do in any browser

- It asks first before anything that sends, posts, submits, buys or deletes.
- It never types passwords, card numbers or similar. You type those yourself.
- It doesn't follow instructions written on web pages; only yours.

---

## Already set up (for reference)

- **Google Cloud CLI** (`gcloud`): installed and signed in as ghanisht.kumawat@gmail.com; default project
  youtubedata-lyricsdockapp. Works in any new terminal.
- **Google's gcloud connection for Claude**: registered; it works in Claude Code sessions started from a new terminal.
- **Search Console access**: Claude can read your three properties' data (`losthusky.qzz.io`, `arth.shop`,
  `baunafier.qzz.io`), billed to the `lost-husky` project.
- **Gmail, Google Drive, Google Calendar**: already connected to Claude Code.
- Full technical state and the rollout checklist: `docs/sso-rollout.md`.
