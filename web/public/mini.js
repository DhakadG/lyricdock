// LyricDock web app: the miniplayer, a small always-on-top window.
// - Chrome, Edge, Brave, Opera (Windows, Mac, Linux): Document Picture-in-Picture holding a second copy of the app
//   (/?mini=<channel>), so it's LyricDock itself: the same lyrics, word effects, background and layouts. It never
//   connects to Spotify: this copy hands it every message it hears (app.js route -> miniFeed) and carries out its
//   commands (send / control -> miniHost). It keeps its own settings (settings.js), and by default its layout follows
//   the window's shape while it's resized (Settings -> Miniplayer layout).
// - Safari (Mac, iPad, iPhone): the cover, the line being sung and the next one drawn on a canvas and shown as
//   picture-in-picture video; the system's play/pause/skip buttons go through Media Session.
// - Firefox has neither API, so Settings hides the option.
(() => {
  // ---- inside the miniplayer: fed by the main copy
  const mini = window.LYRICDOCK_MINI;
  if (mini) {
    const ch = new BroadcastChannel(`lyricdock-mini-${mini}`);
    window.miniHost = d => { try { ch.postMessage(d); } catch (e) {} };
    ch.onmessage = e => { if (e.data?.src) route(e.data.src, e.data.m); };
    miniHost({ hello: 1 });
    setInterval(() => miniHost({ beat: 1 }), 1000);
    // Fit the window: wide -> cover beside the lyrics, short -> big centred lyrics, narrow or tall -> lyrics only.
    const fit = () => {
      const w = innerWidth, h = innerHeight;
      const want = S.miniLayout !== 'auto' ? S.miniLayout
        : h < 190 ? 'cinema' : w / h >= 1.45 ? (w >= 620 ? 'split' : 'player') : w < 420 || h > w * 1.3 ? 'lyrics' : 'compact';
      if (S.layout !== want) Settings.set('layout', want, false);
    };
    let fitT = 0;
    addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fit, 120); }); // once the drag settles
    Settings.onChange(k => { if (k === 'miniLayout') fit(); });
    fit();
    return;
  }

  const dpip = 'documentPictureInPicture' in window;
  const vpip = !dpip && !!document.pictureInPictureEnabled && 'captureStream' in HTMLCanvasElement.prototype;
  const state = () => {
    const p = pos() + S.offset, L = Lyrics.lineAt(p);
    return { p, L, title: $('title').textContent, artist: $('artist').textContent, art: P.art, playing: P.playing };
  };
  const sweep = s => s.L?.text ? Math.max(0, Math.min(1, (s.p - s.L.t) / Math.max(1, s.L.e - s.L.t))) : 0;
  const press = k => $(k)?.click();

  // ---- Document Picture-in-Picture: the app itself in an iframe, on a channel of its own
  let win = null, opening = false;
  async function openDoc() {
    if (win) return win.focus();
    if (opening) return; // a second press while the first window is still opening
    opening = true;
    try { win = await documentPictureInPicture.requestWindow({ width: 480, height: 270 }); } finally { opening = false; }
    const w = win, id = crypto.randomUUID().slice(0, 8), ch = new BroadcastChannel(`lyricdock-mini-${id}`);
    ch.onmessage = e => {
      const d = e.data || {};
      if (d.hello) { // (re)loaded: catch it up with the song, what's next and where playback is
        for (const src of ['bridge', 'web']) for (const m of [SRC[src].track, SRC[src].preload, SRC[src].pos]) if (m) ch.postMessage({ src, m });
      } else if (d.beat) Web.poke(); // the window is visible, this tab usually isn't: keep Spotify's polling on time
      else if (d.ctl) control(...d.ctl);
      else if (d.send && !['alive', 'settings', 'schema', 'pair'].includes(d.send.type)) send(d.send); // its own heartbeat and look stay home
    };
    const skip = new Set(['hello', 'set', 'load', 'auth', 'update', 'wake']); // this screen's settings, sign-in and updates
    window.miniFeed = (src, m) => { if (!skip.has(m?.type)) try { ch.postMessage({ src, m }); } catch (e) {} };
    const d = w.document;
    d.title = 'LyricDock';
    d.head.innerHTML = '<meta name="color-scheme" content="dark"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style>';
    const f = d.createElement('iframe');
    f.src = `${location.origin}/?mini=${id}`;
    f.allow = 'autoplay';
    d.body.append(f);
    w.addEventListener('pagehide', () => { if (win !== w) return; win = null; window.miniFeed = null; ch.close(); });
  }
  // Chrome opens it by itself when the tab is left, but only for a page it counts as playing media (System media
  // controls on, shim.js) and once the user allows "Automatic picture-in-picture" for the site.
  if (dpip) try { navigator.mediaSession.setActionHandler('enterpictureinpicture', () => openDoc().catch(() => {})); } catch (e) {}

  // ---- Safari: a canvas, streamed into a muted video, shown picture-in-picture. Prepared up front, because Safari
  // only allows picture-in-picture straight from a tap, with a video that already has a frame.
  let cv, ctx, vid, img, imgUrl, timer, small;
  function wrap(text, max, lines) {
    const out = [];
    for (const w of text.split(' ')) {
      const l = out.length ? `${out[out.length - 1]} ${w}` : w;
      if (out.length && ctx.measureText(l).width <= max) out[out.length - 1] = l; else out.push(w);
    }
    return out.slice(0, lines);
  }
  function paint() {
    const s = state(), W = cv.width, H = cv.height;
    if (s.art !== imgUrl) { imgUrl = s.art; img = null; if (s.art) { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => { img = i; }; i.src = s.art; } }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (img) {
      // Blur without ctx.filter (Safari's canvas ignores it): shrink the cover to a few pixels, stretch it back, darken.
      small ||= Object.assign(document.createElement('canvas'), { width: 16, height: 9 });
      small.getContext('2d').drawImage(img, 0, 0, 16, 9);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(small, -60, -60, W + 120, H + 120);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 28, 28, 88, 88);
    }
    ctx.fillStyle = '#fff'; ctx.font = '600 30px system-ui, -apple-system, sans-serif'; ctx.fillText(s.title.slice(0, 40), 136, 64);
    ctx.globalAlpha = .65; ctx.font = '26px system-ui, -apple-system, sans-serif'; ctx.fillText(s.artist.slice(0, 44), 136, 102); ctx.globalAlpha = 1;
    ctx.font = '700 46px system-ui, -apple-system, sans-serif';
    const lines = wrap(s.L?.text || '♪', W - 56, 3), k = sweep(s), total = lines.join(' ').length || 1;
    let done = k * total;
    lines.forEach((l, n) => {
      const y = 196 + n * 54, x = 28, w = ctx.measureText(l).width, f = Math.max(0, Math.min(1, done / (l.length || 1)));
      done -= l.length + 1;
      ctx.fillStyle = 'rgba(255,255,255,.38)'; ctx.fillText(l, x, y);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y - 50, w * f, 64); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillText(l, x, y); ctx.restore();
    });
  }
  function prepVideo() {
    cv = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
    ctx = cv.getContext('2d');
    paint();
    vid = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: cv.captureStream(30) });
    vid.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;right:0';
    document.body.append(vid);
    vid.play().catch(() => {});
    vid.addEventListener('enterpictureinpicture', () => { clearInterval(timer); timer = setInterval(paint, 100); });
    vid.addEventListener('leavepictureinpicture', () => clearInterval(timer));
    // The system's buttons on the picture-in-picture window.
    const ms = navigator.mediaSession;
    if (ms) for (const [a, k] of [['play', 'pp'], ['pause', 'pp'], ['nexttrack', 'next'], ['previoustrack', 'prev']]) try { ms.setActionHandler(a, () => press(k)); } catch (e) {}
  }
  function openVideo() {
    if (document.pictureInPictureElement) return document.exitPictureInPicture();
    paint();
    vid.play().catch(() => {});
    vid.requestPictureInPicture().catch(e => window.notice?.(`Miniplayer: ${e.message}`, 4000));
  }

  const open = () => (dpip ? openDoc() : openVideo())?.catch?.(e => window.notice?.(`Miniplayer: ${e.message}`, 4000));
  if (vpip) addEventListener('load', prepVideo);
  window.lyricdockMini = Object.assign(open, { supported: dpip || vpip });
  // M opens it (a key press counts as the click the browser wants), unless typing somewhere.
  if (dpip || vpip) addEventListener('keydown', e => {
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]') && !window.lyricdockPanelOpen?.()) open();
  });
})();
