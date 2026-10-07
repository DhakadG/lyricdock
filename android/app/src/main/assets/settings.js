// Settings: one schema drives defaults, persistence (localStorage) and the in-app panel.
// The panel reuses Spicy Lyrics' settings-panel markup/classes (sl-sp-*), styled in index.html.
const Settings = (() => {
  // Every setting: `desc` is the one-liner under the label, `help` the longer explanation behind the ⓘ button
  // (tap on the phone, hover in Spotify's panel). Defaults here ARE the shipped default config ("Reset all").
  const dyn = s => s.bg === 'dynamic' || s.bg === 'artist';
  const app = !window.LYRICDOCK_WEB; // the Android app (the web shim sets LYRICDOCK_WEB before this runs): phone-only rows
  const SCHEMA = [
    { group: 'Layout', icon: 'layout', cat: 'View', desc: 'Where the cover, title, controls and lyrics sit, and which gestures work.' },
    { type: 'custom', render: () => window.layoutGrid?.() }, // the layout picker: a sketch of every layout (features.js)
    { k: 'layout', label: 'Layout', type: 'choice', def: 'split', opts: [
      ['split', 'Default'], ['player', 'Player card'], ['lyrics', 'Lyrics only'], ['compact', 'Compact'], ['tv', 'TV view'], ['cinema', 'Cinema'], ['nowbar', 'Now Bar'], ['clocksplit', 'Cover + clock'], ['clock', 'Flip clock']],
      help: 'Default: cover + title beside the lyrics. Lyrics only: full-width lyrics. Compact: small cover row on top. TV view: bigger cover and text for across-the-room viewing. Cinema: huge centred lyrics with a small badge. Now Bar: lyrics with a floating pill at the bottom. Player card: an always-visible player (progress, shuffle, repeat, volume) beside the lyrics, like an Apple Music mini player. Cover + clock: the cover and song on one side, a big flip clock (hours and minutes) on the other. Flip clock: the flip clock full screen all the time (tap for seconds, double-tap to go back to the layout before).' },
    { k: 'artSide', label: 'Cover side', type: 'choice', def: 'left', opts: [['left', 'Cover left, lyrics right'], ['right', 'Lyrics left, cover right']],
      when: s => ['split', 'tv', 'clocksplit'].includes(s.layout), help: 'Swap which side the album art and the lyrics sit on (landscape). In portrait the cover is always on top.' },
    { k: 'progress', label: 'Progress bar', type: 'choice', def: 'art', opts: [['art', 'Under the cover'], ['bottom', 'Bottom edge'], ['top', 'Top edge'], ['off', 'Off']],
      help: 'Under the cover: a slim bar with the times right below the album art (Default, TV and Cover + clock; the other layouts have no cover and use the bottom edge). It frees the bottom of the screen, thickens under your finger and you can drag it to scrub. Bottom / Top edge: a thin bar along the screen edge (tap it while the controls show to seek, or press and hold to scrub). Off: none.' },
    { k: 'times', label: 'Show times on the edge bar', desc: 'Elapsed and total time above the ends of the edge bar', type: 'toggle', def: false,
      help: 'Shows 1:23 / 3:45 above the ends of the edge bar. The bar under the cover always shows its times.' },
    { k: 'qsEnabled', label: 'Quick bar', desc: 'One-tap actions next to the settings button, different in each layout', type: 'toggle', def: true,
      help: 'Tap the screen: next to the gear you get swap cover side, romanization, next layout and a Quick settings sheet holding the few settings that matter in the layout you are in (for the clock layouts: card colour, seconds, 12 / 24 h, arrangement, flip animation, sound).' },
    { k: 'showBlocks', label: 'Show block names', desc: 'Outlines and labels every area of the screen (for talking about the design)', type: 'toggle', def: false,
      help: 'Draws a dashed outline and a name on each block: Cover, Now playing, Timeline, Lyrics pane, Control pill, Tags, Status cluster... The names are the ones in the design file and docs/layout-map.md.' },
    { k: 'hideAfter', label: 'Hide controls after', type: 'range', min: 2, max: 10, step: 1, def: 4, unit: 's',
      help: 'Tap anywhere to show play/pause, next, previous, volume and the settings button. They fade out after this many seconds.' },
    { k: 'marquee', label: 'Scroll long titles', type: 'toggle', def: true, help: 'Song titles and artist lists that do not fit scroll slowly back and forth instead of being cut off.' },
    { k: 'showShuffle', label: 'Shuffle and repeat buttons', type: 'toggle', def: true, help: 'Adds shuffle and repeat (off / all / one) next to previous and next.' },
    { k: 'showLists', label: 'Queue, history and friends buttons', type: 'toggle', def: true, help: 'Buttons that open the queue, recently played, your library and your friends\' listening activity.' },
    { k: 'swipe', label: 'Swipe the cover to skip', type: 'toggle', def: true, help: 'Drag the cover (or the song card in layouts without a big cover) left for the next song, right for the previous one. Drag further to go up to 3 songs; a tab at the screen edge shows where you will land. Swiping anywhere else does nothing.' },
    { k: 'doubleTapLike', label: 'Double-tap to like', type: 'toggle', def: true, help: 'Double-tap anywhere (not on a button) to add the song to Liked Songs or remove it.' },
    { k: 'nextChip', label: 'Up next chip', type: 'toggle', def: true, help: 'Near the end of a song, a small chip shows what plays next.' },
    { k: 'nextChipSecs', label: 'Show it for the last', type: 'range', min: 5, max: 45, step: 5, def: 15, unit: ' s', when: s => s.nextChip, help: 'How long before the end of the song the chip appears.' },
    { k: 'showVolume', label: 'Volume slider', type: 'toggle', def: true, help: 'Show a volume slider in the controls. It changes Spotify\'s volume (not the phone\'s).' },
    { k: 'orientation', label: 'Orientation', type: 'choice', def: 'auto', opts: [['auto', 'Auto-rotate (all 4)'], ['landscape', 'Landscape'], ['portrait', 'Portrait']],
      help: 'Auto follows how the phone is standing, including upside down. Lock it if the phone lies on a sensor-confusing stand.' },
    { k: 'edgeMode', label: 'Notch & edge spacing', desc: 'Auto reads the camera cutout and rounded corners from the phone',
      type: 'choice', def: 'auto', opts: [['auto', 'Auto'], ['manual', 'Manual']],
      help: 'The camera notch is always kept clear, whichever way the phone is turned. Auto also reads the rounded corners and pulls the edge progress bar in where they would cut it. Manual lets you add side padding and set the corner inset yourself.' },
    { k: 'notchPad', label: 'Notch side padding', type: 'range', min: 0, max: 120, step: 2, def: 36, unit: 'px', when: s => s.edgeMode === 'manual',
      help: 'Space on the side with the camera notch (top in portrait, left or right in landscape). Lower it if your notch is small and you want the room; a line shows where content stops while you change it.' },
    { k: 'edgePad', label: 'Side padding', type: 'range', min: 0, max: 80, step: 2, def: 0, unit: 'px', when: s => s.edgeMode === 'manual',
      help: 'Space on the left and right edges that have no notch. 0 uses the whole screen.' },
    { k: 'cornerPad', label: 'Progress bar corner inset', type: 'range', min: 0, max: 80, step: 2, def: 20, unit: 'px', when: s => s.edgeMode === 'manual',
      help: 'How rounded the screen corners are: the progress bar is lifted and shortened to stay inside them.' },

    { group: 'Now playing', icon: 'note', cat: 'View', desc: 'The song details around the lyrics: like button, album, quality, accent colour.' },
    { k: 'showLiked', label: 'Show liked (heart)', desc: 'Tap the heart to like / unlike', type: 'toggle', def: true,
      help: 'Green heart = in your Liked Songs. Tapping it saves or removes the song in Spotify.' },
    { k: 'heartLikedOnly', label: 'Only on liked songs', type: 'toggle', def: true, when: s => s.showLiked,
      help: 'Keeps the cover clean: the heart shows only on songs in your Liked Songs. On other songs it appears while the controls are up (tap the screen), and double-tap still likes.' },
    { k: 'heartPos', label: 'Like button position', type: 'choice', def: 'art', opts: [['art', 'Badge on the cover'], ['title', 'Next to the title']], when: s => s.showLiked, help: 'Where the heart sits: a small badge in the corner of the album art, or beside the song title.' },
    { k: 'albumLine', label: 'Album and year', type: 'toggle', def: true, help: 'Shows the album name and release year under the artist.' },
    { k: 'sourceBadge', label: 'Lyrics source tag', type: 'toggle', def: false, help: 'A quiet "Lyrics · Apple Music" line naming where the lyrics came from (Spicy Lyrics, Apple Music, Spotify, LRCLIB). The credits under the lyrics always name it as well.' },
    { k: 'showQuality', label: 'Show audio quality', type: 'toggle', def: true, help: 'Shows Spotify\'s current streaming quality (Low … Very high, Lossless) as a small tag.' },
    { k: 'qualityIcon', label: 'Lossless indicator', desc: 'How a Lossless stream is shown - no text, no badge', type: 'choice', def: 'wave', when: s => s.showQuality,
      opts: [['wave', 'Waveform beside the song length'], ['status', 'Waveform in the status corner'], ['glow', 'Accent glow around the cover'], ['led', 'Light in the cover corner'], ['off', 'Nothing']],
      help: 'Only Lossless streams show anything. Waveform: four little accent bars right of the song length under the cover (they breathe while the song plays); in layouts without that bar they sit in the battery / time corner. Status corner: the same bars in a small glass circle next to the battery and time. Glow: the cover\'s shadow turns into a soft halo of its own colour. Light: a tiny glowing dot in the cover\'s top-right corner, like an amplifier\'s power light.' },
    { k: 'tagPos', label: 'Tag position', desc: 'When the lyrics-source line shows', type: 'choice', def: 'auto', opts: [['auto', 'In the corner, with the controls'], ['corner', 'In the corner, always (dimmed)']],
      when: s => s.sourceBadge,
      help: 'The lyrics source sits in the bottom-right corner (top-right in Cinema and Now Bar) - never in the song details or on the cover. With the controls: it appears when you tap the screen. Always: it stays there, dimmed.' },
    { k: 'accent', label: 'Accent colour from cover', type: 'toggle', def: true,
      help: 'Tints the progress bar, buttons and settings with a colour picked from the album art. Off: plain white.' },
    { k: 'motionArt', label: 'Animated covers (Apple Music)', type: 'toggle', def: true,
      help: 'Albums that have an animated cover in Apple Music play it in place of the still cover (looped, silent, sized to this screen). Found through LyricDock cloud and kept on the phone, so a replayed album uses no data. Albums without one keep the still cover.' },
    { k: 'coverShape', label: 'Animated cover shape', type: 'choice', def: 'auto', opts: [['auto', 'Auto (tall in portrait)'], ['square', 'Always square'], ['tall', 'Tall when available']], when: s => s.motionArt,
      help: 'Some albums also have a tall (3:4) animated cover. Auto uses it in portrait, where the extra height fills the screen, and the square one in landscape. The cover only turns tall while that video plays; albums without one stay square.' },
    { k: 'motionQuality', label: 'Animated cover quality', type: 'choice', def: 'auto', opts: [['saver', 'Data saver'], ['auto', 'Fit the screen'], ['sharp', 'Sharp'], ['max', 'Best available']],
      when: s => s.motionArt || s.bg === 'motion' || s.bg === 'motionblur',
      help: 'Fit the screen: the smallest file that still looks sharp here (about 2-5 MB per album on a phone). Data saver: a size smaller. Sharp / Best: bigger files for big or 4K screens.' },
    { k: 'motionKeep', label: 'Keep animated covers on this device', type: 'choice', def: 'second', opts: [['second', 'From the second play'], ['first', 'From the first play'], ['never', 'Never (always stream)']],
      when: s => s.motionArt || s.bg === 'motion' || s.bg === 'motionblur',
      help: 'From the second play: an album you only hear once just streams; one you come back to is saved, and after that plays without using data. From the first play: saves everything (the video appears once fully downloaded). Never: always streams.' },
    { k: 'motionCacheMB', label: 'Space for saved covers', type: 'range', min: 50, max: 1000, step: 50, def: (navigator.deviceMemory || 4) <= 2 ? 150 : 300, unit: ' MB',
      when: s => s.motionKeep !== 'never' && (s.motionArt || s.bg === 'motion' || s.bg === 'motionblur'),
      help: 'When full, the covers played longest ago are removed first.' },
    { k: 'motionWarm', label: 'Load the next animated cover early', type: 'toggle', def: true, when: s => s.motionArt || s.bg === 'motion' || s.bg === 'motionblur',
      help: 'While a song plays, the next song\'s animated cover is looked up (and downloaded, if it would be saved anyway), so it starts the moment the song changes.' },
    { k: 'motionBadge', label: 'Mark animated covers', type: 'toggle', def: true, when: s => s.motionArt,
      help: 'A tiny mark in the corner of the cover while it is animated. Still covers never show it.' },
    { k: 'spin', label: 'Spinning cover (Now Bar)', type: 'toggle', def: true, when: s => s.layout === 'nowbar', help: 'The round cover in the Now Bar turns like a record while playing.' },
    { k: 'notices', label: 'Status notices', desc: 'Short messages: offline, rate limits, source changes, updates', type: 'toggle', def: true,
      help: 'Small toasts at the bottom for things worth knowing: network lost/back, Spicy API limits, switching between computer and account, pairing, updates.' },

    { group: 'Background', icon: 'image', cat: 'View', desc: 'What moves behind the lyrics: the warped cover, artist photo, Canvas, music video or plain black.' },
    { k: 'bg', label: 'Background', type: 'choice', def: 'dynamic', opts: [
      ['dynamic', 'Dynamic'], ['artist', 'Artist image (dynamic)'], ['canvas', 'Spotify Canvas (looping video)'], ['motion', 'Animated cover (Apple Music)'], ['motionblur', 'Animated cover, blurred'], ['video', 'Music video (YouTube)'], ['blur', 'Blurred art'], ['gradient', 'Colour gradient'], ['black', 'Black']],
      help: 'Dynamic: the cover slowly warped and blurred (Spicy Lyrics\' look, uses the GPU). Artist image: the same effect with the artist\'s photo. Spotify Canvas: the short looping video some songs have in Spotify (desktop mode) - great in portrait; songs without one show the blurred cover. Animated cover: the album\'s animated cover from Apple Music where it has one (tall in portrait, square in landscape). Animated cover, blurred: the same video blurred like Blurred art (reuses the cover\'s file, no extra data). Blurred art: a blurred cover. Colour gradient: slow gradient from the cover\'s colours. Black: nothing (OLED, lowest power).' },
    { k: 'bgDrift', label: 'Drift the still cover', type: 'toggle', def: true, when: s => ['blur', 'canvas', 'motion', 'motionblur'].includes(s.bg),
      help: 'The blurred cover slowly pans and zooms instead of standing still (Ken Burns effect). Cheap: one layer moved by the GPU.' },
    { k: 'bgSpeed', label: 'Motion speed', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0.35, when: dyn, help: 'How fast the dynamic background drifts. 0 freezes it.' },
    { k: 'bgBeat', label: 'Move with the music', desc: 'Livelier while words are sung, calm in instrumental parts', type: 'toggle', def: true, when: dyn,
      help: 'Speeds the background up while vocals are busy (read from the lyric timing) and slows it in instrumental parts.' },
    { k: 'bgWarp', label: 'Warp', type: 'range', min: 0, max: 1, step: 0.05, def: 1, when: dyn, help: 'How much the image is swirled. 0 = just a blurred, slowly moving cover.' },
    { k: 'bgSaturation', label: 'Colour intensity', type: 'range', min: 0.5, max: 2.5, step: 0.05, def: 1.5, unit: '×', when: dyn, help: 'Saturation of the dynamic background. Higher = more vivid.' },
    { k: 'bgFade', label: 'Cover crossfade', type: 'range', min: 0, max: 3000, step: 100, def: 1000, unit: ' ms', when: dyn, help: 'How long the background takes to blend into the next song\'s cover.' },
    { k: 'videoKey', label: 'YouTube Data API key (optional)', type: 'text', def: '', placeholder: 'AIza…', when: s => s.bg === 'video',
      desc: 'Finds the right video more reliably. Without it, a public search service is used.',
      help: 'Music video background: the song\'s video plays muted behind the lyrics, synced to the song. To use your own search quota: console.cloud.google.com → create a project → enable "YouTube Data API v3" → Credentials → Create credentials → API key (restrict it to YouTube Data API v3). Without a key, LyricDock asks a public Piped instance, which can be slow or down.' },
    { k: 'videoSync', label: 'Keep the video in sync', type: 'toggle', def: true, when: s => s.bg === 'video', help: 'Seeks the video to the song position when they drift more than 2 seconds apart, and pauses it with the music.' },
    { k: 'bgDim', label: 'Dim', type: 'range', min: 0, max: 0.8, step: 0.05, def: 0.2, when: s => s.bg !== 'black', help: 'Darkens the background so white lyrics stay readable on bright covers or artist photos.' },

    { group: 'Lyrics', icon: 'text', cat: 'View', desc: 'Font, size, spacing, colours and the Spicy-style word effects.' },
    { k: 'roman', label: 'Romanization', desc: 'Smart keeps Hindi (Devanagari) as is and romanizes everything else',
      type: 'choice', def: 'smart', opts: [['smart', 'Smart (keep Hindi)'], ['always', 'Always'], ['off', 'Original script']],
      help: 'Smart: Hindi stays in Devanagari, Punjabi (Gurmukhi/Shahmukhi), Urdu and other scripts become Latin letters. Always: everything in Latin letters. Original: no romanization.' },
    { k: 'size', label: 'Text size', type: 'range', min: 0.6, max: 1.6, step: 0.05, def: 1, unit: '×', help: 'Lyrics size. Layouts scale from this (TV and Cinema are bigger).' },
    { k: 'font', label: 'Font', type: 'choice', def: 'Inter', opts: [['Inter', 'Inter (Apple-style, default)'], ['system', 'System font'], ['Outfit', 'Outfit'], ['Manrope', 'Manrope'], ['DM Sans', 'DM Sans'], ['Plus Jakarta Sans', 'Plus Jakarta Sans'], ['Space Grotesk', 'Space Grotesk'], ['Sora', 'Sora'], ['Lexend', 'Lexend'], ['Poppins', 'Poppins'], ['Playfair Display', 'Playfair Display (serif)'], ['Lora', 'Lora (serif)'], ['JetBrains Mono', 'JetBrains Mono']],
      help: 'Typeface for lyrics and titles. Inter is the closest free match to Apple\'s San Francisco (Apple Music\'s lyrics font, which Apple only licenses for its own devices). Anything but System downloads once from Google Fonts and is then cached; scripts a font lacks (Devanagari, Gurmukhi…) fall back to the system font.' },
    { k: 'weight', label: 'Text weight', type: 'choice', def: '800', opts: [['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']],
      help: 'Thickness of the lyrics font.' },
    { k: 'align', label: 'Alignment', type: 'choice', def: 'left', opts: [['left', 'Left'], ['center', 'Centre']], help: 'Duet lines sung by the second singer still go to the other side.' },
    { k: 'anchor', label: 'Active line position', desc: 'How far down the screen the current line sits', type: 'range', min: 0.2, max: 0.6, step: 0.05, def: 0.35,
      help: '0.2 = near the top (more upcoming lines visible), 0.6 = below the middle (more past lines).' },
    { k: 'lineGap', label: 'Line spacing', type: 'range', min: 0, max: 5, step: 0.25, def: 1.5, help: 'Space between lyric lines.' },
    { k: 'seekComp', label: 'Seek slightly before a tapped line', type: 'toggle', def: true, help: 'Spotify fades the audio in for about 300 ms after a seek, so landing exactly on a line swallows its first syllable. This seeks 300 ms early.' },
    { k: 'lineOpacity', label: 'Other lines brightness', type: 'range', min: 0.15, max: 0.85, step: 0.05, def: 0.5, help: 'How visible the lines that aren\'t being sung are. Spicy Lyrics uses 0.5.' },
    { k: 'lineColor', label: 'Sung line colour', type: 'choice', def: 'white', opts: [['white', 'White'], ['accent', 'Accent from cover']], help: 'Colour the word fill sweeps in. Accent uses the colour picked from the album art.' },
    { k: 'duetColors', label: 'Colour per singer (duets)', type: 'toggle', def: true, help: 'In duets, the second singer\'s lines (sung on the other side) are tinted with the accent colour so the voices are easy to tell apart.' },
    { k: 'outline', label: 'Darken behind the lyrics', type: 'toggle', def: false, help: 'A soft dark wash behind the lyrics keeps them readable over bright covers and artist photos (it fades out at the edges with the lyrics).' },
    { k: 'hideExplicit', label: 'Hide explicit words', type: 'toggle', def: false, help: 'Masks common English swear words in the lyrics (f***). Only changes what is shown.' },
    { k: 'countdown', label: 'Countdown before singing', type: 'toggle', def: true, help: 'In the intro, the last 3 seconds before the first line count down 3 · 2 · 1 above the dots.' },
    { k: 'blurLines', label: 'Blur distant lines', type: 'toggle', def: false, help: 'Lines two or more away from the current one are softly blurred, drawing the eye to the sung line. Off (default) keeps every line crisp and translucent, like Spotify\'s own lyrics.' },
    { k: 'blurAmount', label: 'Blur strength', type: 'range', min: 0.5, max: 5, step: 0.1, def: 1.2, unit: 'px', when: s => s.blurLines, help: 'Blur of lines two away; three and more get twice this.' },
    { k: 'glow', label: 'Glow on sung words', type: 'toggle', def: true, help: 'Words glow softly as they are sung (Spicy Lyrics). The most expensive effect: turn it off on slow phones for smoother motion.' },
    { k: 'glowStrength', label: 'Glow strength', type: 'range', min: 0.2, max: 2, step: 0.1, def: 1, unit: '×', when: s => s.glow, help: 'Size and brightness of the glow.' },
    { k: 'lift', label: 'Lift sung words', type: 'toggle', def: true, help: 'Each word rises and grows slightly as it is sung, then settles.' },
    { k: 'liftAmount', label: 'Lift amount', type: 'range', min: 0.2, max: 2, step: 0.1, def: 1, unit: '×', when: s => s.lift, help: 'How far words rise and grow.' },
    { k: 'letters', label: 'Letter-by-letter on long notes', desc: 'Held words glow and lift one letter at a time', type: 'toggle', def: true,
      help: 'When a short word is held for a long time ("foreverrr"), each letter lights up in turn with extra lift and glow - Spicy Lyrics\' emphasis.' },
    { k: 'lettersMin', label: 'Long note length', type: 'range', min: 500, max: 3000, step: 100, def: 1000, unit: ' ms', when: s => s.letters,
      help: 'How long a word must be held to get the letter-by-letter treatment.' },
    { k: 'dots', label: 'Interlude dots', type: 'toggle', def: true, help: 'Three breathing dots fill instrumental gaps and pop just before singing resumes.' },
    { k: 'dotsGap', label: 'Dots after a gap of', type: 'range', min: 2, max: 12, step: 0.5, def: 4, unit: ' s', when: s => s.dots, help: 'Minimum silence between lines before the dots appear.' },
    { k: 'scrollLead', label: 'Scroll ahead', type: 'range', min: 0, max: 800, step: 50, def: 250, unit: ' ms', help: 'The list starts moving to the next line this long before it is sung, so your eyes are already there.' },
    { k: 'scrollBack', label: 'Return to the sung line after', type: 'range', min: 1, max: 10, step: 0.5, def: 3, unit: ' s', help: 'Drag the lyrics up or down to read ahead or look back (flick to scroll fast). This long after you let go, they glide back to the line being sung.' },
    { k: 'credits', label: 'Show credits', desc: 'Written by / Provided by under the lyrics', type: 'toggle', def: true,
      help: 'Songwriters are optional; the lyrics provider (and community sync credits) are always shown, as the providers require.' },
    { k: 'tapSeek', label: 'Tap a line to jump to it', type: 'toggle', def: true, help: 'Tap any synced line to seek Spotify to it.' },
    { k: 'offset', label: 'Sync offset', desc: 'Positive shows lyrics later, negative earlier', type: 'range', min: -1000, max: 1000, step: 10, def: 0, unit: 'ms',
      help: 'Nudge if lyrics run early or late (e.g. Bluetooth speaker delay: try +150 to +300 ms).' },
    { k: 'apiKey', label: 'Spicy Lyrics API key (optional)', type: 'text', def: '', placeholder: 'sl_pk_…',
      desc: 'Your own publishable key with "No origin header" allowed. Fills gaps the desktop cache misses.',
      help: 'Get one at developers.spicylyrics.org → your application → Client access (no backend) → publishable key (sl_pk_…), with "No origin header" allowed. Never paste a secret key (sl_sk_…). Needed for word-synced lyrics in Spotify-account mode.' },

    { group: 'Animations', icon: 'spark', cat: 'View', desc: 'How songs change, how play / pause feels and how the lyrics glide.' },
    { k: 'trackAnim', label: 'Next / previous', type: 'choice', def: 'slide', opts: [
      ['slide', 'Slide'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['flip', 'Flip'], ['blur', 'Blur'], ['stack', 'Card stack'], ['none', 'None']],
      help: 'How the screen changes to the next song. Next moves left, previous moves right.' },
    { k: 'ppAnim', label: 'Play / pause', type: 'choice', def: 'both', opts: [
      ['both', 'Pulse + shrink'], ['pulse', 'Pulse'], ['shrink', 'Shrink art'], ['ripple', 'Ripple'], ['none', 'None']],
      help: 'Feedback when playback pauses or resumes. Shrink makes the cover smaller while paused.' },
    { k: 'scroll', label: 'Lyrics scroll', type: 'choice', def: 'smooth', opts: [['smooth', 'Smooth'], ['spring', 'Springy'], ['snappy', 'Snappy']],
      help: 'How the lyrics glide to the next line. Springy overshoots a little.' },
    { k: 'animSpeed', label: 'Animation speed', type: 'range', min: 0.5, max: 2, step: 0.1, def: 1, unit: '×', help: 'Speeds up or slows down every UI animation.' },

    { group: 'Screen', icon: 'phone', cat: 'Device', desc: 'Keep-awake, brightness, night mode, burn-in protection and the phone\'s buttons.' },
    { k: 'awake', label: 'Keep the screen on', type: 'choice', def: 'always', opts: [['always', 'Always'], ['playing', 'Only while playing'], ['system', 'Follow Android']],
      help: 'Always: never sleeps (the kiosk default). Only while playing: the screen turns off after music has been paused for the time below. Follow Android: the normal screen timeout.' },
    { k: 'sleepAfter', label: 'Turn off after pausing for', type: 'range', min: 1, max: 60, step: 1, def: 10, unit: ' min', when: s => s.awake === 'playing', help: 'How long the screen stays on after music stops.' },
    { k: 'night', label: 'Night mode', type: 'toggle', def: false, help: 'Between the hours below: dims everything, switches to a black background and warms the colours.' },
    { k: 'nightFrom', label: 'Night starts at', type: 'range', min: 0, max: 23, step: 1, def: 22, unit: ':00', when: s => s.night, help: 'Hour (24-hour clock) night mode starts.' },
    { k: 'nightTo', label: 'Night ends at', type: 'range', min: 0, max: 23, step: 1, def: 7, unit: ':00', when: s => s.night, help: 'Hour (24-hour clock) night mode ends.' },
    { k: 'nightDim', label: 'Night dimming', type: 'range', min: 0, max: 0.85, step: 0.05, def: 0.5, when: s => s.night, help: 'How much darker everything gets at night.' },
    { k: 'nightWarm', label: 'Night warmth', type: 'range', min: 0, max: 1, step: 0.05, def: 0.4, when: s => s.night, help: 'Amber tint at night (less blue light).' },
    { k: 'burnIn', label: 'Burn-in protection', type: 'toggle', def: true, help: 'AMOLED screens can keep a ghost of things that never move. This shifts the layout by a few pixels every few minutes: invisible, but it spreads the wear.' },
    { k: 'bright', label: 'Brightness', type: 'choice', def: 'system', when: () => app, opts: [['system', 'Follow Android'], ['fixed', 'Fixed'], ['schedule', 'Day / night schedule']],
      help: 'Fixed: always the level below. Day / night: the day level, and the night level between the night hours (Night starts / ends at). Only LyricDock\'s window changes, not the system setting.' },
    { k: 'brightDay', label: 'Day brightness', type: 'range', min: 0.02, max: 1, step: 0.02, def: 0.8, when: s => app && s.bright !== 'system', help: 'Screen brightness while LyricDock is open (Fixed), or during the day (schedule).' },
    { k: 'brightNight', label: 'Night brightness', type: 'range', min: 0.02, max: 1, step: 0.02, def: 0.15, when: s => app && s.bright === 'schedule', help: 'Screen brightness between the night hours.' },
    { k: 'volKeys', label: 'Volume buttons control Spotify', type: 'toggle', def: true, when: () => app, help: 'The phone\'s volume buttons change Spotify\'s volume (5% per press) instead of the phone\'s.' },
    { k: 'mediaNotif', label: 'Media notification', type: 'toggle', def: true, when: () => app, help: 'Shows the song with previous / play-pause / next in the notification shade and on the lock screen (normal, non-kiosk use).' },
    { k: 'lockLyric', label: 'Lyrics on the lock screen', desc: 'The line being sung, in the lock-screen player', type: 'toggle', def: true, when: s => app && s.mediaNotif,
      help: 'The lock screen and notification player show the current lyric line under the song title (instead of the artist), line by line.' },
    { k: 'lockShow', label: 'Show over the lock screen while playing', type: 'toggle', def: false, when: () => app,
      help: 'While music plays, LyricDock itself shows over the lock screen with full word-synced lyrics - no unlocking. The lock screen comes back when playback stops.' },
    { k: 'widgetAccent', label: 'Widget colours from the cover', type: 'toggle', def: true, when: () => app,
      help: 'Home-screen widgets tint the sung line with the colour picked from the album art. Off: white. Add widgets from your home screen: long-press -> Widgets -> LyricDock.' },
    { k: 'battery', label: 'Battery indicator', type: 'toggle', def: false, when: () => app || !!navigator.getBattery, help: 'Shows the phone\'s battery level and whether it is charging, in a corner (handy for a kiosk dock).' },
    { k: 'battStyle', label: 'Battery style', type: 'choice', def: 'in', when: s => s.battery, opts: [['in', 'Icon with the % inside'], ['out', 'Icon with the % beside it'], ['ring', 'Ring with the % inside'], ['bar', 'Thin bar'], ['text', '% only']],
      help: 'How the battery is drawn. It turns green while charging and red below 20 %.' },
    { k: 'timeStyle', label: 'Time of day', desc: 'Shows the current time in any layout', type: 'choice', def: 'off', opts: [['off', 'Off'], ['small', 'Small text'], ['pill', 'Glass pill'], ['big', 'Big and light']],
      help: 'The time next to the battery (12 or 24 hour, see Clock -> Time format). Handy in Lyrics only and Cinema, which show no clock.' },
    { k: 'statPos', label: 'Battery and time corner', type: 'choice', def: 'tr', when: s => s.battery || s.timeStyle !== 'off', opts: [['tr', 'Top right'], ['tl', 'Top left'], ['br', 'Bottom right'], ['bl', 'Bottom left']],
      help: 'Where the battery and the time sit. Top right steps aside while the controls are showing.' },

    { group: 'Clock', icon: 'clock', cat: 'Device', desc: 'The flip clock that takes over when the music stops.' },
    { k: 'clock', label: 'Clock screen', type: 'choice', def: 'paused', opts: [['off', 'Off'], ['paused', 'When paused'], ['idle', 'When nothing is playing']],
      help: 'A full-screen clock after a while without music. It goes away by itself when music plays; double-tap it to go back sooner.' },
    { k: 'clockAfter', label: 'Show the clock after', type: 'range', min: 1, max: 30, step: 1, def: 3, unit: ' min', when: s => s.clock !== 'off', help: 'Minutes without music before the clock appears.' },
    { k: 'clockStyle', label: 'Style', type: 'choice', def: 'flip', opts: [['flip', 'Flip cards'], ['simple', 'Simple (time and date)']], when: s => s.clock !== 'off',
      help: 'Flip cards: big raised numerals on cards that flip like a mechanical clock. Tap to show or hide seconds, double-tap to go back. Simple: a thin time with the date.' },
    { k: 'clockTheme', label: 'Card colour', type: 'choice', def: 'dark', opts: [['dark', 'Dark cards, light numerals'], ['light', 'Light cards, dark numerals'], ['auto', 'Automatic (light by day, dark at night)']], when: s => s.clockStyle === 'flip' || ['clock', 'clocksplit'].includes(s.layout),
      help: 'Dark: off-white puff-print numerals on black paper cards. Light: black numerals on off-white paper cards. Automatic: dark during the night-mode hours (Night section), light the rest of the day. Press and hold the clock to swap colours any time; the cards flip over to the new colour.' },
    { k: 'clockIntro', label: 'Coming in and going out', type: 'choice', def: 'roll', opts: [['roll', 'Airport board (roll from 0 / to 0)'], ['flip', 'Flip from blank'], ['none', 'None']],
      when: s => s.clockStyle === 'flip' || ['clock', 'clocksplit'].includes(s.layout),
      help: 'Airport board: coming in, every card starts on 0 and rolls forward flap by flap to the time; going out, every card rolls on to 0, like a departure board changing. Flip from blank: the cards flip from and to blank. None: no animation.' },
    { k: 'clockAnim', label: 'Flip animation', type: 'choice', def: 'classic', opts: [['classic', 'Classic (smooth)'], ['gravity', 'Gravity (natural fall)'], ['snappy', 'Snappy'], ['bounce', 'Bouncy'], ['fold', 'Slow fold'], ['cascade', 'Cascade (per digit)'], ['roll', 'Roll'], ['fade', 'Fade']],
      when: s => s.clock !== 'off' && s.clockStyle === 'flip',
      help: 'Classic: the top half falls, the new bottom half lands, smooth. Gravity: the flap falls like a real one - fastest at the bottom - and bounces off the stack a little. Snappy: quick and crisp. Bouncy: the flap overshoots and settles. Slow fold: slower, with a light sheen. Cascade: every digit flips a beat after the one before. Roll: the digit rolls down a drum. Fade: a quiet crossfade. The airport-board entry uses the same flap (Classic for Roll and Fade).' },
    { k: 'clockSeconds', label: 'Show seconds', type: 'toggle', def: false, when: s => s.clock !== 'off' && s.clockStyle === 'flip', help: 'A third card for seconds. Tapping the clock toggles it too.' },
    { k: 'clock24', label: 'Time format', type: 'choice', def: '12', opts: [['12', '12-hour (AM / PM)'], ['24', '24-hour']], when: s => s.clock !== 'off', help: '12-hour shows AM or PM in the corner of the hours card.' },
    { k: 'clockLayout', label: 'Arrangement', type: 'choice', def: 'auto', opts: [['auto', 'Follow the screen'], ['side', 'Side by side'], ['stacked', 'Stacked']], when: s => s.clock !== 'off' && s.clockStyle === 'flip',
      help: 'Follow the screen: cards side by side in landscape, stacked in portrait.' },
    { k: 'clockCards', label: 'Show the cards', type: 'toggle', def: true, when: s => s.clock !== 'off' && s.clockStyle === 'flip', help: 'Off: only the numerals (on black, or on paper with light cards); the flip still moves them.' },
    { k: 'clockScale', label: 'Size', type: 'range', min: 0.5, max: 1, step: 0.01, def: 0.96, unit: '×', when: s => s.clockStyle === 'flip' || ['clock', 'clocksplit'].includes(s.layout), help: 'How much of the screen the cards fill (1 = edge to edge). Also sizes the clock in the Cover + clock layout.' },
    { k: 'clockDigitGap', label: 'Gap between digits', type: 'range', min: 0, max: 0.2, step: 0.01, def: 0.03, when: s => s.clockStyle === 'flip' || ['clock', 'clocksplit'].includes(s.layout), help: 'Space between the two cards of the hours, the minutes and the seconds (as a share of a card\'s width).' },
    { k: 'clockGroupGap', label: 'Gap between hours and minutes', type: 'range', min: 0, max: 0.6, step: 0.01, def: 0.14, when: s => s.clockStyle === 'flip' || ['clock', 'clocksplit'].includes(s.layout), help: 'Space between the hours, minutes and seconds groups (as a share of a card\'s width).' },
    { k: 'clockDim', label: 'Dim', type: 'range', min: 0, max: 0.85, step: 0.05, def: 0, when: s => s.clock !== 'off', help: 'Darkens the clock (for a bedroom at night).' },
    { k: 'clockSound', label: 'Flip sound', type: 'choice', def: 'off', opts: [['off', 'Off'], ['solari', 'Airport board (clack)'], ['mechanical', 'Mechanical (air + clack)'], ['click', 'Click'], ['whoosh', 'Whoosh (air)'], ['soft', 'Soft tap']],
      when: s => s.clock !== 'off' && s.clockStyle === 'flip',
      help: 'Made on the phone (no audio files) and timed to each flap: every card clacks as it lands, so several changing at once rattle like a departure board. Airport board: a sharp plastic clack with the next flap rattling. Mechanical: the rush of the falling flap, then the clack. Silent during night mode.' },
    { k: 'clockVolume', label: 'Sound volume', type: 'range', min: 0.05, max: 1, step: 0.05, def: 0.4, when: s => s.clock !== 'off' && s.clockSound !== 'off', help: 'Loudness of the flip sound (relative to the phone\'s media volume).' },
    { k: 'clockSoundEvery', label: 'Sound with seconds on', type: 'choice', def: 'minute', opts: [['minute', 'Only when the minute changes'], ['all', 'Every flip']], when: s => s.clock !== 'off' && s.clockSound !== 'off' && s.clockSeconds,
      help: 'A tick every second gets tiring: by default only the minute flip makes a sound.' },
    { k: 'clockHaptic', label: 'Vibrate on flip', type: 'choice', def: 'off', opts: [['off', 'Off'], ['light', 'Light'], ['firm', 'Firm']], when: s => s.clockStyle === 'flip' || ['clock', 'clocksplit'].includes(s.layout),
      help: 'A tick of the vibration motor as the flap lands (on entering and leaving, as each card settles).' },
    { k: 'clockCaption', label: 'Paused song under the clock', type: 'toggle', def: true, when: s => s.clock !== 'off', help: 'Shows "Paused · song" in small text below the clock.' },
    { group: 'Performance', icon: 'gauge', cat: 'Device', desc: 'Background resolution, blur and frame rate: trade looks for smoothness on slower phones.' },
    { k: 'bgRes', label: 'Background resolution', type: 'range', min: 0.2, max: 1, step: 0.05, def: 0.5, unit: '×',
      help: 'Size the dynamic background is drawn at. Under this much blur 0.5 looks the same as 1 and is what lets a budget phone hold 60 fps.' },
    { k: 'bgBlur', label: 'Background blur passes', type: 'range', min: 1, max: 12, step: 1, def: 6, help: 'Softness of the dynamic background. More passes = smoother, more GPU work.' },
    { k: 'bgFps', label: 'Background frame rate', type: 'choice', def: 'max', opts: [['max', 'Match display'], ['165', '165 fps'], ['144', '144 fps'], ['120', '120 fps'], ['100', '100 fps'], ['90', '90 fps'], ['75', '75 fps'], ['60', '60 fps'], ['45', '45 fps'], ['30', '30 fps'], ['24', '24 fps'], ['20', '20 fps'], ['15', '15 fps']],
      help: 'Cap for the dynamic background. Match display runs at the screen\'s own refresh rate (60, 90, 120, 144 Hz…); a phone never goes above its screen. The background moves slowly, so 30 fps is hard to tell apart and saves power.' },
    { k: 'glass', label: 'Glass blur', desc: 'Frosted blur behind the controls and settings', type: 'toggle', def: true,
      help: 'The controls, the settings button and the settings sheet blur what is behind them. Behind the moving dynamic background that blur is redone every frame, which slower phones feel (the controls opening stutters). Off: the same panels as tinted glass without the blur.' },
    { k: 'renderDistance', label: 'Lines kept drawn', type: 'range', min: 8, max: 60, step: 1, def: 20, help: 'Lines further than this from the current one are not drawn at all (long songs stay light). Raise it if you use a tiny text size.' },

    { group: 'Storage', icon: 'disk', cat: 'Device', desc: 'What LyricDock keeps on this phone - animated covers, lyrics, images - and clearing it.' },
    { label: 'Animated covers', type: 'action', text: () => 'Clear', run: () => window.dockStorage?.clear('videos'), info: () => window.dockStorage?.text('videos') ?? '',
      help: 'Animated covers saved on the phone (see Now playing -> Keep animated covers). Cleared covers stream again next time.' },
    { label: 'Lyrics', type: 'action', text: () => 'Clear', run: () => window.dockStorage?.clear('lyrics'), info: () => window.dockStorage?.text('lyrics') ?? '',
      help: 'Lyrics of the last 500 songs, so a replay (or no internet) shows them instantly.' },
    { label: 'Images & web cache', type: 'action', when: () => app, text: () => 'Clear', run: () => window.dockStorage?.clear('web'), info: () => window.dockStorage?.text('web') ?? '',
      help: 'Still covers, artist pictures and other downloads the app keeps (the WebView cache). They download again when needed.' },
    { label: 'Everything', type: 'action', text: () => 'Clear all', run: () => window.dockStorage?.clear('all'), info: () => window.dockStorage?.text('total') ?? '',
      help: 'Clears all of the above. Your settings stay.' },

    { group: 'Playback source', icon: 'source', cat: 'Source', desc: 'Follow Spotify on the computer, your Spotify account, or both.' },
    { k: 'source', label: 'Source', type: 'choice', def: 'auto',
      desc: 'Auto: the desktop bridge while Spotify plays on the PC, otherwise your Spotify account (phone, speakers…)',
      opts: [['auto', 'Auto'], ['bridge', 'Desktop (Spicetify)'], ['web', 'Spotify account']],
      help: 'Desktop: follow Spotify on the computer through the LyricDock extension (best lyrics, instant). Spotify account: follow whatever device your account plays on, straight from Spotify\'s Web API (needs the Client ID below). Auto: desktop while it plays, account otherwise.' },
    { label: 'LyricDock account', type: 'action', text: () => 'Sign out', run: () => window.Account?.signOut(),
      info: () => { const u = window.Account?.user(); return u ? `${u.name} · ${u.email}` : ''; },
      help: 'LyricDock needs a sign-in with Google on every screen. Signing out here shows the sign-in screen again on this screen only.' },
    // Signing in goes through the setup screen: the dashboard link, the redirect URI and the errors live there.
    { label: 'Spotify account', type: 'action', text: () => (window.Web?.loggedIn() ? 'Sign out' : 'Sign in'),
      run: () => { if (Web.loggedIn()) return Web.logout(); Settings.close(); window.Setup?.open('web'); },
      info: () => window.Web?.status() ?? '',
      help: 'Signs in on this screen (you type your password into Spotify\'s own page). Also lets Spotify on your computer find this screen without a code.' },
    { k: 'spClientId', label: 'Spotify Client ID', type: 'text', def: '', placeholder: '32 hex characters', when: () => !window.Web?.loggedIn(),
      desc: `From developer.spotify.com - redirect URI ${window.LYRICDOCK_WEB ? location.origin : 'http://127.0.0.1:8976'}/callback. No client secret needed.`,
      help: 'developer.spotify.com/dashboard → Create app → Web API, add the redirect URI above → copy the Client ID. Development mode allows 5 users (added by email under User Management); the app owner needs Premium.' },

    { group: 'Presets', icon: 'layers', cat: 'Source', desc: 'Built-in looks and your own, saved on the computer so every phone can use them.' },
    { label: 'Export / import', type: 'io', help: 'Export copies all settings (without API keys) as text you can paste into another phone. Import applies settings pasted here. Spotify\'s LyricDock panel can export and import files too.' },
    { label: 'Presets', type: 'presets', help: 'Built-in: Default (the shipped config), Smooth (for slow phones) and Full Spicy (every effect up). Your own presets are stored in Spotify on the computer.' },

    { group: 'Updates', icon: 'download', cat: 'Ops', desc: 'Automatic updates, the beta channel and release notes.' },
    { k: 'channel', label: 'Update channel', type: 'choice', def: 'stable', when: () => app, opts: [['stable', 'Stable'], ['beta', 'Beta (pre-releases)']],
      help: 'Beta installs pre-releases as soon as they are published (they may have rough edges). Android cannot install an older version over a newer one, so going back from beta to stable waits for the next stable release.' },
    { k: 'autoUpdate', label: 'Update automatically', desc: app ? 'New versions from GitHub Releases install on their own' : 'New versions load on their own', type: 'toggle', def: true,
      help: 'Checks GitHub Releases shortly after start and every 6 hours. In kiosk mode updates install silently; otherwise Android asks once.' },
    { label: 'Reopen by itself', type: 'action', when: () => app, text: () => { try { return Dock.canReopen() ? 'On' : 'Turn on'; } catch (e) { return 'Turn on'; } },
      run: () => { try { Dock.askReopen(); } catch (e) {} },
      info: () => { try { return Dock.canReopen() ? 'The dock comes back by itself after an update or a crash' : 'Off - after an update you get a "tap to reopen" notification'; } catch (e) { return ''; } },
      help: 'Android does not let an app open itself from the background, so after an update (or a crash) the dock could stay closed. Allowing LyricDock to "display over other apps" lets it come straight back. Opens Android\'s switch for it.' },
    { label: 'Install as an app', type: 'action', text: () => 'Install', run: () => window.lyricdockInstall?.() || window.notice?.('Use your browser menu: Install app / Add to Home Screen'),
      when: () => !!window.LYRICDOCK_WEB && !matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches,
      help: 'Puts LyricDock in its own window with an icon, like a normal app, and opens it full screen.' },
    { label: 'Full screen', type: 'action', text: () => 'Go full screen', run: () => window.lyricdockFullscreen?.(), when: () => !!window.LYRICDOCK_WEB && !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen),
      help: 'Hides the browser bars until you press Esc (or swipe on a phone).' },
    { label: 'Miniplayer', type: 'action', text: () => 'Open', run: () => window.lyricdockMini?.(), when: () => !!window.lyricdockMini?.supported,
      help: 'A small always-on-top window with the cover, the line being sung and the controls. Also: press M.' },
    { label: 'LyricDock app', type: 'action', text: () => 'Check now', run: () => window.checkUpdate?.(true), info: () => window.updateStatus?.() ?? '',
      help: 'Check for a new version now and install it if there is one.' },
    { label: 'Changelog', type: 'action', text: () => 'What\'s new', run: () => window.showChangelog?.(), help: 'Release notes for this and earlier versions, from GitHub.' },

    { group: 'Connection', icon: 'link', cat: 'Ops', desc: 'How the phone and Spotify find each other: pairing, signalling server, TURN, kiosk mode.' },
    { label: 'Status', type: 'custom', render: () => window.connCard?.() },
    { label: 'Setup guide', type: 'action', text: () => 'Open', desc: 'The first-run screen: sign in with Spotify or connect Spotify on your computer.', run: () => { Settings.close(); window.Setup?.open(); } },
    { label: 'Pairing code', type: 'action', text: () => 'New code', desc: 'Unpairs every computer: connect again with Find devices.',
      run: () => {
        if (!window.pairArmed) { window.pairArmed = true; setTimeout(() => { window.pairArmed = false; }, 4000); return window.notice?.('Tap New code again: every computer must pair again'); }
        try { localStorage.removeItem('dock:pair'); } catch (e) {}
        location.reload(); // rtc.js makes a fresh code on start
      }, help: 'The code is the key to this screen\'s connection. Make a new one if someone else may have seen it (it was shown on screen, or this phone ran a LyricDock older than v1.8.9 on a shared Wi-Fi).' },
    { k: 'linkPath', label: 'Connection path', type: 'choice', def: 'auto', when: () => app, opts: [['auto', 'Auto (fastest)'], ['usb', 'Prefer USB cable'], ['wifi', 'Wi-Fi only']],
      help: 'How the phone reaches Spotify on your computer. Auto uses whatever works best. Prefer USB cable only offers the USB-tethering network. It works when the computer\'s internet goes through the phone (USB tethering on, and the computer has no other network or prefers the tethered one): Spotify only offers its main network interface. Takes effect on the next connection.' },
    { k: 'relay', label: 'Signalling server', type: 'choice', def: 'ntfy', opts: [['ntfy', 'LyricDock (default)'], ['custom', 'My own ntfy server'], ...(app ? [['helper', 'LyricDock Helper on my PC']] : [])], // an https page can't reach the helper
      help: 'Where the phone and Spotify swap their one-time connection details (encrypted with the pairing code; the server never sees your music or lyrics). LyricDock\'s own server is always used. My own ntfy server: any self-hosted ntfy (https address), used as well. LyricDock Helper: the helper app runs a tiny relay on your PC, so pairing also works without the internet - type your PC\'s IP address below. Spotify takes this setting from the phone.' },
    { k: 'relayUrl', label: 'Server address', type: 'text', def: '', placeholder: 'https://ntfy.example.com  or  192.168.1.20', when: s => s.relay !== 'ntfy',
      help: 'My own ntfy server: its https:// address (Spotify only allows https). LyricDock Helper: the IPv4 address of the PC running the helper (shown on its Dashboard).' },
    { label: 'Local network access', type: 'action', text: () => 'Allow', run: () => window.lyricdockLna?.request(), when: () => !!window.LYRICDOCK_WEB && !!window.lyricdockLna,
      info: () => 'Lets this page reach Spotify on your computer (Chrome / Edge ask once)',
      help: 'Browsers keep websites away from your home network unless you allow it. LyricDock needs it to connect to Spotify on your computer. If you blocked it, allow "Local network" in the site settings (the icon left of the address).' },
    { k: 'ice', label: 'STUN / TURN servers (away from home)', type: 'text', def: '', placeholder: 'turn:host:3478|user|password, stun:host:3478',
      help: 'Only for using LyricDock on a different network from your computer (e.g. phone on mobile data). Add a TURN relay you control as url|username|password; several separated by commas. Options: a Metered.ca or Cloudflare TURN account, or coturn on a VPS. Leave empty at home.' },
    { label: 'Connection log', type: 'info', value: () => (window.connLog?.() ?? []).slice(0, 6).join('  ·  ') || 'Nothing yet', help: 'The last connection events on this phone (connected, lost, reconnected), newest first.' },
    { label: 'Kiosk mode', desc: 'Full screen, starts on boot, silent updates. Leave it to use the phone normally (tap twice).',
      type: 'action', when: () => { try { return Dock.kioskOn(); } catch (e) { return false; } }, text: () => 'Leave',
      run: () => {
        if (window.kioskArmed) { try { Dock.leaveKiosk(); } catch (e) {} window.notice?.('Kiosk mode is off'); return; }
        window.kioskArmed = true; setTimeout(() => { window.kioskArmed = false; }, 4000);
        window.notice?.('Tap Leave again to turn kiosk mode off');
      }, help: 'Kiosk mode was turned on by setup-phone.ps1. Leaving it gives the phone back its normal home screen, status bar and lock screen.' },
  ];

  // Built-in presets (the shipped default config is 'Default'); applied on top of the defaults.
  const BUILTIN = {
    'Default': {},
    'Smooth (slow phones)': { glow: false, letters: false, blurLines: false, glass: false, bgRes: 0.35, bgBlur: 4, bgFps: '30', bgBeat: false, renderDistance: 14 },
    'Full Spicy': { glow: true, glowStrength: 1.3, lift: true, liftAmount: 1.2, letters: true, blurLines: true, bgRes: 0.75, bgBlur: 8, bgFps: 'max', bgBeat: true, bgSaturation: 1.8 },
  };

  // Section icons (24 x 24, 1.8 stroke), shared with Spotify's panel through schema().
  const ICONS = {
    layout: 'M3.5 4.5h17v15h-17zM9.5 4.5v15',
    note: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    image: 'M3.5 5h17v14h-17zM3.5 16l5-5 4 4 3-3 5 5M15.5 9.5h.01',
    text: 'M4 6h16M4 11h11M4 16h14M4 20.5h8',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5',
    phone: 'M7 2.5h10v19H7zM11 18.5h2',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.2 2',
    gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4.2-5.3M3 17h2M19 17h2',
    disk: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    source: 'M4 15v-3a8 8 0 0 1 16 0v3M4 14.5h3v6H4zM17 14.5h3v6h-3z',
    layers: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5',
    download: 'M12 3.5v11M7 10l5 5 5-5M4.5 20h15',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  };
  // Icon tile colours (Apple's system palette, dark mode): each section reads at a glance, like System Settings.
  const TINTS = { layout: '#0A84FF', note: '#FF375F', image: '#BF5AF2', text: '#FF9F0A', spark: '#64D2FF', phone: '#8E8E93', clock: '#5E5CE6',
    gauge: '#30D158', disk: '#64D2FF', source: '#FF453A', layers: '#FFD60A', download: '#0A84FF', link: '#30D158' };
  const KEY = 'dock:settings';
  const defaults = Object.fromEntries(SCHEMA.filter(x => x.k).map(x => [x.k, x.def]));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const fresh = !saved; // first run on this phone: take the desktop's last settings when the bridge sends them
  const S = { ...defaults, ...saved };
  if (typeof S.clockHaptic === 'boolean') S.clockHaptic = S.clockHaptic ? 'light' : 'off'; // was a toggle
  // One time: the progress bar now defaults to "Under the cover"; phones that still had the old default (bottom edge) move over.
  try {
    if (saved && !localStorage.getItem('dock:m17b')) {
      if (S.progress === 'bottom') S.progress = saved.progress = 'art';
      S.blurLines = saved.blurLines = false; // crisp, translucent upcoming lines are the new look
      localStorage.setItem(KEY, JSON.stringify(saved));
      localStorage.setItem('dock:m17b', '1');
    }
  } catch (e) {}
  const listeners = [];
  let presets = {}, presetHook = () => {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const notify = (k, v) => listeners.forEach(f => f(k, v));

  // Every change is saved immediately - sliders included (not only on release).
  function set(k, v, rerender = true) {
    S[k] = v;
    save();
    notify(k, v);
    if (rerender) render();
  }

  // ---- panel (Spicy Lyrics sl-sp-* structure)
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (x, v) => {
    v = +v;
    if (x.unit === 'ms') return `${v > 0 ? '+' : ''}${v} ms`;
    if (x.unit === 's') return `${v} s`;
    if (x.unit) return `${+v.toFixed(2)}${x.unit}`;
    return String(+v.toFixed(2)); // 6, 1.5, 0.35 - no trailing zeros
  };

  function slider(x) {
    const wrap = el('div', 'sl-sp-slider');
    const tw = el('div', 'sl-sp-slider-track-wrap');
    const track = el('div', 'sl-sp-slider-track'), fill = el('div', 'sl-sp-slider-fill');
    const input = el('input', 'sl-sp-slider-input');
    Object.assign(input, { type: 'range', min: x.min, max: x.max, step: x.step, value: S[x.k] });
    const bipolar = x.min < 0 && x.max > 0;
    const meta = el('div', 'sl-sp-slider-meta');
    const val = el('span', 'sl-sp-slider-value'), reset = el('button', 'sl-sp-slider-reset', 'Reset');
    const paint = v => {
      const f = (v - x.min) / (x.max - x.min), c = bipolar ? (0 - x.min) / (x.max - x.min) : 0;
      fill.style.left = Math.min(f, c) * 100 + '%';
      fill.style.width = Math.abs(f - c) * 100 + '%';
      val.textContent = fmt(x, v);
      reset.style.visibility = +v === x.def ? 'hidden' : 'visible';
    };
    // Touch-safe: the native range input grabs any touch that lands on it, which hijacks scrolling the sheet.
    // It is visual only here; a drag must go sideways (>8px, more horizontal than vertical) before it moves the
    // value, a vertical swipe scrolls as normal (touch-action: pan-y). Taps step it (see `end`).
    input.tabIndex = -1;
    const valueAt = cx => {
      const r = tw.getBoundingClientRect(), f = Math.min(1, Math.max(0, (cx - r.left) / r.width));
      const v = x.min + Math.round(f * (x.max - x.min) / x.step) * x.step;
      return +v.toFixed(4);
    };
    let g = null;
    tw.addEventListener('pointerdown', e => { g = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false }; });
    tw.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { g = null; return; } // a scroll, not a slide
        if (Math.abs(dx) < 8) return;
        g.on = true;
        tw.setPointerCapture(e.pointerId);
        wrap.classList.add('dragging');
      }
      const v = valueAt(e.clientX);
      if (v !== +input.value) { input.value = v; paint(v); set(x.k, v, false); }
    });
    const to = v => { v = +Math.min(x.max, Math.max(x.min, v)).toFixed(4); if (v !== +input.value) { input.value = v; paint(v); set(x.k, v, false); } };
    const step = dir => to(+input.value + dir * x.step);
    // A tap steps one notch towards the side tapped; a double tap puts the default back.
    let lastTap = 0;
    const end = e => {
      if (g && !g.on && e.type === 'pointerup') {
        const now = Date.now();
        if (now - lastTap < 320) { to(x.def); lastTap = 0; }
        else {
          const r = tw.getBoundingClientRect(), at = r.left + (+input.value - x.min) / (x.max - x.min) * r.width;
          step(e.clientX < at ? -1 : 1); lastTap = now;
        }
      }
      g = null; wrap.classList.remove('dragging');
    };
    tw.addEventListener('pointerup', end);
    tw.addEventListener('pointercancel', end);
    reset.onclick = () => to(x.def);
    // - / + buttons: one notch per tap, repeating while held.
    const nudge = (label, dir) => {
      const b = el('button', 'sl-sp-slider-step', label);
      b.setAttribute('aria-label', dir < 0 ? 'Less' : 'More');
      let t = 0;
      const stop = () => { clearTimeout(t); clearInterval(t); };
      b.onpointerdown = e => { e.preventDefault(); step(dir); stop(); t = setTimeout(() => { t = setInterval(() => step(dir), 70); }, 400); };
      b.onpointerup = b.onpointercancel = b.onpointerleave = stop;
      return b;
    };
    tw.append(track, fill);
    if (bipolar) { const ctr = el('div', 'sl-sp-slider-center'); ctr.style.left = (0 - x.min) / (x.max - x.min) * 100 + '%'; tw.append(ctr); }
    tw.append(input);
    meta.append(val, reset);
    const row = el('div', 'sl-sp-slider-row');
    row.append(nudge('−', -1), tw, nudge('+', 1));
    wrap.append(row, meta);
    paint(S[x.k]);
    return wrap;
  }

  function control(x) {
    if (x.type === 'info') return el('span', 'sl-sp-description', x.value());
    if (x.type === 'action') {
      const box = el('div', 'sl-presets'), b = el('button', 'sl-text-btn', x.text());
      b.onclick = () => x.run();
      box.append(b, el('span', 'sl-sp-description', x.info?.() ?? '')); // info is optional
      return box;
    }
    if (x.type === 'io') {
      const box = el('div', 'sl-presets sl-io'), ta = el('textarea', 'sl-input');
      ta.placeholder = 'Settings JSON';
      ta.rows = 3;
      const btn = (label, fn) => { const b = el('button', 'sl-text-btn', label); b.onclick = fn; return b; };
      box.append(ta, btn('Export', () => {
        const { apiKey, videoKey, spClientId, ...rest } = S;
        ta.value = JSON.stringify(rest);
        ta.select();
        try { document.execCommand('copy'); window.notice?.('Settings copied'); } catch (e) {}
      }), btn('Import', () => {
        let o = null;
        try { o = JSON.parse(ta.value); } catch (e) {}
        if (!o || typeof o !== 'object' || Array.isArray(o)) return window.notice?.('That is not LyricDock settings JSON');
        load(o); window.notice?.('Settings imported');
      }));
      return box;
    }
    if (x.type === 'text') {
      const i = el('input', 'sl-input');
      Object.assign(i, { value: S[x.k] || '', placeholder: x.placeholder || '', spellcheck: false, autocomplete: 'off' });
      i.onchange = () => set(x.k, i.value.trim());
      return i;
    }
    if (x.type === 'presets') {
      const box = el('div', 'sl-presets');
      const names = Object.keys(presets).sort();
      const sel = el('select', 'sl-sp-select');
      const group = (label, list, prefix) => {
        const g = el('optgroup'); g.label = label;
        for (const n of list) { const o = el('option', null, n); o.value = prefix + n; g.append(o); }
        sel.append(g);
      };
      group('Built-in', Object.keys(BUILTIN), 'b:');
      if (names.length) group('Yours', names, 'u:');
      const pick = () => sel.value.startsWith('b:') ? { ...defaults, ...BUILTIN[sel.value.slice(2)] } : presets[sel.value.slice(2)];
      const btn = (label, fn) => { const b = el('button', 'sl-text-btn', label); b.onclick = fn; return b; };
      const name = el('input', 'sl-input');
      name.placeholder = 'New preset name';
      box.append(sel, btn('Apply', () => { const p = pick(); if (p) load(p); }),
        btn('Delete', () => sel.value.startsWith('u:') && presetHook('delete', sel.value.slice(2))),
        name, btn('Save current', () => name.value.trim() && presetHook('save', name.value.trim().slice(0, 40))));
      return box;
    }
    if (x.type === 'toggle') {
      const l = el('label', 'sl-sp-toggle'), i = el('input');
      i.type = 'checkbox';
      i.checked = !!S[x.k];
      i.onchange = () => set(x.k, i.checked);
      l.append(i, el('span', 'sl-sp-toggle-track'));
      return l;
    }
    if (x.type === 'choice') {
      const s = el('select', 'sl-sp-select');
      for (const [v, name] of x.opts) { const o = el('option', null, name); o.value = v; o.selected = S[x.k] === v; s.append(o); }
      s.onchange = () => set(x.k, s.value);
      return s;
    }
    return slider(x);
  }

  // ---- sheet: an icon rail of sections (a strip along the top in portrait), one section at a time on the right with
  // its category, description and a Reset; the search box in the header searches every section at once.
  let cur = null, query = '';
  const svgI = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const groupKeys = g => { const out = []; for (let j = SCHEMA.findIndex(x => x.group === g) + 1; j < SCHEMA.length && !SCHEMA[j].group; j++) if (SCHEMA[j].k) out.push(SCHEMA[j].k); return out; };
  const visibleRows = g => { const out = []; for (let j = SCHEMA.findIndex(x => x.group === g) + 1; j < SCHEMA.length && !SCHEMA[j].group; j++) if (!SCHEMA[j].when || SCHEMA[j].when(S)) out.push(SCHEMA[j]); return out; };
  function makeRow(x, where) {
    if (x.type === 'custom') { const r = el('div', 'sl-sp-row st-custom'); const c = x.render?.(); if (c) r.append(c); return r; }
    const row = el('div', 'sl-sp-row' + (['range', 'text', 'presets', 'action', 'io'].includes(x.type) ? ' sl-sp-row--stacked' : ''));
    const lw = el('div', 'sl-sp-label-wrap');
    const lab = el('div', 'sl-sp-label', x.label);
    if (where) { const c = el('button', 'st-chip', where); c.onclick = e => { e.stopPropagation(); go(where); }; lab.append(c); }
    if (x.help) { // ⓘ: tap to expand the explanation under the label (hover shows it too, via title)
      const hb = el('button', 'sl-help-btn', 'i');
      hb.title = x.help;
      hb.setAttribute('aria-label', 'What does this do?');
      hb.onclick = e => { e.stopPropagation(); row.classList.toggle('help-open'); };
      lab.append(hb);
    }
    lw.append(lab);
    if (x.desc) lw.append(el('div', 'sl-sp-description', x.desc));
    const c = el('div', 'sl-sp-control');
    c.append(control(x));
    row.append(lw, c);
    if (c.querySelector('select')) row.classList.add('sl-sp-row--choice'); // narrow sheets stack these (no :has() on Chrome 99)
    if (x.help) row.append(el('div', 'sl-sp-help', x.help)); // full row width, under the label + control
    if (x.k) row.dataset.row = x.k;
    return row;
  }
  function go(g) { cur = g; query = ''; const f = document.getElementById('sfind'); if (f) f.value = ''; render(); }
  window.settingsRender = () => render();
  function render() {
    const body = document.querySelector('#settings .sl-modal-main-section');
    if (!body) return;
    const groups = SCHEMA.filter(x => x.group), q = query.trim().toLowerCase();
    if (!groups.some(g => g.group === cur)) cur = groups[0].group;
    const oldPane = body.querySelector('.st-pane'), same = body.dataset.view === `${cur}|${q}`, top = oldPane?.scrollTop ?? 0;
    const rail = el('nav', 'st-rail');
    for (const g of groups) {
      const b = el('button', 'st-tab' + (!q && g.group === cur ? ' on' : ''));
      b.innerHTML = `<i class="st-ico" style="background:${TINTS[g.icon] || '#8E8E93'}">${svgI(ICONS[g.icon] || '')}</i><span></span>`;
      b.lastChild.textContent = g.group;
      b.onclick = () => go(g.group);
      rail.append(b);
    }
    const pane = el('div', 'st-pane'), box = el('div', 'st-box');
    const head = (badge, title, lead, extra) => {
      const hd = el('div', 'st-head');
      const tt = el('div', 'st-tt');
      tt.append(el('div', 'st-cap', badge), el('div', 'st-title', title));
      hd.append(tt);
      if (extra) hd.append(extra);
      pane.append(hd);
      if (lead) pane.append(el('p', 'st-lead', lead));
    };
    if (q) {
      let g = null, n = 0;
      for (const x of SCHEMA) {
        if (x.group) { g = x.group; continue; }
        if ((x.when && !x.when(S)) || !`${x.label} ${x.desc || ''} ${x.help || ''} ${g}`.toLowerCase().includes(q)) continue;
        box.append(makeRow(x, g)); n++;
      }
      head(`${n} result${n === 1 ? '' : 's'}`, 'Search', n ? 'Change them here, or tap a section name to open it.' : 'Nothing matches. Try other words.');
    } else {
      const g = groups.find(x => x.group === cur), keys = groupKeys(cur);
      let r = null;
      if (keys.length) {
        r = el('button', 'sl-group-reset', 'Reset');
        r.onclick = () => { for (const k of keys) if (k !== 'apiKey') S[k] = defaults[k]; save(); notify('*'); render(); window.notice?.(`${cur} reset to defaults`); };
      }
      head(g.cat || 'Settings', g.group, g.desc, r);
      for (const x of visibleRows(cur)) box.append(makeRow(x));
    }
    if (box.childElementCount) pane.append(box);
    const wrap = el('div', 'st-wrap');
    wrap.append(rail, pane);
    body.replaceChildren(wrap);
    body.dataset.view = `${cur}|${q}`;
    pane.scrollTop = same ? top : 0;
    if (!same) rail.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    window.onSettingsRender?.(); // toggles / choices re-render (sliders don't): the quick sheet follows
  }
  const findInput = document.getElementById('sfind');
  if (findInput) findInput.oninput = () => { query = findInput.value; render(); };

  // A few settings as ready-made rows (the quick sheet in features.js): same controls, same live state as the full sheet.
  const byKey = k => SCHEMA.find(x => x.k === k);
  const rows = keys => keys.map(byKey).filter(x => x && (!x.when || x.when(S))).map(x => makeRow(x));
  const open = () => { render(); document.body.classList.add('settings-open'); };
  const close = () => document.body.classList.remove('settings-open');
  const reset = () => { Object.assign(S, defaults, { apiKey: S.apiKey }); save(); notify('*'); render(); };
  // Apply a whole settings object (preset or the desktop's last settings). Unknown keys are ignored.
  function load(obj) {
    for (const k of Object.keys(defaults)) if (obj && k in obj && k !== 'apiKey') S[k] = obj[k];
    if (obj?.apiKey && !S.apiKey) S.apiKey = obj.apiKey;
    save(); notify('*'); render();
  }

  // Serializable copy of the schema for the desktop panel (functions dropped; actions/info/presets are phone-only).
  const schema = () => SCHEMA.filter(x => x.group || (x.k && x.type !== 'info'))
    .filter((x, i, a) => !x.group || (a[i + 1] && !a[i + 1].group)) // drop sections with nothing editable (Presets, Connection)
    .map(({ group, k, label, type, def, opts, min, max, step, unit, desc, placeholder, help, icon, cat }) =>
      ({ group, k, label, type, def, opts, min, max, step, unit, desc, placeholder, help, icon: ICONS[icon], tint: TINTS[icon], cat }));
  // A change from the desktop panel: only known keys, and only values of the default's type.
  const setRemote = (k, v) => { if (k in defaults && typeof v === typeof defaults[k] && (x => !x.opts || x.opts.some(o => o[0] === v))(SCHEMA.find(x => x.k === k))) set(k, v); };

  return {
    S, set, setRemote, schema, open, close, reset, load, fresh, render, rows, BUILTIN, defaults, ICONS,
    onChange: f => listeners.push(f),
    setPresets: p => { presets = p && typeof p === 'object' ? p : {}; render(); },
    onPreset: f => { presetHook = f; },
  };
})();
