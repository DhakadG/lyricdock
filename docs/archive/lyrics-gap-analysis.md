# Spicy Lyrics vs LyricDock — gap analysis and the polish plan

Companion to [spicy-lyrics-internals.md](../spicy-lyrics-internals.md) (what Spicy does) and [lyricdock-lyrics-internals.md](../lyricdock-lyrics-internals.md) (what we did before this pass).
Status column: ✅ done in this pass · 🟡 partly · ⬜ not done (reason given).

## 1. Why the lyrics "feel" less polished — root causes found in our code

These are the concrete reasons, ordered by how visible they are.

| # | Symptom you see | Root cause (file) | Spicy's approach | Status |
|---|---|---|---|---|
| 1 | **New active line: white → greyish → then glows** | `style.css` paints inactive lines as *solid white text* dimmed by the line's `opacity` (.5), and switches to *gradient text with .48 alpha* only under `.ln.on`. On activation the text swaps representation instantly while `opacity` eases .5→1 over .35 s, so effective brightness goes .5 → ≈.24 → .48: the line looks white, dips grey, then the sweep + glow start. | Every state is painted through the same gradient/`background-clip:text` path; only alpha variables and opacity change. Brightness is continuous (.18 → .35 → .85). | ✅ |
| 2 | **Whole line "shrinks" for a frame when it activates** | Words have no idle pose: they are scale 1 in the DOM but their spring starts at 0.95, so the first animated frame snaps every word 1.0 → 0.95. | Idle pose written at build time (scale .95, y +.01 em). | ✅ |
| 3 | **Glow / lift cut off when a line ends** | `Anim.rest()` on `on → sung` removes the inline properties immediately, even though the glow spring is still decaying. | A sung line keeps being stepped until the next line has finished. | ✅ |
| 4 | **Lift missing / uneven on the phone** | anim.js writes the CSS `scale` *property*; individual transform properties need Chrome 104+, the phone's WebView was reported as Chrome 99. | Spicy runs in modern Chromium. | ✅ (one combined `transform`) |
| 5 | **Scroll feels a little "stop-start" when lines change quickly** | Scrolling is a CSS transition on `#lines`; each new target restarts the easing from the current position with zero velocity. | Critically damped spring that keeps its velocity across re-targets. | ✅ |
| 6 | **Word sweep jumps slightly every half second** | `now()` is overwritten by every bridge beat: the clock steps by the transport jitter. | Predicted clock + frame-rate-independent low-pass (τ = 300 ms), snap only on jumps > 500 ms. | ✅ |
| 7 | **Progress bar shifts when you change Sync offset** | Lyric offset is baked into `now()`, which also feeds the progress bar and time labels. | Separate concerns. | ✅ |
| 8 | **Sung line drops abruptly** | `.ln.sung` = solid white (α 1) at opacity .485 vs the active line's sung words (α .92). | Same paint path, brightness continuous. | ✅ |
| 9 | **Long held words look like a wave, not one popping letter** | Letters each follow the *full* word curve independently, ×2.2; no proximity falloff; the last letter finishes exactly when the word does. | Only the active letter peaks; neighbours fall off as `1/(1+d^2.8)` (glow `1/(1+.9d)`); letters share `[start, end−250 ms]`. | ✅ |
| 10 | Duet lines are both full width | No inset on the side a voice leans away from. | 15 cqw inset (Duet Line Padding). | ✅ |
| 11 | Line-synced lyrics are a plain fade | No sweep/glow for line type. | Line-level glow spring + scale 1.05. | 🟡 glow pulse only |
| 12 | Tapping a line lands on the first syllable and swallows it | No seek compensation. | −300 ms. | ✅ |
| 13 | Background vocals always visible, flattened into one array, lead window not widened | Bridge/renderer simplification. | Separate `bg-line`s with their own timing, lead window widened. | 🟡 bg words keep rendering inside the line but follow the same paint path and dim/lift with the line; separate timing needs bridge work ⬜ |

## 2. Feature gap table (everything Spicy has that we don't, or that differs)

| Area | Spicy | LyricDock | Verdict / action |
|---|---|---|---|
| TTML parsing | full parser (agents, x-bg, x-roman, x-translation, itunes:key, songPart) | reuses Spicy's parsed cache via Spicetify | Fine on desktop; a *phone-only* TTML parser is only needed for Apple Music source (planned) |
| Translations (`x-translation`) | parsed | ignored | ⬜ roadmap #19 |
| Romanization scripts | ja, zh, ko, ru/…, el, + Indic via API | Indic + Urdu only | ⬜ needs bundled dictionaries (Kuroshiro ~17 MB) — roadmap #17/#18 |
| Multiple bg groups | yes | flattened | ⬜ |
| Virtualization | TanStack, ~viewport+5 lines | `.far` visibility trick, `renderDistance` | OK for phone lyric sizes; fine |
| Scroll spring | yes (f=1, d=1, sub-pixel) | CSS transition | ✅ ported (JS spring, sub-pixel via transform) |
| Early scroll | optional 250 ms | default 250 ms | ✅ same |
| Anchor pinning (PIN_LOOKAHEAD) | yes | last-started line | 🟡 kept simple; overlapping echo lines can pull the anchor forward early |
| User-scroll pauses auto-scroll 750 ms, hides blur | yes | drag → free mode, glides back after `scrollBack` s | Equivalent; ours is touch-first |
| Clock jitter filter, round-trip midpoint, dual source | yes | none | ✅ jitter filter; the rest is desktop-only |
| Lyric offset & output-latency offset | user offset + fixed +100 ms | user offset | ✅ separated from the bar |
| Letters/emphasis | proximity model | independent | ✅ |
| Skeleton loader | yes | 3 shimmer bars | OK |
| Line hover box | yes | none (touch device) | 🟡 pressed-state highlight |
| Timeline placement | under the media box (default) or over it | full-width edge bar | ✅ **now under the cover** |
| Now-bar side swap | view-control button | `artSide` setting inside the sheet only | ✅ **swap button + quick settings** |
| View controls always reachable | button row | gear only | ✅ **quick-settings pill per layout** |
| Provider text | at the end of the lyrics, low key | end credits + optional fixed grey chip top-left | ✅ credits keep it; the optional tag moved to the bottom-right corner, never in Now playing or on the cover |
| Quality / lossless tag | (none) | vertical pill on the cover edge | ✅ no text at all: a small breathing waveform beside the song length (default) — or in the status corner, an accent glow, or a cover light |
| Battery | (none) | one status-bar clone | ✅ 5 styles |
| Clock time overlay | (none) | only the clock screens | ✅ 4 styles, any layout |
| Volume capsule, heart, marquee, cover cross-fade | yes | yes (different look) | parity |
| Dynamic background | Kawarp + audio-analysis speed | Kawarp + audio analysis or vocal energy | parity |
| Popup / PiP, NPV card, fullscreen | yes | n/a (phone is the fullscreen) | n/a |

## 3. What we do that Spicy does not (keep it)
Word-synced lyrics on a phone with tap-to-seek, free scroll with inertia, 9 layouts incl. Flip clock/Cover+clock, swipe-to-skip with cover peek, night mode + burn-in, keep-awake/kiosk, WebRTC link,
Web-API source without a desktop, LRCLIB/Spotify fallbacks, presets, per-group reset, live-preview settings, letter mode toggles, countdown before the first line.

## 4. The plan that was executed

**A. Lyrics animation (lyrics.js, anim.js, style.css)** — every row marked ✅ above. Concretely:
1. All syllables are painted through one gradient path in *every* line state; per-state alpha is driven by CSS variables so `NotSung → Active → Sung` is continuous.
2. Idle pose written at build time via a combined `transform: translate3d(0,.01em,0) scale(.95)` (works without individual transform properties).
3. Cool-down: a just-sung line keeps being stepped for ~1 s (glow decays, lift settles) before `rest()`.
4. Letter groups: shared `[t, e − 250 ms]` window, active-letter proximity falloff (`1/(1+d^2.8)`, glow `1/(1+.9d)`), sine-out sweep on the active letter, Spicy letter curves (scale 1.175, y ×2, glow radius `4+12g`, opacity `×185 %`).
5. Scroll = critically damped spring (smooth f≈1 d=1, springy f≈1.3 d=.7, snappy f≈2.2 d=1), velocity preserved on re-target, written as a transform (sub-pixel), sleeps when settled.
6. Clock = predicted clock with low-pass smoothing; separate `pos()` (real position, drives the bar) and `now()` (= `pos() + offset`, drives lyrics).
7. Duet inset; tap-seek −300 ms; pressed-line highlight; line-synced glow pulse.

**B. Progress bar (app.js, features.js, style.css, index.html)** — new `#tl` **under the cover** in cover layouts (Default, TV, Cover+clock, and Compact/Player keep their own),
glass capsule, compositor-only fill, thickens on touch, drag-to-scrub with a live time readout, optimistic hold after a seek (no flicker back), tabular times, `Progress bar` setting gains **Under the cover**
(new default); the edge bar stays for Bottom/Top and for layouts with no cover; bottom space is freed (`fitArt()` no longer reserves the strip).

**C. Quick settings + side swap (features.js, settings.js, style.css)** — a glass pill next to the gear (visible with the controls): **⇄ swap cover side** where a cover side exists, **Aa romanization**,
**layout cycle**, and a **tune** button that opens a compact *Quick settings* sheet holding the 5–8 settings that matter for the layout you are in (for the clock layouts: card colour, seconds, 12/24 h,
arrangement, flip animation, sound, size, dim). The rows are the same components as the full sheet (live, shared state), so nothing is duplicated.

**D. Tags, battery, time** — Now playing holds song information only. The lyrics-source tag sits bottom-right (with the controls, or always, dimmed). Audio quality has no tag: Lossless shows as a small accent waveform beside the song length (alternatives: status corner, cover glow, cover light). Rejected on the way: a chip, a label over the bar, a tick-style bar, a rim around the cover.
New **status cluster** (`#stat`): battery styles *Icon + % outside*, *% inside the icon*, *Ring*, *Thin bar*, *% only*; time styles *Small*, *Pill*, *Big-light*, off; four corner positions; works in every layout.

**E. Naming** — [layout-map.md](../layout-map.md) names every layout and block; each block also carries a `data-block` attribute, and **Settings → Layout → Show block names** overlays the names on the phone.

**F. Figma** — the same names, wireframes, hi-fi screens (invented demo song with duet, background vocals, held notes, split words, Hindi/Punjabi/Urdu lines), components and settings screens.

## 5. Found on the real phone (second pass)

Everything below was measured or seen on the Galaxy M01 over DevTools, not in a desktop browser.

| Finding | Evidence | Fix |
|---|---|---|
| WebView is Chrome 99: the `scale` property is ignored | `CSS.supports('scale','1') === false` | one combined `transform` everywhere (words, dots) |
| Word glow halves the frame rate | busy singing 319/600 slow frames → 30/600 with glow off | glow = fixed-shadow copy, opacity-only on the compositor |
| Lift re-composites settled words | 156 → 66 slow frames with lift off | quantized spring output; words promoted ahead of activation |
| Live glass blur over the moving background | controls opening 60/120 slow | Performance → Glass blur (off on this phone): 7/120 |
| Quick sheet opening | 107/120 slow | no backdrop blur, own layer: 0/120 |
| Split words showed gaps ("ima gination") | real screenshot | transform-origin toward the joined piece |
| Controls popped up while scrolling; releasing a drag seeked; diagonal scroll could skip | code review + synthetic touches | gesture arbiter (one touch = one gesture), 11 checks pass |
| Quick double taps swallowed (WebView double-tap zoom) | synthetic double tap: no clicks | `touch-action: manipulation` |
| Manual edge mode ignored the notch | native insets t=29.5, CSS --sa-t 0 | notch always respected; manual only adds side padding |
| Battery over lyrics, tag over the cover, Cinema/Now Bar badge vs times, quick sheet a third wide in portrait | screen-audit, both orientations | fixed; audit clean except a 3 px heart touch in Now Bar |
| Flip clock light cards turned grey-black mid-flip | frame-by-frame capture | shading per card colour |
| Dark smear under all lyrics (text-shadow inherited by transparent-fill words) | live screenshot | "Darken behind the lyrics" became a soft wash behind the pane |
| Scrollbars flashing on every scrolling panel | user report | hidden app-wide |

Settings applied to this phone: background 30 fps, glass blur off, distance blur off (crisp translucent lines like Spotify's).

## 6. Known limits (honest list)
* Background-vocal timing per group and translations need the bridge to forward more of Spicy's parsed payload (not done).
* Spicy's virtualizer/glide layer is not ported; on a phone with `renderDistance` 20 it is unnecessary.
* The Chrome 99 statement comes from the project notes; if the WebView has since updated, item 4 is simply a harmless simplification.
* I could not run the animation on the physical phone in this pass; verification was done in the browser preview at 760×360 (see the test notes at the end of the change log).
