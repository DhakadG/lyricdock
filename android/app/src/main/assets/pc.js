// Playback source "Apps on my PC": the LyricDock Helper reads Windows' media sessions (Apple Music, YouTube Music in a
// browser, VLC... - helper/src-tauri/src/media.rs) and streams them over its relay port. The phone finds the helper the
// way rtc.js does (Spotify's hello, or Settings -> Connection); the web app on that PC uses 127.0.0.1, and only when this
// source is picked (the browser asks before a site may reach this PC).
const Pc = (() => {
  const n = Named(),
    PORT = 8977;
  let ws = null,
    base = null,
    fails = 0,
    next = 0;
  const where = () => {
    if (window.LYRICDOCK_WEB) return Settings.S.source === 'pc' ? `http://127.0.0.1:${PORT}` : null;
    if (!['auto', 'pc'].includes(Settings.S.source)) return null;
    const ip = (Settings.S.relay === 'helper' && Settings.S.relayUrl) || localStorage.getItem('dock:helper') || '';
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? `http://${ip}:${PORT}` : null;
  };
  function tick() {
    const b = where();
    if (b !== base && ws) ws.close();
    base = b;
    if (!b || ws || Date.now() < next) return;
    ws = new WebSocket(b.replace(/^http/, 'ws') + '/media/ws');
    ws.onopen = () => (fails = 0);
    ws.onmessage = e => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (x) {
        return;
      }
      if (m.type === 'track' && m.art) m.art = base + m.art; // served by the helper, next to the stream
      if (m.type === 'track' || m.type === 'pos') n.msg(m);
    };
    ws.onclose = () => {
      ws = null;
      next = Date.now() + Math.min(60000, 2000 * 2 ** fails++); // helper closed or not running: try again, less often
    };
  }
  setInterval(tick, 2000);
  return {
    control: (cmd, ms) =>
      base &&
      fetch(base + '/media/cmd', { method: 'POST', body: JSON.stringify({ cmd, ms: +ms || 0 }) }).catch(() => {}),
    app: n.app,
    onMessage: f => {
      n.onMessage(f);
      tick();
    },
  };
})();
window.Pc = Pc;
