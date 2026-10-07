# Spicy Lyrics — how its lyrics animation, rendering and layout actually work

Source studied: `github.com/Spikerko/spicy-lyrics` at commit `c22a9d7` (26 Sep 2026), every file under `src/utils/Lyrics`, `src/utils/Scrolling`,
`src/css/Lyrics`, `src/css/ContentBox.css`, `src/components/Utils/NowBar.ts`, `src/components/Pages/PageView.ts`, `src/components/DynamicBG`,
`src/modules/Spring.ts`, `src/utils/Gets/GetProgress.ts`, `src/utils/API/CircuitBreaker.ts`, `src/utils/Lyrics/LyricsQueueRetry.ts`,
`src/components/Utils/{NPVLyrics,PopupLyrics,Fullscreen,CompactMode}.ts`, `src/utils/{stores,uiState,experiments}.ts`. Spicy Lyrics is AGPL-3.0; this document paraphrases behaviour and quotes constants,
it does not copy code. File paths below are relative to that repo's `src/`.

Reading order: 1 Pipeline → 2 Data model → 3 DOM → 4 Timing/clock → 5 Animator → 6 CSS painting → 7 Scrolling → 8 Virtualizer → 9 Chrome (now bar,
timeline, controls) → 10 Views → 11 Background → 12 Settings → 13 Performance tricks → 14 Small details worth knowing →
15 Apply ordering and notices → 16 Resilience (queue retry, circuit breaker) → 17 View ownership (page / NPV card / PiP / fullscreen) →
18 Text hygiene (zero-width, RTL, display text) → 19 Scrolling mechanics details → 20 Persistence → 21 What Spicy assumes about the browser (and why it matters on a phone).

---

## 1. Pipeline: from "track changed" to pixels

```
Spotify track change
  → fetchLyrics(uri)                         utils/Lyrics/fetchLyrics.ts
      guards: DJ, video/mixed media, episode, local file  → notice text, no fetch
      1. saved payload in $currentLyricsData (same uri)   → present at once
      2. LocalLyricsManager.get(uri)  (user-uploaded TTML, "Lyrics DB")
      3. LyricsStore.GetItem(trackId) (Cache Storage "SpicyLyrics_LyricsStore_g1", expires after 3 days;
                                       value "NO_LYRICS" = looked, nothing found)
      4. offline check → "offline" notice
      5. Query([{operation:"lyrics", variables:{id, auth}}]) with the Spotify access token as a bearer,
         probe:true so it may pass an open circuit breaker; a 401 retries ONCE with a fresh token
      status 200 → SLObjPack.unpack → ProcessLyrics → stamp uri → cache → present
      status 404 → "lyrics-not-found"   429 → "rate-limited"   503 → "lyrics-queued" (LyricsQueueRetry: keeps polling with backoff,
      survives closing the page)   thrown ServiceUnavailableError → "service-unavailable" (circuit breaker open)
  → ApplyLyrics (Global/Applyer.ts) picks the applyer by lyrics Type: Syllable | Line | Static
  → Applyer builds DOM + LyricsObject.Types[Type].Lines[]  (the animator's model)
  → initLyricsVirtualizer(scrollEl, virtualContainer, lineElements)
  → a permanent requestAnimationFrame loop (lyrics.ts LyricsInterval) calls TimeSetter + Animate every frame
```

**Stale-fetch protection.** `inFlightUri` de-duplicates a second request for the same track; `latestRequestedUri` (never cleared) lets a slow fetch
that finished *after* a newer one notice it lost the race, so the previous song's lyrics (or its "no lyrics" notice) are never painted over the
current one. `isStaleFetch(uri)` is checked before every present/cache-stamp.

**Cache rules.** Every completed request is cached even if the user already skipped (the next play is a hit). API terms require refetch/discard
within 30 days; Spicy uses 3.

**ProcessLyrics** (`ProcessLyrics.ts`): strips empty lines/syllables (`EmptyLines.ts`), detects the language with `franc`, detects which scripts are
actually present (kana→Japanese else Han→Chinese, Hangul, Cyrillic {2,}, Greek), loads only the needed romanizers (Kuroshiro for Japanese,
pinyin, aromanize for Korean, cyrillic-romanization, GreekRomanization), romanizes per syllable and per line, **never overwriting a
transliteration the API/TTML already shipped**, and sets `HasTransliterations` (which adds the `Lyrics_RomanizationAvailable` class so the
romanization toggle button appears). Background-vocal syllables are romanized too but do not feed language detection.

## 2. Data model

Three payload types (`Type`):

| Type | Meaning | Line object |
|---|---|---|
| `Syllable` | word/syllable timed (Apple "Word" timing) | `{ Type:'Vocal', OppositeAligned, Lead:{Syllables[],StartTime,EndTime}, Background?:[{Syllables[],StartTime,EndTime}] }` |
| `Line` | one time per line | `{ Text, StartTime, EndTime, OppositeAligned, TransliteratedText?, TranslatedText? }` |
| `Static` | unsynced | `{ Text, TransliteratedText? }` |

Syllable: `{ Text, TransliteratedText?, IsPartOfWord, StartTime, EndTime }` (times in seconds, converted to ms by `ConvertTime`).
Root extras: `SongWriters[]`, `source` (`spt` Spotify / `spl` Spicy / `aml` Apple Music), `HasTransliterations`, `HasTranslations`, `Language`,
`classes`/`styles` (server-supplied styling for the content container), `UploadAttribution` (community syncs).

### TTML parser (`ttml/parser.ts`, used for Local DB uploads and community data)
* `fast-xml-parser`; `itunes:timing` = `None`→Static, `Word`→Syllable, `Line`→Line; missing → inferred from structure.
* **Agents** (`ttm:agent` in `<head>`): id `v1` = main singer (left); `v2` and `v2000` = `OppositeAligned` (right). Each `<p>` looks up its agent
  (p → div → body). This is how duets get their sides. Groups/`other` agents are not treated specially.
* **Background vocals**: `<span ttm:role="x-bg">` wrapper inside a `<p>`; parentheses are stripped from their text; several backgrounds per line
  are allowed; the lead line's `StartTime/EndTime` is widened to cover any background that starts before / ends after it.
* **Sub-words (`IsPartOfWord`)**: a syllable joins the next one when (a) its closing tag is *immediately* followed by another tag in the raw XML
  (`createAdjacencyScanner` reads the raw string because the XML parser discards whitespace between tags), (b) the next node is a vocal span,
  (c) the next text does not start with whitespace, (d) the current text does not end with a comma or whitespace. This is what lets "for-ev-er" render
  as one word with three timed pieces.
* **x-roman / x-translation** spans (line- or bg-level) and `iTunesMetadata` `<transliterations>` keyed by `itunes:key` fill
  `TransliteratedText` / `TranslatedText`; timings are matched with a 2 ms epsilon.
* `itunes:songPart="Instrumental"` divs are skipped (Outro is skipped for Static only); empty `<p>` become nothing; a line-timed `<p>` inside a word-timed
  document becomes one syllable; `songwriters` are read from `iTunesMetadata`.
* Time formats: clock `hh:mm:ss.fff`, offsets, plain numbers; a 4th component (SMPTE frames) is dropped rather than guessed.

## 3. DOM Spicy builds (per Type)

```
.LyricsContent  (size container, mask, scroll element via SimpleBar)
 └ .SpicyLyricsScrollContainer[data-lyrics-type="Syllable|Line|Static"].HasDuetLines.HasRtlLines
    ├ .VirtualLyricsContainer                      height = virtualizer total size
    │   └ wrapper[data-index]  (position:absolute; translateY(start); padding-bottom = gap)   ← added/removed by the virtualizer
    │       └ .line
    │          ├ .OppositeAligned  .rtl  .bg-line  .musical-line  .static   (modifiers)
    │          ├ .word-group   (wraps consecutive IsPartOfWord syllables so they stay together / never break mid-word)
    │          │   └ .word.PartOfWord  .LastWordInLine  .bg-word
    │          ├ .letterGroup  (a word that qualifies for emphasis; a div, display:inline-flex)
    │          │   └ .letter.Emphasis  (.SpaceLetter  .LastLetterInWord)
    │          └ .dotGroup > .word.dot ×3   (musical-line only)
    ├ .SongInfo / .Credits (songwriters) / .LyricsProvider / community attribution   (appended inside the scroll container)
    └ spacer (half the viewport, appended after the container)
```

Musical (interlude) lines are real lines in the array: one before the first line when `data.StartTime >= getLyricsBetweenShow()` and one after every
line whose gap to the next start is `>= getLyricsBetweenShow()`. `getLyricsBetweenShow()` = **3 s** normally, **5 s** in Minimal Lyrics Mode.
Each has three dots that own a third of the gap each. Dot end times are shifted by `getInterludeTimePadding()` = −(500+50) = **−550 ms**, so
the third dot fills up 550 ms before the next line starts and the dots vanish just before singing resumes.

Background vocal lines are **separate `.line.bg-line` elements** placed after their lead line (own StartTime/EndTime, `BGLine:true`), not children of the lead.

Minimal Lyrics Mode extends a line's EndTime to the next line's StartTime when the gap is shorter than the interlude threshold (so lines don't blink out
during short breaths).

### Emphasis (letters)
A syllable becomes a **letter group** when `IsLetterCapable(letterCount, duration)`: normal mode = **duration ≥ 1000 ms** (no length cap);
Simple mode = ≤ 12 letters and ≥ 1050 ms. RTL/Arabic-script text is excluded. `Emphasize()` splits the text into characters and gives each an equal slice of
`[StartTime, EndTime − 250ms]` (Simple mode: `+21 / −40 ms`), so the last letter has finished before the syllable does. A whitespace letter gets `.SpaceLetter`
(`white-space:pre; min-width:.3ch`) because whitespace in an inline-block collapses to 0 px and glues multi-word syllables together. Arabic-script words get
`font="Vazirmatn"`.

### Idle pose (set at build time, not on first animation frame)
Every word/letter is created with inline `scale: 0.95` and `transform: translateY(0.01 × size)` (letters `0.02`), `--text-shadow-opacity:0%`,
`--text-shadow-blur-radius:4px`, `--gradient-position:-20%`. This is important: it means a word already sits at its spring's resting value **before** its line
becomes active, so activation never snaps it from 1.0 to 0.95.

## 4. Timing: the lyric clock (`utils/Gets/GetProgress.ts`)

Lyrics never read `Spicetify.Player.getProgress()` directly. A poll loop (`requestPositionSync`, every 1/60 s for local playback) calls
`PlayerAPI._contextPlayer.getPositionState()` (audio-side truth) and keeps `{StartedSyncAt, Position}`. Highlights:

* **Round-trip midpoint**: the sample time is `startedAt + (Date.now() − startedAt)/2` (NTP-style), not the request time.
* **Anchor hold**: on clients where `getPositionState` only updates on state changes, the anchor is held from when a value *first* appeared so the clock
  extrapolates through the gap instead of mirroring a stalled source. Re-anchoring on track change / seek / pause is forced.
* **Two sources with hysteresis**: if `getPositionState` stalls >500 ms while playing the clock switches to the timestamped player state; it only
  switches back after 3 consecutive fresh samples (so a source that twitches once in a while doesn't step the clock).
* Non-local playback (Spotify Connect to another device): uses `positionAsOfTimestamp + (now − timestamp)`, with a few fast resume-syncs at 50/100/150/750 ms.
* **Output offset**: `+100 ms` (`PROGRESS_POSITION_OFFSET`) is added while playing to compensate audio-output latency; `−$playbackOffset` is the user's lyric offset.
* **Jitter filter** (`normalizeProgress`): a *predicted* clock advances with wall-clock time and is pulled toward the measured value with a
  frame-rate-independent low-pass `alpha = 1 − exp(−elapsed / 300 ms)`. A difference > **500 ms** is a real jump (seek/track change) and snaps. It never adds
  lag, it just spreads sample noise. Reset on first read, track change, and while paused.
* Track-change guard: until the first poll for the new track lands, the previous track's sample is not used.

## 5. The animator (`utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts`)

Runs **every animation frame** for the mounted lines only (`el.isConnected`), driven by `deltaTime` in seconds. It is a pure function of playback position; it
holds no timers. `TimeSetter` first stamps each line `Status` (NotSung/Active/Sung) — that field is only read by the scroller. Words and letters are
animated straight from their own times.

### Spring (`modules/Spring.ts`, a port of Fraktality's `spr`)
Analytic (closed-form) critically-, under- and over-damped solutions, not numerical integration, so it is stable at any `dt`. `f` in Hz, `d` damping ratio.
`SetGoal(g, snap)`; `Step(dt)`; `CanSleep()` when |velocity|² < 1e-4 and |offset|² < (1/3840)².

### Curves (natural cubic splines, `cubic-spline` package; x = progress 0…1 through the word)
| Curve | Points (progress → value) |
|---|---|
| Word scale | 0→0.95, 0.7→1.0505, 1→1 |
| Word Y offset (× font size) | 0→+0.01, 0.9→−1/60, 1→0 |
| Glow | 0→0, 0.15→1, 0.6→1, 1→0 |
| Letter scale | 0→0.95, 0.7→1.175, 1→1 |
| Letter Y offset (× font size, then ×2 when written) | 0→+0.01, 0.9→−1/56, 1→0 |
| Line glow (line-synced) | 0→0, 0.5→1, 1→0 |
| Dot scale | 0→0.75, 0.7→1.05, 1→1 |
| Dot Y offset | 0→0, 0.9→−0.12, 1→0 |
| Dot glow | 0→0, 0.6→1, 1→1 |
| Dot opacity | 0→0.35, 0.6→1, 1→1 (Simple mode: 0.27) |

### Spring constants (frequency Hz / damping ratio)
| Property | f | d |
|---|---|---|
| Word/letter Scale | 0.88 | 0.64 |
| Word/letter Y offset | 1.45 | 0.40 |
| Word/letter Glow | 1.18 | 0.56 |
| Dot Scale / Y / Glow / Opacity | 0.7 / 1.25 / 1.0 / 1.0 | 0.6 / 0.4 / 0.5 / 0.5 |
| Line glow | 1.0 | 0.5 |
| (unused dot-group) | scale 5 / y 1.25 | 0.7 / 0.4 |

**The trick:** the *goal* comes from the curve at the current progress, and the *value written to the DOM* is the spring's output. That is why a word eases
into its lift instead of tracking the linear curve, and why it overshoots and settles after its end.

### Per-word write (Syllable type)
For each word of an **Active** line: state from time → progress `p`. Targets: `scale = Scale(p)`, `y = YOffset(p)`, `glow = Glow(p)`.
`gradientPos = −20 + 120·p` (Active), `−20` (NotSung), `100` (Sung). Written: `scale`, `transform: translate3d(0, calc(size·y), 0)`,
`--gradient-position`, `--text-shadow-blur-radius = 4 + 2·glow` px, `--text-shadow-opacity = min(35·glow, 100)`%.

A **Sung line keeps being stepped** (with its Sung targets) *as long as the next line is still NotSung or Active* (`checkNextLine`). That is what lets a
word's glow and lift spring back to rest instead of freezing mid-decay when the line flips to Sung.

### Letters (emphasis) — proximity model
Inside an Active letter-group, find the letter whose own time window contains "now" (`activeLetterIndex`) and its progress. For every letter `k`:
```
distance   = |k − active|
falloff    = 1 / (1 + distance^2.8)        // steep: only the active letter pops
glowFall   = 1 / (1 + 0.9·distance)        // glow spreads wider
target     = rest + (curveAtActiveProgress − rest) · falloff     (scale, yOffset)
glow       = rest + (glowAtActive − rest) · glowFall
NotSung letters → rest.   Sung letters in a word with no active letter → glow = Glow(0.2)
gradient   = k == active ? −20 + 120·easeSinOut(letterProgress) : −20 (unsung) / 100 (sung)
```
Written per letter: `scale`, `translate3d(0, size·y·2, 0)`, `--gradient-position`, `--text-shadow-blur-radius = 4 + 12·glow`px,
`--text-shadow-opacity = glow · 185`%.

### Dots
Each of the three dots has its own four springs (scale, y, glow, opacity) chasing the dot curves above. Line visibility itself is CSS: the dot group is
`scale:0` unless the musical line is `.Active` and not `.pre-hidden` (added when `position > EndTime − 500 ms`); `.pre-hidden`/inactive uses a
`linear()` easing with overshoot (`0.4s linear(0,-0.006 9.4%,… -0.189 55.9% … 1)`) so the dots shrink with an anticipation dip. A far more elaborate
"dot-group" spring (pulsing 0.95↔1.05 every 2.25 s, pop to 1.15 in the last 75 ms) exists in the source but is commented out ("still undone").

### Line-synced type
No per-word data, so the active **line** gets a horizontal-ish gradient fill by percentage (`--gradient-position = pct·100`) plus a glow spring
(`4 + 8·g` px, `50·g`%). CSS scales an Active line to `1.05` (except in fullscreen minimal mode).

### Blur of distant lines (no `filter`)
On every change of the active line (`Blurring_LastLine !== index`) `applyBlur` writes `--BlurAmount` on every mounted line:
`blur = min(1.25 × distanceInLines, max)`, `max = 1.25·5 + 1.25·0.465 ≈ 6.83 px`; Active lines and distance 0 get `0px`. Inactive lines are drawn as a
`text-shadow: 0 0 var(--BlurAmount) color` of their own (text fill is transparent), so blurring costs a shadow, not an offscreen filter layer.
`.HideLineBlur` (added while the user scrolls) forces `--BlurAmount:0`. The cache is reset (`Blurring_LastLine=null`) whenever the virtualizer mounts a new line
so freshly-mounted lines get correct values.

### Write batching
`setStyleIfChanged(el, prop, value, epsilon)` compares against the last written number (`scale` 0.001, `transform` 0.0001, glow radius 0.5, glow opacity 1),
queues the write in a `Map`, and `flushStyleBatch()` applies **all** writes once at the end of the frame. `classList` writes go through `setClass` (checks
`contains` first, because even a no-op `classList.toggle` queues a MutationObserver record). `promoteToGPU` sets `will-change: transform, opacity, text-shadow, scale`
once per element; lines that are not connected are skipped entirely (writing to detached nodes only inflates the queue).

### Simple Lyrics Mode (a lighter renderer)
Skips the springs for scale/glow, keeps only a Y spring on words, and drives the sweep either by a computed `--SLM_GradientPosition` ("calculate") or by
CSS keyframes `SLM_Animation {−27.5% → 100%}` with a `Pre_SLM_GradientAnimation {−50% → −27.5%}` pre-roll started `0.6·duration − 22 ms` (word) /
`0.845·duration − 130 ms` (letter group) into the previous word ("animate"). `--SLM_GradientPosition` is a registered `@property <percentage>` so it can be
animated. It also lowers idle alpha (`--Vocal-NotSung-opacity .45`, sung `.35`) and uses a 33.5 ms clock lead.

## 6. CSS: how a line is *painted* (`css/Lyrics/Mixed.css`, `main.css`)

The core idea: **every line/word/letter has `-webkit-text-fill-color: transparent; background-clip: text`** — the visible glyph is either a gradient
background (active) or a `text-shadow` copy (inactive). There is never a swap between "solid text" and "gradient text", so nothing pops when a line activates.

| State | Text visible through | Line `opacity` | Notes |
|---|---|---|---|
| `.NotSung` | `text-shadow: 0 0 var(--BlurAmount) rgba(255,255,255,var(--gradient-alpha-end = .35))` | `--Vocal-NotSung-opacity: .51` | `--gradient-position:-20% !important`, scale `--DefaultLineScale:1` |
| `.Active` | `background-image: linear-gradient(90deg, rgba(255,255,255,α=.85) var(--gp), rgba(255,255,255,.35) calc(var(--gp) + 20% + var(--gradient-offset)))` + glow text-shadow | `1` (transition `.2s cubic-bezier(.61,1,.88,1)`) | Syllable-type lines: the *line* paints nothing, each *word* paints its own gradient (a gradient clipped to the parent would paint the same glyphs twice while words move) |
| `.Sung` | `text-shadow: 0 0 var(--BlurAmount) rgba(255,255,255,var(--gradient-alpha = .85))` | `--Vocal-Sung-opacity: .497` | `--gradient-position:100% !important` |
| `.static` | full gradient, `--gradient-alpha/-end: 1` | 1 | cursor default |
| `.bg-line` | alpha `.6 / .3`, size `× .75`, weight 600 | — | own line box, margin `-1cqw 0 1cqw`, "SpicyLyrics" font when enabled |
| `.musical-line` | dots | 0 when inactive; `height:0; line-height:0; overflow:hidden; margin/padding:0` | `.Active` restores `height:auto`; the virtualizer's MutationObserver re-measures |

Brightness maths worth remembering: NotSung effective brightness ≈ .35 × .51 = **0.18**; the *unsung words of the active line* = .35 × 1 = **0.35**; sung words in the
active line = **.85**; a Sung line = .85 × .497 ≈ **0.42**. The active line therefore "lights up" from .18 → .35 with the line's `opacity` transition, then each word
brightens .35 → .85 as it is sung, and the finished line falls back to .42.

Hover/tap: `.line::before` is a translucent white rounded box (`backdrop-filter: blur(2px)`, `border-radius:16px`) that scales `.9 → 1.05` on hover with a `linear()` spring
easing; disabled by the `NoLineHoverBackground` page class (setting *Line Hover Background*).

Typography and geometry
* `--DefaultLyricsSize: clamp(1.85rem, 7cqw, 3.5rem)` (the lyrics box is a **size container**, `cqw` = 1 % of its width). Popup: `clamp(1.7rem, 5.5cqw, 2.6rem)`;
  Static: `clamp(.8rem, 5cqw, 2.5rem)`. Weight **700** everywhere (bg lines 600, Static 500). `line-height: 1.1818`, `letter-spacing: 0`.
* Line spacing: `--SpicyLyrics-LineSpacing: 1cqw 0`; under the virtualizer margins are cleared and the gap is `padding-bottom` (1 cqw; **0.2 cqw** between a line and its bg-line).
* Side padding: `padding-right: 5cqw` on every line; with duets (`HasDuetLines`) lines get an inset of `5cqw`, or **`15cqw`** with the *Duet Line Padding* experiment (default on)
  on the side they lean away from: `.OppositeAligned` gets `padding-left`, others `padding-right`; RTL flips it.
* Top/bottom fade: `mask-image: linear-gradient(180deg, transparent 0, transparent 16px, solid calc(64px + --SL-LyricsContent_MaskTopPadding) … solid calc(100% − 64px), transparent calc(100% − 16px))`;
  the top padding animates to +32 px while the mouse is over the view controls (registered `@property <length>`, `.5s`).
* Word joining: `.word:not(.PartOfWord,.dot,.LastWordInLine)::after {content:""; margin-right:.32ch}` — the inter-word space is a margin, not a text space, so wrapping
  `.word-group`s (`white-space:nowrap`) never split inside a word. Duet lines use `column-gap:.32ch` and `justify-content:flex-end`.
* Transform origins: `.word`/`.letterGroup` centre; `.PartOfWord` **right** (so a growing first half doesn't crash into the second), the word *after* a `.PartOfWord` **left**; RTL mirrors. Lines: left (right for
  `.OppositeAligned`/`.rtl`).
* RTL: `direction:rtl`, gradient `−90deg`, extra vertical padding with equal negative margin (so Arabic marks above/below the box are not clipped by `background-clip:text`).
* Vertical safety: words in RTL and letters get padding + equal negative margin so `background-clip:text` doesn't cut ascenders/descenders.
* Fonts: optional bundled "SpicyLyrics" display font (`UseSpicyFont`, off with *skip Spicy font*), used for bg lines and interlude dots.
* Credits block: `.Credits` `clamp(.8rem, 3.7cqw, max(.47em, 1rem))`, opacity .6; `.LyricsProvider` `clamp(.7rem, 3cqw, max(.34em,.875rem))`, opacity .5; `.SongInfo` for community
  uploader/maker with avatars. All are *inside* the scroll container, after the last line — not floating chips.

## 7. Scrolling (`utils/Scrolling/ScrollToActiveLine.ts`)

Called every frame from the position ticker. Key rules:

1. **Which line owns the anchor** (`GetScrollLine`): collect active lines; map background lines to their lead (`ResolveToLeadIndex`); drop a bg line's tail if a
   later group is already active; the *highest* active line keeps the anchor as long as it (and its bg lines) end before the line **`PIN_LOOKAHEAD = 2`** real
   lines further starts; otherwise contiguous/near-contiguous → first active, wide gap → last active. Prevents the list jumping back up when an overlapping
   duet/echo line starts while another still rings out.
2. **Early scroll**: `position + scrollLeadMs` (default 250, off by default) chooses the *target* only; line states still follow the real clock.
3. **Force scroll** (instant, no animation) when: a queued force (resize, open now bar, focus), no last line, paused with a changed position (seeking while paused),
   or a **drastic position change > 1000 ms**. All-Sung → last line; all-NotSung or one active with none sung → smooth scroll to top once (`scrolledToFirstLine`); all sung → once to bottom.
4. **User scroll**: wheel/touchmove sets `isUserScrolling`, adds `.HideLineBlur`, stamps time. Auto-scroll resumes when **750 ms** have passed *and* the active line is in view (with the
   virtualizer, "mounted" = in view); then the class is removed.
5. **Alignment**: `Center` (`padding +30`) normally, `Top` in compact mode (`−85`, `−50` in the popup). A line following a dot line waits **240 ms** for the dots to collapse
   unless smooth scrolling is on (then it scrolls at once, the rows glide together).
6. Re-runs `ResetLastLine()` on window focus/resize and when `.LyricsContent` resizes (ResizeObserver).

## 8. The virtualizer (`utils/Lyrics/LyricsVirtualizer.ts`, TanStack Virtual)

Why: hundreds of lines with per-word DOM is heavy; only ~viewport + 5 lines (`overscan: 5`) exist in the DOM.
* Each line lives in a **positioning wrapper** (`position:absolute; translateY(start); will-change:transform; padding-bottom: gap`). The `.line` inside can therefore use `scale`
  around its own centre without composing with the translate.
* Estimated sizes: default 66 px, bg-line 50, inactive musical-line 0, active musical-line 66; real sizes from `offsetHeight` via `ResizeObserver` + a `MutationObserver` on `class`
  (gap changes when a line becomes Active/`musical-line`), batched so measuring costs one layout.
* Self-heal every **250 ms** (`_selfHealCheck`): stale viewport rect after minimise/occlusion, width drift, height drift, per-wrapper measurement drift.
* A permanent **bottom spacer of half the viewport** lets the last line reach the centre without inflating the container.
* **Layout glide**: when *Smooth Scrolling* is on and a mounted row's position changes (interlude collapsing/opening), the wrapper animates `transform .5s cubic-bezier(.22,1,.36,1)`;
  disabled for `1500 ms` after init and `800 ms` after resize/instant jumps/user scroll intent, and never applied to rows being mounted.
* **`scrollToIndex`**: computes `containerOffset + item.start − (viewport − item.size)/2 + padding`, writes `scrollTop`, then retries each frame (max 30) until the target is mounted, its
  position stopped drifting and the browser is no longer clamping (first scroll after a mid-song open relies on estimates).
* **Smooth scroll = a critically damped spring** (`f=1 Hz, d=1`, ~0.8 s to settle, never overshoots). The spring persists so a re-target mid-flight *keeps its velocity* — back-to-back line
  changes read as one glide. Each frame re-reads the target row from TanStack's cache (rows mounting above shift it), uses geometry cached at re-target time (no per-frame layout reads),
  clamps `dt` to 50 ms, and **splits the value into whole pixels (real `scrollTop`) + a sub-pixel remainder applied as `translate` on the virtual container** so the last part of the ease does not
  tick one pixel at a time. It settles at `< 0.25 px` and `< 0.05 px/frame`, re-aims up to 3 times if the browser clamped it elsewhere, and cancels on any user gesture.
* Disabling Smooth Scrolling mid-glide hands the move to the normal path so the line still lands.

## 9. Chrome around the lyrics

### Page structure (`components/Pages/PageView.ts`)
```
#SpicyLyricsPage.SpicyRenderer[.CardMode][.Fullscreen][.CompactMode][.ForcedCompactMode][.NowBarStatus__Open|Closed][.MinimalLyricsMode][.SimpleLyricsMode]…
 └ .ContentBox                      (dynamic background is attached here)
    ├ .NowBar  (left or right, slides in with left .4s)
    │   └ .CenteredView > .Header
    │        ├ .MediaBox   (square, 100cqw)  .MediaContent (overlay: playback controls, heart, volume capsule, view controls in fullscreen)
    │        │              .MediaImageContainer (two stacked .ImageBox for cross-fade: .fi_FromImage / .ti_ToImage)
    │        ├ .Timeline  (only here when "Timeline Outside Media Box" is on)
    │        └ .Metadata > .SongName + .Artists   (marquee if overflow, masked edges)
    ├ .LyricsContainer > .loaderContainer | .LyricsSkeleton | .LyricsContent
    └ .ViewControls   (top or bottom row of buttons)
```
The now bar's width is a token (`--NowBarWidth`); with the bar open the lyrics get extra left padding
(`--LyricsLeftSidePadding: calc(calc(50cqw − --NowBarRightSpacing·.3)·.9)`), so the text column stays clear of the media box.

### The NowBar side swap
`NowBarSideToggle` (a view control, only shown while the now bar is open, hidden in popup) calls `NowBar_SwapSides()`; the choice is persisted in `$nowBarSide`
(`Session_NowBar_SetSide` restores it). `.NowBar.LeftSide.Active { left: var(--NowBarLeftSpacing) }`, `.RightSide.Active { left: calc(100% − width − spacing) }`, inactive positions are pushed
off-screen by `--unactive-spacing` (`transition: left .4s`). Compact mode forces Left. The lyrics' side padding follows the side (`NowBarSide__Left/Right` classes).

### View controls (top or bottom row; `$viewControlsPosition`)
Cinema view · Compact-mode toggle (in fullscreen only) · **Romanization toggle** (only when `Lyrics_RomanizationAvailable`) · Now bar toggle · **Now bar side swap** · Fullscreen ⇄ close-fullscreen ·
Lyrics Manager (TTML maker mode) · Settings · Close. Tooltips via Spicetify's Tippy. `NoLyrics` hides most.

### Timeline (progress bar) — three placements
* `.Timeline` **inside `.MediaContent`** (absolute, bottom, padding `5cqw 7cqw`): the bar sits over the bottom of the artwork — used in compact mode, popup, or when the setting is off.
* **Outside the media box** (`$timelineOutsideMediaContent`, default **on**): `.Header > .Timeline` between the artwork and the title — the layout most players use.
* Structure: `<span.Time.Position> <div.SliderBar style="--SliderProgress: 0..1"><div.Handle> <span.Time.Duration>`; `tabular-nums`, `min-width:5ch`.
* **Skin A (experiment "New SliderBar Styling", default on)**: frosted-glass capsule (`--material-regular-bg` + backdrop blur, inset highlights), fill is `::before` white with
  `transform: scaleX(var(--SliderProgress))`, `transform-origin:left`, `transition: transform .18s cubic-bezier(.23,1,.32,1)`; **thickens** on hover/drag (`2.2cqh → 3cqh`, spring
  cubic-bezier `.34,1.56,.64,1`); no handle; while dragging the fill transition is `none` so it tracks the pointer 1:1. **Skin B (legacy)**: accent gradient `--TraveledColor` / `--RemainingColor`
  by `calc(100% * --SliderProgress)`, plus a round handle.
* Interaction: click = seek (position from `getBoundingClientRect`), mousedown/touchstart = drag with document-level move/up listeners; while dragging the time label shows the *drag* position
  and the store emits `nowbar:timeline:dragging`; `SetControlsDragLock` keeps the artwork overlay visible; text selection disabled during drag; `SongProgressBar` class only formats times and maps
  clicks (`floor(pct × duration)`).
* The whole widget updates through `setText()` (edits the existing text node in place — Spicetify rescans computed style on every `childList` mutation and `textContent =` always replaces the node).

### Playback controls, heart, volume
Shuffle · Prev · Play/Pause · Next · Loop (context → track → off) with a `Pressed` class on mousedown/touchstart and named handlers cleaned by a `Maid`. Heart with `press02` /
`reverse_press02` keyframes (100/160 ms), state polled every 50 ms. Volume: vertical glass capsule at the artwork's right edge, icon flips ink/white once the fill clears it (`IconOnFill`,
`ICON_COVERED_LEVEL 0.09`), mute restores the previous level.

## 10. Views (which "layouts" exist)
| View | What changes |
|---|---|
| **Page** | Now bar (left/right) + lyrics; view controls top/bottom |
| **Compact mode** (auto in narrow pages, or forced) | Now bar forced left, smaller media box (`LockedMediaBox` optional), scroll alignment `Top`, timeline inside media |
| **Fullscreen / Cinema View** | Media box moved into fullscreen, playback controls + heart + volume overlay on the artwork, `Compactify` on resize; **Minimal Lyrics Mode** hides Sung lines and dims NotSung to .5 with scale .965 |
| **Popup (PiP) window** | Document Picture-in-Picture wrapper, smaller type, compact forced, no tooltips |
| **NPV card (`CardMode`)** | Lyrics injected into Spotify's Now Playing sidebar; transparent over Spotify's own background; open/close morph animations |

## 11. Background (`components/DynamicBG`)
`@kawarp/core` WebGL: `warpIntensity 1`, `blurPasses 8`, `animationSpeed .1`, `saturation 1.5`, `dithering .008`, `tintIntensity 0`, transition 500–1000 ms. Cover loading is progressive (full image gets
250 ms before a small preview is shown, then cross-fades). With Spotify audio analysis, `BackgroundAnimationController.getSpeedMultiplier` = `sectionTempo/120 × loudnessFactor` plus a beat pulse
`1.5·e^(−5·progressIntoBeat)·confidence` (only beats with confidence > .4), clamped 0.1…3. Alternatives: static colour / image (`$staticBackgroundMode`, blur), artist header image.

## 12. Settings that exist (`utils/stores.ts`, `experiments.ts`, `SettingsPanel/*`)
Lyrics Display: Simple Lyrics Mode (+ rendering "calculate/animate"), Minimal Lyrics Mode, Line Hover Background · Scrolling: Early Scroll (+ ms 0–800, default 250), Smooth Scrolling ·
Playback: playback (lyric) offset (bipolar ms), seek-fade compensation (−300 ms) · Interface: Lock Media Box, Popup allowed, View Controls Position, Timeline Outside Media Box, Volume Slider,
NPV lyrics options, hide Spotify's lyrics button · Background: static background mode/blur, dynamic bg · Appearance: skip Spicy font · Experiments: New SliderBar Styling, Duet Line Padding,
Lyrics Loading Skeleton (each toggles a page class so the cost is zero at runtime). Persisted in one JSON blob `SL:settings` in Spicetify LocalStorage.

## 13. Performance tricks catalogue (copy these ideas)
1. Text painted by gradient / text-shadow only — **no `filter: blur`** (no offscreen layers).
2. One write per property per frame, only when changed beyond an epsilon, all flushed together; detached nodes skipped.
3. `will-change` set once, on the elements that actually animate; virtualized DOM (only ~viewport+5 lines).
4. Layout reads are cached at re-target time; scroll spring reads no geometry per frame; `ResizeObserver` batched to one pass per frame.
5. `queueMicrotask` coalescing of virtualizer "change" notifications; remeasure once when a glide settles, not on every `scrollend`.
6. Skeleton uses only transform/opacity animations so it keeps moving while the main thread builds DOM.
7. `@property`-registered custom properties for animatable percentages/lengths.
8. Sub-pixel scroll via compositor `translate` instead of ticking whole pixels.

## 14. Small details that make it feel polished
* Active line opacity `transition .2s`, all line/word states are *the same paint path* → no pop.
* Words rest at scale .95 / y +.01 before their line starts; springs overshoot after the word ends.
* Sung lines keep stepping until the next line is done (glow decays instead of freezing).
* First/last line special scroll; instant jump for seeks, spring for normal changes; user scrolling suppresses blur and pauses auto-scroll for 0.75 s.
* Clicking a line seeks to its first word minus 300 ms (Spotify fades audio in after a seek; landing exactly on the start swallows the first syllable).
* Romanization is a per-view toggle; provider text is never hidden; community attribution shows avatars.
* Lyrics fetches are guarded against every "user already moved on" race.
* Marquee on title/artist only when overflowing, edges masked.
* Progress fill uses transform + `will-change`; the drag disables the fill transition; times use tabular numbers.

## 15. Apply ordering and notices (`utils/Lyrics/Global/Applyer.ts`)

`ApplyLyrics(result)` is the single entry that turns a fetch result into DOM. Its order matters:

1. **Drop stale results.** The result carries the uri it was fetched for; if the player has moved on, it does nothing (otherwise the previous
   song's lyrics, or worse its "no lyrics" notice, would be painted — and the `NO_LYRICS:<uri>` sentinel stamped on the *new* song, which would
   make every later fetch for that song short-circuit to "no lyrics").
2. **Take an apply token** (`++applyToken`). Anything that awaits re-checks the token afterwards; a newer apply wins.
3. **Skeleton first.** Building syllable DOM blocks the main thread for a while, so `PaintLyricsSkeleton()` shows the skeleton and waits two
   animation frames (or 100 ms, or nothing when the document is hidden — rAF never fires then) *before* building. The skeleton only animates
   transform/opacity, so the compositor keeps it moving while the main thread is busy. After the wait it re-checks token and uri.
4. Reset: blur cache (`setBlurringLastLine(null)`), abort controller for the previous notice's listeners, `EmitNotApplyed`, destroy containers
   (and the virtualizer), clear the lyrics arrays, SimpleBar and the page container, community credits.
5. Hide any loader an earlier fetch left up — except for the queued state, which keeps its loader on purpose.
6. **Notices.** A string descriptor becomes a `.LyricsNotice` (plain text + a footer link), with fixed copy per case:
   `lyrics-not-found`, `dj`, `unknown-track`, `unknown-error`, `offline`, `service-unavailable` ("temporarily unavailable — we'll keep trying"),
   `rate-limited`, `status-not-200`, `video-track`, `episode-track`, `mixed-track`, `local-track`; `lyrics-queued` shows the queue loader and
   renders nothing else. In fullscreen/cinema (not compact) a not-found or local-file notice hides the whole lyrics column instead.
7. Otherwise the typed applyer runs with the current romanization flag, then `HideLyricsSkeleton()` as a safety net.

## 16. Resilience

**Queue retry** (`LyricsQueueRetry.ts`): an envelope 503 means "your request is queued on our side". A module-scope controller (independent of the
page DOM, so closing the page, swapping views or toggling modes never resets it) re-fetches with backoff **2 s × 1.5ⁿ, capped at 10 s**.
Re-entering for the same uri keeps the schedule; a different uri or a song change cancels; a resolution from anywhere else (cache hit, upload)
stops it via `NotifyResolved`.

**Circuit breaker** (`API/CircuitBreaker.ts`): one breaker for every request. Only *transport* statuses count (403, 408, 425, 429, 5xx) — never the
per-query status inside the envelope, which is how the queue's 503-on-HTTP-200 keeps working. Two consecutive failures open it; the pause climbs a
jittered (0.5–1.5×) ladder of 30 s ×3, 60 s, 120 s ×8, then a sticky 300 s; the ladder decays after an hour of quiet; state is **persisted** (people
restart Spotify exactly when lyrics look broken, which would otherwise clear it); a persisted `openUntil` beyond 45 min is treated as corrupt;
`Retry-After` is honoured within that bound. While open, a user-initiated lyrics request may *probe* at most every 30 s, and a probe that never
settles is abandoned. Its purpose is stated in the code: when the API is refusing traffic, clients must get quieter, not louder.

## 17. View ownership

The lyrics pipeline is a singleton (`PageView.PageContainer`), so only one view may own it at a time: the **page** (route `/SpicyLyrics`), the
**Now Playing View card** (`NPVLyrics.ts`, a compact copy injected into Spotify's right sidebar with states `DORMANT → SHELL → ACTIVE`, reconciled
by one evaluator that is debounced and held while its open/close morph animation runs), the **popup** (`PopupLyrics.ts`, Document
Picture-in-Picture; `IsPIPOpening` marks the whole async setup so the card can't grab the page meanwhile, and the card is torn down directly
rather than via history navigation) and **fullscreen / cinema** (`Fullscreen.ts`, which moves the media box into a fullscreen overlay and runs
`Compactify` on resize). Compact mode (`CompactMode.ts`) forces the now bar to the left, can lock the media box size, and makes scrolling align
the active line near the top.

## 18. Text hygiene

* **Zero-width characters** (U+200B, U+200E, U+200F, U+2060, U+FEFF) are stripped at render time only (`StripZeroWidth`): each would otherwise
  become an empty letter span with its own slice of a held word's time. ZWJ/ZWNJ are kept (meaningful in Arabic, Persian, Indic and emoji).
  Cached/parsed text is never mutated.
* **RTL detection** (`isRtl`) looks at the *first strongly directional character*, skipping digits, spaces and punctuation, so "1, 2, 3 שלום" is
  RTL and "OK یہ" is LTR.
* **Display text** (`PickDisplayText`): the romanization when romanized view is on and one exists; else the original if it has visible text; else
  the romanization (TTML lines that carry only `x-roman`) — a line kept for having *some* text never renders blank.
* **Empty lines** (`EmptyLines.ts`) are pruned everywhere (payload, lead, background groups); a payload that prunes to nothing is a miss, not an
  empty card.
* **Provider label** (`ApplyProvider.ts`): `spt` Spotify · `aml` Apple Music · `spl` Spicy Lyrics · `ldb` Local DB (substring match), rendered as
  "Provided by: X" at the end of the lyrics; songwriters as "Written by: A, B".

## 19. Scrolling mechanics, the parts not covered above

* Two legacy helpers remain for the non-virtualized path: `ScrollIntoCenterView` (a hand-rolled rAF ease: slow start, faster middle, 3 %
  overshoot, settle) and `ScrollIntoCenterViewCSS` (set `scrollTop` and let `scroll-behavior: smooth` do it; `.InstantScroll` switches that off
  for 50 ms). Both use only container-relative metrics (`offsetTop`, `clientHeight`) to avoid layout thrash.
* SimpleBar owns the scroll element: native scrollbars are hidden (`scrollbar-width: none` + `::-webkit-scrollbar`), its own thin overlay bar
  can be hidden per view (`hide-scrollbar`).
* `ScrollToActiveLine` re-arms on window focus/resize and on `.LyricsContent` resize, so a layout change never leaves the list parked off the
  active line.

## 20. Persistence

Two JSON blobs in Spicetify's LocalStorage: `SL:settings` (every user setting, `persistAtom`, with key migrations for renamed settings) and
`SL:uiState` (UI state that isn't a setting: now bar open + side, forced compact mode, romanization on/off, NPV card open/expanded, last fetched
uri, version seen). Experiments persist as `experiment:<id>` inside the settings blob and each toggles a page class, so an experiment costs nothing
at runtime.

## 21. What Spicy assumes about the browser — and why it matters for a phone

Spicy runs inside Spotify desktop's current Chromium, so it freely uses: the individual `scale` / `translate` CSS properties (Chrome 104+),
`:has()` (105+), container queries and `cqw/cqh` units (105+), `linear()` easings (113+), `@property` (85+), `scrollend` (114+),
`AbortSignal.timeout`, Document Picture-in-Picture, and a desktop GPU. Its design choices — animated `text-shadow` glow on every sung word,
`backdrop-filter` glass everywhere, a `mask-image` fade over a moving list — are cheap there. On a phone WebView (LyricDock's Galaxy M01 runs
**Chrome 99** on an entry-level Adreno GPU) the same choices either silently don't apply (`scale`, `:has`, `linear()`) or cost whole frames
(animated shadows, live blur over a moving background). A faithful port has to keep Spicy's *look and timing* while swapping the mechanisms —
see archive/lyrics-gap-analysis.md §6 for what was measured and changed.
