# Contributing to LyricDock

Thanks for helping. LyricDock is three small pieces: a Spicetify extension (`extension/`), an Android app whose UI is plain HTML/CSS/JS in a WebView (`android/app/src/main/assets/`), and an optional Windows helper (`helper/`, Tauri 2).

## Ground rules

- **No secrets in the repo.** API keys, client IDs and keystores live in a local `.env` / `secrets/` (both gitignored) or in the phone's settings. Before committing, run:
  ```bash
  git grep --cached -n -I -E "sl_pk_|sl_sk_|BEGIN .*PRIVATE KEY"
  ```
  No output means clean.
- **Users never need adb.** adb is for development only (and the one-time `updater/setup-phone.ps1`). Features must work over the normal WebRTC link.
- **Every setting lives in the schema** (`assets/settings.js`): a default, a one-line `desc` if useful, and a `help` text. The phone panel, Spotify's panel and the README table are all built from it.
- **Keep it light on old phones.** The reference device is a Galaxy M01 (Snapdragon 439, WebView Chrome 99). Measure before adding per-frame work; prefer CSS transforms and opacity over layout properties.
- Plain language in the UI, sentence case, no exclamation marks.

## Building

| What | How |
|---|---|
| Android app | `./scripts/build-apk.ps1` (no Gradle needed; uses `ANDROID_HOME` or `.tools/sdk`). `./scripts/deploy.ps1` builds and installs over USB adb. |
| Extension (development) | `./scripts/install-extension.ps1 -Dev` installs `extension/dock-bridge.js` directly (no auto-updates), then `spicetify apply`. |
| Helper | `cd helper/src-tauri && cargo build --release` |
| Page preview in a desktop browser | `./scripts/preview.ps1` |

The Java side uses no inner, anonymous or lambda classes (the Gradle-free `d8` step), so every callback is a small top-level class (`UiOp`, `MediaCb`, …).

## Debugging the phone

`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` and then `node scripts/cdp.mjs eval "<js>"` / `node scripts/cdp.mjs shot out.png`, or open `chrome://inspect` in Chrome.

## Pull requests

- One topic per PR; describe what you tested and on which device / Spotify version.
- CI (`.github/workflows/build.yml`) syntax-checks the JavaScript and builds the APK.
- Releases are cut by the maintainer with `./scripts/release.ps1 -Version x.y.z` (bumps every version, tags, uploads the APK and helper).

By contributing you agree that your contribution is licensed under the AGPL-3.0, like the rest of the project.
