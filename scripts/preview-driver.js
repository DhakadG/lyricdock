// Preview-only test driver: fake bridge feeding an invented, feature-rich word-synced demo song ("Midnight Signal" by Aria Vale
// ft. Kai Ren - not a real song, no real lyrics). It has: an intro gap with dots, duet lines on the other side, background vocals,
// split words (IsPartOfWord), held notes that trigger the letter effect, Hindi / Gurmukhi / Urdu lines, an instrumental break with
// dots, and a line-synced twin (demoTrack('line')) and a static one (demoTrack('static')). Not shipped in the APK.
window.Dock = { send: m => console.log('[cmd]', m), battery: () => '87,0', vibrate: () => {}, ip: () => '192.168.0.2', version: () => 'preview' };
(function () {
  // [text, ms, isPartOfWord?, romanization?]; a line's words follow each other from its start time.
  const W = (s, t, e, p = false, r) => ({ s, t, e, p, r });
  const mk = (words, t0, extra = {}) => { let t = t0; const w = words.map(x => { const o = W(x[0], t, t + x[1], x[2], x[3]); t += x[1]; return o; }); return { t: t0, e: t, opp: false, w, bg: [], ...extra }; };
  const lines = [
    mk([['Mid', 260, true], ['night ', 380], ['signal ', 520], ['on ', 260], ['the ', 220], ['water', 900]], 5200),
    mk([['I ', 200], ['hear ', 340], ['you ', 300], ['call ', 420], ['me ', 320], ['home', 1900]], 7900),
    mk([['Lights ', 420], ['go ', 300], ['soft ', 380], ['across ', 480], ['the ', 200], ['bay', 700]], 10600, { opp: true }),
    mk([['We ', 220], ['are ', 240], ['never ', 420], ['far', 1500], ['ther', 500, true], ['now', 800]], 13200),
    mk([['Say ', 300], ['it ', 220], ['again ', 520], ['a', 380, true], ['gain', 900]], 16400, { opp: true }),
    mk([['Dil ', 400, false, 'Dil'], ['mera ', 480, false, 'mera'], ['tera ', 480, false, 'tera'], ['zinda', 500, true, 'zinda'], ['gi', 900, false, 'gi']], 18900),
    mk([['ਸੋਹ', 400, true, 'soh'], ['ਣੀ ', 400, false, 'nee'], ['ਤੇਰੀ ', 520, false, 'teri'], ['ਯਾਦ', 900, false, 'yaad']], 21800, { opp: true }),
    mk([['Ooh ', 500], ['oh', 2600]], 30200),
    mk([['Hold ', 400], ['me ', 380], ['through ', 520], ['the ', 240], ['static', 1300]], 34000),
    mk([['And ', 260], ['let ', 260], ['the ', 220], ['morning ', 620], ['come', 2200]], 37000),
  ];
  lines[0].bg = [W('(signal', 6100, 6600), W('signal)', 6600, 7300)];
  lines[1].bg = [W('(home', 9400, 9900), W('home)', 9900, 10500)];
  lines[3].bg = [W('(far', 15200, 15800), W('away)', 15800, 16300)];
  lines[7].bg = [W('(ah', 31500, 32300), W('ah)', 32300, 33500)];
  const art = 'https://picsum.photos/id/1043/640/640'; // any square cover; swap for a Spotify one when you like
  const plain = lines.map(l => ({ t: l.t, e: l.e, opp: l.opp, s: l.w.map(w => w.s).join(''), r: undefined }));
  window.demoTrack = (kind = 'word', id = 'demo-' + kind) => dock({
    type: 'track', id, title: 'Midnight Signal', artist: 'Aria Vale, Kai Ren', album: 'Harbour Lights', dur: 200000, art, quality: 'Lossless',
    lyrics: kind === 'static' ? { kind: 'static', lines: plain.map(l => ({ s: l.s })), writers: ['A. Vale', 'K. Ren'], source: 'LRCLIB' }
      : kind === 'line' ? { kind: 'line', lines: plain, writers: ['A. Vale', 'K. Ren'], source: 'Spotify' }
      : { kind: 'word', lines, writers: ['A. Vale', 'K. Ren'], source: 'Apple Music', contributors: [] } });
  window.demoAt = ms => { window.__base = ms; window.__t0 = performance.now(); dock({ type: 'pos', pos: ms, playing: true, dur: 200000, quality: 'Lossless', liked: true, volume: 60 }); };
  // a bridge beat every 500 ms, with a little jitter like the real thing
  setInterval(() => window.__t0 && dock({ type: 'pos', pos: window.__base + performance.now() - window.__t0 + (Math.random() * 60 - 30), playing: true, dur: 200000, quality: 'Lossless', liked: true, volume: 60 }), 500);
  demoTrack();
  demoAt(4000);
})();
