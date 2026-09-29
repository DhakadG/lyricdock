# LyricDock — layout map and block names

One vocabulary for the design file (Figma "Dumpyard" → page *LyricDock · Design File*), this document, and the phone.
On the phone: **Settings → Layout → Show block names** draws a dashed outline and the name on every block below (`data-block` attributes in `index.html`).

## The 9 layouts (Settings → Layout → Layout)
| Name | id | Blocks it shows | Progress bar |
|---|---|---|---|
| **Default** | `split` | Cover column (Cover, Timeline, Now playing) + Lyrics pane; controls over the cover | Timeline under the cover |
| **Player card** | `player` | Cover column as a mini player (thumb + Now playing, Deck timeline, Control pill) + Lyrics pane | Deck timeline |
| **Lyrics only** | `lyrics` | Lyrics pane full width | Edge progress bar |
| **Compact** | `compact` | small Cover + Now playing on top, Lyrics pane below | Edge progress bar |
| **TV view** | `tv` | like Default, bigger cover and type | Timeline under the cover |
| **Cinema** | `cinema` | huge centred Lyrics pane + Now-playing badge (bottom-left) | Edge progress bar |
| **Now Bar** | `nowbar` | Lyrics pane + floating Now Bar pill (round spinning cover + title) | Edge progress bar |
| **Cover + clock** | `clocksplit` | Cover column + Clock pane (flip clock HH:MM) | Timeline under the cover |
| **Flip clock** | `clock` | Clock screen only (tap = seconds, double tap = back) | none |

Landscape reference size 760 × 360 CSS px (Galaxy M01); all sizes are `vmin`, so portrait uses the same blocks stacked (cover on top, lyrics below).

## Blocks (top to bottom, left to right in Default)
| Block | Element | What it is |
|---|---|---|
| **Screen** | `#wrap` | the whole page inside the safe insets |
| **Cover column** | `#left` | left column: cover, timeline, now playing |
| **Cover** / **Cover art** | `#artbox` / `#art` | the album art |
| **Like button** | `#heart` | heart badge on the cover, or beside the title |
| **Timeline** | `#tl` | slim seek bar + elapsed / total, under the cover; drag to scrub |
| **Now playing** | `#meta` | **Title row** (Title + like), **Artist**, **Album line** — song information only |
| **Tags** | `#tags` | quiet text: lyrics source, bottom-right corner (with the controls, or always) |
| **Lossless indicator** | `#qw` | four breathing accent bars beside the song length (or in the status corner); only for Lossless streams |
| **Control pill** | `#ctl` | shuffle · prev · play/pause · next · repeat · volume · list buttons; over the cover on tap |
| **Deck** / **Deck timeline** | `#deck` `#deckbar` | Player card's always-visible player |
| **Lyrics pane** | `#lyrics` (+ `#lines`) | the lines, interludes, credits |
| **Edge progress bar** / **Edge times** | `#bar` `#times` | thin bar on the screen edge (layouts without a cover) |
| **Quick bar** | `#qs` | one-tap actions left of the gear (tap the screen to show) |
| **Quick settings** | `#qpanel` | per-layout compact settings sheet |
| **Settings button** | `#gear` | opens the full Settings |
| **Status cluster** / **Time** / **Battery** | `#stat` `#tnow` `#batt` | battery (5 styles) + time of day (3 styles), 4 corners |
| **Up-next chip** | `#nextChip` | bottom-right in the last seconds of a song |
| **Clock pane** / **Clock screen** | `#clockPane` `#clockScreen` | flip clock beside the cover / full screen |
| **List panel** | `#listPanel` | queue, recent, library, search, friends |
| **Toast** | `#toast` | short notices |
| **Link status** | `#dot` | "Reconnecting…" |

## Quick bar per layout
Default / TV: ⇄ swap cover side · Aa romanization · ▯ next layout · ⚙ quick settings.
Player card / Lyrics only / Compact / Cinema / Now Bar: Aa · ▯ · ⚙.
Cover + clock: ⇄ · ◐ card colour · ss seconds · ▯ · ⚙. Flip clock: ◐ · ss · 12/24 · ▯ · ⚙.

## Quick settings contents (the ⚙ sheet)
Lyric layouts: Romanization, Text size, Alignment, Weight, Line spacing, Other lines brightness, Blur distant lines, Glow, Lyrics scroll (+ Cover side / Progress bar in Default & TV; Time of day, Battery, Battery style, Corner in the cover-less layouts; Spinning cover in Now Bar).
Clock layouts: Card colour, Seconds, Time format, Arrangement, Flip animation, Coming in and going out, Show the cards, Size, Digit gaps, Dim, Flip sound, Sound volume, Vibrate on flip (+ Cover side in Cover + clock).
