# LyricDock — how the lyrics, animation and screen work (v1.7 work, measured on the Galaxy M01)

Companion to [spicy-lyrics-internals.md](spicy-lyrics-internals.md). Files: `extension/dock-bridge.js` (Spotify side) and
`android/app/src/main/assets/{lyrics,anim,app,features,settings,flipclock,api,spotify,roman}.js`, `style.css`, `index.html`.
Runtime: one Android WebView page. Reference device: **Galaxy M01 (SM-M015G, Snapdragon 439-class msm8937, 60 Hz, 720×1520, DPR 2)**, WebView
**Chrome 99** — so no `scale`/`translate` properties, no `:has()`, no container queries, no `linear()` easing. Sizes are `vmin` so one stylesheet
serves all four orientations (landscape 760×360 CSS px, portrait 360×760).

---

## 1. Where lyrics come from

```
Spotify desktop (Spicetify, dock-bridge.js)                          Phone
  Spicy Lyrics' own cache  (Cache Storage "SpicyLyrics_LyricsStore_g1")  ──►  {type:'track', lyrics:{spicy: raw}}   → Lyrics.fromSpicy
  fallback: Spotify color-lyrics (line)  → LRCLIB search (synced/plain) ──►  {type:'track', lyrics:{kind,lines,…}}
  upgradeFromSpicy: polls the Spicy cache for 60 s; word-synced lyrics replace the fallback when they land
  preloadNext: next track's cover + cached lyrics · beat(): position/play/liked/quality/volume/shuffle/repeat every ~500 ms
  extras: artist image, album + year, Canvas URL, audio analysis (tempo + loudness per 0.5 s)
Spotify account source (spotify.js, Web API polled 1 s / 3 s paused) → same messages; lyrics from the Spicy API (user's sl_pk_ key) or LRCLIB
```
Ranking word 3 > line 2 > static 1 > none 0; `offerLyrics` only replaces what is on screen with something better, and fades just the list in
(opacity only — the pane may still be running the song-change animation and the list's transform belongs to the scroll spring).

**Normalized shape** (`Lyrics.fromSpicy`): `{ kind, lines, writers, source, contributors }`; word lines `{ t, e, opp, w:[{s,r,t,e,p}], bg:[…] }`
(ms; `s` text, `r` romanization, `p` joined to the next syllable). Background groups are flattened into one `bg` list per line.
**Romanization** at build time: `smart` (Devanagari stays), `always`, `off`; the provider's romanization wins, else our Indic/Urdu transliterator.

## 2. DOM (`Lyrics.build`)

```
#lyrics  [data-block="Lyrics pane"]  mask fades top/bottom; margin clears the status corner
 └ #lines  (translate3d from the scroll spring; .duet when any line is sung by the second voice)
    ├ .ln [.opp .rtl .indic .lk] [.on | .sung | .cool] [.past] [.far] data-d="0..3"
    │   ├ .main → .sy | .wg > .sy.pw/.pn… | .wg.lw > .sy.lt…      (.pw joined to next, .pn joined to previous, .lt letter)
    │   └ .bgv → the same, background vocals at .55 em italic
    ├ .ln.dots > [.cd] .dotGroup > .dt ×3          interludes (gap ≥ dotsGap, default 4 s); 3·2·1 in the intro
    ├ .ln.skel ×3 / .ln.empty                       loading / no lyrics
    └ .credits > .writers, .provider, contributor links
```
Every `.sy` carries `data-t` (its own text) for the glow copy. Letters of a held word share `[start, end − 250 ms]` (Spicy).

## 3. The clock (`app.js pos()/now()`)

`pos()` is a **predicted clock**: it advances with `performance.now()` and is pulled toward each measured position with a frame-rate-independent
low-pass (τ = 300 ms); a difference above 500 ms (seek, new song) snaps; paused / just resumed / new song trust the measurement. `now() = pos() +
offset` drives the lyrics; `pos()` alone drives the progress bar and times (the sync offset no longer moves the bar). After a seek, beats still
carrying the old position are ignored for 1.2 s.

## 4. Animation (per frame: `Lyrics.update(p, dt)` → `anim.js`)

* States: `ns` / `on` / `sung` from each line's window. A line that just finished keeps animating for **1.2 s** (`.cool`) so the glow and lift of
  its last words spring back instead of being cut; a seek that lands inside a line starts its words at rest.
* **Springs and curves are Spicy's** (closed-form spring; word scale .88/.64, lift 1.45/.40, glow 1.18/.56; letters use scale peak 1.175 and
  double lift; dots and dot group as in Spicy).
* **Writes** (`paint()`): `--gp` (sweep −20 → 100 %), one combined `transform: translate3d(0, y em, 0) scale(s)` (works on Chrome 99, where the
  separate `scale` property is ignored), `--go` (glow 0..1). Values are **quantized** (1/800 em, 1/1000 scale, 1/50 glow), so a settled spring stops
  writing — the underdamped lift otherwise wiggles sub-pixel for seconds and re-composites every word every frame.
* **Letters**: the group finds the sung letter once per frame; others follow with `1/(1+d^2.8)` (lift, scale) and `1/(1+.9 d)` (glow); the active
  letter's sweep eases with a sine.
* **Line-synced** lines pulse a glow and lift to 1.03 while sung.

## 5. How a word is painted (`style.css`)

One paint path in every state: `.sy` is a gradient clipped to its text — `rgba(--cs, --a1)` up to `--gp`, then `rgba(--cu, --a0)`. Brightness
stays continuous: a not-sung line shows white at `--lop` (.5) × 1; on activation the line jumps to opacity 1 in the same instant the unsung words
drop to `--lop + .1` (so .5 → .6, no flash); sung words go to .92; a finished line fades back to ≈ .49. Idle pose `translate3d(0,.01em,0)
scale(.95)` is in the CSS, so activation never snaps words. Split-word pieces scale toward each other (`transform-origin` right on `.pw`, left on
`.pn`) so "ima-gi-na-tion" never opens gaps.
**Glow** is a transparent copy of the word (`.sy::after { content: attr(data-t) }`) carrying a *fixed* text-shadow; only its `opacity` animates,
on the compositor. Words of the sung line and the next are promoted to layers ahead of time (`will-change`), so lift and glow never repaint the line.
Upcoming lines are crisp and translucent (distance blur is off by default). "Darken behind the lyrics" is a soft wash on the pane, not a text shadow
(a shadow under translucent letters shows through as a smear).

## 6. Scrolling

`#lines` is moved by a **critically damped spring** (Smooth f 1.05 / d 1, Springy 1.5 / .62, Snappy 2.4 / 1, × animation speed): it keeps its
velocity when the target changes, moves in sub-pixels and sleeps when settled. Anchor = last line with `t ≤ p + scrollLead` (250 ms); a jump over
1.5 s snaps. **Free scroll**: a vertical drag claims the touch (see §8), flicks with inertia, and glides back after `scrollBack` s.

## 7. Layouts, blocks and chrome

9 layouts (Default, Player card, Lyrics only, Compact, TV, Cinema, Now Bar, Cover + clock, Flip clock) — names and every block in
[layout-map.md](layout-map.md); `data-block` on each element; Settings → Layout → *Show block names* draws them on the phone.
* **Timeline** (`#tl`, default): slim bar + times under the cover (Default, TV, Cover + clock), compositor-only fill (one linear transition to the
  song's end), thickens under the finger; tap seeks, a sideways drag scrubs (seek on release), a vertical finger is a scroll, not a seek. Moves with
  the cover via `transform` when the controls open. Other layouts use the edge bar (tap to seek while the controls show, press-and-hold to scrub).
* **Quick bar** (`#qs`) left of the gear with per-layout actions (swap cover side, romanization, next layout; card colour / seconds / 12-24 h on the
  clock layouts) and a **Quick settings** sheet of the settings that matter in that layout (full width in portrait).
* **Status corner** (`#stat`): battery in 5 styles (% inside the icon, beside it, ring, thin bar, % only; green charging, red < 20 %) and time of day
  in 3 styles, any corner; the lyrics pane keeps clear of it.
* **Tags** (`#tags`): the lyrics source only, bottom-right, with the controls or always — never in Now playing, never on the cover.
* **Lossless** (no text): waveform beside the song length (default), waveform in the status corner, accent glow around the cover, or a small light
  in the cover's corner.

## 8. Touch: one touch = one gesture (`Gesture` in lyrics.js)

Every handler asks before acting; the first to **claim** a touch owns it: `lyrics` (vertical drag), `skip` (clearly sideways, |dx| > 16 and
> 1.6 |dy|), `cover` (cover drag), `timeline`, `scrub` (edge-bar hold), `layout` (four fingers). A **tap** is an unclaimed, unmoved (≤ 10 px),
one-finger touch under 450 ms. Only taps show the controls, seek a tapped line (−300 ms for Spotify's fade-in) or count toward double-tap-like
(which never fires on lyric lines or the cover). `touch-action: manipulation` stops the WebView swallowing quick double taps as zoom.
Verified with `scripts/gesture-test.mjs` (11 cases, real touches on the phone).

## 9. Notch, corners and orientation

Android reports the cutout's safe insets and the corner radii (`MainActivity.onApplyWindowInsets`, CSS px, re-sent on every rotation):
`--sa-l/t/r/b` and `--bar-*`. The notch is **always** respected — top in portrait, left or right in landscape; *Manual* edge mode only adds side
padding on top of it. Fixed elements (gear, quick bar, status, tags, edge bar, toasts, sheets) all offset by these. Orientation: auto (all four),
landscape (both), portrait (both). Checked with `scripts/screen-audit.mjs` in both orientations.

## 10. Flip clock (`flipclock.js`)

Four full-card layers per digit clipped at the hinge; flaps animate `rotateX` (eased variants, gravity simulation, roll, fade), airport-board entry
and exit, synthesized clack sounds, haptics. Card art baked from Figma for dark and light themes. **Shading follows each flap's own card**: black
cards sink toward black as they turn (0.65 falling / 0.85 landing), paper cards dim only slightly in a warm tone (0.26 / 0.34) — a black shade on
light cards looked like a dark card flipping over. During a colour change the falling flap keeps the old theme's shade, the landing one the new.
Verified frame by frame with `scripts/flip-frames.mjs`.

## 11. Performance (measured, demo song, same 8 s passage)

| Moment | before this work | now |
|---|---|---|
| Busy singing | ~66 % frames > 20 ms | ~15 % |
| Controls opening | 60 / 120 slow | 7 / 120 (glass blur off) |
| Quick settings sheet | 107 / 120 slow | 0 / 120 |
Causes found: animated text-shadow glow (now an opacity-only layer), un-promoted word transforms, sub-pixel spring writes (quantized), live
`backdrop-filter` over the moving background (Performance → Glass blur), `top` animations (now `transform`), background at 60 fps (30 is
indistinguishable here). The pane's fade mask still costs some frames while many words move; it stays for the look.

## 12. Dev tools (not shipped)

`scripts/deploy.ps1` build + install · `cdp.mjs` eval/screenshot · `fps.mjs` frame-time probe · `demo-phone.mjs` play the invented demo song
("Midnight Signal": duet, background vocals, split words, held notes, Hindi/Punjabi) on the phone without touching settings · `gesture-test.mjs` ·
`screen-audit.mjs` (every layout × state, overlap/clipping report + real screenshots) · `contact-sheet.ps1` · `flip-frames.mjs`.
