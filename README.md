# LyricDock

Turn an old Android phone into a desk display for Spotify: album art, a moving background and word-by-word synced
lyrics — the Spicy Lyrics experience on a second screen.

- **Spotify desktop + [Spicetify](https://spicetify.app)** runs the LyricDock extension (auto-updating).
- **The phone** runs the LyricDock app: it shows the lyrics and sends play / pause / next / previous / seek / like back.
- They talk **directly over your Wi-Fi** (WebRTC), no cable and no extra PC software. The phone can also follow
  your Spotify account on its own when the PC is off (optional, see below).

## Features

- Word-synced lyrics with Spicy Lyrics' spring animation, letter-by-letter glow on held notes, background vocals,
  duets, interlude dots, right-to-left scripts, credits and provider attribution.
- Lyrics come from what [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) already fetched on your desktop
  (no extra requests), falling back to Spotify's own lyrics and [LRCLIB](https://lrclib.net).
- Romanization: *Smart* keeps Hindi (Devanagari) and romanizes Punjabi (Gurmukhi), Urdu and others.
- Layouts: Default, Lyrics only, Compact, TV, Cinema, Now Bar. Backgrounds: Dynamic, Artist image, Blurred art,
  Colour gradient, Black — the dynamic ones can move with the music. All four orientations; notch and rounded-corner aware.
- Settings on the phone (tap → ⚙) and in Spotify (LyricDock button in the top bar), with presets.
- Updates itself: the Spotify extension within 30 minutes of a release, the phone app within 6 hours.

## Setup (one time)

You need: a Windows PC with Spotify desktop and [Spicetify](https://spicetify.app), and an Android 8+ phone on the
same Wi-Fi. Tested on a Samsung Galaxy M01 (Android 12, not rooted).

**1. Spotify (PC)** — in PowerShell:

```powershell
iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex
```

Spotify restarts with a LyricDock button in the top bar. Run the same line again any time to repair it — e.g. after
a Spotify update wiped Spicetify (the Update button in the LyricDock popup does it for you).

**2. Phone** — pick one:

- **Simple:** on the phone, download `lyricdock-vX.Y.Z.apk` from
  [Releases](https://github.com/DhakadG/lyricdock/releases/latest) and install it (allow installing from your
  browser when asked). LyricDock runs as a normal app.
- **Dedicated dock (kiosk):** full screen, starts on boot, stays on, updates silently. Turn on USB debugging on the
  phone (Settings → About phone → Software information → tap *Build number* 7 times; then Settings → Developer
  options → *USB debugging*), connect it with a USB cable and run:

  ```powershell
  iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/setup-phone.ps1 | iex
  ```

  It downloads Android's adb into a temp folder, installs the app, turns kiosk mode on, and deletes adb again.
  Kiosk mode needs a phone with **no accounts signed in** (Settings → Accounts; a factory-reset phone is ideal).
  Afterwards USB debugging can be switched off — LyricDock never uses adb.

**3. Pair** — the phone shows a code like `K7QX-9MP-2F2`. In Spotify click the LyricDock button (top bar), type
the code under *Pair phone*, click *Pair*. Done: play something and the phone follows within a second. It
reconnects by itself from now on (the button's dot is green when connected).

### Optional

- **Phone follows your Spotify account when the PC is off** (and finds the PC without a code): create a free app in
  the [Spotify developer dashboard](https://developer.spotify.com/dashboard) (Web API; redirect URI
  `http://127.0.0.1:8976/callback`), then on the phone: Settings → Playback source → paste its Client ID → Sign in.
  No client secret is needed (PKCE). Spotify's development mode works for up to 5 accounts; the app owner needs Premium.
- **Spicy Lyrics developer API** fills gaps the desktop cache misses, with *your own* publishable key: in the
  [developer dashboard](https://developers.spicylyrics.org) open your application → *Client access (no backend)* →
  create a publishable key (`sl_pk_…`) and allow **No origin header**. Paste it in the phone's Settings → Lyrics.
  Never use a secret key (`sl_sk_…`) here.
- **Leaving kiosk mode:** phone Settings (⚙) → Connection → Kiosk mode → *Leave* (tap twice). Then it's a normal app
  you can uninstall.

## Development

Needs JDK 17+, the Android SDK (platform 34 + build-tools; `$env:ANDROID_HOME` or `.tools/sdk`) and adb.
adb is used here for development only.

- `./scripts/deploy.ps1` — Gradle-free build (`scripts/build-apk.ps1`) + install on the USB phone.
- `./scripts/install-extension.ps1 -Dev` — run this checkout's `extension/dock-bridge.js` in Spotify instead of the
  released build (without `-Dev`: the auto-updating loader).
- `./scripts/link.ps1` (or `autostart.ps1`) — an extra wired path for development: points Spotify's
  `localhost:8975` at the phone over USB / wireless adb. Chromium blocks `ws://` from Spotify's https page to LAN
  addresses, which is why the normal path is WebRTC.
- `companion/LyricDock.ps1` — tray app for development: the adb link, phone brightness / restart / reboot and a live
  phone screen.
- `node scripts/cdp.mjs eval "<js>"` / `shot out.png` — drive the phone app's live WebView
  (after `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).
- `./scripts/preview.ps1` — browser preview with a fake bridge at 760×360 (the phone's CSS viewport).
- `node tests/roman.test.js` — romanizer tests.
- `./scripts/release.ps1 -Version X.Y.Z` — bump `extension/version.json`, build the APK, tag, push and publish the
  GitHub release that every install updates from.

## License

AGPL-3.0 — it includes code ported from Spicy Lyrics (AGPL-3.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Lyrics belong to their rights holders; LyricDock always shows the provider and credits and does not redistribute them.
