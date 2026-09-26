// LyricDock: playback clock, track changes (with preloaded art), background, controls, settings.
const $ = id => document.getElementById(id);
const S = Settings.S;
const P = { pos: 0, at: 0, playing: false, dur: 0, id: null, art: null, lyrics: null, dir: 1, dirAt: 0, lockUntil: 0, token: 0, shown: false };
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

async function onTrack(m) {
  if (!/^https:\/\/[^"'()\\\s]+$/.test(m.art || '')) m.art = null;
  if (m.id === P.id) { // same song: lyrics arrived after the track, or Spicy's word-synced ones replaced a fallback
    if (m.lyrics && (!P.lyrics || m.upgrade)) {
      P.lyrics = m.lyrics;
      Lyrics.build(m.lyrics);
      $('lyrics').animate([{ opacity: 0, transform: 'translateY(3vh)' }, { opacity: 1, transform: 'none' }], { duration: ms(500), easing: EASE });
    }
    return;
  }
  const token = ++P.token;
  const outStyle = S.trackAnim, d = performance.now() - P.dirAt < 3000 ? P.dir : 1;
  const parts = [$('artbox'), $('meta'), $('lyrics')];
  // Out-animation and cover decode run in parallel; the new cover is ready before it comes in.
  const outDone = outStyle !== 'none' && P.shown
    ? Promise.all(parts.map((el, i) => el.animate(OUT[outStyle](d), { duration: ms(240), delay: ms(i * 30), easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished))
    : Promise.resolve();
  const [im] = await Promise.all([Promise.race([art(m.art), sleep(900).then(() => null)]), outDone]);
  if (token !== P.token) return; // skipped again meanwhile
  swap(m, im, m.lyrics ?? pre.get(m.id)?.lyrics ?? null);
  parts.forEach((el, i) => {
    el.getAnimations().forEach(a => a.cancel());
    if (outStyle !== 'none') el.animate(IN[outStyle](d), { duration: ms(560), delay: ms(i * 55), easing: EASE, fill: 'backwards' });
  });
  P.shown = true;
}

function onPreload(m) {
  pre.set(m.id, m);
  if (pre.size > 6) pre.delete(pre.keys().next().value);
  art(m.art); // warm the decode now
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
  // After a tap, ignore play state from beats already in flight, so the button doesn't flicker back.
  if (performance.now() > P.lockUntil) setPlaying(!!m.playing, had && !!m.playing !== P.playing);
}

function dock(m) {
  if (m.type === 'track') onTrack(m);
  else if (m.type === 'preload') onPreload(m);
  else if (m.type === 'pos') onPos(m);
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
  const link = document.body.classList.contains('stale') ? 'Not connected' : P.via === 'usb' ? 'USB' : P.via === 'wifi' ? 'Wi-Fi' : 'Connected';
  return `${link} · phone IP ${myIp || 'none'}`;
};
// It also carries the phone's Wi-Fi IP, which the bridge remembers for the Wi-Fi fallback.
let myIp = '';
const refreshIp = () => { try { myIp = Dock.ip(); } catch (e) {} };
refreshIp();
setInterval(refreshIp, 10000);
setInterval(() => {
  send({ type: 'alive', ip: myIp });
  if (!P.id) $('artist').textContent = myIp ? `Phone IP ${myIp} · Spotify → profile menu → LyricDock` : 'Connect this phone to Wi-Fi or USB';
}, 1000);

// ---- settings -> page
function apply(k) {
  const b = document.body;
  b.className = b.className.replace(/\b(layout|bg|align|prog|pp|scroll)-\S+/g, '').replace(/\s+/g, ' ').trim();
  b.classList.add(`layout-${S.layout}`, `bg-${S.bg}`, `align-${S.align}`, `prog-${S.progress}`, `pp-${S.ppAnim}`, `scroll-${S.scroll}`);
  b.classList.toggle('blurlines', S.blurLines);
  b.classList.toggle('times', S.times);
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
setPlaying(false);
addEventListener('resize', () => { Lyrics.refresh(); sizeBg(); });

// ---- frame loop
const clock = t => { t = Math.max(0, t) / 1000 | 0; return `${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`; };
let lastT = performance.now(), lastSec = -1;
(function tick(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000) || 0.016;
  lastT = t;
  document.body.classList.toggle('stale', !(P.at && performance.now() - P.at < 1500)); // beats arrive every 500ms
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
