# LyricDock roadmap — 200 features, additions and improvements

Sources: our own backlog, [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics), [Wave Player](https://github.com/03x1/Wave-Player)
and [ivLyrics](https://github.com/ivLis-Studio/ivLyrics).

**Scores (1–10):** **Value** = how much users gain (essential / must-have is 9–10). **Ease** = how easy to build and keep
working (10 = trivial). **Score** = Value × 0.6 + Ease × 0.4, the order to build in.
**Status:** ✅ shipped · 🟡 partly · ⬜ not yet. Where = **P**hone app, **E**xtension (Spotify), **H**elper app, **I**nfra.

## Lyrics display

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 1 | Word-synced lyrics with Spicy's spring animation | P | 10 | 6 | 8.4 | ✅ |
| 2 | Line-synced + static fallbacks | P | 9 | 8 | 8.6 | ✅ |
| 3 | Background vocals line | P | 7 | 7 | 7.0 | ✅ |
| 4 | Duets: second singer on the other side | P | 7 | 8 | 7.4 | ✅ |
| 5 | Colour per singer in duets | P | 6 | 9 | 7.2 | ✅ |
| 6 | Interlude dots (Spicy musical line) | P | 8 | 6 | 7.2 | ✅ |
| 7 | Interlude dots mid-song without scroll jumps | P | 9 | 7 | 8.2 | ✅ |
| 8 | Intro countdown 3·2·1 | P | 5 | 8 | 6.2 | ✅ |
| 9 | Letter-by-letter emphasis on held notes | P | 7 | 6 | 6.6 | ✅ |
| 10 | Glow + lift, with strength sliders | P | 7 | 8 | 7.4 | ✅ |
| 11 | Blur distant lines, with strength | P | 6 | 9 | 7.2 | ✅ |
| 12 | Scroll ahead (lead) + instant seek snap | P | 7 | 8 | 7.4 | ✅ |
| 13 | Right-to-left scripts | P | 6 | 8 | 6.8 | ✅ |
| 14 | Smart romanization (keep Hindi) | P | 9 | 5 | 7.4 | ✅ |
| 15 | Urdu / Shahmukhi romanization | P | 7 | 4 | 5.8 | ✅ |
| 16 | Show original + romanized together (dual line) | P | 7 | 6 | 6.6 | ⬜ |
| 17 | Japanese furigana | P | 5 | 3 | 4.2 | ⬜ |
| 18 | Korean / Chinese / Japanese romanization | P | 6 | 3 | 4.8 | ⬜ |
| 19 | Translation line (user's Gemini/DeepL key) | P+E | 8 | 5 | 6.8 | ⬜ |
| 20 | Accent-coloured active line | P | 5 | 9 | 6.6 | ✅ |
| 21 | Text shadow for bright backgrounds | P | 6 | 9 | 7.2 | ✅ |
| 22 | Hide explicit words | P | 4 | 8 | 5.6 | ✅ |
| 23 | Font picker (13 fonts) | P | 7 | 8 | 7.4 | ✅ |
| 24 | Text weight / size / spacing / brightness | P | 7 | 9 | 7.8 | ✅ |
| 25 | Credits + provider attribution | P | 9 | 8 | 8.6 | ✅ |
| 26 | Lyrics source badge | P | 4 | 9 | 6.0 | ✅ |
| 27 | Sync offset | P | 8 | 9 | 8.4 | ✅ |
| 28 | Per-song sync offset memory | P | 6 | 7 | 6.4 | ⬜ |
| 29 | Community-shared sync offsets (ivLyrics) | I | 4 | 2 | 3.2 | ⬜ |
| 30 | Tap a line to seek | P | 8 | 9 | 8.4 | ✅ |
| 31 | Instrumental / "no lyrics" state with art | P | 5 | 8 | 6.2 | 🟡 |
| 32 | Lines-kept-drawn virtualisation | P | 7 | 8 | 7.4 | ✅ |
| 33 | Lyrics skeleton while loading | P | 5 | 9 | 6.6 | ✅ |
| 34 | Karaoke "word fill" colour choice | P | 4 | 8 | 5.6 | ✅ |
| 35 | Upcoming-line preview size option | P | 3 | 8 | 5.0 | ⬜ |
| 36 | Lyrics-only full screen quick toggle | P | 5 | 9 | 6.6 | 🟡 |
| 37 | Learning mode (word-by-word translation) | P | 3 | 2 | 2.6 | ⬜ |
| 38 | Share a lyric line as an image | P | 4 | 5 | 4.4 | ⬜ |
| 39 | Copy lyrics to clipboard (desktop) | E | 3 | 9 | 5.4 | ⬜ |
| 40 | Lyrics search when none found (manual pick) | P+E | 5 | 4 | 4.6 | ⬜ |

## Lyrics sources

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 41 | Reuse Spicy Lyrics' desktop cache | E | 10 | 7 | 8.8 | ✅ |
| 42 | Spotify lyrics fallback | E | 9 | 7 | 8.2 | ✅ |
| 43 | LRCLIB fallback (desktop + phone) | P+E | 8 | 8 | 8.0 | ✅ |
| 44 | Spicy Lyrics developer API (user key) | P | 8 | 7 | 7.6 | ✅ |
| 45 | Upgrade to better lyrics when they arrive | P+E | 8 | 7 | 7.6 | ✅ |
| 46 | Lyric source priority order setting (Wave Player) | P+E | 6 | 6 | 6.0 | ⬜ |
| 47 | NetEase provider | E | 4 | 5 | 4.4 | ⬜ |
| 48 | Musixmatch provider (user token) | E | 5 | 4 | 4.6 | ⬜ |
| 49 | LyricsPlus / Paxsenix providers (ivLyrics) | E | 4 | 4 | 4.0 | ⬜ |
| 50 | Offline lyrics cache on phone (7 days) | P | 7 | 9 | 7.8 | ✅ |
| 51 | Cache viewer / clear cache button | P | 3 | 9 | 5.4 | ⬜ |
| 52 | Local TTML/LRC files | P | 4 | 5 | 4.4 | ⬜ (declined for now) |

## Now playing & controls

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 53 | Play / pause / next / previous | P | 10 | 9 | 9.6 | ✅ |
| 54 | Seek (tap bar) | P | 8 | 9 | 8.4 | ✅ |
| 55 | Long-press scrub with time bubble | P | 6 | 7 | 6.4 | ✅ |
| 56 | Volume slider | P | 7 | 9 | 7.8 | ✅ |
| 57 | Shuffle + repeat (off/all/one) | P+E | 8 | 8 | 8.0 | ✅ |
| 58 | Smart-shuffle badge (Wave Player) | P+E | 3 | 7 | 4.6 | ⬜ |
| 59 | Like / unlike | P+E | 8 | 8 | 8.0 | ✅ |
| 60 | Like as a cover badge | P | 5 | 9 | 6.6 | ✅ |
| 61 | Double-tap to like, with burst animation | P | 6 | 8 | 6.8 | ✅ |
| 62 | Swipe to skip | P | 7 | 8 | 7.4 | ✅ |
| 63 | Marquee for long titles / artists | P | 7 | 8 | 7.4 | ✅ |
| 64 | Album + year line | P+E | 5 | 7 | 5.8 | ✅ |
| 65 | Audio quality badge (incl. 24-bit) | P+E | 5 | 8 | 6.2 | ✅ |
| 66 | Up next chip | P | 6 | 8 | 6.8 | ✅ |
| 67 | Smooth compositor-driven progress bar | P | 8 | 8 | 8.0 | ✅ |
| 68 | Elapsed / total times | P | 6 | 9 | 7.2 | ✅ |
| 69 | Device picker (Spotify Connect) | P | 6 | 5 | 5.6 | ⬜ |
| 70 | Speed / crossfade info | P | 2 | 6 | 3.6 | ⬜ |
| 71 | Sleep timer | P | 5 | 8 | 6.2 | ⬜ |
| 72 | Hardware volume keys control Spotify | P | 5 | 7 | 5.8 | ⬜ |
| 73 | Media notification / lock-screen controls | P | 3 | 5 | 3.8 | ⬜ |
| 74 | Podcast episode support (chapters, no lyrics) | P+E | 4 | 5 | 4.4 | 🟡 |
| 75 | Ads shown as "Advertisement" | E | 4 | 9 | 6.0 | ✅ |

## Lists & library

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 76 | Queue (now playing + next up), tap to play | P+E | 8 | 6 | 7.2 | ✅ |
| 77 | Recently played | P+E | 7 | 7 | 7.0 | ✅ |
| 78 | Friends' listening activity (desktop) | P+E | 7 | 6 | 6.6 | ✅ |
| 79 | Library: playlists + Liked Songs + albums, tap to play | P+E | 8 | 6 | 7.2 | ✅ |
| 80 | Browse a playlist's tracks | P+E | 6 | 5 | 5.6 | ⬜ |
| 81 | Search Spotify from the phone | P | 6 | 5 | 5.6 | ⬜ |
| 82 | Add to queue from lists | P+E | 5 | 7 | 5.8 | ⬜ |
| 83 | Remove / reorder queue | P+E | 3 | 4 | 3.4 | ⬜ |
| 84 | Artist page (top tracks) | P | 4 | 5 | 4.4 | ⬜ |
| 85 | Lyrics of queued songs preloaded | P+E | 7 | 7 | 7.0 | 🟡 (next song) |

## Layouts & look

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 86 | 7 layouts incl. Player card (Wave Player style) | P | 9 | 6 | 7.8 | ✅ |
| 87 | Swap cover / lyrics sides | P | 5 | 9 | 6.6 | ✅ |
| 88 | All four orientations; portrait layouts | P | 8 | 6 | 7.2 | ✅ |
| 89 | Notch + rounded-corner awareness | P | 8 | 6 | 7.2 | ✅ |
| 90 | Accent colour from the cover | P | 7 | 8 | 7.4 | ✅ |
| 91 | Glass controls, spring animations | P | 6 | 7 | 6.4 | ✅ |
| 92 | Compact mini-player layout (Wave compact 460×80) | P | 5 | 7 | 5.8 | 🟡 (Now Bar) |
| 93 | Vinyl record mode (ivLyrics) | P | 4 | 6 | 4.8 | ⬜ |
| 94 | Song-info ticker (ivLyrics) | P | 3 | 7 | 4.6 | ⬜ |
| 95 | Custom accent colour picker | P | 4 | 8 | 5.6 | ⬜ |
| 96 | Light theme | P | 2 | 5 | 3.2 | ⬜ |
| 97 | Cover corner radius option | P | 3 | 9 | 5.4 | ⬜ |
| 98 | Cover shadow/glow option | P | 3 | 9 | 5.4 | ⬜ |
| 99 | Grain/noise overlay option | P | 3 | 8 | 5.0 | ⬜ |
| 100 | Next/previous animation choices (7) | P | 6 | 8 | 6.8 | ✅ |

## Backgrounds

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 101 | Dynamic warped cover (Kawarp) | P | 9 | 6 | 7.8 | ✅ |
| 102 | Artist image background | P+E | 6 | 6 | 6.0 | ✅ |
| 103 | Blurred cover / gradient / black | P | 7 | 9 | 7.8 | ✅ |
| 104 | Move with the music (vocal energy) | P | 5 | 7 | 5.8 | ✅ |
| 105 | Background resolution / blur passes / fps (15–165, match display) | P | 7 | 8 | 7.4 | ✅ |
| 106 | Colour intensity, crossfade, warp, speed, dim | P | 6 | 9 | 7.2 | ✅ |
| 107 | YouTube music video background (ivLyrics) | P | 7 | 3 | 5.4 | ✅ |
| 108 | Spotify Canvas (looping video) background | P+E | 7 | 4 | 5.8 | ⬜ |
| 109 | Solid custom colour background (ivLyrics) | P | 3 | 9 | 5.4 | ⬜ |
| 110 | Blur-gradient from album colours (ivLyrics) | P | 4 | 8 | 5.6 | 🟡 (gradient) |
| 111 | Minimal background (no effect) | P | 3 | 10 | 5.8 | ✅ (Black) |
| 112 | Background drift animation for still cover | P | 4 | 8 | 5.6 | ⬜ |

## Screen & device

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 113 | Clock screen when paused / idle | P | 6 | 7 | 6.4 | ✅ |
| 114 | Night mode (schedule, dim, warmth) | P | 6 | 7 | 6.4 | ✅ |
| 115 | Burn-in protection | P | 6 | 8 | 6.8 | ✅ |
| 116 | Keep awake: always / while playing / system | P | 7 | 7 | 7.0 | ✅ |
| 117 | Battery indicator | P | 4 | 8 | 5.6 | ✅ |
| 118 | Brightness control in app | P | 5 | 7 | 5.8 | ⬜ |
| 119 | Auto-brightness by time | P | 4 | 7 | 5.2 | 🟡 (night dim) |
| 120 | Weather on the clock screen | P | 3 | 5 | 3.8 | ⬜ |
| 121 | Screen-off when phone face down | P | 2 | 5 | 3.2 | ⬜ |
| 122 | Kiosk mode (boot, full screen, silent updates) | P | 9 | 5 | 7.4 | ✅ |
| 123 | Leave kiosk from the phone | P | 7 | 7 | 7.0 | ✅ |
| 124 | Home screen only in kiosk | P | 6 | 7 | 6.4 | ✅ |
| 125 | Status notices (toasts) | P | 6 | 9 | 7.2 | ✅ |

## Connection

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 126 | Direct Wi-Fi link (WebRTC) | P+E | 10 | 4 | 7.6 | ✅ |
| 127 | Encrypted setup via ntfy relay | P+E | 8 | 5 | 6.8 | ✅ |
| 128 | Pairing code | P+E | 9 | 7 | 8.2 | ✅ |
| 129 | Pair automatically by Spotify account | P+E | 7 | 4 | 5.8 | ✅ |
| 130 | USB-tethering path + "Connection path" setting | P+E | 6 | 6 | 6.0 | 🟡 (built; cable-only test pending) |
| 131 | Link path + latency shown in Settings | P | 5 | 8 | 6.2 | ✅ |
| 132 | Standalone mode (Spotify Web API) | P | 9 | 5 | 7.4 | ✅ |
| 133 | Auto source switching | P | 8 | 6 | 7.2 | ✅ |
| 134 | Several phones paired to one PC | P+E | 6 | 4 | 5.2 | ⬜ |
| 135 | Self-hosted signalling option (no ntfy) | E+H | 4 | 4 | 4.0 | ⬜ |
| 136 | TURN relay for remote (away from home) | E | 3 | 3 | 3.0 | ⬜ |
| 137 | Reconnect backoff + status history | P+E | 5 | 8 | 6.2 | 🟡 |
| 138 | Developer adb link | I | 5 | 6 | 5.4 | ✅ |

## Settings

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 139 | Everything configurable (80 settings) | P+E | 9 | 6 | 7.8 | ✅ |
| 140 | Help ⓘ on every setting | P+E | 7 | 8 | 7.4 | ✅ |
| 141 | Live preview (phone: side sheet; Spotify: preview card) | P+E | 8 | 6 | 7.2 | ✅ |
| 142 | Built-in presets + your own | P+E | 7 | 7 | 7.0 | ✅ |
| 143 | Shipped default config file | I | 6 | 9 | 7.2 | ✅ |
| 144 | Settings search | P+E | 6 | 7 | 6.4 | ⬜ |
| 145 | Import / export settings (JSON) | P+E | 5 | 8 | 6.2 | ⬜ |
| 146 | Reset a single group | P | 3 | 8 | 5.0 | ⬜ |
| 147 | Sliders apply live, no scroll jump (Spotify panel) | E | 8 | 8 | 8.0 | ✅ |
| 148 | Settings synced desktop ↔ phone | P+E | 8 | 6 | 7.2 | ✅ |
| 149 | Keyboard shortcuts in Spotify (toggle lyrics dock etc.) | E | 4 | 7 | 5.2 | ⬜ |
| 150 | Per-device settings profiles (multi-phone) | P+E | 4 | 4 | 4.0 | ⬜ |

## Updates & install

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 151 | Extension auto-update (loader + jsDelivr) | E | 9 | 6 | 7.8 | ✅ |
| 152 | Check for updates button (Spotify + phone) | P+E | 7 | 9 | 7.8 | ✅ |
| 153 | Update popup with release notes | E | 6 | 8 | 6.8 | ✅ |
| 154 | Phone self-update (silent in kiosk) | P | 9 | 5 | 7.4 | ✅ |
| 155 | One-line installer with steps | I | 8 | 7 | 7.6 | ✅ |
| 156 | lyricdock-updater:// protocol | I | 5 | 7 | 5.8 | ✅ |
| 157 | One-time phone setup script (temporary adb) | I | 7 | 6 | 6.6 | ✅ |
| 158 | Release script | I | 7 | 8 | 7.4 | ✅ |
| 159 | Changelog page in app | P | 3 | 7 | 4.6 | ⬜ |
| 160 | Beta channel | I | 3 | 6 | 4.2 | ⬜ |
| 161 | Rollback to previous version | E | 3 | 6 | 4.2 | ⬜ |
| 162 | Signed release APK (own key, not debug) | I | 6 | 7 | 6.4 | ⬜ |

## Helper app (Windows)

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 163 | Redesign on Ethernet Guardian's Tauri UI | H | 7 | 5 | 6.2 | ✅ |
| 164 | Dashboard: Spotify extension, phone link, versions | H | 7 | 6 | 6.6 | ✅ |
| 165 | Install / repair / update extension | H | 7 | 7 | 7.0 | ✅ |
| 166 | Phone setup wizard (kiosk) | H | 6 | 5 | 5.6 | ⬜ |
| 167 | Tray icon with status | H | 6 | 6 | 6.0 | ✅ |
| 168 | Start with Windows | H | 5 | 8 | 6.2 | ✅ |
| 169 | History / log view | H | 4 | 7 | 5.2 | ⬜ |
| 170 | Developer tools page (adb link, live screen) | H | 5 | 6 | 5.4 | ✅ |
| 171 | Local signalling server (no ntfy) | H | 4 | 4 | 4.0 | ⬜ |
| 172 | Notifications (update available, phone offline) | H | 4 | 7 | 5.2 | ⬜ |

## Extension (Spotify side)

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 173 | Native top-bar button with status dot | E | 7 | 8 | 7.4 | ✅ |
| 174 | Settings panel with preview | E | 8 | 6 | 7.2 | ✅ |
| 175 | Connection notifications | E | 5 | 9 | 6.6 | ✅ |
| 176 | Worker timer (works minimised) | E | 8 | 7 | 7.6 | ✅ |
| 177 | Pop-out lyrics window on the PC (PiP, Wave Player) | E | 6 | 4 | 5.2 | ⬜ (declined for now) |
| 178 | Right-click "Send to dock" / "Open lyrics on phone" | E | 3 | 7 | 4.6 | ⬜ |
| 179 | Diagnostics page (last errors, link log) | E | 5 | 7 | 5.8 | 🟡 |
| 180 | Split bridge into modules (<500 lines each) | E | 5 | 6 | 5.4 | ⬜ |

## Quality, performance, accessibility

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 181 | 60 fps on a Snapdragon 439 (bg res, overlay fixes) | P | 9 | 5 | 7.4 | ✅ |
| 182 | No hidden backdrop-filter work | P | 7 | 8 | 7.4 | ✅ |
| 183 | Performance HUD (fps, CPU) debug option | P | 3 | 7 | 4.6 | ⬜ |
| 184 | Automatic "Smooth" suggestion on slow devices | P | 5 | 6 | 5.4 | ⬜ |
| 185 | Reduced-motion mode | P | 4 | 8 | 5.6 | 🟡 (animation speed) |
| 186 | Large touch targets / accessibility labels | P | 5 | 7 | 5.8 | 🟡 |
| 187 | Unit tests for romanizer | I | 5 | 8 | 6.2 | ✅ |
| 188 | Tests for lyrics normaliser + timing | I | 5 | 7 | 5.8 | ⬜ |
| 189 | CI build of the APK on GitHub Actions | I | 5 | 6 | 5.4 | ⬜ |
| 190 | Crash / error reporting to the desktop panel | P+E | 5 | 7 | 5.8 | 🟡 (diag) |

## Docs & privacy

| # | Feature | Where | Value | Ease | Score | Status |
|---|---|---|---|---|---|---|
| 191 | README with every mode, key guide, troubleshooting | I | 9 | 7 | 8.2 | ✅ |
| 192 | Generated settings reference | I | 7 | 8 | 7.4 | ✅ |
| 193 | Privacy section | I | 7 | 9 | 7.8 | ✅ |
| 194 | Screenshots / GIFs in README | I | 6 | 7 | 6.4 | ⬜ |
| 195 | Website / landing page | I | 4 | 5 | 4.4 | ⬜ |
| 196 | Localisation of the app UI | P+E | 4 | 4 | 4.0 | ⬜ |
| 197 | In-app "What's new" after update | P | 4 | 8 | 5.6 | ⬜ |
| 198 | FAQ inside the helper app | H | 3 | 8 | 5.0 | ⬜ |
| 199 | Contribution guide | I | 3 | 9 | 5.4 | ⬜ |
| 200 | Security review of relay + keys | I | 7 | 6 | 6.6 | 🟡 |

**Count:** ✅ 116 · 🟡 14 · ⬜ 70 (as of v1.3.0).
