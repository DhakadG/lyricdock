// LyricDock: playback clock, track changes (with preloaded art), background, controls, settings.
const $ = id => document.getElementById(id);
const S = Settings.S;
const P = { pos: 0, at: 0, playing: false, dur: 0, id: null, art: null, lyrics: null, dir: 1, dirAt: 0, lockUntil: 0, token: 0,
  shown: false, liked: false, heartLock: 0, quality: null, gotHello: false };
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 5h4v14H6zm8 0h4v14h-4z';
const ms = t => t / S.animSpeed;
const now = () => P.pos + (P.playing ? performance.now() - P.at : 0) + S.offset;
const send = o => { try { Dock.send(JSON.stringify(o)); } catch (e) {} };
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
// CSS-pixel resolution (half the device's): invisible under the blur, much cheaper on the Snapdragon 439.
function sizeBg() { const c = $('bgc'); c.width = innerWidth; c.height = innerHeight; kw?.resize(); }
function kawarp() {
  if (kw || !window.Kawarp) return kw;
  try {
    kw = new Kawarp($('bgc'), { animationSpeed: S.bgSpeed, warpIntensity: S.bgWarp, blurPasses: 8, saturation: 1.5,
      tintIntensity: 0, dithering: 0.008, transitionDuration: 1000, scale: 1 });
    sizeBg(); // canvas is 300x150 until told otherwise
  } catch (e) { kw = null; } // no WebGL -> blurred-art fallback below
  return kw;
}

function colours(im) {
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
  return [avg(0, 0, 6, 6), avg(3, 3, 9, 9), avg(6, 6, 12, 12)];
}

function background(url, im) {
  const root = document.documentElement.style;
  // Cover still downloading (swap only waits ~0.9s): finish it, then update - otherwise the old song's colours stick.
  if (!im && url) art(url).then(i => { if (i && P.art === url) background(url, i); });
  $('bg').style.backgroundImage = url ? `url("${url}")` : 'none';
  if (S.bg === 'dynamic' && im && kawarp()) {
    try { kw.loadImageElement(im); kw.start(); } catch (e) {}
  } else kw?.stop();
  if (S.bg === 'gradient' && im) {
    try { colours(im).forEach((c, i) => root.setProperty(`--c${i + 1}`, c)); } catch (e) {}
  }
  if (S.bg === 'dynamic' && !kawarp()) document.body.classList.replace('bg-dynamic', 'bg-blur'); // no WebGL
}

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
  P.id = m.id;
  P.art = m.art;
  P.dur = m.dur || P.dur;
  P.lyrics = lyr;
  $('title').textContent = m.title || '';
  $('artist').textContent = m.artist || '';
  $('art').style.backgroundImage = m.art ? `url("${m.art}")` : 'none';
  background(m.art, im);
  Lyrics.build(lyr);
}

// The bridge sends Spicy-cache results raw ({spicy}) and Spotify/LRCLIB ones already normalized.
const norm = l => l?.spicy ? Lyrics.fromSpicy(l.spicy) ?? { kind: 'none', lines: [] } : l ?? null;

// Show lyrics for the playing song, but only if they beat what is on screen (word > line > static > none).
function offerLyrics(id, lyr) {
  if (!lyr || id !== P.id || (P.lyrics && Lyrics.rank(lyr) <= Lyrics.rank(P.lyrics))) return;
  const first = !P.lyrics;
  P.lyrics = lyr;
  Lyrics.build(lyr);
  $('lyrics').animate([{ opacity: 0, transform: first ? 'translateY(3vmin)' : 'none' }, { opacity: 1, transform: 'none' }],
    { duration: ms(first ? 500 : 350), easing: EASE });
}

// Fill the gap from the API while the desktop has nothing better than line-synced lyrics.
function topUp(id) {
  if (Api.enabled() && Lyrics.rank(P.lyrics) < 3) Api.get(id).then(l => offerLyrics(id, l));
}

async function onTrack(m) {
  if (!/^https:\/\/[^"'()\\\s]+$/.test(m.art || '')) m.art = null;
  m.lyrics = norm(m.lyrics);
  if (m.id === P.id) { // same song: lyrics arrived after the track, or better ones replaced a fallback
    offerLyrics(m.id, m.lyrics);
    topUp(m.id);
    return;
  }
  const token = ++P.token;
  // Next slides left, previous slides right. The bridge knows which (history), a phone tap knows too.
  const outStyle = S.trackAnim, d = m.dir ?? (performance.now() - P.dirAt < 3000 ? P.dir : 1);
  const parts = [$('artbox'), $('meta'), $('lyrics')];
  // Out-animation and cover decode run in parallel; the new cover is ready before it comes in.
  const outDone = outStyle !== 'none' && P.shown
    ? Promise.all(parts.map((el, i) => el.animate(OUT[outStyle](d), { duration: ms(240), delay: ms(i * 30), easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished))
    : Promise.resolve();
  const [im] = await Promise.all([Promise.race([art(m.art), sleep(900).then(() => null)]), outDone]);
  if (token !== P.token) return; // skipped again meanwhile
  const preLyr = pre.get(m.id)?.lyrics;
  swap(m, im, Lyrics.rank(m.lyrics) >= Lyrics.rank(preLyr) ? m.lyrics : preLyr ?? null);
  topUp(m.id);
  parts.forEach((el, i) => {
    el.getAnimations().forEach(a => a.cancel());
    if (outStyle !== 'none') el.animate(IN[outStyle](d), { duration: ms(560), delay: ms(i * 55), easing: EASE, fill: 'backwards' });
  });
  P.shown = true;
}

function onPreload(m) {
  m.lyrics = norm(m.lyrics);
  pre.set(m.id, m);
  if (pre.size > 6) pre.delete(pre.keys().next().value);
  art(m.art); // warm the decode now
  // Warm the API cache for the next song too, and keep whichever is better for when it starts.
  if (Api.enabled() && Lyrics.rank(m.lyrics) < 3) Api.get(m.id).then(l => { if (Lyrics.rank(l) > Lyrics.rank(m.lyrics)) m.lyrics = l; });
}

// ---- liked + audio quality (sent with every heartbeat)
function onMeta(m) {
  if (typeof m.liked === 'boolean' && performance.now() > P.heartLock) {
    P.liked = m.liked;
    $('heart').classList.toggle('on', m.liked);
  }
  if (m.quality !== undefined && m.quality !== P.quality) {
    P.quality = m.quality;
    // Spotify's playbackQuality.bitrateLevel: 1 Low, 2 Normal, 3 High, 4 Very high, 5 Lossless.
    $('quality').textContent = ({ 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Very high', 5: 'Lossless' })[m.quality] ?? m.quality ?? '';
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
  const had = P.at > 0;
  P.pos = +m.pos || 0;
  P.at = performance.now();
  if (m.dur) P.dur = +m.dur;
  if (m.via) P.via = m.via;
  onMeta(m);
  // After a tap, ignore play state from beats already in flight, so the button doesn't flicker back.
  if (performance.now() > P.lockUntil) setPlaying(!!m.playing, had && !!m.playing !== P.playing);
}

function dock(m) {
  if (m.type === 'track') onTrack(m);
  else if (m.type === 'preload') onPreload(m);
  else if (m.type === 'pos') onPos(m);
  else if (m.type === 'api') Api.onResponse(m);
  else if (m.type === 'hello') { // bridge (re)connected: desktop-side settings + presets
    if (Settings.fresh && !P.gotHello && m.last) Settings.load(m.last);
    Settings.setPresets(m.presets);
    P.gotHello = true;
  }
  else if (m.type === 'presets') Settings.setPresets(m.presets);
  else if (m.type === 'diag') window.lastDiag = m; // inspected over CDP while developing
}

// ---- controls
let hideT;
document.addEventListener('pointerdown', e => {
  if (e.target.closest?.('#settings')) return;
  document.body.classList.add('ui');
  clearTimeout(hideT);
  hideT = setTimeout(() => document.body.classList.remove('ui'), S.hideAfter * 1000);
}, true);
const cmd = (c, dir) => { send({ type: 'cmd', cmd: c }); if (dir) { P.dir = dir; P.dirAt = performance.now(); } };
$('prev').onclick = () => cmd('prev', -1);
$('next').onclick = () => cmd('next', 1);
$('pp').onclick = () => { P.pos = now() - S.offset; P.at = performance.now(); P.lockUntil = P.at + 400; setPlaying(!P.playing, true); cmd('toggle'); };
$('heart').onclick = () => {
  P.liked = !P.liked;
  P.heartLock = performance.now() + 1500; // don't let an in-flight beat flip it back
  $('heart').classList.toggle('on', P.liked);
  $('heart').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: ms(350), easing: EASE });
  send({ type: 'cmd', cmd: 'heart' });
};
$('gear').onclick = () => Settings.open();
$('sclose').onclick = () => Settings.close();
$('settings').addEventListener('click', e => { if (e.target.id === 'settings') Settings.close(); }); // tap outside the sheet
$('sreset').onclick = () => Settings.reset();
const seek = t => { send({ type: 'cmd', cmd: 'seek', ms: t }); P.pos = t; P.at = performance.now(); };
Lyrics.onSeek(seek);
$('bar').addEventListener('pointerdown', e => {
  if (!document.body.classList.contains('ui') || !P.dur) return;
  seek(Math.round(e.clientX / innerWidth * P.dur));
});

// Keep-alive for the bridge: an adb-forwarded socket can stay "open" on the PC after the phone end dies,
// so the bridge reconnects when these stop arriving.
window.dockStatus = () => {
  const link = document.body.classList.contains('stale') ? 'Not connected' : 'Connected';
  const api = Api.enabled() ? ` · API key set${Api.lastStatus ? ` (last ${Api.lastStatus})` : ''}` : '';
  return `${link} · phone IP ${myIp || 'none'}${api}`;
};
// Spotify reaches the phone through adb (USB, or wireless adb when the cable is out - see scripts/link.ps1),
// always via localhost on the PC: Chromium refuses ws:// from Spotify's https page to a LAN address.
let myIp = '';
const refreshIp = () => { try { myIp = Dock.ip(); } catch (e) {} };
refreshIp();
setInterval(refreshIp, 10000);
setInterval(() => {
  send({ type: 'alive', ip: myIp });
  if (!P.id) $('artist').textContent = `Phone IP ${myIp || 'none'} · waiting for the LyricDock Spicetify bridge`;
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
function applyInsets() {
  const man = S.edgeMode === 'manual', st = document.documentElement.style, px = v => `${Math.round(v * 10) / 10}px`;
  st.setProperty('--sa-l', px(man ? S.edgePad : insets.l));
  st.setProperty('--sa-r', px(man ? S.edgePad : insets.r));
  st.setProperty('--sa-t', px(man ? 0 : insets.t));
  st.setProperty('--sa-b', px(man ? 0 : insets.b));
  const bar = r => { // raise by ~a quarter radius; inset = where the corner arc crosses that height
    if (r <= 0) return [0, 0];
    const y = Math.max(3, r * 0.25);
    return [y, r - Math.sqrt(r * r - (r - y) * (r - y)) + 4];
  };
  const [by, bx] = bar(man ? S.cornerPad : Math.max(insets.rbl, insets.rbr));
  const [ty, tx] = bar(man ? S.cornerPad : Math.max(insets.rtl, insets.rtr));
  st.setProperty('--bar-by', px(by)); st.setProperty('--bar-bx', px(bx));
  st.setProperty('--bar-ty', px(ty)); st.setProperty('--bar-tx', px(tx));
}

// ---- settings -> page
function apply(k) {
  const b = document.body;
  b.className = b.className.replace(/\b(layout|bg|align|prog|pp|scroll)-\S+/g, '').replace(/\s+/g, ' ').trim();
  b.classList.add(`layout-${S.layout}`, `bg-${S.bg}`, `align-${S.align}`, `prog-${S.progress}`, `pp-${S.ppAnim}`, `scroll-${S.scroll}`);
  b.classList.toggle('blurlines', S.blurLines);
  b.classList.toggle('times', S.times);
  b.classList.toggle('show-liked', S.showLiked);
  b.classList.toggle('show-quality', S.showQuality);
  try { Dock.setOrientation(S.orientation); } catch (e) {}
  applyInsets();
  const r = document.documentElement.style;
  r.setProperty('--size', S.size);
  r.setProperty('--dim', S.bgDim);
  r.setProperty('--as', S.animSpeed);
  (['split', 'tv'].includes(S.layout) ? $('art') : b).appendChild($('ctl'));
  if (kw) { kw.animationSpeed = S.bgSpeed; kw.warpIntensity = S.bgWarp; }
  if (!k || k === '*' || k === 'bg') art(P.art).then(im => background(P.art, im));
  if (k === '*' || ['roman', 'credits'].includes(k)) Lyrics.rebuild();
  requestAnimationFrame(() => { Lyrics.refresh(); sizeBg(); });
}
Settings.onChange(apply);
apply();
pullInsets();
setPlaying(false);
addEventListener('resize', () => { pullInsets(); Lyrics.refresh(); sizeBg(); });

// ---- frame loop
const clock = t => { t = Math.max(0, t) / 1000 | 0; return `${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`; };
let lastT = performance.now(), lastSec = -1;
const linkLog = window.linkLog = [];
(function tick(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000) || 0.016;
  lastT = t;
  const stale = !(P.at && performance.now() - P.at < 1500); // beats arrive every 500ms
  if (stale !== document.body.classList.contains('stale')) {
    document.body.classList.toggle('stale', stale);
    linkLog.push({ at: new Date().toLocaleTimeString(), stale }); // read over CDP when testing failover
    if (linkLog.length > 50) linkLog.shift();
  }
  const p = now();
  $('fill').style.transform = `scaleX(${P.dur ? Math.min(1, p / P.dur) : 0})`;
  if (S.times && (p / 1000 | 0) !== lastSec) {
    lastSec = p / 1000 | 0;
    $('tcur').textContent = clock(p);
    $('tdur').textContent = clock(P.dur);
  }
  Lyrics.update(p, dt);
  requestAnimationFrame(tick);
})(performance.now());
