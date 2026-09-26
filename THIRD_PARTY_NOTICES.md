# Third-party notices

## Spicy Lyrics — AGPL-3.0
https://github.com/Spikerko/spicy-lyrics — Copyright (c) Spikerko and contributors.

Ported into this project (and the reason LyricDock is AGPL-3.0):
- `android/app/src/main/assets/anim.js` — word spring animation: `src/modules/Spring.ts` and the word
  scale / Y-offset / glow curves and constants from `src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts`.
- `android/app/src/main/assets/index.html` — lyric line/word styling values from `src/css/Lyrics/Mixed.css`, and the
  settings sheet from `src/css/tokens.css`, `src/css/settings-panel.css`, `src/css/polyfills/generic-modal-polyfill.css`
  and `src/css/default.css`.
- `extension/dock-bridge.js` — reads Spicy Lyrics' local lyrics cache; the payload shape follows its sources.

LyricDock does not call Spicy Lyrics' internal client API.

## spr (spring solver) — MIT
https://github.com/Fraktality/spr — Copyright (c) Fraktality. Reached this project through Spicy Lyrics' port.

## @kawarp/core 1.2.2 — MIT
Bundled as `android/app/src/main/assets/kawarp.js` (ESM exports stripped so it loads as a classic script).

```
MIT License

Copyright (c) 2026 Better Lyrics

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Java-WebSocket 1.5.7 — MIT, SLF4J API 2.0.6 — MIT
Runtime dependencies of the Android app (fetched from Maven Central at build time, not vendored).

## Lyrics
Lyrics text belongs to its rights holders. LyricDock shows the provider name ("Provided by") and song credits
with every set of lyrics and does not redistribute them.
