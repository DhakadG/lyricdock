# Widgets and lock-screen lyrics: scope and plan

Status: proposal (October 2026). Nothing here is built yet. Android ships first. The iOS sections only fix the
data shape now, so the iPhone version can reuse it later.

## 0. What exists today (checked in the code)

- `MainActivity` hosts the WebView. JS calls Java through `Dock.*` (`@JavascriptInterface`), and Java calls JS
  through `UiOp.JS` / `evaluateJavascript`. The page holds all of the now-playing state (`P` in `app.js`: `pos/at/playing/dur/id/art`).
- `features.js` `hardware()` runs every 1 s. When the track or play state changes it calls `Dock.media(title, artist, art, playing)`,
  which posts `MediaNotif` (MediaSession + MediaStyle notification, `VISIBILITY_PUBLIC`, prev / toggle / next).
- Button presses come back through `MediaReceiver` / `MediaCb` and then `MainActivity.mediaCmd()` (only toggle / next / prev pass).
- `UiOp.WAKE` calls `setShowWhenLocked(true)` and `setTurnScreenOn(true)` plus a 3 s wake lock, triggered by the Spotify hotkey. There is no
  persistent lock-screen mode.
- `lyrics.js` `update(p, dt)` works out the active line index `a` on every frame. The cover colours come from `colours(im)` / `accentFrom()` in `app.js`.
- Build: `scripts/build-apk.ps1` runs aapt2, then javac `-source 8` against **android-34.jar**, then d8, with min SDK 26 and target 34. There are no services and no
  AppWidget code. No inner or anonymous classes (d8 crashes on them), and no AndroidX.
- The app process lives only while `MainActivity` does. If the Activity dies, every update stops.

## 1. What the platforms allow (2026)

### Android
| Surface | Limits that matter | Source |
|---|---|---|
| Home-screen AppWidget | `updatePeriodMillis` is floored at 30 min. That only limits *system-driven* updates. An app process can call `AppWidgetManager.updateAppWidget` / `partiallyUpdateAppWidget` whenever it wants, but each call is a binder IPC that makes the launcher re-apply the views. A partial update merges into the last full one and is dropped if the host never got a full update. | [advanced widgets](https://developer.android.com/develop/ui/views/appwidgets/advanced), [AppWidgetProviderInfo](https://developer.android.com/reference/android/appwidget/AppWidgetProviderInfo) |
| RemoteViews | A fixed set of views (TextView, ImageView, ProgressBar, Chronometer, TextClock, Lin/Rel/FrameLayout, ...), no video or custom drawing. Bitmaps travel inside the parcel, which has a binder size cap, so the cover goes out once per track. API 31+ has responsive layouts (`RemoteViews(Map<SizeF,RemoteViews>)`), `targetCellWidth/Height` and dynamic colours. | same |
| Lock-screen widgets | Came back on Pixel **phones** in Android 16 QPR2 (tablets got them first). They are on by default for existing widgets, and `widgetCategory` can opt out. They only work on Pixel builds that have the hub. | [Android Authority](https://www.androidauthority.com/lock-screen-widgets-on-phones-android-16-qpr2-3589668/), [first look](https://www.androidauthority.com/lock-screen-widgets-on-phones-demo-3532896/) |
| Media notification | Already shipped. The lock-screen media card reads the MediaSession metadata (title / artist / art). Updating that metadata is cheap if the bitmap is reused. | `MediaNotif.java` |
| Live Updates (Android 16, promoted ongoing) | Standard / BigText / Call / Progress / Metric styles only. **MediaStyle and custom RemoteViews are excluded**, so are colorized and min-importance notifications. Needs `POST_PROMOTED_NOTIFICATIONS`, `setOngoing`, a title, and `EXTRA_REQUEST_PROMOTED_ONGOING`. Shows as a status-bar chip, at the top of the shade, on the lock screen and **on AOD**. Google's guidance excludes "ambient information", and music players are left out. The user can turn promotion off per app. | [Live Updates docs](https://developer.android.com/develop/ui/views/notifications/live-update), [Android Authority](https://www.androidauthority.com/android-16-live-updates-music-player-3573487/) |
| showWhenLocked Activity | `setShowWhenLocked(true)` draws the full app over the keyguard without unlocking. This is the only Android way to get real word-synced lyrics on a locked screen. It costs a lit screen. | `UiOp.java` |
| AOD | No third-party API. AOD shows notifications / Live Updates (Pixel) and the OEM's own media widget. Nothing else. | Live Updates docs |

Battery rule for real-time lyrics: push **only when the active line index changes** (about every 2 to 5 s while singing, nothing
during instrumentals), text only, as a partial update, and **nothing while the screen is off** (`PowerManager.isInteractive()`).
The position counts up by itself with `Chronometer` (`setChronometer(base, fmt, running)`). The clock uses `TextClock`. Neither one costs
any updates.

### iOS (for later)
| Surface | Limits | Source |
|---|---|---|
| WidgetKit (Home, StandBy, Lock-screen accessory) | A timeline reload budget of about 40 to 70 per day for a frequently viewed widget, so effectively every 15 to 60 min. Entries should be at least about 5 min apart. `reloadTimelines` from a foreground app is effectively not budgeted. No video, no network in the view. Self-updating views: `Text(date, style: .timer)` and `ProgressView(timerInterval:)`. | [WWDC21 10048](https://developer.apple.com/wwdc21/10048), [forum](https://developer.apple.com/forums/thread/654331), [budget write-up](https://dzionis.by/writing/widgetkit-timeline-budget.html) |
| Live Activities (Lock Screen, Dynamic Island, StandBy, Watch, CarPlay) | The ContentState and each push payload are **at most 4 KB**. Active for up to 8 h, then up to 4 h more on the lock screen. Updates come locally (`activity.update`) while the app runs, or through APNs `liveactivity` pushes. Pushes have an **hourly budget**, priority 5 does not count toward it, and `NSSupportsLiveActivitiesFrequentUpdates` raises the budget. The view has no network access, so images go through the bundle or an App Group. Push needs a paid developer account and an APNs key. | [ActivityKit](https://developer.apple.com/documentation/activitykit), [Braze guide](https://www.braze.com/docs/developer_guide/live_notifications/live_activities), [WWDC26 session 223](https://developer.apple.com/videos/play/wwdc2026/223/) |
| Dynamic Island | Compact leading/trailing, minimal, and expanded. Same ContentState as the lock-screen Live Activity. | same |
| StandBy | Shows systemSmall widgets two-up (widget budget applies) and Live Activities full-screen. It is the closest thing iOS has to the "dock". | [iOS 26 surfaces](https://blakecrosley.com/blog/ios-26-widget-and-control-surface) |

The key iOS fact: a non-audio app is **suspended within seconds** of going to the background. Its WebRTC link and JS clock stop, so local
updates stop too. Line-by-line lyrics with the app backgrounded only work with **remote pushes**, and about 1 push every 3 s will
blow the budget. Plan for best-effort lines (see section 3).

## 2. Widget designs

Shared options, set per widget through the configure activity or the app's Settings (stored by appWidgetId):
theme (accent from cover / dark / light / transparent), font size (S/M/L), show cover / progress / controls / next line,
and the tap action (open dock / toggle / open lock-screen mode). Video covers show as their **static poster frame**, because widgets can't play video.

**W1 Cover tile** (Android 2x2, iOS systemSmall + StandBy)
```
+-----------+
| [ cover ] |
|           |
| Title     |
| Artist  ▶ |
+-----------+
```
**W2 Now playing** (Android 4x2, iOS systemMedium)
```
+------------------------------------+
| [cov] Title - Artist          0:42 |
|       ♪ current lyric line here    |
|       |◀    ▶||    ▶|   ━━━━○──── |
+------------------------------------+
```
**W3 Lyrics** (Android 4x3/4x4, iOS systemLarge, only while the app runs; iOS shows a static excerpt)
```
+------------------------------------+
| Title - Artist              [cov]  |
|   previous line (dim)              |
|   CURRENT LINE (accent, bold)      |
|   next line (dim)                  |
|   next+1 (dimmer)                  |
|  |◀   ▶||   ▶|          ━━━━○──── |
+------------------------------------+
```
**W4 Clock + now playing** (Android 4x2, iOS systemMedium / StandBy)
```
+------------------------------------+
|  21:47            [cov] Title      |
|  Wed 1 Oct              Artist  ▶  |
+------------------------------------+
```
The clock is `TextClock`, so it costs no updates. On iOS it is `Text(.now, style: .time)`.

**W5 Lyric strip** (Android 4x1 / 5x1, iOS accessoryRectangular / accessoryInline)
```
+--------------------------------------------+
| ♪ current lyric line, ellipsized         ▶ |
+--------------------------------------------+
```
**W6 Lock screen / Live Activity** (Android: media card, optional Live-Update notification, W2/W5 on the QPR2 hub. iOS: Live Activity)
```
Lock screen                         Dynamic Island compact     expanded
+--------------------------------+  ( [cov]  ●  ♪ 0:42 )      +------------------------+
| [cov] Title - Artist     ▶||   |                             | [cov] Title     ▶||   |
| ♪ current line                 |                             | ♪ current line         |
| ━━━━━━━○───────── 1:12 / 3:40  |                             | ━━━━○────────          |
+--------------------------------+                             +------------------------+
```
Size map:

| Design | Android | iOS |
|---|---|---|
| W1 | 2x2 | systemSmall, StandBy |
| W2 | 4x2 (responsive down to 3x2) | systemMedium |
| W3 | 4x3, 4x4 | systemLarge |
| W4 | 4x2 | systemMedium, StandBy (pair) |
| W5 | 4x1, 5x1 | accessoryRectangular, accessoryInline |
| W6 | notification / lock hub | Live Activity + Dynamic Island |

Ship W2, W3 and W5 as **one** provider with responsive sizes (the `SizeF` map on API 31+, falling back to the 4x2 layout).
W1 and W4 are a second provider. That makes two providers, not six.

## 3. Lock-screen lyrics

### Android: options compared
| Approach | Real-time? | Works on | Cost | Verdict |
|---|---|---|---|---|
| A. Lyric line in the existing media notification / session (`setContentText(line)` on the notification, opt-in: also the MediaMetadata subtitle) | line level | all devices, lock screen + shade | 1 notify per line, bitmap reused | **Default.** Cheap and universal. Opt-in because some lock-screen cards and Bluetooth/car displays then show lyrics in place of the artist. |
| B. Separate Live-Update notification (BigTextStyle, ongoing, promoted) with the current line | line level | Android 16+ (Pixel, others vary), lock screen + **AOD** + status chip | same | **Opt-in experiment.** Outside Google's use-case guidance, and the user or OEM may demote it. LyricDock is sideloaded from GitHub, so no Play policy applies. The extra can be set as `extras.putBoolean("android.requestPromotedOngoing", true)` without moving to android-36.jar. Without the permission it is still a normal notification, which is a harmless fallback. |
| C. Lock-screen mode of the app (`setShowWhenLocked` while playing) | word level, full UI | all | screen stays on (dock use: already on) | **Best experience.** Make it a setting ("Show over lock screen while playing"), reusing `UiOp.WAKE`. Brightness/night settings already exist. |
| D. Widget on the lock-screen hub | line level | Pixel, Android 16 QPR2+ | widget updates | Comes for free with W2/W5. Don't build anything specific. |

Recommendation: **C for the dock (charging, screen on), A for pocket use, B as an experimental toggle.**

Data flow (Android): PC bridge (Spicetify over WebRTC/WS) or the Web API poll goes to the WebView `P`. `lyrics.js` sees `a` change and calls
`Dock.nowPlaying(json)`. Java (`NowPlaying`) then updates the widgets, the notification line and the optional Live Update. When the app is killed,
`MainActivity.onDestroy` pushes `{playing:false, line:null}` so the widgets show the cover, title and a "tap to open" state, never a frozen
lyric. Reopening goes through `Reopen.java`, which already exists. A foreground service to survive Activity death is **not** planned: the
WebView needs the Activity anyway.

### iOS (later): Live Activity
- Start: from the app while it's foregrounded and playing, or with push-to-start (iOS 17.2+) when the desktop bridge sees playback start.
- While the app is in the foreground: local `activity.update` on every line change. No budget issues.
- While backgrounded or killed: the **desktop bridge is the source of truth**. Spicetify sends track/line events to the Cloudflare Worker,
  which sends APNs `liveactivity` pushes. Every track change, play/pause and seek goes at priority 10. Lyric lines go at priority 5 (no budget, best effort),
  coalesced to at least 5 s apart. The progress bar animates locally (`ProgressView(timerInterval:)`), so it stays right between pushes.
- With no paid account: only the in-app foreground Live Activity and widgets (reloaded from the app) are possible. That is enough for StandBy
  docking with the app open.
- Cover: download it in the app, downscale to about 100 px, put it in the App Group, and send its key in the ContentState. Video covers use the poster frame.

## 4. Android implementation plan

### Shared state model (the contract for Android widgets, notifications and the iOS ContentState)
JSON, at most 4 KB, built in JS, which already has every field:
```json
{ "v": 1, "id": "spotify:track:..", "title": "..", "artist": "..", "album": "..",
  "art": "https://..", "accent": "#e0a040", "playing": true,
  "posMs": 42100, "atMs": 1759312345678, "durMs": 220000,
  "line": { "i": 12, "text": "..", "t": 41800, "e": 44900 },
  "prev": "..", "next": ["..", ".."], "src": "bridge|webapi" }
```
- `atMs` is wall-clock time (not `performance.now()`), so native code and iOS can extrapolate the position (`posMs + now - atMs`).
- Lines are trimmed to 120 chars each and `next` holds at most 2 entries, which keeps it well under 4 KB.
- `line` is null for unsynced or instrumental parts. `accent` comes from the existing `colours()`/`accentFrom()`.
- For iOS: the static fields (`id/title/artist/album/art`) map to `ActivityAttributes`, the rest to `ContentState`. The keys are the same, as a Codable struct.

### New / changed files
| File | Change |
|---|---|
| `res/layout/w_now.xml`, `w_lyrics.xml`, `w_strip.xml`, `w_cover.xml`, `w_clock.xml` | RemoteViews layouts (only the allowed views: LinearLayout, TextView, ImageView, ImageButton, ProgressBar, Chronometer, TextClock). |
| `res/xml/w_now_info.xml`, `w_cover_info.xml` | `appwidget-provider`: `updatePeriodMillis="0"`, `minWidth/Height`, `targetCellWidth/Height`, `resizeMode`, `widgetCategory="home_screen\|keyguard"`, `previewLayout`. |
| `res/drawable/w_bg.xml` | Rounded background shape (tinted at runtime via `setColorStateList`/`setInt(..,"setColorFilter")`). |
| `NowWidget.java`, `CoverWidget.java` | `AppWidgetProvider`s. `onUpdate` re-renders from the last saved state, which matters after a launcher restart or a reboot. |
| `NowPlaying.java` | Top-level `Runnable` like `MediaNotif` (no inner classes). It parses the JSON, saves the last state to SharedPreferences, picks full vs partial updates, renders every widget id, and hands the line to `MediaNotif`. |
| `MediaNotif.java` | Takes an optional `line` (content text), plus an optional promoted extra for option B. |
| `MainActivity.java` | `@JavascriptInterface nowPlaying(String json)` and `hasWidgets()`. `onDestroy` pushes the idle state. Settings toggle for lock-screen mode (C). |
| `MediaReceiver.java` | Reused for widget buttons (same `cmd` extras). If `MainActivity.current == null`, it starts the activity instead. |
| `AndroidManifest.xml` | Two `<receiver>`s with `APPWIDGET_UPDATE` + meta-data. `POST_PROMOTED_NOTIFICATIONS` only if B ships. |
| `lyrics.js` / `features.js` | Call `Dock.nowPlaying` when `a` changes and from `hardware()` on track/state changes. |
| `settings.js` | Widget theme / font / elements, "Lyric on lock screen", "Show over lock screen while playing". |

### Update throttling (in `NowPlaying`, not in JS)
1. Do nothing when `getAppWidgetIds()` is empty for both providers and no lyric notification option is on. JS checks `Dock.hasWidgets()` once a minute, so it skips the JSON building as well.
2. On a track change, send a **full** `updateAppWidget`: cover bitmap (reuse `MediaNotif.cover()` / `lastArt`, downscaled to 256 px), accent and texts.
3. On a line change, send a **partial** update with text only. Minimum gap 400 ms: if lines come faster, the last one wins.
4. Position: `Chronometer` base = `elapsedRealtime() - posMs`, running = playing. The `ProgressBar` only changes on track change, seek and pause, plus once every 10 s while the screen is on.
5. Screen off (`!isInteractive()`): drop the widget pushes but keep the latest state. On `ACTION_SCREEN_ON` / `USER_PRESENT`, send one full update. Lock-screen notification updates do continue while the keyguard is up and the screen is on.
6. One worker thread with a single-slot "latest state" field (no queue), so nothing piles up.

### Gradle-free gotchas
- Every `PendingIntent` needs `FLAG_IMMUTABLE` and a unique request code per (widget id, cmd).
- Responsive `RemoteViews(Map<SizeF,RemoteViews>)` is API 31+. Below that, use a single layout chosen in `onAppWidgetOptionsChanged`.
- aapt2 compiles the new `res/layout` and `res/xml` without changes. Check that `build-apk.ps1` picks up the new dirs (it compiles `--dir res`, so it should).
- No AndroidX, no Glance. Plain `android.widget.RemoteViews` is enough.

### Phases and effort
| Phase | Scope | Effort |
|---|---|---|
| 1 | `NowPlaying` state + `Dock.nowPlaying`, W2 (4x2) with cover/title/line/controls/Chronometer, full/partial throttling, idle state on destroy | 1.5 to 2 days |
| 2 | Lyric line in the media notification (option A) + "Show over lock screen while playing" (option C) | 0.5 to 1 day |
| 3 | Responsive W3 lyrics + W5 strip in the same provider; W1/W4 second provider; settings (theme, font, elements, tap action) | 2 days |
| 4 | Live-Update experiment (option B), tested on Pixel / Android 16 | 0.5 day |
| 5 | iOS later: Codable model from the same JSON, WidgetKit W1/W2/W4, Live Activity local-only; then Worker APNs relay once there is a paid account | 4 to 6 days + account |

Out of scope: animated covers in widgets (not possible), word-level highlighting in widgets (too many updates; only option C has it),
and a foreground service.
