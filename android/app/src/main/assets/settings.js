// Settings: one schema drives defaults, persistence (localStorage) and the in-app panel.
// The panel reuses Spicy Lyrics' settings-panel markup/classes (sl-sp-*), styled in index.html.
const Settings = (() => {
  // Every setting: `desc` is the one-liner under the label, `help` the longer explanation behind the ⓘ button
  // (tap on the phone, hover in Spotify's panel). Defaults here ARE the shipped default config ("Reset all").
  const dyn = s => s.bg === 'dynamic' || s.bg === 'artist';
  const SCHEMA = [
    { group: 'Layout' },
    { k: 'layout', label: 'Layout', type: 'choice', def: 'split', opts: [
      ['split', 'Default'], ['player', 'Player card'], ['lyrics', 'Lyrics only'], ['compact', 'Compact'], ['tv', 'TV view'], ['cinema', 'Cinema'], ['nowbar', 'Now Bar']],
      help: 'Default: cover + title beside the lyrics. Lyrics only: full-width lyrics. Compact: small cover row on top. TV view: bigger cover and text for across-the-room viewing. Cinema: huge centred lyrics with a small badge. Now Bar: lyrics with a floating pill at the bottom. Player card: an always-visible player (progress, shuffle, repeat, volume) beside the lyrics, like an Apple Music mini player.' },
    { k: 'artSide', label: 'Cover side', type: 'choice', def: 'left', opts: [['left', 'Cover left, lyrics right'], ['right', 'Lyrics left, cover right']],
      when: s => s.layout === 'split' || s.layout === 'tv', help: 'Swap which side the album art and the lyrics sit on (landscape). In portrait the cover is always on top.' },
    { k: 'progress', label: 'Progress bar', type: 'choice', def: 'bottom', opts: [['bottom', 'Bottom'], ['top', 'Top'], ['off', 'Off']],
      help: 'Where the song progress bar sits. Tap it (while the controls are showing) to seek.' },
    { k: 'times', label: 'Show times', desc: 'Elapsed and total time next to the progress bar', type: 'toggle', def: false,
      help: 'Shows 1:23 / 3:45 above the ends of the progress bar.' },
    { k: 'hideAfter', label: 'Hide controls after', type: 'range', min: 2, max: 10, step: 1, def: 4, unit: 's',
      help: 'Tap anywhere to show play/pause, next, previous, volume and the settings button. They fade out after this many seconds.' },
    { k: 'marquee', label: 'Scroll long titles', type: 'toggle', def: true, help: 'Song titles and artist lists that do not fit scroll slowly back and forth instead of being cut off.' },
    { k: 'showShuffle', label: 'Shuffle and repeat buttons', type: 'toggle', def: true, help: 'Adds shuffle and repeat (off / all / one) next to previous and next.' },
    { k: 'showLists', label: 'Queue, history and friends buttons', type: 'toggle', def: true, help: 'Buttons that open the queue, recently played, your library and your friends\' listening activity.' },
    { k: 'swipe', label: 'Swipe to skip', type: 'toggle', def: true, help: 'Swipe left for the next song, right for the previous one.' },
    { k: 'doubleTapLike', label: 'Double-tap to like', type: 'toggle', def: true, help: 'Double-tap anywhere (not on a button) to add the song to Liked Songs or remove it.' },
    { k: 'nextChip', label: 'Up next chip', type: 'toggle', def: true, help: 'Near the end of a song, a small chip shows what plays next.' },
    { k: 'nextChipSecs', label: 'Show it for the last', type: 'range', min: 5, max: 45, step: 5, def: 15, unit: ' s', when: s => s.nextChip, help: 'How long before the end of the song the chip appears.' },
    { k: 'showVolume', label: 'Volume slider', type: 'toggle', def: true, help: 'Show a volume slider in the controls. It changes Spotify\'s volume (not the phone\'s).' },
    { k: 'orientation', label: 'Orientation', type: 'choice', def: 'auto', opts: [['auto', 'Auto-rotate (all 4)'], ['landscape', 'Landscape'], ['portrait', 'Portrait']],
      help: 'Auto follows how the phone is standing, including upside down. Lock it if the phone lies on a sensor-confusing stand.' },
    { k: 'edgeMode', label: 'Notch & edge spacing', desc: 'Auto reads the camera cutout and rounded corners from the phone',
      type: 'choice', def: 'auto', opts: [['auto', 'Auto'], ['manual', 'Manual']],
      help: 'Auto keeps text clear of the camera notch and pulls the progress bar in where the rounded corners would cut it. Manual lets you set both yourself.' },
    { k: 'edgePad', label: 'Side padding', type: 'range', min: 0, max: 80, step: 2, def: 24, unit: 'px', when: s => s.edgeMode === 'manual',
      help: 'Extra space on the left and right edges.' },
    { k: 'cornerPad', label: 'Progress bar corner inset', type: 'range', min: 0, max: 80, step: 2, def: 20, unit: 'px', when: s => s.edgeMode === 'manual',
      help: 'How rounded the screen corners are: the progress bar is lifted and shortened to stay inside them.' },

    { group: 'Now playing' },
    { k: 'showLiked', label: 'Show liked (heart)', desc: 'Tap the heart to like / unlike', type: 'toggle', def: true,
      help: 'Green heart = in your Liked Songs. Tapping it saves or removes the song in Spotify.' },
    { k: 'heartPos', label: 'Like button position', type: 'choice', def: 'art', opts: [['art', 'Badge on the cover'], ['title', 'Next to the title']], when: s => s.showLiked, help: 'Where the heart sits: a small badge in the corner of the album art, or beside the song title.' },
    { k: 'albumLine', label: 'Album and year', type: 'toggle', def: true, help: 'Shows the album name and release year under the artist.' },
    { k: 'sourceBadge', label: 'Lyrics source badge', type: 'toggle', def: false, help: 'A small label in the corner naming where the lyrics came from (Spicy Lyrics, Apple Music, Spotify, LRCLIB).' },
    { k: 'showQuality', label: 'Show audio quality', type: 'toggle', def: true, help: 'Shows Spotify\'s current streaming quality (Low … Very high, Lossless) under the artist.' },
    { k: 'accent', label: 'Accent colour from cover', type: 'toggle', def: true,
      help: 'Tints the progress bar, buttons and settings with a colour picked from the album art. Off: plain white.' },
    { k: 'spin', label: 'Spinning cover (Now Bar)', type: 'toggle', def: true, when: s => s.layout === 'nowbar', help: 'The round cover in the Now Bar turns like a record while playing.' },
    { k: 'notices', label: 'Status notices', desc: 'Short messages: offline, rate limits, source changes, updates', type: 'toggle', def: true,
      help: 'Small toasts at the bottom for things worth knowing: network lost/back, Spicy API limits, switching between computer and account, pairing, updates.' },

    { group: 'Background' },
    { k: 'bg', label: 'Background', type: 'choice', def: 'dynamic', opts: [
      ['dynamic', 'Dynamic'], ['artist', 'Artist image (dynamic)'], ['blur', 'Blurred art'], ['gradient', 'Colour gradient'], ['black', 'Black']],
      help: 'Dynamic: the cover slowly warped and blurred (Spicy Lyrics\' look, uses the GPU). Artist image: the same effect with the artist\'s photo. Blurred art: a still blurred cover. Colour gradient: slow gradient from the cover\'s colours. Black: nothing (OLED, lowest power).' },
    { k: 'bgSpeed', label: 'Motion speed', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0.35, when: dyn, help: 'How fast the dynamic background drifts. 0 freezes it.' },
    { k: 'bgBeat', label: 'Move with the music', desc: 'Livelier while words are sung, calm in instrumental parts', type: 'toggle', def: true, when: dyn,
      help: 'Speeds the background up while vocals are busy (read from the lyric timing) and slows it in instrumental parts.' },
    { k: 'bgWarp', label: 'Warp', type: 'range', min: 0, max: 1, step: 0.05, def: 1, when: dyn, help: 'How much the image is swirled. 0 = just a blurred, slowly moving cover.' },
    { k: 'bgSaturation', label: 'Colour intensity', type: 'range', min: 0.5, max: 2.5, step: 0.05, def: 1.5, unit: '×', when: dyn, help: 'Saturation of the dynamic background. Higher = more vivid.' },
    { k: 'bgFade', label: 'Cover crossfade', type: 'range', min: 0, max: 3000, step: 100, def: 1000, unit: ' ms', when: dyn, help: 'How long the background takes to blend into the next song\'s cover.' },
    { k: 'bgDim', label: 'Dim', type: 'range', min: 0, max: 0.8, step: 0.05, def: 0.2, when: s => s.bg !== 'black', help: 'Darkens the background so white lyrics stay readable on bright covers or artist photos.' },

    { group: 'Lyrics' },
    { k: 'roman', label: 'Romanization', desc: 'Smart keeps Hindi (Devanagari) as is and romanizes everything else',
      type: 'choice', def: 'smart', opts: [['smart', 'Smart (keep Hindi)'], ['always', 'Always'], ['off', 'Original script']],
      help: 'Smart: Hindi stays in Devanagari, Punjabi (Gurmukhi/Shahmukhi), Urdu and other scripts become Latin letters. Always: everything in Latin letters. Original: no romanization.' },
    { k: 'size', label: 'Text size', type: 'range', min: 0.6, max: 1.6, step: 0.05, def: 1, unit: '×', help: 'Lyrics size. Layouts scale from this (TV and Cinema are bigger).' },
    { k: 'font', label: 'Font', type: 'choice', def: 'system', opts: [['system', 'System (Roboto)'], ['Inter', 'Inter'], ['Outfit', 'Outfit'], ['Manrope', 'Manrope'], ['DM Sans', 'DM Sans'], ['Plus Jakarta Sans', 'Plus Jakarta Sans'], ['Space Grotesk', 'Space Grotesk'], ['Sora', 'Sora'], ['Lexend', 'Lexend'], ['Poppins', 'Poppins'], ['Playfair Display', 'Playfair Display (serif)'], ['Lora', 'Lora (serif)'], ['JetBrains Mono', 'JetBrains Mono']],
      help: 'Typeface for lyrics and titles. Anything but System downloads once from Google Fonts and is then cached; scripts a font lacks (Devanagari, Gurmukhi…) fall back to the system font.' },
    { k: 'weight', label: 'Text weight', type: 'choice', def: '700', opts: [['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']],
      help: 'Thickness of the lyrics font.' },
    { k: 'align', label: 'Alignment', type: 'choice', def: 'left', opts: [['left', 'Left'], ['center', 'Centre']], help: 'Duet lines sung by the second singer still go to the other side.' },
    { k: 'anchor', label: 'Active line position', desc: 'How far down the screen the current line sits', type: 'range', min: 0.2, max: 0.6, step: 0.05, def: 0.35,
      help: '0.2 = near the top (more upcoming lines visible), 0.6 = below the middle (more past lines).' },
    { k: 'lineGap', label: 'Line spacing', type: 'range', min: 0, max: 5, step: 0.25, def: 1.5, help: 'Space between lyric lines.' },
    { k: 'lineOpacity', label: 'Other lines brightness', type: 'range', min: 0.15, max: 0.85, step: 0.05, def: 0.5, help: 'How visible the lines that aren\'t being sung are. Spicy Lyrics uses 0.5.' },
    { k: 'lineColor', label: 'Sung line colour', type: 'choice', def: 'white', opts: [['white', 'White'], ['accent', 'Accent from cover']], help: 'Colour the word fill sweeps in. Accent uses the colour picked from the album art.' },
    { k: 'duetColors', label: 'Colour per singer (duets)', type: 'toggle', def: true, help: 'In duets, the second singer\'s lines (sung on the other side) are tinted with the accent colour so the voices are easy to tell apart.' },
    { k: 'outline', label: 'Text shadow for bright backgrounds', type: 'toggle', def: false, help: 'A soft dark shadow under the lyrics keeps them readable over bright covers and artist photos.' },
    { k: 'hideExplicit', label: 'Hide explicit words', type: 'toggle', def: false, help: 'Masks common English swear words in the lyrics (f***). Only changes what is shown.' },
    { k: 'countdown', label: 'Countdown before singing', type: 'toggle', def: true, help: 'In the intro, the last 3 seconds before the first line count down 3 · 2 · 1 above the dots.' },
    { k: 'blurLines', label: 'Blur distant lines', type: 'toggle', def: true, help: 'Lines two or more away from the current one are softly blurred, drawing the eye to the sung line.' },
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
    { k: 'credits', label: 'Show credits', desc: 'Written by / Provided by under the lyrics', type: 'toggle', def: true,
      help: 'Songwriters are optional; the lyrics provider (and community sync credits) are always shown, as the providers require.' },
    { k: 'tapSeek', label: 'Tap a line to jump to it', type: 'toggle', def: true, help: 'Tap any synced line to seek Spotify to it.' },
    { k: 'offset', label: 'Sync offset', desc: 'Positive shows lyrics later, negative earlier', type: 'range', min: -1000, max: 1000, step: 10, def: 0, unit: 'ms',
      help: 'Nudge if lyrics run early or late (e.g. Bluetooth speaker delay: try +150 to +300 ms).' },
    { k: 'apiKey', label: 'Spicy Lyrics API key (optional)', type: 'text', def: '', placeholder: 'sl_pk_…',
      desc: 'Your own publishable key with "No origin header" allowed. Fills gaps the desktop cache misses.',
      help: 'Get one at developers.spicylyrics.org → your application → Client access (no backend) → publishable key (sl_pk_…), with "No origin header" allowed. Never paste a secret key (sl_sk_…). Needed for word-synced lyrics in Spotify-account mode.' },

    { group: 'Animations' },
    { k: 'trackAnim', label: 'Next / previous', type: 'choice', def: 'slide', opts: [
      ['slide', 'Slide'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['flip', 'Flip'], ['blur', 'Blur'], ['stack', 'Card stack'], ['none', 'None']],
      help: 'How the screen changes to the next song. Next moves left, previous moves right.' },
    { k: 'ppAnim', label: 'Play / pause', type: 'choice', def: 'both', opts: [
      ['both', 'Pulse + shrink'], ['pulse', 'Pulse'], ['shrink', 'Shrink art'], ['ripple', 'Ripple'], ['none', 'None']],
      help: 'Feedback when playback pauses or resumes. Shrink makes the cover smaller while paused.' },
    { k: 'scroll', label: 'Lyrics scroll', type: 'choice', def: 'smooth', opts: [['smooth', 'Smooth'], ['spring', 'Springy'], ['snappy', 'Snappy']],
      help: 'How the lyrics glide to the next line. Springy overshoots a little.' },
    { k: 'animSpeed', label: 'Animation speed', type: 'range', min: 0.5, max: 2, step: 0.1, def: 1, unit: '×', help: 'Speeds up or slows down every UI animation.' },

    { group: 'Screen' },
    { k: 'awake', label: 'Keep the screen on', type: 'choice', def: 'always', opts: [['always', 'Always'], ['playing', 'Only while playing'], ['system', 'Follow Android']],
      help: 'Always: never sleeps (the kiosk default). Only while playing: the screen turns off after music has been paused for the time below. Follow Android: the normal screen timeout.' },
    { k: 'sleepAfter', label: 'Turn off after pausing for', type: 'range', min: 1, max: 60, step: 1, def: 10, unit: ' min', when: s => s.awake === 'playing', help: 'How long the screen stays on after music stops.' },
    { k: 'clock', label: 'Clock screen', type: 'choice', def: 'paused', opts: [['off', 'Off'], ['paused', 'When paused'], ['idle', 'When nothing is playing']],
      help: 'A calm full-screen clock with the date and the next song, shown after a while without music. Tap it to go back.' },
    { k: 'clockAfter', label: 'Show the clock after', type: 'range', min: 1, max: 30, step: 1, def: 3, unit: ' min', when: s => s.clock !== 'off', help: 'Minutes without music before the clock appears.' },
    { k: 'night', label: 'Night mode', type: 'toggle', def: false, help: 'Between the hours below: dims everything, switches to a black background and warms the colours.' },
    { k: 'nightFrom', label: 'Night starts at', type: 'range', min: 0, max: 23, step: 1, def: 22, unit: ':00', when: s => s.night, help: 'Hour (24-hour clock) night mode starts.' },
    { k: 'nightTo', label: 'Night ends at', type: 'range', min: 0, max: 23, step: 1, def: 7, unit: ':00', when: s => s.night, help: 'Hour (24-hour clock) night mode ends.' },
    { k: 'nightDim', label: 'Night dimming', type: 'range', min: 0, max: 0.85, step: 0.05, def: 0.5, when: s => s.night, help: 'How much darker everything gets at night.' },
    { k: 'nightWarm', label: 'Night warmth', type: 'range', min: 0, max: 1, step: 0.05, def: 0.4, when: s => s.night, help: 'Amber tint at night (less blue light).' },
    { k: 'burnIn', label: 'Burn-in protection', type: 'toggle', def: true, help: 'AMOLED screens can keep a ghost of things that never move. This shifts the layout by a few pixels every few minutes: invisible, but it spreads the wear.' },
    { k: 'battery', label: 'Battery indicator', type: 'toggle', def: false, help: 'Shows the phone\'s battery level and whether it is charging, in a corner (handy for a kiosk dock).' },

    { group: 'Performance' },
    { k: 'bgRes', label: 'Background resolution', type: 'range', min: 0.2, max: 1, step: 0.05, def: 0.5, unit: '×',
      help: 'Size the dynamic background is drawn at. Under this much blur 0.5 looks the same as 1 and is what lets a budget phone hold 60 fps.' },
    { k: 'bgBlur', label: 'Background blur passes', type: 'range', min: 1, max: 12, step: 1, def: 6, help: 'Softness of the dynamic background. More passes = smoother, more GPU work.' },
    { k: 'bgFps', label: 'Background frame rate', type: 'choice', def: 'max', opts: [['max', 'Match display'], ['165', '165 fps'], ['144', '144 fps'], ['120', '120 fps'], ['100', '100 fps'], ['90', '90 fps'], ['75', '75 fps'], ['60', '60 fps'], ['45', '45 fps'], ['30', '30 fps'], ['24', '24 fps'], ['20', '20 fps'], ['15', '15 fps']],
      help: 'Cap for the dynamic background. Match display runs at the screen\'s own refresh rate (60, 90, 120, 144 Hz…); a phone never goes above its screen. The background moves slowly, so 30 fps is hard to tell apart and saves power.' },
    { k: 'renderDistance', label: 'Lines kept drawn', type: 'range', min: 8, max: 60, step: 1, def: 20, help: 'Lines further than this from the current one are not drawn at all (long songs stay light). Raise it if you use a tiny text size.' },

    { group: 'Playback source' },
    { k: 'source', label: 'Source', type: 'choice', def: 'auto',
      desc: 'Auto: the desktop bridge while Spotify plays on the PC, otherwise your Spotify account (phone, speakers…)',
      opts: [['auto', 'Auto'], ['bridge', 'Desktop (Spicetify)'], ['web', 'Spotify account']],
      help: 'Desktop: follow Spotify on the computer through the LyricDock extension (best lyrics, instant). Spotify account: follow whatever device your account plays on, straight from Spotify\'s Web API (needs the Client ID below). Auto: desktop while it plays, account otherwise.' },
    { k: 'spClientId', label: 'Spotify Client ID', type: 'text', def: '', placeholder: '32 hex characters',
      desc: 'From developer.spotify.com - redirect URI http://127.0.0.1:8976/callback. No client secret needed.',
      help: 'developer.spotify.com/dashboard → Create app → Web API, redirect URI http://127.0.0.1:8976/callback → copy the Client ID. Development mode allows 5 users; the app owner needs Premium.' },
    { label: 'Spotify account', type: 'action', text: () => (window.Web?.loggedIn() ? 'Sign out' : 'Sign in'),
      run: () => (Web.loggedIn() ? Web.logout() : Web.login()), info: () => window.Web?.status() ?? '',
      help: 'Signs in on this phone (you type your password into Spotify\'s own page). Also lets Spotify on your computer find this phone without a code.' },

    { group: 'Presets', desc: 'Built-in presets, plus your own (saved on the desktop, so another phone can reuse them)' },
    { label: 'Presets', type: 'presets', help: 'Built-in: Default (the shipped config), Smooth (for slow phones) and Full Spicy (every effect up). Your own presets are stored in Spotify on the computer.' },

    { group: 'Updates' },
    { k: 'autoUpdate', label: 'Update automatically', desc: 'New versions from GitHub Releases install on their own', type: 'toggle', def: true,
      help: 'Checks GitHub Releases shortly after start and every 6 hours. In kiosk mode updates install silently; otherwise Android asks once.' },
    { label: 'LyricDock app', type: 'action', text: () => 'Check now', run: () => window.checkUpdate?.(true), info: () => window.updateStatus?.() ?? '',
      help: 'Check for a new version now and install it if there is one.' },

    { group: 'Connection' },
    { label: 'Link', type: 'info', value: () => window.dockStatus?.() ?? '', help: 'How this phone is currently getting playback: from the computer (direct Wi-Fi / WebRTC, or USB for developers) or from your Spotify account.' },
    { label: 'Pairing code', desc: 'Enter once in Spotify → LyricDock (top bar) → Pair phone', type: 'info', value: () => window.Rtc?.code ?? '',
      help: 'Type this into Spotify on your computer once: click the LyricDock button in the top bar → Pair phone. It also encrypts the connection setup.' },
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
    'Smooth (slow phones)': { glow: false, letters: false, blurLines: false, bgRes: 0.35, bgBlur: 4, bgFps: '30', bgBeat: false, renderDistance: 14 },
    'Full Spicy': { glow: true, glowStrength: 1.3, lift: true, liftAmount: 1.2, letters: true, blurLines: true, bgRes: 0.75, bgBlur: 8, bgFps: 'max', bgBeat: true, bgSaturation: 1.8 },
  };

  const KEY = 'dock:settings';
  const defaults = Object.fromEntries(SCHEMA.filter(x => x.k).map(x => [x.k, x.def]));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const fresh = !saved; // first run on this phone: take the desktop's last settings when the bridge sends them
  const S = { ...defaults, ...saved };
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
    // value, a vertical swipe scrolls as normal (touch-action: pan-y), and a plain tap changes nothing.
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
    const end = () => { g = null; wrap.classList.remove('dragging'); };
    tw.addEventListener('pointerup', end);
    tw.addEventListener('pointercancel', end);
    reset.onclick = () => { input.value = x.def; paint(x.def); set(x.k, x.def, false); };
    tw.append(track, fill);
    if (bipolar) { const ctr = el('div', 'sl-sp-slider-center'); ctr.style.left = (0 - x.min) / (x.max - x.min) * 100 + '%'; tw.append(ctr); }
    tw.append(input);
    meta.append(val, reset);
    wrap.append(tw, meta);
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

  function render() {
    const body = document.querySelector('#settings .sl-modal-main-section');
    if (!body) return;
    const top = body.scrollTop;
    // Rows live in an inner, auto-height wrapper: multi-column on the fixed-height scroller itself would
    // overflow into extra columns off to the side (settings "missing") instead of scrolling.
    const cols = el('div', 'sl-cols');
    body.replaceChildren(cols);
    cols.append(...SCHEMA.filter(x => !x.when || x.when(S)).map(x => {
      if (x.group) return el('div', 'sl-sp-section-title', x.group);
      const row = el('div', 'sl-sp-row' + (['range', 'text', 'presets', 'action'].includes(x.type) ? ' sl-sp-row--stacked' : ''));
      const lw = el('div', 'sl-sp-label-wrap');
      const lab = el('div', 'sl-sp-label', x.label);
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
      if (x.help) row.append(el('div', 'sl-sp-help', x.help)); // full row width, under the label + control
      return row;
    }));
    body.scrollTop = top;
  }

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
    .map(({ group, k, label, type, def, opts, min, max, step, unit, desc, placeholder, help }) =>
      ({ group, k, label, type, def, opts, min, max, step, unit, desc, placeholder, help }));
  // A change from the desktop panel: only known keys, and only values of the default's type.
  const setRemote = (k, v) => { if (k in defaults && typeof v === typeof defaults[k] && (x => !x.opts || x.opts.some(o => o[0] === v))(SCHEMA.find(x => x.k === k))) set(k, v); };

  return {
    S, set, setRemote, schema, open, close, reset, load, fresh, render, BUILTIN, defaults,
    onChange: f => listeners.push(f),
    setPresets: p => { presets = p && typeof p === 'object' ? p : {}; render(); },
    onPreset: f => { presetHook = f; },
  };
})();
