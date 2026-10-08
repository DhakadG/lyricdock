// LyricDock web app: the miniplayer, a small always-on-top window.
// - Chrome, Edge, Brave, Opera (Windows, Mac, Linux): Document Picture-in-Picture holding a second copy of the app
//   (/?mini=<channel>), so the lyrics are LyricDock's own: word effects, background, the screen's look. Around them a
//   trimmed-down player: cover, song and like on top, timeline and controls at the bottom. It never connects to
//   Spotify: this copy hands it every message it hears (app.js route -> miniFeed) and carries out its commands
//   (send / control -> miniHost).
// - Safari (Mac, iPad, iPhone): the cover, the line being sung and the next one drawn on a canvas and shown as
//   picture-in-picture video; the system's play/pause/skip buttons go through Media Session.
// - Firefox has neither API, so Settings hides the option.
(() => {
  // ---- inside the miniplayer: fed by the main copy. Only the lyrics pane (and the background behind it) is the app's
  // own; around it sits a trimmed-down player: cover, song and like on top; at the bottom, shown while the pointer is
  // in the window (or paused), the timeline, the controls and a few extras beside them (text size, volume, top bar).
  const mini = window.LYRICDOCK_MINI;
  if (mini) {
    const ch = new BroadcastChannel(`lyricdock-mini-${mini}`);
    window.miniHost = d => { try { ch.postMessage(d); } catch (e) {} };
    ch.onmessage = e => { if (e.data?.src) route(e.data.src, e.data.m); };
    miniHost({ hello: 1 });
    setInterval(() => miniHost({ beat: 1 }), 1000);
    const keep = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} };
    // The look comes from the screen's settings (settings.js), made readable for a small window over any cover (white
    // lines, Spicy Lyrics' 0.5 for the others, a darker background); the screen's furniture stays off in here.
    const off = { layout: 'lyrics', clock: 'off', qsEnabled: false, nextChip: false, progress: 'off', times: false, timeStyle: 'off', battery: false, showBlocks: false, sourceBadge: false,
      lineColor: 'white', duetColors: false, lineOpacity: 0.5, blurLines: false, outline: true, bgDim: Math.max(S.bgDim, 0.45), size: +(keep('dock:miniSize') || S.size) };
    for (const [k, v] of Object.entries(off)) if (S[k] !== v) Settings.set(k, v, false);
    const svg = id => $(id).querySelector('svg').outerHTML;
    const icon = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
    const st = document.createElement('style');
    st.textContent = `body.mini #left,body.mini #ctl,body.mini #gear,body.mini #qs,body.mini #qpanel,body.mini #stat,body.mini #nextChip,body.mini #bar,body.mini #times,body.mini #clockPane,body.mini #signin{display:none!important}
body.mini #wrap{padding:var(--mh) 16px 14px!important}
body.mini #lines{filter:drop-shadow(0 1px 5px rgba(0,0,0,.45))}
#mh,#mb{position:fixed;left:0;right:0;z-index:50;display:flex;align-items:center;gap:10px;padding:10px 14px;color:#fff;font:14px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
#mh{top:0;background:linear-gradient(rgba(0,0,0,.5),transparent)}
#mb{bottom:0;flex-direction:column;align-items:stretch;gap:2px;padding:28px 12px 8px;background:linear-gradient(transparent,rgba(0,0,0,.75) 45%);
  opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .25s,transform .25s}
body.mini.bar #mb{opacity:1;transform:none;pointer-events:auto}
#mArt{width:44px;height:44px;flex:none;border-radius:8px;object-fit:cover;background:#222;box-shadow:0 2px 10px rgba(0,0,0,.4)}#mArt:not([src]){visibility:hidden}
#mh div{display:grid;min-width:0;flex:1}#mT,#mA{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mT{font-weight:700}#mA{font-size:.85em;opacity:.7}
#mTl{display:flex;align-items:center;gap:8px;font-size:11px;opacity:.85;font-variant-numeric:tabular-nums}
#mPr{flex:1;min-width:0;height:4px;accent-color:#fff;cursor:pointer}
#mNav{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4px}
#mNav .main,#mNav .side{display:flex;align-items:center;gap:4px}#mNav .l{justify-content:flex-start}#mNav .r{justify-content:flex-end}
#mini button{position:relative;width:34px;height:34px;flex:none;display:grid;place-items:center;border:0;border-radius:50%;color:#fff;background:none;cursor:pointer;padding:0;font:700 13px system-ui,sans-serif}
#mini button:hover{background:rgba(255,255,255,.14)}#mini button:focus-visible{outline:2px solid #fff}
#mini svg{width:18px;height:18px;fill:currentColor}
#mini .s,#mini .side button{opacity:.6}#mini .side button:hover{opacity:1}#mini .s.on{opacity:1;color:rgb(var(--acc,255,255,255))}#mini .one::after{content:"1";position:absolute;top:4px;right:5px;font:700 9px system-ui}
#mini [data-k=pp]{width:40px;height:40px;background:#fff;color:#000}#mini [data-k=pp]:hover{background:#ddd}
#mVol.muted{opacity:.35}#mHead.on{opacity:1}
#mLike path.fill{opacity:0}#mLike.on path.fill{opacity:1;color:rgb(var(--acc,30,215,96))}
body.mini.short #mh,body.mini.nohead #mh{display:none}body.mini.narrow #mini .s{display:none}
body.mini.slim #mNav{grid-template-columns:auto}body.mini.slim #mNav .side{display:none}`;
    document.head.append(st);
    const ui = document.createElement('div');
    ui.id = 'mini';
    ui.innerHTML = `<header id="mh"><img id="mArt" alt=""><div><b id="mT"></b><span id="mA"></span></div><button id="mLike" data-k="heart" aria-label="Like">${svg('heart')}</button></header>
<footer id="mb"><div id="mTl"><span id="mCur">0:00</span><input id="mPr" type="range" min="0" max="1" value="0" aria-label="Seek"><span id="mDur">0:00</span></div>
<nav id="mNav"><div class="side l"><button data-x="smaller" aria-label="Smaller lyrics" title="Smaller lyrics">A−</button><button data-x="bigger" aria-label="Bigger lyrics" title="Bigger lyrics">A+</button></div>
<div class="main"><button class="s" data-k="shuf" aria-label="Shuffle">${svg('shuf')}</button><button data-k="prev" aria-label="Previous">${svg('prev')}</button><button data-k="pp" aria-label="Play or pause"><svg viewBox="0 0 24 24"><path/></svg></button><button data-k="next" aria-label="Next">${svg('next')}</button><button class="s" data-k="rep" aria-label="Repeat">${svg('rep')}</button></div>
<div class="side r"><button id="mVol" data-x="mute" aria-label="Mute (scroll for volume)">${svg('volUp')}</button><button id="mHead" data-x="head" aria-label="Show or hide the song bar" title="Song bar">${icon('M4 4h16v5H4zm0 7h16v2H4zm0 4h16v2H4zm0 4h10v2H4z')}</button></div></nav></footer>`;
    document.body.append(ui);
    document.body.classList.add('mini');
    document.body.classList.toggle('nohead', keep('dock:miniHead') === 'off');
    const q = id => document.getElementById(id), pr = q('mPr'), vol = $('vol'), last = {};
    // Volume goes through the app's own slider (throttled, app.js); a mute remembers where it was.
    const setVol = v => { vol.value = Math.max(0, Math.min(100, Math.round(v))); vol.dispatchEvent(new Event('input')); q('mVol').title = `Volume ${vol.value}%`; };
    let unmute = 50;
    const extra = {
      smaller: () => { Settings.set('size', Math.max(0.6, +(S.size - 0.1).toFixed(2)), false); keep('dock:miniSize', S.size); },
      bigger: () => { Settings.set('size', Math.min(1.6, +(S.size + 0.1).toFixed(2)), false); keep('dock:miniSize', S.size); },
      mute: () => { if (+vol.value > 0) { unmute = +vol.value; setVol(0); } else setVol(unmute); },
      head: () => { keep('dock:miniHead', document.body.classList.toggle('nohead') ? 'off' : 'on'); fit(); },
    };
    ui.onclick = e => {
      const b = e.target.closest('[data-k], [data-x]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.k) $(b.dataset.k).click(); // the app's own buttons
      else extra[b.dataset.x]();
    };
    q('mVol').addEventListener('wheel', e => { e.preventDefault(); setVol(+vol.value + (e.deltaY < 0 ? 5 : -5)); }, { passive: false });
    let drag = false;
    pr.onpointerdown = () => { drag = true; };
    pr.onchange = () => { drag = false; seek(+pr.value); };
    // The bottom bar: up while the pointer moves in the window or rests on the bar, while dragging, and while paused.
    let barT = 0, overBar = false;
    const wake = () => { document.body.classList.add('bar'); clearTimeout(barT); barT = setTimeout(() => { if (!overBar && !drag && P.playing) document.body.classList.remove('bar'); }, 2500); };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, wake, { passive: true });
    q('mb').onpointerenter = () => { overBar = true; wake(); };
    q('mb').onpointerleave = () => { overBar = false; wake(); };
    document.documentElement.addEventListener('pointerleave', () => { overBar = false; clearTimeout(barT); barT = setTimeout(() => P.playing && !drag && document.body.classList.remove('bar'), 600); });
    const fit = () => {
      const short = innerHeight < 160;
      document.body.classList.toggle('short', short);
      document.body.classList.toggle('narrow', innerWidth < 300);
      document.body.classList.toggle('slim', innerWidth < 440 || innerHeight > innerWidth); // no room beside the controls
      document.body.style.setProperty('--mh', `${short || document.body.classList.contains('nohead') ? 12 : q('mh').offsetHeight}px`);
    };
    addEventListener('resize', fit);
    fit();
    wake();
    (function frame() {
      const t = $('title').textContent, a = $('artist').textContent, real = pos();
      if (t !== last.t) q('mT').textContent = last.t = t;
      if (a !== last.a) q('mA').textContent = last.a = a;
      if (P.art !== last.art) { last.art = P.art; if (P.art) q('mArt').src = P.art; else q('mArt').removeAttribute('src'); }
      if (P.playing !== last.pl) { last.pl = P.playing; ui.querySelector('[data-k="pp"] path').setAttribute('d', P.playing ? PAUSE : PLAY); if (!P.playing) document.body.classList.add('bar'); else wake(); }
      for (const k of ['heart', 'shuf', 'rep']) {
        const b = ui.querySelector(`[data-k="${k}"]`), c = $(k).classList;
        b.classList.toggle('on', c.contains('on')); b.classList.toggle('one', c.contains('one'));
      }
      q('mVol').hidden = !$('ctl').classList.contains('has-vol'); // Spotify reports no volume for some devices
      q('mVol').classList.toggle('muted', +vol.value === 0);
      q('mHead').classList.toggle('on', !document.body.classList.contains('nohead'));
      if (P.dur !== last.dur) { pr.max = last.dur = P.dur || 1; q('mDur').textContent = clock(P.dur); }
      if (!drag) pr.value = real;
      q('mCur').textContent = clock(drag ? +pr.value : real);
      requestAnimationFrame(frame);
    })();
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
