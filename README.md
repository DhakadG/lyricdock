# LyricDock

Turn an old Android phone, a tablet or a small Android device into a desk display for Spotify: album art, a moving
background and word-by-word synced lyrics — the [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) experience
on a second screen, with play / pause / next / previous / seek / like / volume from the touchscreen.

It works **with** Spotify on your computer (through a small Spicetify extension) or **without any computer at all**
(the phone reads your Spotify account directly). Pick whatever fits — every combination is mapped out below.

- [How it works](#how-it-works)
- [Pick your setup](#pick-your-setup) — every mode and combination
- [What you need](#what-you-need) — devices, accounts and API keys
- [Keys and accounts: how to get them](#keys-and-accounts-how-to-get-them)
- [Setup guides](#setup-guides) — step by step for each mode
- [Using it](#using-it) — controls, settings, presets, updates
- [Settings reference](#settings-reference) — every setting, its default and what it does
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [Uninstalling](#uninstalling)
- [Development](#development)

---

## How it works

```
                 ┌─────────────────────────── Desktop mode ────────────────────────────┐
 Spotify desktop │  LyricDock extension (Spicetify)                                     │
 + Spicetify     │   · reads the playing track, position, liked state, audio quality   │
                 │   · reads lyrics Spicy Lyrics already fetched, else Spotify / LRCLIB │
                 └────────────┬─────────────────────────────────────────────────────────┘
                              │  direct Wi-Fi / LAN (WebRTC data channel, ~7 ms)
                              │  (setup handshake via an encrypted mailbox on ntfy.sh)
                              ▼
                     ┌─────────────────┐        Spotify Web API (your own Client ID)
                     │  LyricDock app  │◄────── Standalone mode: follows whatever device
                     │  (Android)      │        your account is playing on, anywhere
                     └─────────────────┘        + Spicy Lyrics API (your key) / LRCLIB
```

- **Desktop mode** — Spotify on your Windows PC with [Spicetify](https://spicetify.app) runs the LyricDock
  extension. It streams the track, position and lyrics straight to the phone over your local network. Best lyrics
  coverage (it reuses what Spicy Lyrics already loaded), instant sync, no extra API keys.
- **Standalone mode** — no PC, no Spicetify. The phone signs in to **your Spotify account** through the Spotify Web
  API (your own free developer "app", a 5-minute setup) and follows playback on any device: your phone's Spotify, a
  speaker, the web player, a car. Lyrics come from the Spicy Lyrics API (with your own free key) and LRCLIB.
- **Auto** (the default) — desktop mode while Spotify plays on the PC, standalone otherwise. Switches by itself.

---

## Pick your setup

### The modes

| Mode | What drives the display | Needs a PC? | Needs Spicetify? | Keys needed | Works away from home? |
|---|---|---|---|---|---|
| **Desktop · wireless** (recommended) | Spotify on your PC | yes | yes | none | no (same network) |
| **Desktop · wired (USB tethering)** | Spotify on your PC, over a USB cable | yes | yes | none | no |
| **Standalone** | your Spotify account, any device | **no** | **no** | Spotify Client ID (+ optional Spicy key) | **yes** (internet) |
| **Auto** (desktop + standalone) | PC while it plays, account otherwise | optional | optional | as above | partly |
| **Desktop · away from home** | Spotify on your PC, phone elsewhere | yes | yes | a TURN server ([setup](#h-away-from-home-turn)) | **yes** |
| **Developer · adb** | Spotify on your PC, via adb port forward | yes | yes | none | no |

### Every combination

The display app is the same everywhere; these are independent choices you can mix:

| Choice | Options | Where to set it |
|---|---|---|
| Playback source | **Auto** · Desktop only · Spotify account only | Phone: Settings → Playback source |
| Connection to the PC | **Wireless** (Wi-Fi/LAN) · Wired (USB tethering) · adb (developers) | automatic; see [guides](#setup-guides) |
| How the app runs | **Normal app** · **Kiosk** (dedicated dock: full screen, boots into it, silent updates) | Install method; leave kiosk in Settings → Connection |
| Pairing with the PC | **Pairing code** (once) · **Automatic via your Spotify account** · several phones per PC | Spotify: LyricDock button → Phones |
| Signalling (connection setup) | **ntfy.sh** · your own ntfy server · the Helper's local relay | Phone: Settings → Connection → Signalling server |
| Lyrics source | Desktop Spicy cache → Spotify → LRCLIB · Spicy Lyrics API (your key) → LRCLIB | automatic; add a key in Settings → Lyrics |
| Device | Phone · tablet · Android TV box · custom Android build (e.g. Raspberry Pi + LineageOS) | see [What you need](#what-you-need) |
| Look | 7 layouts × 7 backgrounds (incl. Spotify Canvas and music video) × all settings, or a preset | Settings (phone) or the LyricDock panel in Spotify |

Common recipes:

- **"Just a lyrics screen next to my PC"** → Desktop · wireless, normal app, pairing code. Nothing but Spicetify.
- **"A dedicated dock that is always on"** → Desktop · wireless (or Auto), **kiosk**, on a charger.
- **"I don't use Spicetify / I listen on my phone or a speaker"** → Standalone, with a Spotify Client ID and a
  Spicy Lyrics key.
- **"Both"** → Auto: the PC when it plays, your account otherwise. Pair once and sign in once.
- **"My Wi-Fi blocks devices from talking to each other"** → Desktop · wired (USB tethering) or Standalone.
- **"A screen in two rooms"** → pair both phones with the same Spotify; each keeps its own settings.
- **"Nothing should leave my network"** → turn on the Helper's local relay and point the phones at it.

---

## What you need

### Devices

| | Minimum | Notes |
|---|---|---|
| Display device | **Android 8.0+** (API 26), Android System WebView 99+ | Tested on a Samsung Galaxy M01 (Android 12, 3 GB, not rooted). Tablets work. Android TV boxes work but need a touchscreen or mouse for the controls. Custom builds (e.g. a Raspberry Pi 4/5 with [LineageOS](https://konstakang.com/devices/rpi4/) and a touchscreen) work if they have Google's WebView and WebGL. |
| Dynamic background | WebGL | Without WebGL the app falls back to a blurred cover. |
| PC (desktop mode) | Windows 10/11 with Spotify desktop | The extension itself is cross-platform Spicetify, but the installer scripts are Windows PowerShell. |
| Network (desktop mode) | PC and phone on the **same network** | Wi-Fi with "AP/client isolation" off, or a USB cable (tethering). |

### Accounts and keys

| What | Needed for | Cost | Where |
|---|---|---|---|
| Spotify account | everything | Free or Premium | — |
| **Spotify Premium** | play / pause / skip / seek / volume **in standalone mode**, and for owning a Spotify developer app | paid | — |
| [Spicetify](https://spicetify.app) | desktop mode | free | [spicetify.app/docs/getting-started](https://spicetify.app/docs/getting-started) |
| **Spotify Client ID** | standalone mode, and automatic pairing by account | free | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) — [how](#spotify-client-id-standalone-mode) |
| **Spicy Lyrics publishable key** (`sl_pk_…`) | word-synced lyrics in standalone mode; fills gaps in desktop mode | free | [developers.spicylyrics.org](https://developers.spicylyrics.org) — [how](#spicy-lyrics-api-key-optional) |
| Spicy Lyrics extension | best lyrics in desktop mode (optional) | free | Spicetify Marketplace → "Spicy Lyrics" |

**Not needed, never use:** a Spotify *client secret* (LyricDock uses PKCE, no secret exists in it), a Spicy Lyrics
*secret* key (`sl_sk_…`), your Spotify password anywhere except Spotify's own sign-in page.

---

## Keys and accounts: how to get them

### Spotify Client ID (standalone mode)

Your own Spotify "app" lets the phone read your playback from Spotify's Web API. It takes about 5 minutes:

1. Go to **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)** and log in with your Spotify
   account (the owner of a developer app needs **Premium**). Accept the developer terms if asked.
2. Click **Create app**.
   - **App name:** anything, e.g. `LyricDock`. **App description:** anything.
   - **Redirect URI:** `http://127.0.0.1:8976/callback` — exactly this, then click **Add**.
   - **Which API/SDKs are you planning to use?** tick **Web API**.
   - Accept the terms → **Save**.
3. Open the app → **Settings** → copy the **Client ID** (32 characters, letters a–f and digits).
   Ignore the client secret — LyricDock doesn't use one.
4. **Other people's accounts:** new apps are in *Development mode*, limited to **5 users**. To let someone else sign
   in, add their Spotify e-mail under **User Management** in the app's settings. You don't need to add yourself.
5. On the phone: **Settings (⚙) → Playback source → Spotify Client ID** → paste → **Spotify account → Sign in** →
   log in on Spotify's page → **Agree**. The status shows *Signed in · <device>* when something plays.

### Spicy Lyrics API key (optional)

Word-synced lyrics in standalone mode, and a fallback in desktop mode when the Spicy cache has nothing:

1. Go to **[developers.spicylyrics.org](https://developers.spicylyrics.org)** and sign in.
2. Create an application (name/URL: anything, e.g. `LyricDock` and this repo's URL).
3. Open it → **Client access (no backend)** → create a **publishable key** (starts with `sl_pk_`).
4. Under the key's allowed origins, enable **No origin header** (the phone app calls the API natively, without a
   browser origin).
5. On the phone: **Settings → Lyrics → Spicy Lyrics API key** → paste.
   **Never** paste a secret key (`sl_sk_…`) — those are for servers only.

Lyrics are cached on the phone for 7 days. The provider (and, for community syncs, the uploader and maker) is always
shown under the lyrics, as the API terms require.

### Spicetify (desktop mode)

Follow **[spicetify.app/docs/getting-started](https://spicetify.app/docs/getting-started)** — on Windows it is one
PowerShell line:

```powershell
iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex
```

Optional but recommended: install **Spicy Lyrics** from the Spicetify Marketplace. LyricDock reuses the lyrics Spicy
Lyrics has already loaded (no extra requests), which gives the best word-synced coverage.

---

## Setup guides

### A. Desktop · wireless (recommended)

**1. PC — install the extension** (PowerShell, not as administrator):

```powershell
iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex
```

It checks Spicetify, closes Spotify, installs the auto-updating LyricDock loader, registers the
`lyricdock-updater://` link (used by the Update button) and re-applies Spicetify. Spotify restarts with a
**LyricDock button** (screen icon) in the top bar. Re-run the same line any time to repair — for example after a
Spotify update wiped Spicetify.

**2. Phone — install the app** (pick one):

- **Normal app:** on the phone, open
  [github.com/DhakadG/lyricdock/releases/latest](https://github.com/DhakadG/lyricdock/releases/latest), download
  `lyricdock-vX.Y.Z.apk`, open it and allow installing from your browser when Android asks. Open **LyricDock**.
- **Dedicated dock (kiosk):** see [E. Kiosk](#e-kiosk-dedicated-dock).

**3. Pair (once).** The phone shows a code like `K7QX-9MP-2F2` (on the waiting screen, and in Settings → Connection).
In Spotify click the **LyricDock** button → **Pair phone** → type the code → **Pair**. Play something: the phone
follows within a second. The dot on the top-bar button is green when connected. From now on it reconnects by itself.

*Automatic pairing instead:* if the phone is signed in to the same Spotify account ([Client ID](#spotify-client-id-standalone-mode)),
Spotify finds it without the code — both screens show the same 4 digits, tap **Allow** on the phone.

### B. Desktop · wired (USB tethering)

For networks that block device-to-device traffic, or if you prefer a cable. No adb involved:

1. Do **A** (extension, app, pairing).
2. Connect the phone to the PC with a USB **data** cable.
3. Phone: **Settings → Connections → Mobile Hotspot and Tethering → USB tethering** (wording varies by brand).
4. The PC and phone now share a private network over the cable; LyricDock's direct connection uses it like Wi-Fi.

5. Auto uses whichever network works. To force the cable: **Settings → Connection → Connection path → Prefer USB
   cable**. This only works when the PC's own network goes through the phone (the PC has no other network, or Windows
   prefers the tethered adapter): Spotify's WebRTC offers only the PC's main network interface. Settings → Connection
   → Link shows which path is in use (*USB cable (192.168.x.x)* or *direct Wi-Fi*) and the round-trip time.

> The phone still needs internet (Wi-Fi or mobile data) for the few-hundred-byte connection setup; the music data then
> flows over the cable.

### C. Standalone (no PC, no Spicetify)

1. Install the app (A.2 or E).
2. Create a [Spotify Client ID](#spotify-client-id-standalone-mode) and sign in on the phone.
3. Recommended: add a [Spicy Lyrics API key](#spicy-lyrics-api-key-optional) for word-synced lyrics (without it,
   LRCLIB provides line-synced lyrics for most songs).
4. Settings → Playback source → **Source: Spotify account** (or leave **Auto**).
5. Play Spotify anywhere (phone, speaker, web player). The display follows within a second or two; its controls
   control that device (Premium).

### D. Auto (desktop + standalone)

Do **A** and **C**. Leave **Source: Auto**. While Spotify plays on the PC, the display follows the PC (instant,
Spicy's lyrics); when the PC is off or idle it follows your account. A short notice tells you when it switches.

### E. Kiosk (dedicated dock)

Kiosk mode makes LyricDock the phone's only app: full screen, no lock screen or status bar, starts on boot, stays on
while charging, and updates install silently. Android only allows this on a phone **without accounts**, so it suits a
spare / factory-reset phone.

1. On the phone: remove all accounts (**Settings → Accounts and backup → Manage accounts**) or factory-reset it and
   skip signing in.
2. Turn on USB debugging: **Settings → About phone → Software information → tap *Build number* 7 times**, then
   **Settings → Developer options → USB debugging**.
3. Connect it to the PC with a USB data cable and run (PowerShell):

   ```powershell
   iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/setup-phone.ps1 | iex
   ```

   It downloads Google's Android platform-tools (adb) into a **temporary** folder, waits for you to tap *Allow* on
   the phone's USB-debugging prompt, installs the latest app, turns kiosk mode on, starts the app, and **deletes adb
   again**. adb is only used for these few minutes.
4. USB debugging can now be switched off. Then pair (A.3) and/or sign in (C).

To leave kiosk mode later: phone **Settings → Connection → Kiosk mode → Leave** (tap twice).

### F. Custom device (tablet, TV box, Raspberry Pi…)

Anything that runs Android 8+ with Google's Android System WebView:

- Install the APK (sideload via browser, `adb install`, or a file manager).
- For a wall/desk build, use kiosk (E) so it boots straight into LyricDock.
- Raspberry Pi 4/5: flash an Android build such as [KonstaKANG's LineageOS](https://konstakang.com/devices/rpi4/)
  with GApps/WebView, attach a touchscreen, then install as above. Choose **Settings → Performance → Smooth** preset
  if frames drop.
- No touchscreen (TV box): the display works; use a mouse or the Spotify app to control playback, and the LyricDock
  panel in Spotify (desktop mode) to change settings.

### G. Away from home (TURN)

<a id="h-away-from-home-turn"></a>Desktop mode normally needs the phone and PC on the same network. To use it from
elsewhere (phone on mobile data, PC at home), both ends need a TURN relay you control:

1. Get TURN credentials: a free [Metered.ca](https://www.metered.ca/tools/openrelay/) or
   [Cloudflare Calls TURN](https://developers.cloudflare.com/calls/turn/) account, or run
   [coturn](https://github.com/coturn/coturn) on a VPS.
2. Phone: **Settings → Connection → STUN / TURN servers** → `turn:your.host:3478|username|password` (several
   separated by commas). Spotify takes the same setting from the phone the next time they connect at home.
3. Music data then flows through that relay (encrypted by WebRTC, DTLS).

### H. Several phones on one PC

In Spotify: LyricDock → **Devices** → **Find devices**, then **Connect** next to each phone and tap **Allow** on it (or type a phone's pairing code under *Other ways to connect*). All of
them follow the same Spotify; each keeps its **own settings** (click *Edit settings* next to a phone), and presets are
shared. Commands (play, skip, like) from any phone control Spotify.

### I. Signalling without ntfy.sh

The one-time connection setup normally goes through [ntfy.sh](https://ntfy.sh) (encrypted). Two alternatives, set on
the phone under **Settings → Connection → Signalling server**:

- **LyricDock Helper on my PC:** Helper → Settings → **Local signalling relay** on; type the address it shows
  (e.g. `192.168.1.20`) into the phone. Allow the Windows firewall prompt for private networks.
- **My own ntfy server:** any self-hosted [ntfy](https://docs.ntfy.sh/install/) over **https** (Spotify only allows
  secure addresses).

### J. Developer · adb (development only)

Users never need this. For developing, a USB/wireless-adb path exists alongside WebRTC: `scripts/link.ps1` points
Spotify's `localhost:8975` at the phone via `adb forward` (Chromium blocks `ws://` from Spotify's https page to LAN
addresses, which is why the product uses WebRTC). See [Development](#development).

---

## LyricDock Helper (optional, Windows)

A small tray app (download `LyricDock-Helper-vX.Y.Z.exe` from [Releases](https://github.com/DhakadG/lyricdock/releases/latest)):
shows whether the Spotify extension is installed and enabled, installs or repairs it, walks you through the one-time
kiosk setup (step-by-step wizard), can run a **local signalling relay** (so nothing goes through ntfy.sh), notifies you
of new versions, has a Help page, starts with Windows if you like, and has an optional Developer page (adb link, live
phone screen). Nothing needs it day to day.

## Using it

- **Tap anywhere** to show the controls: previous · play/pause · next, volume, and the ⚙ settings button. Tap the
  progress bar to seek, tap a lyric line to jump to it, tap the heart to like/unlike.
- **Settings on the phone:** ⚙. Every row has an **ⓘ** — tap it to read what the setting does.
- **Settings from the PC:** Spotify → LyricDock button. The same settings (hover the **ⓘ** for help), applied to the
  phone instantly, or saved and applied when it next connects.
- **Presets:** built-in **Default** (the shipped config, see [`config/default-settings.json`](config/default-settings.json)),
  **Smooth (slow phones)** and **Full Spicy**; save your own from either panel (stored in Spotify on the PC, so a new
  phone picks them up). **Reset all** returns to Default.
- **Gestures:** swipe left/right to skip, double-tap to like, long-press the progress bar to scrub.
- **Lists:** the controls have buttons for the **queue**, **recently played**, **search**, your **library** (playlists,
  Liked Songs, albums, artists) and **friends' listening activity** (desktop mode). Tap a playlist, album or artist to
  **browse** it (Play / Shuffle at the top, Back to return); tap a song to play it in that list. Every song row has
  **add to queue** and **like** buttons; swipe a row right to queue it, left to like it. In the queue, queued songs
  have **move to top** and **remove** (swipe right / left).
- **Hardware:** the phone's **volume buttons** change Spotify's volume; a **media notification** (and lock-screen
  controls) shows the song with previous / play-pause / next; **brightness** can be fixed or follow a day/night
  schedule.
- **From Spotify:** right-click a playlist / album / artist → **Show on LyricDock** (the phone opens it), or a song →
  **Play with lyrics on LyricDock**. Shortcuts: **Ctrl+Alt+L** the LyricDock panel, **Ctrl+Alt+W** wake the phone,
  **Ctrl+Alt+Y** next layout.
- **Player card layout:** an always-visible player (progress, shuffle, repeat, volume) beside the lyrics.
- **Spotify Canvas background:** Settings → Background → *Spotify Canvas* plays the song's looping video (desktop
  mode) over the blurred cover; songs without one show the cover, which can slowly drift.
- **Music video background:** Settings → Background → *Music video (YouTube)* plays the song's video muted behind the
  lyrics, in sync. Optional: your own [YouTube Data API key](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
  for more reliable matches (Google Cloud Console → enable *YouTube Data API v3* → Credentials → API key).
- **Flip clock:** when the music stops, a flip clock takes over: one dark card per digit (designed in Figma, vectors in [design/flipclock](design/flipclock/)), six flip animations (classic, bounce, slow fold, cascade, roll, fade), optional seconds (tap the clock), 12/24 h, dim, size, cards on/off, and optional synthesised flip sounds and vibration. Double-tap to go back.
- **Lyrics scrolling:** drag the lyrics to read ahead or back (flick to scroll fast); they glide back to the sung line a few seconds after you let go.
- **Font:** Inter Extra Bold by default, the closest free match to Apple Music's San Francisco (which Apple licenses only for its own devices).
- **Screen:** clock screen when paused, night mode (dim + warm + black), burn-in protection, battery indicator,
  keep-awake modes.
- **Settings preview:** phone ⚙ → **Preview** moves the sheet aside so the player shows every change live; Spotify's
  panel has a live preview card at the top.
- **Settings tools:** search box at the top of the settings (phone and Spotify), **Reset** per section, and
  **export / import** (a JSON file in Spotify's panel; copy/paste text on the phone).
- **Versions:** Spotify's panel → *Update channel and version*: **Beta** gets pre-releases first; pick an older version
  to **roll back** (updates pause until you choose Latest). The phone has a **Beta** channel too (Settings → Updates)
  and shows **What's new** after it updates. Android cannot install an older app version over a newer one.
- **Updates:** automatic. The Spotify extension checks every 30 minutes (Spotify's panel also has **Check for
  updates**; the popup's **Update** switches in a second). The phone checks at start and every 6 hours
  (Settings → Updates → **Check now**); kiosk phones install silently, normal installs ask once.

---

## Settings reference

Everything is in the phone's ⚙ menu (and most of it in Spotify's LyricDock panel). Defaults below are the shipped
config ([`config/default-settings.json`](config/default-settings.json)).

**Built-in presets**

| Preset | Changes from Default |
|---|---|
| Default | — (the shipped config) |
| Smooth (slow phones) | glow off, letter mode off, line blur off, background at 0.35× with 4 blur passes at 30 fps, no music motion, 14 lines drawn |
| Full Spicy | glow 1.3×, lift 1.2×, letter mode, line blur, background 0.75× with 8 passes at 60 fps, music motion, colour 1.8× |

**Layout**

| Setting | Default | What it does |
|---|---|---|
| Layout | Default | Default: cover + title beside the lyrics. Lyrics only: full-width lyrics. Compact: small cover row on top. TV view: bigger cover and text for across-the-room viewing. Cinema: huge centred lyrics with a small badge. Now Bar: lyrics with a floating pill at the bottom. Player card: an always-visible player (progress, shuffle, repeat, volume) beside the lyrics, like an Apple Music mini player. Cover + clock: the cover and song on one side, a big flip clock (hours and minutes) on the other. Flip clock: the flip clock full screen all the time (tap for seconds; tap again for the controls). Options: Default / Player card / Lyrics only / Compact / TV view / Cinema / Now Bar / Cover + clock / Flip clock. |
| Cover side | Cover left, lyrics right | Swap which side the album art and the lyrics sit on (landscape). In portrait the cover is always on top. Options: Cover left, lyrics right / Lyrics left, cover right. |
| Progress bar | Bottom | Where the song progress bar sits. Tap it (while the controls are showing) to seek. Options: Bottom / Top / Off. |
| Show times | Off | Shows 1:23 / 3:45 above the ends of the progress bar. |
| Hide controls after | 4 s | Tap anywhere to show play/pause, next, previous, volume and the settings button. They fade out after this many seconds. Range 2–10 s. |
| Scroll long titles | On | Song titles and artist lists that do not fit scroll slowly back and forth instead of being cut off. |
| Shuffle and repeat buttons | On | Adds shuffle and repeat (off / all / one) next to previous and next. |
| Queue, history and friends buttons | On | Buttons that open the queue, recently played, your library and your friends' listening activity. |
| Swipe to skip | On | Swipe left for the next song, right for the previous one. |
| Double-tap to like | On | Double-tap anywhere (not on a button) to add the song to Liked Songs or remove it. |
| Up next chip | On | Near the end of a song, a small chip shows what plays next. |
| Show it for the last | 15 s | How long before the end of the song the chip appears. Range 5–45 s. |
| Volume slider | On | Show a volume slider in the controls. It changes Spotify's volume (not the phone's). |
| Orientation | Auto-rotate (all 4) | Auto follows how the phone is standing, including upside down. Lock it if the phone lies on a sensor-confusing stand. Options: Auto-rotate (all 4) / Landscape / Portrait. |
| Notch & edge spacing | Auto | Auto keeps text clear of the camera notch and pulls the progress bar in where the rounded corners would cut it. Manual lets you set both yourself. Options: Auto / Manual. |
| Side padding | 24 px | Extra space on the left and right edges. Range 0–80 px. |
| Progress bar corner inset | 20 px | How rounded the screen corners are: the progress bar is lifted and shortened to stay inside them. Range 0–80 px. |

**Now playing**

| Setting | Default | What it does |
|---|---|---|
| Show liked (heart) | On | Green heart = in your Liked Songs. Tapping it saves or removes the song in Spotify. |
| Like button position | Badge on the cover | Where the heart sits: a small badge in the corner of the album art, or beside the song title. Options: Badge on the cover / Next to the title. |
| Album and year | On | Shows the album name and release year under the artist. |
| Lyrics source badge | Off | A small label in the corner naming where the lyrics came from (Spicy Lyrics, Apple Music, Spotify, LRCLIB). |
| Show audio quality | On | Shows Spotify's current streaming quality (Low … Very high, Lossless) under the artist. |
| Accent colour from cover | On | Tints the progress bar, buttons and settings with a colour picked from the album art. Off: plain white. |
| Spinning cover (Now Bar) | On | The round cover in the Now Bar turns like a record while playing. |
| Status notices | On | Small toasts at the bottom for things worth knowing: network lost/back, Spicy API limits, switching between computer and account, pairing, updates. |

**Background**

| Setting | Default | What it does |
|---|---|---|
| Background | Dynamic | Dynamic: the cover slowly warped and blurred (Spicy Lyrics' look, uses the GPU). Artist image: the same effect with the artist's photo. Spotify Canvas: the short looping video some songs have in Spotify (desktop mode) - great in portrait; songs without one show the blurred cover. Blurred art: a blurred cover. Colour gradient: slow gradient from the cover's colours. Black: nothing (OLED, lowest power). Options: Dynamic / Artist image (dynamic) / Spotify Canvas (looping video) / Music video (YouTube) / Blurred art / Colour gradient / Black. |
| Drift the still cover | On | The blurred cover slowly pans and zooms instead of standing still (Ken Burns effect). Cheap: one layer moved by the GPU. |
| Motion speed | 0.35 | How fast the dynamic background drifts. 0 freezes it. Range 0–1.5. |
| Move with the music | On | Speeds the background up while vocals are busy (read from the lyric timing) and slows it in instrumental parts. |
| Warp | 1 | How much the image is swirled. 0 = just a blurred, slowly moving cover. Range 0–1. |
| Colour intensity | 1.5 × | Saturation of the dynamic background. Higher = more vivid. Range 0.5–2.5 ×. |
| Cover crossfade | 1000 ms | How long the background takes to blend into the next song's cover. Range 0–3000 ms. |
| YouTube Data API key (optional) | (empty) | Music video background: the song's video plays muted behind the lyrics, synced to the song. To use your own search quota: console.cloud.google.com → create a project → enable "YouTube Data API v3" → Credentials → Create credentials → API key (restrict it to YouTube Data API v3). Without a key, LyricDock asks a public Piped instance, which can be slow or down. |
| Keep the video in sync | On | Seeks the video to the song position when they drift more than 2 seconds apart, and pauses it with the music. |
| Dim | 0.2 | Darkens the background so white lyrics stay readable on bright covers or artist photos. Range 0–0.8. |

**Lyrics**

| Setting | Default | What it does |
|---|---|---|
| Romanization | Smart (keep Hindi) | Smart: Hindi stays in Devanagari, Punjabi (Gurmukhi/Shahmukhi), Urdu and other scripts become Latin letters. Always: everything in Latin letters. Original: no romanization. Options: Smart (keep Hindi) / Always / Original script. |
| Text size | 1 × | Lyrics size. Layouts scale from this (TV and Cinema are bigger). Range 0.6–1.6 ×. |
| Font | Inter (Apple-style, default) | Typeface for lyrics and titles. Inter is the closest free match to Apple's San Francisco (Apple Music's lyrics font, which Apple only licenses for its own devices). Anything but System downloads once from Google Fonts and is then cached; scripts a font lacks (Devanagari, Gurmukhi…) fall back to the system font. Options: Inter (Apple-style, default) / System (Roboto) / Outfit / Manrope / DM Sans / Plus Jakarta Sans / Space Grotesk / Sora / Lexend / Poppins / Playfair Display (serif) / Lora (serif) / JetBrains Mono. |
| Text weight | Extra bold | Thickness of the lyrics font. Options: Medium / Semibold / Bold / Extra bold / Black. |
| Alignment | Left | Duet lines sung by the second singer still go to the other side. Options: Left / Centre. |
| Active line position | 0.35 | 0.2 = near the top (more upcoming lines visible), 0.6 = below the middle (more past lines). Range 0.2–0.6. |
| Line spacing | 1.5 | Space between lyric lines. Range 0–5. |
| Other lines brightness | 0.5 | How visible the lines that aren't being sung are. Spicy Lyrics uses 0.5. Range 0.15–0.85. |
| Sung line colour | White | Colour the word fill sweeps in. Accent uses the colour picked from the album art. Options: White / Accent from cover. |
| Colour per singer (duets) | On | In duets, the second singer's lines (sung on the other side) are tinted with the accent colour so the voices are easy to tell apart. |
| Text shadow for bright backgrounds | Off | A soft dark shadow under the lyrics keeps them readable over bright covers and artist photos. |
| Hide explicit words | Off | Masks common English swear words in the lyrics (f***). Only changes what is shown. |
| Countdown before singing | On | In the intro, the last 3 seconds before the first line count down 3 · 2 · 1 above the dots. |
| Blur distant lines | On | Lines two or more away from the current one are softly blurred, drawing the eye to the sung line. |
| Blur strength | 1.2 px | Blur of lines two away; three and more get twice this. Range 0.5–5 px. |
| Glow on sung words | On | Words glow softly as they are sung (Spicy Lyrics). The most expensive effect: turn it off on slow phones for smoother motion. |
| Glow strength | 1 × | Size and brightness of the glow. Range 0.2–2 ×. |
| Lift sung words | On | Each word rises and grows slightly as it is sung, then settles. |
| Lift amount | 1 × | How far words rise and grow. Range 0.2–2 ×. |
| Letter-by-letter on long notes | On | When a short word is held for a long time ("foreverrr"), each letter lights up in turn with extra lift and glow - Spicy Lyrics' emphasis. |
| Long note length | 1000 ms | How long a word must be held to get the letter-by-letter treatment. Range 500–3000 ms. |
| Interlude dots | On | Three breathing dots fill instrumental gaps and pop just before singing resumes. |
| Dots after a gap of | 4 s | Minimum silence between lines before the dots appear. Range 2–12 s. |
| Scroll ahead | 250 ms | The list starts moving to the next line this long before it is sung, so your eyes are already there. Range 0–800 ms. |
| Return to the sung line after | 3 s | Drag the lyrics up or down to read ahead or look back (flick to scroll fast). This long after you let go, they glide back to the line being sung. Range 1–10 s. |
| Show credits | On | Songwriters are optional; the lyrics provider (and community sync credits) are always shown, as the providers require. |
| Tap a line to jump to it | On | Tap any synced line to seek Spotify to it. |
| Sync offset | 0 ms | Nudge if lyrics run early or late (e.g. Bluetooth speaker delay: try +150 to +300 ms). Range -1000–1000 ms. |
| Spicy Lyrics API key (optional) | (empty) | Get one at developers.spicylyrics.org → your application → Client access (no backend) → publishable key (sl_pk_…), with "No origin header" allowed. Never paste a secret key (sl_sk_…). Needed for word-synced lyrics in Spotify-account mode. |

**Animations**

| Setting | Default | What it does |
|---|---|---|
| Next / previous | Slide | How the screen changes to the next song. Next moves left, previous moves right. Options: Slide / Fade / Zoom / Flip / Blur / Card stack / None. |
| Play / pause | Pulse + shrink | Feedback when playback pauses or resumes. Shrink makes the cover smaller while paused. Options: Pulse + shrink / Pulse / Shrink art / Ripple / None. |
| Lyrics scroll | Smooth | How the lyrics glide to the next line. Springy overshoots a little. Options: Smooth / Springy / Snappy. |
| Animation speed | 1 × | Speeds up or slows down every UI animation. Range 0.5–2 ×. |

**Screen**

| Setting | Default | What it does |
|---|---|---|
| Keep the screen on | Always | Always: never sleeps (the kiosk default). Only while playing: the screen turns off after music has been paused for the time below. Follow Android: the normal screen timeout. Options: Always / Only while playing / Follow Android. |
| Turn off after pausing for | 10 min | How long the screen stays on after music stops. Range 1–60 min. |
| Night mode | Off | Between the hours below: dims everything, switches to a black background and warms the colours. |
| Night starts at | 22 :00 | Hour (24-hour clock) night mode starts. Range 0–23 :00. |
| Night ends at | 7 :00 | Hour (24-hour clock) night mode ends. Range 0–23 :00. |
| Night dimming | 0.5 | How much darker everything gets at night. Range 0–0.85. |
| Night warmth | 0.4 | Amber tint at night (less blue light). Range 0–1. |
| Burn-in protection | On | AMOLED screens can keep a ghost of things that never move. This shifts the layout by a few pixels every few minutes: invisible, but it spreads the wear. |
| Brightness | Follow Android | Fixed: always the level below. Day / night: the day level, and the night level between the night hours (Night starts / ends at). Only LyricDock's window changes, not the system setting. Options: Follow Android / Fixed / Day / night schedule. |
| Day brightness | 0.8 | Screen brightness while LyricDock is open (Fixed), or during the day (schedule). Range 0.02–1. |
| Night brightness | 0.15 | Screen brightness between the night hours. Range 0.02–1. |
| Volume buttons control Spotify | On | The phone's volume buttons change Spotify's volume (5% per press) instead of the phone's. |
| Media notification | On | Shows the song with previous / play-pause / next in the notification shade and on the lock screen (normal, non-kiosk use). |
| Battery indicator | Off | Shows the phone's battery level and whether it is charging, in a corner (handy for a kiosk dock). |

**Clock**

| Setting | Default | What it does |
|---|---|---|
| Clock screen | When paused | A full-screen clock after a while without music. It goes away by itself when music plays; double-tap to go back sooner. Options: Off / When paused / When nothing is playing. |
| Show the clock after | 3 min | Minutes without music before the clock appears. Range 1–30 min. |
| Style | Flip cards | Flip cards: big white numerals on dark cards that flip like a mechanical clock. Tap to show or hide seconds, double-tap to go back. Simple: a thin time with the date. Options: Flip cards / Simple (time and date). |
| Flip animation | Classic | Classic: the top half falls, the new bottom half lands. Bounce: the flap overshoots and settles. Slow fold: slower, with a light sheen and a shadow on the half below. Cascade: every digit is its own card and flips a beat after the one before (departure board). Roll: the digit rolls down a drum. Fade: a quiet crossfade. Options: Classic / Bounce / Slow fold / Cascade (per digit) / Roll / Fade. |
| Show seconds | Off | A third card for seconds. Tapping the clock toggles it too. |
| Time format | 12-hour (AM / PM) | 12-hour shows AM or PM in the corner of the hours card. Options: 12-hour (AM / PM) / 24-hour. |
| Arrangement | Follow the screen | Follow the screen: cards side by side in landscape, stacked in portrait. Options: Follow the screen / Side by side / Stacked. |
| Show the cards | On | Off: only the numerals on black (the flip still moves them). |
| Size | 1 × | Smaller cards leave more black around them. Range 0.5–1 ×. |
| Dim | 0 | Darkens the clock (for a bedroom at night). Range 0–0.85. |
| Flip sound | Off | A small sound made on the phone (no audio files) timed to the flap: the whoosh as it falls, the click as it lands. Silent during night mode. Options: Off / Mechanical (whoosh + click) / Click / Whoosh / Soft tap. |
| Sound volume | 0.4 | Loudness of the flip sound (relative to the phone's media volume). Range 0.05–1. |
| Sound with seconds on | Only when the minute changes | A tick every second gets tiring: by default only the minute flip makes a sound. Options: Only when the minute changes / Every flip. |
| Vibrate on flip | Off | A very short tick of the vibration motor as the flap lands. |
| Paused song under the clock | On | Shows "Paused · song" in small text below the clock. |

**Performance**

| Setting | Default | What it does |
|---|---|---|
| Background resolution | 0.5 × | Size the dynamic background is drawn at. Under this much blur 0.5 looks the same as 1 and is what lets a budget phone hold 60 fps. Range 0.2–1 ×. |
| Background blur passes | 6 | Softness of the dynamic background. More passes = smoother, more GPU work. Range 1–12. |
| Background frame rate | Match display | Cap for the dynamic background. Match display runs at the screen's own refresh rate (60, 90, 120, 144 Hz…); a phone never goes above its screen. The background moves slowly, so 30 fps is hard to tell apart and saves power. Options: Match display / 165 fps / 144 fps / 120 fps / 100 fps / 90 fps / 75 fps / 60 fps / 45 fps / 30 fps / 24 fps / 20 fps / 15 fps. |
| Lines kept drawn | 20 | Lines further than this from the current one are not drawn at all (long songs stay light). Raise it if you use a tiny text size. Range 8–60. |

**Playback source**

| Setting | Default | What it does |
|---|---|---|
| Source | Auto | Desktop: follow Spotify on the computer through the LyricDock extension (best lyrics, instant). Spotify account: follow whatever device your account plays on, straight from Spotify's Web API (needs the Client ID below). Auto: desktop while it plays, account otherwise. Options: Auto / Desktop (Spicetify) / Spotify account. |
| Spotify Client ID | (empty) | developer.spotify.com/dashboard → Create app → Web API, redirect URI http://127.0.0.1:8976/callback → copy the Client ID. Development mode allows 5 users; the app owner needs Premium. |
| Spotify account | — | Signs in on this phone (you type your password into Spotify's own page). Also lets Spotify on your computer find this phone without a code. |

**Presets**

| Setting | Default | What it does |
|---|---|---|
| Export / import | — | Export copies all settings (without API keys) as text you can paste into another phone. Import applies settings pasted here. Spotify's LyricDock panel can export and import files too. |
| Presets | — | Built-in: Default (the shipped config), Smooth (for slow phones) and Full Spicy (every effect up). Your own presets are stored in Spotify on the computer. |

**Updates**

| Setting | Default | What it does |
|---|---|---|
| Update channel | Stable | Beta installs pre-releases as soon as they are published (they may have rough edges). Android cannot install an older version over a newer one, so going back from beta to stable waits for the next stable release. Options: Stable / Beta (pre-releases). |
| Update automatically | On | Checks GitHub Releases shortly after start and every 6 hours. In kiosk mode updates install silently; otherwise Android asks once. |
| LyricDock app | — | Check for a new version now and install it if there is one. |
| Changelog | — | Release notes for this and earlier versions, from GitHub. |

**Connection**

| Setting | Default | What it does |
|---|---|---|
| Status | — |  |
| Connection path | Auto (fastest) | How the phone reaches Spotify on your computer. Auto uses whatever works best. Prefer USB cable only offers the USB-tethering network. It works when the computer's internet goes through the phone (USB tethering on, and the computer has no other network or prefers the tethered one): Spotify only offers its main network interface. Takes effect on the next connection. Options: Auto (fastest) / Prefer USB cable / Wi-Fi only. |
| Signalling server | ntfy.sh (public) | Where the phone and Spotify swap their one-time connection details (encrypted with the pairing code; the server never sees your music or lyrics). ntfy.sh is free and public. My own ntfy server: any self-hosted ntfy (https address). LyricDock Helper: the helper app runs a tiny relay on your PC and nothing leaves your network - type your PC's IP address below. Spotify takes this setting from the phone. Options: ntfy.sh (public) / My own ntfy server / LyricDock Helper on my PC. |
| Server address | (empty) | My own ntfy server: its https:// address (Spotify only allows https). LyricDock Helper: the IPv4 address of the PC running the helper (shown on its Dashboard). |
| STUN / TURN servers (away from home) | (empty) | Only for using LyricDock on a different network from your computer (e.g. phone on mobile data). Add a TURN relay you control as url\|username\|password; several separated by commas. Options: a Metered.ca or Cloudflare TURN account, or coturn on a VPS. Leave empty at home. |
| Connection log | — | The last connection events on this phone (connected, lost, reconnected), newest first. |
| Kiosk mode | — | Kiosk mode was turned on by setup-phone.ps1. Leaving it gives the phone back its normal home screen, status bar and lock screen. |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone says **Waiting for Spotify…** / red dot on the LyricDock button | Same network? Guest Wi-Fi and "AP isolation" block devices from reaching each other — use your main Wi-Fi, USB tethering (B) or standalone (C). Re-enter the pairing code if the phone was reinstalled. |
| **No LyricDock button in Spotify** after a Spotify update | Spotify updates wipe Spicetify. Re-run the installer line (A.1); it runs `spicetify backup apply` when needed. |
| **"Could not set device owner"** / kiosk refused | The phone still has an account signed in (Google, Samsung, …). Remove all accounts or factory-reset, then run `setup-phone.ps1` again. |
| **Standalone: sign-in fails / 403** | Redirect URI must be exactly `http://127.0.0.1:8976/callback`; Web API ticked; the account must be the app owner or listed under User Management (Development mode). |
| Standalone: controls don't work | Playback control through the Web API needs **Premium**. |
| Lyrics missing or only line-synced | Desktop: install Spicy Lyrics in Spotify. Standalone: add a Spicy Lyrics key. Some songs simply have no synced lyrics. |
| Notice **"Spicy Lyrics API is rate-limiting"** | Temporary; LyricDock uses other sources meanwhile. |
| Lyrics early/late (e.g. Bluetooth speaker) | Settings → Lyrics → **Sync offset** (try +150 to +300 ms). |
| Queue / friends / recently played show an error | Update Spotify's LyricDock (Check for updates). Friends activity needs desktop mode; the Web API has no friends feed. |
| Several phones: one keeps disconnecting | Each phone needs its own pairing; check Spotify → LyricDock → Phones and the Connection log. |
| Choppy animation | **Smooth** preset, or turn off glow; Performance → background resolution 0.35×. |
| Phone didn't update | Settings → Updates → **Check now**. Versions 1.1.0–1.1.3 in kiosk mode could not self-update: reinstall once with `setup-phone.ps1` or the APK. |

---

## Privacy and security

- **Desktop ↔ phone** traffic goes directly over your local network (WebRTC). Setting up that connection needs one
  small offer/answer exchange; it goes through [ntfy.sh](https://ntfy.sh) (a public message relay), your own ntfy
  server or the Helper's local relay, **encrypted with AES-GCM** using a key derived from your pairing code — the relay
  only sees ciphertext. Automatic pairing by account
  uses an ECDH key exchange plus your confirmation of matching digits on both screens.
- **Standalone mode** talks to Spotify's Web API with your own Client ID (PKCE, no secret). Tokens stay on the phone.
- **Keys** (Client ID, Spicy key) are stored only on the phone (and in Spotify's local storage when synced from the
  PC panel; presets never include keys). Nothing is sent anywhere else.
- **Lyrics** are fetched from Spicy Lyrics / Spotify / LRCLIB, cached locally, never redistributed; the provider is
  always credited.
- The installer only writes to Spicetify's folder and one per-user registry key (`lyricdock-updater://`).

---

## Uninstalling

- **Spotify:** `spicetify config extensions lyricdock.js-` then `spicetify apply`. Optionally delete the registry key
  `HKCU\Software\Classes\lyricdock-updater`.
- **Phone (kiosk):** Settings → Connection → Kiosk mode → **Leave**, then uninstall LyricDock like any app.
- **Phone (normal):** uninstall like any app.
- **Spotify developer app:** delete it in the [dashboard](https://developer.spotify.com/dashboard) if you no longer use standalone mode.

---

## Development

Needs JDK 17+, the Android SDK (platform 34 + build-tools; `$env:ANDROID_HOME` or `.tools/sdk`) and adb — adb is used
here for development only.

| Task | Command |
|---|---|
| Build + install on the USB phone (Gradle-free) | `./scripts/deploy.ps1` (`scripts/build-apk.ps1` builds only) |
| Run this checkout's extension in Spotify (no auto-update) | `./scripts/install-extension.ps1 -Dev` |
| Extra wired path for development (adb forward, USB/wireless adb) | `./scripts/link.ps1` / `./scripts/autostart.ps1` |
| Windows helper app (Tauri 2, same UI as Ethernet Guardian) | `cd helper/src-tauri; cargo build --release` |
| Drive the phone's WebView (after `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`) | `node scripts/cdp.mjs eval "<js>"` / `shot out.png` |
| Browser preview with a fake bridge (760×360) | `./scripts/preview.ps1` |
| Romanizer tests | `node tests/roman.test.js` |
| Release (bump version, build APK, tag, push, GitHub release) | `./scripts/release.ps1 -Version X.Y.Z` (add `-Beta` for a pre-release) |
| Sign with your own release key instead of the debug key | set `LYRICDOCK_KEYSTORE`, `LYRICDOCK_KS_PASS`, `LYRICDOCK_KEY_ALIAS` before building (switching keys needs a reinstall on existing phones) |
| CI | `.github/workflows/build.yml` checks the JavaScript and builds the APK on every push |

Layout: `extension/` (Spicetify loader + bridge), `android/` (app: Java shell + `assets/` web UI — `style.css`,
`settings.js` holds the settings schema and defaults), `updater/` (installer, phone setup), `config/` (generated
default config), `helper/` (Windows helper app) and `scripts/` (tooling). `docs/ROADMAP.md` lists 200 rated features and their status. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

AGPL-3.0 — it includes code ported from Spicy Lyrics (AGPL-3.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Lyrics belong to their rights holders; LyricDock always shows the provider and credits and does not redistribute them.
