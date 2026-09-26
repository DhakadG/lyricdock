# LyricDock

Turn an old Android phone into a desk display for Spotify: album art, a moving album-art background and
word-by-word synced lyrics — the Spicy Lyrics experience, mirrored from your desktop over USB (Wi-Fi as fallback).

- **Spotify desktop + [Spicetify](https://spicetify.app)** runs a small bridge extension (`extension/dock-bridge.js`).
- **The phone** runs a kiosk app (`android/`) that renders the lyrics and sends play / pause / next / previous back.

## Features

- Word-synced lyrics with Spicy Lyrics' spring animation, background vocals, duets, interlude dots, credits.
- Lyrics come from what [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) already fetched on your desktop
  (no extra requests), falling back to Spotify's own lyrics and [LRCLIB](https://lrclib.net).
- Romanization: *Smart* keeps Hindi (Devanagari) and romanizes everything else (built-in Gurmukhi/Punjabi romanizer).
- Next track's cover is preloaded, so track changes animate without pop-in.
- Layouts: Default, Lyrics only, Compact, TV, Cinema, Now Bar. Backgrounds: Dynamic (WebGL), Blurred art,
  Colour gradient, Black. Several next/previous and play/pause animations. Everything is in the in-app settings (tap → ⚙).
- Tap a lyric line to jump to it; tap the progress bar to seek.
- USB link first (`adb forward`), direct Wi-Fi as fallback, automatic reconnect.

## Requirements

- Windows PC with Spotify desktop, [Spicetify](https://spicetify.app) and (optionally) the Spicy Lyrics extension.
- An Android 8+ phone with USB debugging on. Tested on a Samsung Galaxy M01 (Android 12, not rooted).
- `adb` on PATH (or set `$env:ADB`), JDK 17+, Android SDK (platform 34 + build-tools) via `$env:ANDROID_HOME`
  or at `.tools/sdk`.

## Setup

```powershell
# 1. Build and install the phone app (Gradle-free; `gradle assembleDebug` in android/ works too)
./scripts/deploy.ps1

# 2. Optional kiosk mode: full screen, no lock screen, stays on while charging.
#    Needs a phone with NO accounts signed in (factory-reset works best).
adb shell dpm set-device-owner com.you.lyricdock/.AdminReceiver

# 3. Install the Spicetify bridge
./scripts/install-extension.ps1

# 4. USB only: keep the adb tunnel up (leave running). Skip for Wi-Fi-only use.
./scripts/link.ps1
```

Play something in Spotify — the phone picks it up within a second.

**Wi-Fi:** the phone reports its Wi-Fi IP over any USB session and the bridge remembers it. Wi-Fi-only? The phone
shows its IP while waiting — enter it once in Spotify under *profile menu → LyricDock*. The bridge prefers USB,
fails over to Wi-Fi within ~2.5 s when the cable drops, and switches back to USB within ~1 s when it returns.

**Leaving kiosk mode:** `adb shell dpm remove-active-admin com.you.lyricdock/.AdminReceiver`, then
`adb uninstall com.you.lyricdock` if you want the app gone.

## Development

- `./scripts/preview.ps1` builds `android/build/preview.html` with a fake bridge — open it in a browser at 760×360
  (the phone's CSS viewport) to work on the UI without a phone.
- `node scripts/cdp.mjs eval "<js>"` / `node scripts/cdp.mjs shot out.png` drive the app's live WebView on the phone
  (after `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).
- `node tests/roman.test.js` checks the romanizer.

## License

AGPL-3.0 — it includes code ported from Spicy Lyrics (AGPL-3.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Lyrics belong to their rights holders; LyricDock always shows the provider and credits and does not redistribute them.
