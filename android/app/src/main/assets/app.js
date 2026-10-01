// LyricDock: playback clock, track changes (with preloaded art), background, controls, settings.
const $ = id => document.getElementById(id);
const S = Settings.S;
const P = { pos: 0, at: 0, playing: false, dur: 0, id: null, art: null, lyrics: null, dir: 1, dirAt: 0, lockUntil: 0, token: 0,
  shown: false, liked: false, heartLock: 0, quality: null, gotHello: false };
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 5h4v14H6zm8 0h4v14h-4z';
const ms = t => t / S.animSpeed;
// The song position. Every bridge beat (~500 ms) re-measures it, and the measurements are a little noisy, so following
// them raw makes the word sweep jump by tens of ms on each beat. Like Spicy Lyrics, keep a predicted clock that advances
// with wall-clock time and is pulled toward the measurement with a frame-rate-independent low-pass (time constant 300 ms);
// a difference over 500 ms is a real jump (seek, new song) and snaps. It never adds lag, it only spreads the noise.
const K = { v: 0, t: 0, id: null, playing: false };
function pos() {
  const t = performance.now(), dt = t - K.t;
  if (dt <= 0) return K.v;
  const m = P.pos + (P.playing ? t - P.at : 0), fresh = !P.playing || !K.playing || K.id !== P.id;
  K.t = t; K.id = P.id; K.playing = P.playing;
  if (fresh) return (K.v = m); // paused, just resumed or a new song: trust the measurement
  const err = m - (K.v + dt);
  return (K.v = Math.abs(err) > 500 ? m : K.v + dt + err * (1 - Math.exp(-dt / 300)));
}
// Lyrics use the position plus the user's sync offset; the progress bar and time labels use the real position.
const now = () => pos() + S.offset;
// To the desktop bridge over whichever link is up: the adb WebSocket (native) and/or the WebRTC channel (rtc.js).
const send = o => { const s = JSON.stringify(o); try { Dock.send(s); } catch (e) {} Rtc.send(s); };
const sleep = t => new Promise(r => setTimeout(r, t));

// ---- art cache: covers are decoded before they're shown, so animations never reveal a half-loaded image
const arts = new Map(), pre = new Map();
function art(url) {
  if (!url) return Promise.resolve(null);
  if (!arts.has(url)) {
    const im = new Image();
    im.crossOrigin = 'anonymous'; // i.scdn.co sends ACAO:* - needed for WebGL + colour sampling
    im.src = url;
    arts.set(url, im.decode().then(() => im, () => null));
    if (arts.size > 12) arts.delete(arts.keys().next().value);
  }
  return arts.get(url);
}

// ---- background
let kw = null;
// Half the CSS-pixel size (a quarter of the device's): identical under this much blur, and it's what lets the
// phone's GPU (Adreno 505) hold 60fps - full size ran the whole app at 32-42fps.
// Settings -> Performance -> Background resolution (default 0.5).
function sizeBg() { const c = $('bgc'); c.width = Math.round(innerWidth * S.bgRes); c.height = Math.round(innerHeight * S.bgRes); kw?.resize(); }
function kawarp() {
  if (kw || !window.Kawarp) return kw;
  try {
    kw = new Kawarp($('bgc'), { animationSpeed: S.bgSpeed, warpIntensity: S.bgWarp, blurPasses: S.bgBlur, saturation: S.bgSaturation,
      tintIntensity: 0, dithering: 0.008, transitionDuration: S.bgFade, scale: 1 });
    // Frame-rate cap (Settings -> Performance): Kawarp's own loop, minus the frames the cap skips.
    const k = kw;
    k.renderLoop = t => {
      if (!k.isPlaying) return;
      if (S.bgFps === 'max' || t - k.lastFrameTime >= 1000 / +S.bgFps - 2) {
        const dt = (t - k.lastFrameTime) / 1000;
        k.lastFrameTime = t;
        k._animationSpeed += (k._targetAnimationSpeed - k._animationSpeed) * 0.05;
        k.accumulatedTime += dt * k._animationSpeed;
        k.render(k.accumulatedTime, t);
      }
      k.animationId = requestAnimationFrame(k.renderLoop);
    };
    sizeBg(); // canvas is 300x150 until told otherwise
  } catch (e) { kw = null; } // no WebGL -> blurred-art fallback below
  return kw;
}

const colCache = new Map();
function colours(im) {
  const hit = colCache.get(im.src);
  if (hit) return hit;
  const c = document.createElement('canvas'), n = 12;
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data;
  const avg = (x0, y0, x1, y1) => {
    let r = 0, gg = 0, b = 0, k = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * n + x) * 4; r += px[i]; gg += px[i + 1]; b += px[i + 2]; k++; }
    return `rgb(${r / k | 0},${gg / k | 0},${b / k | 0})`;
  };
  const r = [avg(0, 0, 6, 6), avg(3, 3, 9, 9), avg(6, 6, 12, 12)];
  colCache.set(im.src, r);
  if (colCache.size > 12) colCache.delete(colCache.keys().next().value);
  return r;
}

// 'artist' is the dynamic background fed the artist's picture instead of the cover (falls back to the cover).
const artistImgs = new Map(), audio = new Map();
// Accent colour (progress bar, buttons, settings): the most colourful of the cover's three sampled colours, lifted
// so it stays visible on dark backgrounds. Settings -> Now playing -> Accent colour from cover.
function accentFrom(cs) {
  const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
  let [r, g, b] = cs.map(c => c.match(/\d+/g).map(Number)).sort((x, y) => sat(y) - sat(x))[0];
  const k = 220 / Math.max(r, g, b, 1);
  if (k > 1) { r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k); }
  document.documentElement.style.setProperty('--acc', `${r | 0}, ${g | 0}, ${b | 0}`);
}

function background(url, im) {
  if (S.bg === 'artist' && P.artistImg && url === P.art) {
    const a = P.artistImg;
    return art(a).then(i => { if (P.artistImg === a) paint(a, i); });
  }
  paint(url, im);
}
function paint(url, im) {
  const root = document.documentElement.style, dyn = S.bg === 'dynamic' || S.bg === 'artist'; // canvas / video: blurred cover under the video
  // Image still downloading (swap only waits ~0.9s): finish it, then update - otherwise the old song's colours stick.
  if (!im && url) art(url).then(i => { if (i && (P.art === url || P.artistImg === url)) paint(url, i); });
  $('bg').style.backgroundImage = url ? `url("${url}")` : 'none';
  if (dyn && im && kawarp()) {
    try { kw.loadImageElement(im); kw.start(); } catch (e) {}
  } else kw?.stop();
  if (im) try {
    const cs = colours(im);
    if (S.bg === 'gradient') cs.forEach((c, i) => root.setProperty(`--c${i + 1}`, c));
    accentFrom(cs);
  } catch (e) {}
  if (dyn && !kawarp()) { document.body.classList.remove('bg-dynamic', 'bg-artist'); document.body.classList.add('bg-blur'); } // no WebGL
}
function onArtist(m) {
  if (!/^https:\/\/[^"'()\\\s]+$/.test(m.img || '')) return;
  artistImgs.set(m.id, m.img);
  if (artistImgs.size > 12) artistImgs.delete(artistImgs.keys().next().value);
  if (m.id === P.id && P.artistImg !== m.img) { P.artistImg = m.img; if (S.bg === 'artist') background(P.art); }
}
// Tempo + loudness (0..1 every 0.5s) from Spotify desktop's audio analysis: the background moves with the music.
function onAudio(m) {
  if (typeof m.id !== 'string' || !Number.isFinite(m.tempo) || !Array.isArray(m.loud)) return;
  audio.set(m.id, m);
  if (audio.size > 6) audio.delete(audio.keys().next().value);
}
let beatAt = 0;
function beatBg(p) {
  if (!kw || performance.now() - beatAt < 200) return;
  beatAt = performance.now();
  const a = S.bgBeat && audio.get(P.id);
  const e = S.bgBeat && !a ? Lyrics.energy(p) : null; // no audio analysis (Spotify removed it): follow the vocals
  const level = a ? a.loud[Math.max(0, p / 500 | 0)] ?? 0.5 : 0.5;
  const target = !P.playing ? S.bgSpeed
    : a ? S.bgSpeed * Math.min(1.6, Math.max(0.6, a.tempo / 120)) * (0.45 + level * 1.1)
    : e !== null ? S.bgSpeed * (0.4 + e * 1.4) : S.bgSpeed;
  kw.animationSpeed += (target - kw.animationSpeed) * 0.35; // eased, so beats swell rather than jerk
}

// ---- short status notices (Spicy-style toasts)
let toastT;
window.notice = (text, ms = 3500) => {
  if (!S.notices) return;
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
};
addEventListener('offline', () => notice('Offline - lyrics and art may be missing until the network is back'));
addEventListener('online', () => notice('Back online'));

// ---- track changes
const OUT = {
  slide: d => [{ transform: 'none', opacity: 1 }, { transform: `translateX(${-d * 18}%) scale(.92)`, opacity: 0 }],
  fade: () => [{ opacity: 1 }, { opacity: 0 }],
  zoom: () => [{ transform: 'none', opacity: 1 }, { transform: 'scale(.8)', opacity: 0 }],
  flip: d => [{ transform: 'perspective(80vh) rotateY(0)', opacity: 1 }, { transform: `perspective(80vh) rotateY(${-d * 75}deg)`, opacity: 0 }],
  blur: () => [{ filter: 'blur(0)', opacity: 1 }, { filter: 'blur(3vh)', opacity: 0 }],
  stack: () => [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-12%) scale(.9)', opacity: 0 }],
};
const IN = {
  slide: d => [{ transform: `translateX(${d * 18}%) scale(.92)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
  fade: () => [{ opacity: 0 }, { opacity: 1 }],
  zoom: () => [{ transform: 'scale(1.12)', opacity: 0 }, { transform: 'none', opacity: 1 }],
  flip: d => [{ transform: `perspective(80vh) rotateY(${d * 75}deg)`, opacity: 0 }, { transform: 'perspective(80vh) rotateY(0)', opacity: 1 }],
  blur: () => [{ filter: 'blur(3vh)', opacity: 0 }, { filter: 'blur(0)', opacity: 1 }],
  stack: () => [{ transform: 'translateY(14%) scale(1.05)', opacity: 0 }, { transform: 'none', opacity: 1 }],
};

function swap(m, im, lyr) {
  const changed = P.shown && P.cur && P.cur.id !== m.id;
  P.prevArt = P.art;
  // History for the cover swipe's "previous" side (up to 3 back, with lyrics, so going back is instant).
  P.hist ??= [];
  if (P.cur && P.cur.id !== m.id) {
    const back = P.hist.findIndex(h => h.id === m.id);
    if (back >= 0) P.hist.splice(0, back + 1); // went back: it (and anything after it) leaves the history
    else { P.hist.unshift({ ...P.cur, lyrics: P.lyrics }); P.hist.length = Math.min(P.hist.length, 5); }
  }
  P.cur = { id: m.id, uri: m.uri, title: m.title, artist: m.artist, album: m.album, art: m.art, dur: m.dur };
  P.id = m.id;
  P.art = m.art;
  P.dur = m.dur || P.dur;
  P.lyrics = lyr;
  window.lyricStore?.put(m.id, lyr); // device copy for replays / offline (features.js)
  P.artistImg = artistImgs.get(m.id) ?? null;
  $('title').textContent = m.title || '';
  $('artist').textContent = m.artist || '';
  if (!P.artHold) $('art').style.backgroundImage = m.art ? `url("${m.art}")` : 'none';
  if (changed) reveal(m.art, im); else background(m.art, im);
  Lyrics.build(lyr);
  window.afterSwap?.(m);
  window.refreshNeighbours?.();
}

// Song change (swipe, button, song ended - everything goes through swap): the new cover's glow grows out of the
// cover's centre until it fills the screen, the real background (kawarp / blur / gradient) switches underneath it,
// then the glow fades away. Scaled, not clip-path, so it runs on the compositor even on a slow phone.
let revealing = null; // lands the bloom in progress (paints its background, hides the glow)
function reveal(url, im) {
  revealing?.(); // another song before the last bloom finished: land it now
  const el = $('reveal'), b = document.body.classList;
  if (!url || S.trackAnim === 'none' || b.contains('night') || b.contains('bg-black') || matchMedia('(prefers-reduced-motion: reduce)').matches) return background(url, im);
  let a = $('artbox'), x = innerWidth / 2, y = innerHeight / 2;
  if (a.offsetWidth) { // layout position, not the on-screen one: the cover may be mid out-animation
    x = a.offsetWidth / 2; y = a.offsetHeight / 2;
    for (; a; a = a.offsetParent) { x += a.offsetLeft; y += a.offsetTop; }
  }
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) / 0.72 + 60; // past the feathered edge and the blur
  Object.assign(el.style, { display: 'block', width: `${2 * r}px`, height: `${2 * r}px`, left: `${x - r}px`, top: `${y - r}px`, backgroundImage: `url("${url}")` });
  const anims = [el.animate([{ transform: 'scale(.04)', opacity: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: ms(720), easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' })];
  let painted = false;
  const paintOnce = () => { if (!painted) { painted = true; background(url, im); } };
  const land = revealing = () => { revealing = null; paintOnce(); anims.forEach(a => a.cancel()); el.style.display = 'none'; };
  anims[0].finished.then(() => {
    if (revealing !== land) return;
    paintOnce(); // covered: switch the real background underneath, then let the glow go
    anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(520), easing: 'ease-out', fill: 'forwards' }));
    anims[1].finished.then(() => revealing === land && land(), () => {});
  }, () => {});
}

// The bridge sends Spicy-cache results raw ({spicy}) and Spotify/LRCLIB ones already normalized.
const norm = l => l?.spicy ? Lyrics.fromSpicy(l.spicy) ?? { kind: 'none', lines: [] } : l ?? null;

// Show lyrics for the playing song, but only if they beat what is on screen (word > line > static > none).
function offerLyrics(id, lyr) {
  if (!lyr || id !== P.id || (P.lyrics && Lyrics.rank(lyr) <= Lyrics.rank(P.lyrics))) return;
  const first = !P.lyrics;
  P.lyrics = lyr;
  window.lyricStore?.put(id, lyr);
  Lyrics.build(lyr);
  // Opacity only, on the list: #lyrics may still be running the song-change animation (two animations on one element
  // replace each other mid-flight = a visible jump), and #lines' transform belongs to the scroll spring.
  $('lines').animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(first ? 450 : 320), easing: 'ease-out' });
}

// Fill the gap from the API while the desktop has nothing better than line-synced lyrics.
function topUp(id) {
  if (Api.enabled() && Lyrics.rank(P.lyrics) < 3) Api.get(id).then(l => offerLyrics(id, l));
}

async function onTrack(m) {
  if (!/^https:\/\/[^"'()\\\s]+$/.test(m.art || '')) m.art = null;
  m.lyrics = norm(m.lyrics);
  // A cover swipe over several songs: Spotify reports each song it passes through - those never reach the screen.
  const sk = P.skip && performance.now() < P.skip.until ? P.skip : (P.skip = null);
  if (sk?.pass.has(m.id)) return;
  if (sk && m.id === sk.target && m.id !== P.id) { sk.early = m; return; } // confirmed before the card landed: applied at landing
  if (sk && m.id !== sk.target) P.skip = null; // Spotify went somewhere else (queue changed): follow it
  if (m.id === P.id) { // same song: lyrics arrived after the track, better ones replaced a fallback, or a swipe got confirmed
    P.optimistic = 0;
    if (sk) P.skip = null;
    if (m.art && m.art !== P.art) { const old = P.art; P.art = m.art; P.cur && (P.cur.art = m.art); art(m.art).then(im => { if (P.id !== m.id || P.art !== m.art) return; $('art').style.backgroundImage = `url("${m.art}")`; if (old) artFadeFrom(old, ms(300)); background(m.art, im); }); }
    offerLyrics(m.id, m.lyrics);
    topUp(m.id);
    return;
  }
  const token = ++P.token;
  // Next slides left, previous slides right. The bridge knows which (history), a phone tap knows too.
  const outStyle = S.trackAnim, d = m.dir ?? (performance.now() - P.dirAt < 3000 ? P.dir : 1);
  // A swipe that landed on a song we knew nothing about: its card is already in place, so no out-animation here.
  const sw = performance.now() < (P.swipeWait || 0); P.swipeWait = 0;
  const xfade = !sw && (outStyle === 'fade' || outStyle === 'blur') && P.art && m.art;
  const oldArt = P.art;
  const parts = sw || xfade ? [$('meta'), $('lyrics')] : [$('artbox'), $('meta'), $('lyrics')];
  // Out-animation and cover decode run in parallel; the new cover is ready before it comes in.
  // A swipe: no out-animation - the card already moved; everything else switches the moment Spotify names the song.
  const outDone = !sw && outStyle !== 'none' && P.shown
    ? Promise.all(parts.map((el, i) => el.animate(OUT[outStyle](d), { duration: ms(240), delay: ms(i * 30), easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished))
    : Promise.resolve();
  const [im] = await Promise.all([Promise.race([art(m.art), sleep(900).then(() => null)]), outDone]);
  if (token !== P.token) return; // skipped again meanwhile
  const preLyr = pre.get(m.id)?.lyrics;
  swap(m, im, Lyrics.rank(m.lyrics) >= Lyrics.rank(preLyr) ? m.lyrics : preLyr ?? null);
  if (xfade) artFadeFrom(oldArt, ms(520));
  if (!Lyrics.rank(P.lyrics)) window.lyricStore?.get(m.id).then(l => offerLyrics(m.id, l)); // nothing yet: the device copy
  if (sw) { $('art').classList.remove('art-wait'); $('art').animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(280), easing: 'ease-out' }); }
  topUp(m.id);
  parts.forEach((el, i) => {
    el.getAnimations().forEach(a => a.cancel());
    if (outStyle !== 'none' && !sw) el.animate(IN[outStyle](d), { duration: ms(560), delay: ms(i * 55), easing: EASE, fill: 'backwards' });
  });
  P.shown = true;
}

// The previous cover laid over the new one and faded out: an old -> new crossfade with no empty frame.
function artFadeFrom(url, dur) {
  const a = $('art'), x = document.createElement('div');
  x.className = 'art-x';
  x.style.backgroundImage = `url("${url}")`;
  a.append(x);
  x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => x.remove();
}

function onPreload(m) {
  m.lyrics = norm(m.lyrics);
  pre.set(m.id, m);
  if (pre.size > 6) pre.delete(pre.keys().next().value);
  art(m.art).then(im => { try { if (im) colours(im); } catch (e) {} }); // warm the decode and the colours now
  window.afterPreload?.(m);
  // Warm the API cache for the next song too, and keep whichever is better for when it starts.
  if (Api.enabled() && Lyrics.rank(m.lyrics) < 3) Api.get(m.id).then(l => { if (Lyrics.rank(l) > Lyrics.rank(m.lyrics)) m.lyrics = l; });
}

// ---- liked + audio quality (sent with every heartbeat)
function onMeta(m) {
  if (Number.isFinite(m.volume) && !(performance.now() < P.volLock)) { $('vol').value = m.volume; window.volMuted?.(); }
  $('ctl').classList.toggle('has-vol', Number.isFinite(m.volume) && S.showVolume);
  if (typeof m.liked === 'boolean' && performance.now() > P.heartLock) {
    P.liked = m.liked;
    $('heart').classList.toggle('on', m.liked);
  }
  if (m.quality !== undefined && m.quality !== P.quality) {
    P.quality = m.quality;
    // Spotify's playbackQuality.bitrateLevel: 1 Low, 2 Normal, 3 High, 4 Very high, 5 Lossless, 6 Lossless 24-bit.
    document.body.classList.toggle('q-lossless', /lossless|hifi|hi-fi/i.test(String(m.quality)) || m.quality >= 5);
    window.qualityChanged?.();
    $('quality').textContent = ({ 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Very high', 5: 'Lossless', 6: 'Lossless' })[m.quality] ?? (m.quality > 6 ? 'Lossless' : m.quality) ?? '';
  }
}

// ---- play / pause
function setPlaying(p, animate) {
  if (p === P.playing && !animate) return;
  P.playing = p;
  document.body.classList.toggle('paused', !p);
  $('ppIcon').setAttribute('d', p ? PAUSE : PLAY);
  if (!animate) return;
  if (S.ppAnim === 'both' || S.ppAnim === 'pulse') {
    $('pulseIcon').setAttribute('d', p ? PLAY : PAUSE);
    $('pulse').animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: .3 },
      { opacity: 0, transform: 'scale(1.25)' }], { duration: ms(700), easing: 'ease-out' });
  }
  if (S.ppAnim === 'ripple') {
    $('ripple').animate([{ transform: 'scale(.4)', opacity: .9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: ms(800), easing: 'ease-out' });
  }
}

function onPos(m) {
  if (performance.now() < P.optimistic && +m.pos > 3000) return onMeta(m);
  if (performance.now() < P.seekUntil && Math.abs(+m.pos - (P.seekTo + (P.playing ? performance.now() - P.seekAt : 0))) > 1200) return onMeta(m);
  const had = P.at > 0;
  P.pos = +m.pos || 0;
  P.at = performance.now();
  if (m.dur) P.dur = +m.dur;
  if (m.via) P.via = m.via;
  onMeta(m);
  // After a tap, ignore play state from beats already in flight, so the button doesn't flicker back.
  if (performance.now() > P.lockUntil) setPlaying(!!m.playing, had && !!m.playing !== P.playing);
  window.afterPos?.(m);
}

// ---- sources. The bridge (native -> dock()) and the Web API (spotify.js) both produce track/pos/preload; each
// keeps its latest state and only the active one reaches the screen. Auto: whichever is actually playing, the
// desktop bridge winning ties; switching replays the new source's state so the screen catches up instantly.
const SRC = { bridge: { at: 0, playing: false }, web: { at: 0, playing: false } };
P.source = 'bridge';
function dock(m) { route('bridge', m); }
Rtc.onMessage(m => route('bridge', m)); // same bridge, reached over WebRTC instead of adb
Web.onMessage(m => route('web', m));

function route(src, m) {
  const s = SRC[src];
  s.heard = performance.now(); // any message proves the link is up (see 'stale' in the frame loop)
  if (m.type === 'track') s.track = m;
  else if (m.type === 'preload') s.preload = m;
  else if (m.type === 'pos') { s.pos = m; s.at = performance.now(); s.playing = !!m.playing; }
  else return handle(m); // api / hello / presets / auth / diag: source-independent
  if (src === P.source) handle(m);
  if (m.type === 'pos') decideSource();
}

function decideSource() {
  const b = SRC.bridge, w = SRC.web, t = performance.now();
  const bLive = t - b.at < 2500, wLive = t - w.at < 7000;
  const want = S.source !== 'auto' ? S.source
    : bLive && b.playing ? 'bridge' : wLive && w.playing ? 'web' : bLive ? 'bridge' : wLive ? 'web' : P.source;
  Web.setWanted(S.source === 'web' || (S.source === 'auto' && !(bLive && b.playing)));
  if (want === P.source) return;
  P.source = want;
  if (P.shown) notice(want === 'web' ? 'Following your Spotify account' : 'Following Spotify on the computer');
  const s = SRC[want];
  for (const m of [s.track && { ...s.track, dir: 1 }, s.preload, s.pos]) if (m) handle(m);
}
setInterval(decideSource, 1000);

function handle(m) {
  if (m.type === 'track') onTrack(m);
  else if (m.type === 'preload') onPreload(m);
  else if (m.type === 'pos') onPos(m);
  else if (m.type === 'api') Api.onResponse(m);
  else if (m.type === 'artist') onArtist(m);
  else if (m.type === 'audio') onAudio(m);
  else if (m.type === 'hello') { // bridge (re)connected: desktop-side settings + presets
    if (Settings.fresh && !P.gotHello && m.last) Settings.load(m.last);
    Settings.setPresets(m.presets);
    P.gotHello = true;
    send({ type: 'schema', schema: Settings.schema(), S, builtins: Settings.BUILTIN, defaults: Settings.defaults }); // lets Spotify's LyricDock panel render these settings
    if (!m.paired) send({ type: 'pair', code: Rtc.code }); // hand the pairing code over the link we already have
  }
  else if (m.type === 'set') Settings.setRemote(m.k, m.v); // changed from the desktop panel
  else if (m.type === 'load' && m.S && typeof m.S === 'object') Settings.load(m.S);
  else if (m.type === 'presets') Settings.setPresets(m.presets);
  else if (m.type === 'diag') window.lastDiag = m; // inspected over CDP while developing
  else if (m.type === 'auth') Web.onAuth(m);
  else if (['list', 'album', 'acted', 'canvas'].includes(m.type)) window.onExtra?.(m);
  else if (m.type === 'browse') window.dockBrowse?.(m.uri);
  else if (m.type === 'wake') window.dockWake?.();
  else if (m.type === 'update') { P.update = m; Settings.render(); if (m.state === 'installing') notice(`Updating LyricDock to v${m.version}…`, 6000); }
}

// ---- automatic pairing by Spotify account: listen while signed in; a desktop asking shows the Allow prompt.
Rtc.onAsk((name, digits) => new Promise(resolve => {
  $('pairName').textContent = name;
  $('pairDigits').textContent = digits;
  document.body.classList.add('pair-ask');
  const done = ok => { document.body.classList.remove('pair-ask'); clearTimeout(t); if (ok) notice(`Paired with ${name}`); resolve(ok); };
  $('pairAllow').onclick = () => done(true);
  $('pairDeny').onclick = () => done(false);
  const t = setTimeout(() => done(false), 60000); // unanswered: treat as deny
}));
setInterval(() => { Web.refreshUserId(); const uid = Web.userId(); if (uid) Rtc.watchAccount(uid); }, 5000);

// ---- app updates (native Updater: GitHub Releases, silent install as device owner)
let appVersion = '';
try { appVersion = Dock.version(); } catch (e) {}
// What took the app down last time (CrashLog.java: a crash, or the page's renderer dying and being restarted).
try { window.lastCrash = Dock.lastCrash() || ''; } catch (e) { window.lastCrash = ''; }
if (window.lastCrash) {
  console.warn('LyricDock recovered:', window.lastCrash);
  setTimeout(() => { notice('LyricDock restarted after a problem - it has been noted', 4000); send({ type: 'crashlog', text: window.lastCrash.slice(-4000) }); }, 4000);
}
// Native call first: a broken settings render must never stop the app from updating (that's how fixes arrive).
window.checkUpdate = install => { P.update = { state: 'checking' }; try { Dock.setChannel(S.channel); } catch (e) {} try { Dock.checkUpdate(!!install); } catch (e) {} try { Settings.render(); } catch (e) {} };
window.updateStatus = () => {
  const u = P.update, v = `v${appVersion || '?'}`;
  if (!u) return v;
  return { checking: `${v} · checking…`, current: `${v} · up to date`, available: `${v} · v${u.version} available`,
    installing: `${v} · installing v${u.version}…`, error: `${v} · update check failed (${u.version})` }[u.state] ?? v;
};
const autoUpdate = () => S.autoUpdate && checkUpdate(true);
setTimeout(autoUpdate, 15000);           // shortly after start
setInterval(autoUpdate, 6 * 3600 * 1000); // and every 6 hours (fallback: the ping below is the fast path)

// Update ping: scripts/ping-update.ps1 (run by release.ps1) publishes "update" to this ntfy topic, and every open
// dock checks GitHub at once and installs - even with "Update automatically" off, so a release rolls out in seconds.
// The ping carries nothing trusted: it only starts the normal check, and Android installs nothing that isn't signed
// with our key. Reconnects resume from the last message seen, so a ping sent while offline still arrives (ntfy
// keeps messages 12 h). ponytail: public topic; worst case a stranger makes docks check GitHub early.
const PING = 'https://ntfy.losthusky.qzz.io/lyricdock-update-ping-v1'; // self-hosted ntfy (docs/ntfy.md)
let lastPing = 0, retry = 5000;
(function listen(since) {
  let es;
  try { es = new EventSource(`${PING}/sse?since=${since}`); } catch (e) { return; }
  es.onopen = () => { retry = 5000; };
  es.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.event !== 'message') return;
    since = m.id;
    if (!/^update\b/.test(m.message || '') || Date.now() - lastPing < 60000) return;
    lastPing = Date.now(); checkUpdate(true);
  };
  es.onerror = () => { es.close(); setTimeout(() => listen(since), retry); retry = Math.min(retry * 2, 300000); };
})(Math.floor(Date.now() / 1000));
// The path we control: every release rewrites extension/version.json on GitHub (release.ps1), and every open dock
// reads that 30-byte file every 5 minutes. A newer version there = required: installed even with "Update automatically"
// off. So a release reaches every open phone within ~5-10 min even when ntfy.sh is down or over its quota.
const VERSION_URL = 'https://raw.githubusercontent.com/DhakadG/lyricdock/main/extension/version.json';
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function pollVersion() {
  try {
    const v = await (await fetch(VERSION_URL, { cache: 'no-store' })).json();
    const want = S.channel === 'beta' && v.beta && newer(v.beta, v.version) ? v.beta : v.version;
    if (appVersion && want && newer(want, appVersion) && P.update?.state !== 'installing' && Date.now() - lastPing > 60000) { lastPing = Date.now(); checkUpdate(true); }
  } catch (e) {} // offline: next round
}
setTimeout(pollVersion, 20000);
setInterval(pollVersion, 5 * 60 * 1000 + Math.random() * 30000); // a little jitter so a room of docks doesn't hit GitHub in step

// ---- controls
let hideT;
window.showUi = on => {
  clearTimeout(hideT);
  if (on && document.body.classList.contains('art-ctl')) {
    // The cover shrinks (from its top edge) just enough for the controls to fit under it.
    // The controls take the title's place under the cover (it fades out), and the cover gives up only what's missing.
    const box = $('artbox').getBoundingClientRect(), meta = $('meta').getBoundingClientRect(), w = box.width, h = $('ctl').offsetHeight, gap = w * 0.04;
    const room = (meta.height && meta.top >= box.bottom - 2 ? meta.bottom : box.bottom) - box.top;
    const tl = $('tl').getClientRects().length ? $('tl').offsetHeight + gap * 0.5 : 0; // the timeline rides under the shrunk cover
    const s = w ? Math.min(0.94, Math.max(0.5, (room - h - gap - tl) / w)) : 0.9;
    document.documentElement.style.setProperty('--art-mini', s.toFixed(3));
    document.documentElement.style.setProperty('--ctl-top', `${(s * w + gap + tl).toFixed(1)}px`);
    document.documentElement.style.setProperty('--tl-dy', `${((s - 1) * w).toFixed(1)}px`);
  }
  document.body.classList.toggle('ui', on);
  if (on) hideT = setTimeout(() => { if (!document.body.classList.contains('qs-open')) document.body.classList.remove('ui'); }, S.hideAfter * 1000);
};
// The controls appear on a tap, not on every touch: scrolling the lyrics or swiping must not pop them up. A tap on a lyric line
// seeks (Settings -> Tap a line to jump to it) instead; the cover handles its own taps (features.js).
document.addEventListener('click', e => {
  if (!Gesture.tap() || e.target.closest?.('#settings, #qpanel, #listPanel, #pairAsk, #news, #setup')) return;
  if (document.body.classList.contains('art-ctl') && e.target.closest?.('#artbox') && !e.target.closest('#ctl')) return;
  const onLine = S.tapSeek && e.target.closest?.('#lyrics:not(.static) .ln:not(.dots):not(.credits):not(.skel):not(.empty)');
  if (onLine && !document.body.classList.contains('ui')) return;
  showUi(true); // (buttons inside the controls just keep them up)
}, true);
// Commands go to whichever source is on screen.
const control = (c, arg) => P.source === 'web' ? Web.control(c, arg) : send({ type: 'cmd', cmd: c, ms: arg, v: arg });
const cmd = (c, dir) => { control(c); if (dir) { P.dir = dir; P.dirAt = performance.now(); } };
// ---- cover swipe (swipe.js): the songs on either side, and committing a swipe of 1-3 songs.
// Next: the preloaded song, then the queue (fetched on every song change). Previous: what this phone showed before.
P.upq = [];
const idOf = x => x?.id || (x?.uri || '').split(':')[2] || null;
window.neighbours = () => {
  const q = P.upq, at = q.findIndex(x => idOf(x) === P.id);
  const after = (at >= 0 ? q.slice(at + 1) : q).filter(x => idOf(x) !== P.id);
  const next = [];
  if (P.next?.id && P.next.id !== P.id) next.push(P.next);
  for (const x of after) if (next.length < 3 && !next.some(n => n.id === idOf(x)))
    next.push({ id: idOf(x), uri: x.uri, title: x.title, artist: x.sub, art: x.big || x.art, dur: x.dur });
  return { next, prev: (P.hist || []).slice(0, 3) };
};
let qFetchT = 0;
window.refreshNeighbours = () => { clearTimeout(qFetchT); qFetchT = setTimeout(() => {
  if (!S.swipe) return;
  if (P.source === 'web') Web.list('queue').then(r => onQueue(r)).catch(() => {});
  else send({ type: 'list', which: 'queue' });
}, 900); };
window.onQueue = r => {
  if (!r || !Array.isArray(r.items)) return;
  P.upq = [...(r.now ? [r.now] : []), ...r.items].slice(0, 12);
  for (const x of window.neighbours().next) art(x.art); // decode now, so a swipe never waits for a cover
};
// Commands in order, spaced: Spotify drops a burst of skips sent in the same instant.
let cmdChain = Promise.resolve();
const queueCmd = c => { cmdChain = cmdChain.then(() => { control(c); return sleep(170); }); };
window.swipeTo = k => {
  const n = Math.abs(k), nb = window.neighbours(), list = k > 0 ? nb.next : nb.prev, t = list[n - 1] || null, now = performance.now();
  // "Previous" more than 3 s into a song only restarts it, so one extra press goes back the first song.
  for (let i = 0; i < n + (k < 0 && pos() > 3000 ? 1 : 0); i++) queueCmd(k > 0 ? 'next' : 'prev');
  P.dir = Math.sign(k); P.dirAt = now;
  if (!t?.id) { P.swipeWait = now + 5000; return null; } // unknown song: the card lands empty, Spotify fills it in
  const prevSkip = P.skip && now < P.skip.until ? P.skip : null;
  const pass = new Set([...(prevSkip ? [...prevSkip.pass, prevSkip.target] : []), ...list.slice(0, n - 1).map(x => x.id), P.id]);
  pass.delete(t.id);
  P.skip = { target: t.id, pass, until: now + 5000, passed: k > 0 ? list.slice(0, n - 1) : [] };
  P.optimistic = now + 2500; P.pos = 0; P.at = now; P.dur = t.dur || P.dur;
  return t;
};
// The card is in place: title, lyrics, colours switch in the same frame (the cover image is already decoded).
window.swipeLand = t => {
  const token = ++P.token, lyr = t.lyrics ?? pre.get(t.id)?.lyrics ?? null;
  art(t.art).then(im => {
    if (token !== P.token) return;
    swap(t, im, lyr); topUp(t.id); P.shown = true;
    const sk = P.skip;
    if (sk?.target !== t.id) return;
    for (const x of sk.passed) P.hist.unshift({ ...x }); // skipped over = played, as far as Spotify's "previous" goes
    if (sk.early) { const m = sk.early; sk.early = null; onTrack(m); } // Spotify already confirmed it: take its details
  });
};
$('prev').onclick = () => cmd('prev', -1);
$('next').onclick = () => cmd('next', 1);
$('pp').onclick = () => { P.pos = pos(); P.at = performance.now(); P.lockUntil = P.at + 400; setPlaying(!P.playing, true); cmd('toggle'); };
$('heart').onclick = () => {
  P.liked = !P.liked;
  P.heartLock = performance.now() + 1500; // don't let an in-flight beat flip it back
  $('heart').classList.toggle('on', P.liked);
  $('heart').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: ms(350), easing: EASE });
  control('heart');
};
// Volume (both sources report 0-100). Ignore reports for a moment after dragging so it doesn't jump back.
$('vol').addEventListener('input', () => { P.volLock = performance.now() + 2000; control('volume', +$('vol').value); });
$('gear').onclick = () => Settings.open();
$('sclose').onclick = () => Settings.close();
$('settings').addEventListener('click', e => { if (e.target.id === 'settings') Settings.close(); }); // tap outside the sheet
$('sreset').onclick = () => Settings.reset();
// A seek is applied at once; for a moment beats still carrying the old position (Spotify has not caught up) are ignored, so the
// bar and the lyrics do not jump back and forth.
const seek = t => { control('seek', t); P.pos = t; P.at = performance.now(); P.seekTo = t; P.seekAt = P.at; P.seekUntil = P.at + 1200; };
Lyrics.onSeek(seek);
// Edge bar: a tap seeks (while the controls show); a press-and-hold scrubs (features.js). Not on finger-down: that seeked
// before we knew whether the finger was tapping, holding or starting a scroll.
$('bar').addEventListener('click', e => {
  if (!document.body.classList.contains('ui') || !P.dur || !Gesture.tap() || document.body.classList.contains('scrubbing')) return;
  seek(Math.round(e.clientX / innerWidth * P.dur));
});

// Keep-alive for the bridge: an adb-forwarded socket can stay "open" on the PC after the phone end dies,
// so the bridge reconnects when these stop arriving.
// Direct link over Wi-Fi or over the USB cable (tethering): compare the link's local address with the Wi-Fi one.
const rtcVia = () => { const p = Rtc.path(); if (!p?.local) return 'direct'; const ms = p.rtt ? ` · ${Math.round(p.rtt * 1000)} ms` : '';
  return (p.local === myIp ? 'direct Wi-Fi' : `USB cable (${p.local})`) + ms; };
window.dockStatus = () => {
  const link = document.body.classList.contains('stale') ? 'Not connected'
    : P.source === 'web' ? `Spotify account${SRC.web.pos?.device ? ` · ${SRC.web.pos.device}` : ''}`
    : `Desktop bridge (${Rtc.open() ? rtcVia() : 'adb'})`;
  const api = Api.enabled() ? ` · API key set${Api.lastStatus ? ` (last ${Api.lastStatus})` : ''}` : '';
  return `${link} · phone IP ${myIp || 'none'}${api}`;
};
// Spotify reaches the phone through adb (USB, or wireless adb when the cable is out - see scripts/link.ps1),
// always via localhost on the PC: Chromium refuses ws:// from Spotify's https page to a LAN address.
let myIp = '', phoneModel = '';
try { phoneModel = Dock.model(); } catch (e) {}
const refreshIp = () => { try { myIp = Dock.ip(); } catch (e) {} };
refreshIp();
setInterval(refreshIp, 10000);
setInterval(() => {
  send({ type: 'alive', ip: myIp, code: Rtc.code, name: phoneModel });
  if (!P.id) $('artist').textContent = `In Spotify: LyricDock button → Devices → Find devices  ·  code ${Rtc.code}`;
}, 1000);

// ---- settings + presets live on the desktop too (Spicetify LocalStorage), so a new phone starts configured.
let syncT;
Settings.onChange(() => { clearTimeout(syncT); syncT = setTimeout(() => send({ type: 'settings', S }), 400); });
Settings.onPreset((action, name) => send({ type: 'preset', action, name, S }));

// ---- notch + rounded corners. Android reports the camera cutout's safe insets and each corner's radius
// (CSS px); they change with rotation. The progress bar floats just above the edge, and its ends are pulled
// in exactly as far as the corner curve needs at that height - flat screens get a full-width edge bar.
let insets = { l: 0, t: 0, r: 0, b: 0, rtl: 0, rtr: 0, rbl: 0, rbr: 0 };
window.setInsets = o => { insets = { ...insets, ...o }; applyInsets(); };
const pullInsets = () => { try { setInsets(JSON.parse(Dock.insets())); } catch (e) { applyInsets(); } };
// Settings: while padding is being changed, lines show where content stops (accent = the notch side).
let guideT = 0;
window.flashGuide = () => { document.body.classList.add('pad-guide'); clearTimeout(guideT); guideT = setTimeout(() => document.body.classList.remove('pad-guide'), 3000); };
function applyInsets() {
  const man = S.edgeMode === 'manual', st = document.documentElement.style, px = v => `${Math.round(v * 10) / 10}px`;
  // Auto: the notch side gets exactly the cutout's safe inset (it moves with the rotation: top in portrait, left or
  // right in landscape), every other edge uses the whole screen. Manual: the notch side gets 'Notch side padding' (you
  // may go under the inset if your notch is small) and the other sides 'Side padding'.
  const side = man ? S.edgePad : 0, notch = v => v > 0 ? (man ? S.notchPad : v) : null;
  st.setProperty('--sa-l', px(notch(insets.l) ?? side));
  st.setProperty('--sa-r', px(notch(insets.r) ?? side));
  st.setProperty('--sa-t', px(notch(insets.t) ?? 0));
  st.setProperty('--sa-b', px(notch(insets.b) ?? 0));
  let g = document.getElementById('padGuide');
  if (!g) { g = document.createElement('div'); g.id = 'padGuide'; g.innerHTML = '<i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i>'; document.body.append(g); }
  for (const k of ['l', 'r', 't', 'b']) g.querySelector('.' + k).classList.toggle('notch', insets[k] > 0);
  const bar = r => { // raise by ~a quarter radius; inset = where the corner arc crosses that height
    if (r <= 0) return [0, 0];
    const y = Math.max(3, r * 0.25);
    return [y, r - Math.sqrt(r * r - (r - y) * (r - y)) + 4];
  };
  const [by, bx] = bar(man ? S.cornerPad : Math.max(insets.rbl, insets.rbr));
  const [ty, tx] = bar(man ? S.cornerPad : Math.max(insets.rtl, insets.rtr));
  st.setProperty('--bar-by', px(by)); st.setProperty('--bar-bx', px(bx));
  st.setProperty('--bar-ty', px(ty)); st.setProperty('--bar-tx', px(tx));
  if (typeof lyricRoom === 'function') setTimeout(lyricRoom, 60);
}

// ---- room for the lyrics to grow sideways (style.css #lyrics): how far the pane may reach past its own sides before it
// would touch something - the screen edge (plus the notch / manual edge padding), the cover column, the battery / time
// corner. Up to 6 vmin each side, re-measured whenever the pane changes size (rotation, layout, insets, controls).
const lyr = $('lyrics');
let roomL = 0, roomR = 0;
function lyricRoom() {
  const r = lyr.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return; // hidden (clock layouts): keep what we have
  const l0 = r.left + roomL, r0 = r.right - roomR; // the pane's own sides, without the room
  const root = getComputedStyle(document.documentElement), sa = k => parseFloat(root.getPropertyValue(k)) || 0;
  let minX = sa('--sa-l') + 4, maxX = innerWidth - sa('--sa-r') - 4;
  for (const id of ['left', 'stat']) { // neighbours beside the pane (vertically overlapping it)
    const e = $(id); if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none') continue;
    const b = e.getBoundingClientRect();
    // only what sits beside the lit middle of the pane counts - the top and bottom 15 % are faded out anyway (the battery)
    if (b.width < 2 || b.bottom <= r.top + r.height * 0.15 || b.top >= r.bottom - r.height * 0.15) continue;
    if (b.right <= l0 + 1) minX = Math.max(minX, b.right + 6);
    if (b.left >= r0 - 1) maxX = Math.min(maxX, b.left - 6);
  }
  const most = Math.min(innerWidth, innerHeight) * 0.06;
  const L = Math.round(Math.max(0, Math.min(most, l0 - minX))), R = Math.round(Math.max(0, Math.min(most, maxX - r0)));
  if (L === roomL && R === roomR) return;
  roomL = L; roomR = R;
  lyr.style.setProperty('--glx-l', `${L}px`); lyr.style.setProperty('--glx-r', `${R}px`);
}
new ResizeObserver(() => requestAnimationFrame(lyricRoom)).observe(lyr);
addEventListener('resize', () => requestAnimationFrame(lyricRoom));

// ---- settings -> page
function apply(k) {
  if (['edgeMode', 'edgePad', 'notchPad'].includes(k)) window.flashGuide?.();
  setTimeout(lyricRoom, 60); // a neighbour (cover side, battery corner) may have moved without the pane resizing
  const b = document.body;
  b.className = b.className.replace(/\b(layout|bg|align|prog|pp|scroll|art)-\S+/g, '').replace(/\s+/g, ' ').trim();
  b.classList.add(`layout-${S.layout}`, `bg-${S.bg}`, `align-${S.align}`, `prog-${S.progress}`, `pp-${S.ppAnim}`, `scroll-${S.scroll}`, `art-${S.artSide}`);
  b.classList.toggle('no-accent', !S.accent);
  b.classList.toggle('no-lift', !S.lift); // without lift the words rest at full size, not the idle pose
  b.classList.toggle('no-spin', !S.spin);
  if (!S.showVolume) $('ctl').classList.remove('has-vol');
  b.classList.toggle('blurlines', S.blurLines);
  b.classList.toggle('times', S.times);
  b.classList.toggle('show-liked', S.showLiked);
  b.classList.toggle('heart-liked-only', S.heartLikedOnly);
  b.classList.toggle('no-motion-badge', !S.motionBadge);
  b.classList.toggle('show-quality', S.showQuality);
  try { Dock.setOrientation(S.orientation); } catch (e) {}
  applyInsets();
  const r = document.documentElement.style;
  r.setProperty('--size', S.size);
  r.setProperty('--dim', S.bgDim);
  r.setProperty('--as', S.animSpeed);
  r.setProperty('--lw', S.weight);
  r.setProperty('--lgap', S.lineGap + 'vmin');
  r.setProperty('--lop', S.lineOpacity);
  r.setProperty('--blur', S.blurAmount + 'px');
  r.setProperty('--gk', S.glowStrength);
  b.classList.toggle('no-glass', !S.glass);
  // Controls: over the cover (Default/TV), in the always-visible deck (Player card), centred on screen otherwise.
  const artCtl = ['split', 'tv', 'clocksplit'].includes(S.layout);
  b.classList.toggle('art-ctl', artCtl);
  (artCtl ? $('artbox') : S.layout === 'player' ? $('deck') : b).appendChild($('ctl'));
  if (kw) { kw.animationSpeed = S.bgSpeed; kw.warpIntensity = S.bgWarp; kw.blurPasses = S.bgBlur; kw.saturation = S.bgSaturation; kw.transitionDuration = S.bgFade; }
  if (!k || k === '*' || k === 'bg') art(P.art).then(im => background(P.art, im));
  if (kw && k === 'bgBeat') kw.animationSpeed = S.bgSpeed;
  if (k === '*' || ['roman', 'credits', 'letters', 'lettersMin', 'dots', 'dotsGap'].includes(k)) Lyrics.rebuild();
  requestAnimationFrame(() => { Lyrics.refresh(); sizeBg(); });
  window.afterApply?.(k);
}
Settings.onChange(apply);
apply();
pullInsets();
setPlaying(false);
addEventListener('resize', () => { pullInsets(); Lyrics.refresh(); sizeBg(); });

// ---- progress bar: one linear CSS transition from "now" to the end of the song, run by the compositor (smooth at any
// frame rate, no per-frame work). Re-synced only on seek / pause / new song / drift > 200ms.
const F = { at: 0, pos: -1, playing: false, dur: 0 };
function fillSync(p) {
  const frac = P.dur ? Math.min(1, Math.max(0, p / P.dur)) : 0;
  Object.assign(F, { at: performance.now(), pos: p, playing: P.playing, dur: P.dur });
  for (const f of [$('fill'), $('dfill'), $('tlfill')]) { // the edge bar, the Player card's bar and the one under the cover
    f.style.transition = 'none';
    f.style.transform = `translateX(${(frac - 1) * 100}%)`;
    if (!P.playing || !P.dur || frac >= 1) continue;
    f.offsetWidth; // commit the start point before starting the glide
    f.style.transition = `transform ${Math.round(P.dur - p)}ms linear`;
    f.style.transform = 'translateX(0)';
  }
}
function fillCheck(p) {
  if (document.body.classList.contains('tl-drag')) return; // the finger is driving the bar
  const expected = F.pos + (F.playing ? performance.now() - F.at : 0);
  if (F.pos < 0 || F.playing !== P.playing || F.dur !== P.dur || Math.abs(p - expected) > 200) fillSync(p);
}
// ---- frame loop
const clock = t => { t = Math.max(0, t) / 1000 | 0; return `${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`; };
let lastT = performance.now(), lastSec = -1;
const linkLog = window.linkLog = [];
(function tick(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000) || 0.016;
  lastT = t;
  // Bridge beats every 500ms; the Web API is polled every 1s (3s while paused). Liveness is anything heard from the
  // source, not P.at: beats are deliberately ignored for a moment after a skip or seek, and a song change can queue a
  // big chunked track message ahead of them - neither is a lost link, so neither may flash "Reconnecting".
  const heard = SRC[P.source].heard;
  const stale = !(heard && performance.now() - heard < (P.source === 'web' ? 7000 : 2500));
  if (stale !== document.body.classList.contains('stale')) {
    document.body.classList.toggle('stale', stale);
    linkLog.push({ at: new Date().toLocaleTimeString(), stale }); // read over CDP when testing failover
    if (linkLog.length > 50) linkLog.shift();
  }
  const real = pos(), p = real + S.offset;
  fillCheck(real);
  if ((real / 1000 | 0) !== lastSec && !document.body.classList.contains('tl-drag')) {
    lastSec = real / 1000 | 0;
    $('tcur').textContent = $('dcur').textContent = $('tlcur').textContent = clock(real);
    $('tdur').textContent = $('ddur').textContent = $('tldur').textContent = clock(P.dur);
  }
  Lyrics.update(p, dt);
  beatBg(p);
  requestAnimationFrame(tick);
})(performance.now());
