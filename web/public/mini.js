// LyricDock web app: the miniplayer. A small always-on-top window with the cover, the line being sung (swept as it is
// sung), the next line and the controls.
// - Chrome, Edge, Brave, Opera (desktop): Document Picture-in-Picture, a real page with buttons.
// - Safari (Mac, iPad, iPhone): the same drawn on a canvas and shown as picture-in-picture video; the system's
//   play/pause/skip buttons go through Media Session.
// - Firefox has neither API, so Settings hides the option.
// It reads the app's own state (P, pos(), Lyrics) and presses the app's own buttons, so it is never a second player.
(() => {
  const dpip = 'documentPictureInPicture' in window;
  const vpip = !dpip && !!document.pictureInPictureEnabled && 'captureStream' in HTMLCanvasElement.prototype;
  const state = () => {
    const p = pos() + S.offset, L = Lyrics.lineAt(p);
    return { p, L, title: $('title').textContent, artist: $('artist').textContent, art: P.art, playing: P.playing };
  };
  const sweep = s => s.L?.text ? Math.max(0, Math.min(1, (s.p - s.L.t) / Math.max(1, s.L.e - s.L.t))) : 0;
  const press = k => $(k)?.click();
  const icon = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const PREV = 'M6 6h2v12H6zm3.5 6 8.5 6V6z', NEXT = 'M16 6h2v12h-2zM6 18l8.5-6L6 6z';

  // ---- Document Picture-in-Picture
  const CSS = `*{box-sizing:border-box;margin:0}html,body{height:100%}
body{overflow:hidden;background:#000;color:#fff;font:15px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-rows:auto 1fr;gap:6px;padding:12px 14px;user-select:none}
#bg{position:fixed;inset:-20%;z-index:-1;background:#111 center/cover;filter:blur(40px) saturate(1.4) brightness(.45)}
header{display:flex;gap:10px;align-items:center;min-width:0}
#art{width:44px;height:44px;flex:none;border-radius:8px;object-fit:cover;background:#222}#art:not([src]){visibility:hidden}
header div{display:grid;min-width:0}#t,#a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#t{font-weight:650}#a{font-size:.8em;opacity:.65}
main{display:grid;align-content:center;gap:6px;min-height:0}
#cur{font-weight:750;font-size:clamp(16px,7vw,34px);line-height:1.15;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* inline, so the gradient runs across the wrapped rows in reading order (box-decoration-break: slice) */
#cs{--k:0;color:transparent;-webkit-background-clip:text;background-clip:text;background-image:linear-gradient(90deg,#fff calc(var(--k)*100%),rgba(255,255,255,.38) calc(var(--k)*100%))}
#cs.gap{color:rgba(255,255,255,.4);background:none}
#nxt{font-size:clamp(12px,4vw,18px);opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav{position:fixed;right:10px;bottom:10px;display:flex;gap:6px;opacity:0;transition:opacity .2s}
body:hover nav,nav:focus-within{opacity:1}@media (hover:none){nav{opacity:1}}
button{width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:50%;color:#fff;background:rgba(255,255,255,.16);cursor:pointer;backdrop-filter:blur(8px)}
button:hover{background:rgba(255,255,255,.28)}button:focus-visible{outline:2px solid #fff}svg{width:18px;height:18px;fill:currentColor}`;
  let win = null, opening = false;
  async function openDoc() {
    if (win) return win.focus();
    if (opening) return; // a second press while the first window is still opening
    opening = true;
    try { win = await documentPictureInPicture.requestWindow({ width: 380, height: 200 }); } finally { opening = false; }
    const w = win, d = w.document;
    d.title = 'LyricDock';
    d.head.innerHTML = `<meta name="color-scheme" content="dark"><style>${CSS}</style>`;
    d.body.innerHTML = `<div id="bg"></div><header><img id="art" alt=""><div><b id="t"></b><span id="a"></span></div></header>
      <main><p id="cur"><span id="cs"></span></p><p id="nxt"></p></main>
      <nav><button data-k="prev" aria-label="Previous">${icon(PREV)}</button><button data-k="pp" aria-label="Play or pause">${icon('')}</button><button data-k="next" aria-label="Next">${icon(NEXT)}</button></nav>`;
    d.body.onclick = e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) press(k); };
    d.onkeydown = e => { if (e.key === ' ') { e.preventDefault(); press('pp'); } else if (e.key === 'ArrowRight') press('next'); else if (e.key === 'ArrowLeft') press('prev'); };
    const q = id => d.getElementById(id), last = {};
    w.addEventListener('pagehide', () => { if (win === w) win = null; });
    // Driven by the miniplayer window's own frames: the app's tab is usually hidden (and throttled) while it is open.
    const frame = () => {
      if (win !== w) return;
      const s = state(), L = s.L;
      if (s.art !== last.art) { last.art = s.art; if (s.art) q('art').src = s.art; else q('art').removeAttribute('src'); q('bg').style.backgroundImage = s.art ? `url(${JSON.stringify(s.art)})` : 'none'; }
      if (s.title !== last.title) q('t').textContent = last.title = s.title;
      if (s.artist !== last.artist) q('a').textContent = last.artist = s.artist;
      if (s.playing !== last.playing) { last.playing = s.playing; d.querySelector('[data-k="pp"] path').setAttribute('d', s.playing ? PAUSE : PLAY); }
      const key = `${L?.i}|${L?.text}`;
      if (key !== last.key) {
        last.key = key;
        q('cs').textContent = L?.text || '♪';
        q('cs').classList.toggle('gap', !L?.text);
        q('nxt').textContent = L?.next?.[0] || '';
      }
      q('cs').style.setProperty('--k', sweep(s).toFixed(3));
      w.requestAnimationFrame(frame);
    };
    frame();
  }

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
