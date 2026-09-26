// Preview-only test driver: fake bridge feeding a word-synced song. Not shipped in the APK.
window.Dock = { send: m => console.log('[cmd]', m) };
(function () {
  const W = (s, t, e, p = false, r) => ({ s, t, e, p, r });
  const mk = (words, t0, extra = {}) => { let t = t0; const w = words.map(x => { const o = W(x[0], t, t + x[1], x[2], x[3]); t += x[1]; return o; }); return { t: t0, e: t, opp: false, w, bg: [], ...extra }; };
  const lines = [
    mk([['Maa', 300, true], ['di ', 300], ['tu ', 300], ['ki', 250, true], ['ti ', 300], ['behi', 400, true], ['saab', 500]], 4000),
    mk([['ਸੋਹ', 400, true], ['ਣੀ', 400], ['ਤੇਰੀ', 500], ['ਯਾਦ', 600]], 6800),
    mk([['दिल', 400], ['मेरा', 500], ['तेरा', 500], ['ज़िंदगी', 700]], 9000),
    mk([['Kudiye', 500], ['jo', 300], ['vaar', 400], ['kade', 500]], 16000, { opp: true }),
    mk([['Door', 300], ['ho', 200], ['ni', 200], ['paara', 500], ['tera', 400], ['ishq', 500], ['da', 300], ['junoon', 700]], 18500),
  ];
  lines[1].bg = [W('(oh', 7600, 8000), W('oh)', 8000, 8400)];
  window.demoTrack = (id = 'demo', art = 'https://i.scdn.co/image/ab67616d0000b273b52e8a3c2a3b2b8b5d2e8f4a') => dock({
    type: 'track', id, title: 'Behisaab (Demo)', artist: 'Karan Aujla, Ikky', dur: 200000,
    art: 'https://i.scdn.co/image/ab67616d0000b2734ce8b4e42588bf18182a1ad2',
    lyrics: { kind: 'word', lines, writers: ['Anmol Ashish', 'Pratik Singh'], source: 'Apple Music' } });
  window.demoAt = ms => { window.__base = ms; window.__t0 = performance.now(); dock({ type: 'pos', pos: ms, playing: true, dur: 200000 }); };
  setInterval(() => window.__t0 && dock({ type: 'pos', pos: window.__base + performance.now() - window.__t0, playing: true, dur: 200000 }), 500);
  demoTrack();
  demoAt(7700);
})();
