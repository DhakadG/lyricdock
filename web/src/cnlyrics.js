// /lyrics/find: NetEase Cloud Music, QQ Music and Kugou, asked side by side for a song by name - their catalogues carry
// word-synced lyrics for many Western and Asian songs that LRCLIB only has line by line. None needs a key, but none
// answers a browser (no CORS) and Kugou's are encrypted, hence here. Every version found goes back (NetEase can give both
// word and line); the page ranks them with Settings -> Lyrics sources (lyrics.js rank). Same shape as Lyrics.fromSpicy.

const T = 5000; // a slow catalogue gives up, the others still answer
const get = (url, init = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(T) }).then(
    r => (r.ok ? r.json() : null),
    () => null,
  );

// ---- matching: titles and artists compared loosely, the length strictly (same-name songs are common)
export const norm = s =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s(feat|ft|with)\.?\s.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const artistsOf = s =>
  String(s || '')
    .split(/[、/&,;，]|\sx\s|\sand\s|\sfeat\.?\s|\sft\.?\s/i)
    .map(norm)
    .filter(Boolean);
// The search: title and first artist (every artist made the catalogues' searches miss).
const query = want => encodeURIComponent(`${want.title} ${artistsOf(want.artist)[0] ?? ''}`.trim());
export function score(want, c) {
  const a = norm(want.title),
    b = norm(c.title);
  if (!a || !b || (a !== b && !a.startsWith(b + ' ') && !b.startsWith(a + ' '))) return -1;
  const wa = norm(want.artist),
    ca = norm(c.artist);
  const artist =
    artistsOf(want.artist).some(x => x && ca.includes(x)) || artistsOf(c.artist).some(x => x && wa.includes(x));
  if (!artist) return -1;
  if (want.dur && c.dur && Math.abs(want.dur - c.dur) > 3000) return -1;
  return (a === b ? 2 : 1) - (want.dur && c.dur ? Math.abs(want.dur - c.dur) / 3000 : 0.5);
}
const pick = (want, list, n = 2) =>
  list
    .map(c => [score(want, c), c])
    .filter(([s]) => s >= 0)
    .sort((x, y) => y[0] - x[0])
    .slice(0, n)
    .map(([, c]) => c);

// ---- parsing. Credit lines ("作词 : ...", "Lyrics by: ...", "Song - Artist") are dropped.
const CREDIT =
  /^[^:：]{0,24}(词|曲|编曲|制作|混音|母带|和声|录音|监制|出品|吉他|贝斯|鼓|弦乐|lyrics|composed|composer|produced|producer|written|writer|arrange|mix|master|vocal|by)[^:：]{0,12}[:：]/i;
// ("Song - Artist" or "Artist - Song": the header line some catalogues put first)
const credit = (s, want) => CREDIT.test(s) || (/ - /.test(s) && s.split(' - ').some(x => norm(x) === norm(want.title)));
const ends = lines => lines.map((l, i) => ({ ...l, e: l.e ?? lines[i + 1]?.t ?? l.t + 5000 }));

export function lrc(text, want) {
  const lines = String(text || '')
    .split('\n')
    .flatMap(s => {
      const m = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/.exec(s.trim());
      if (!m) return [];
      const t = m[2].trim();
      return [...m[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)].map(([, mm, ss]) => ({
        t: Math.round((+mm * 60 + +ss.replace(':', '.')) * 1000),
        s: t,
      }));
    })
    .filter(l => !credit(l.s, want))
    .sort((a, b) => a.t - b.t);
  // empty lines are pauses: they end the line before and are not shown
  const out = ends(lines).filter(l => l.s);
  return out.length > 2 ? { kind: 'line', lines: out } : null;
}

// Word lines: NetEase yrc "[start,dur](t,d,0)word(t,d,0)word" (absolute times), Kugou krc "[start,dur]<o,d,0>word" (o from
// the line's start). A word carrying its own trailing space is a whole word; one without is joined to the next (CJK).
function words(text, re, rel, want) {
  const lines = [];
  for (const s of String(text || '').split('\n')) {
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(s.trim());
    if (!m) continue;
    const t0 = +m[1],
      w = [...m[3].matchAll(re)]
        .map(([, t, d, x]) => ({ t: (rel ? t0 : 0) + +t, e: (rel ? t0 : 0) + +t + +d, raw: x }))
        .filter(x => x.raw);
    const txt = w.map(x => x.raw).join('');
    if (!txt.trim() || credit(txt.trim(), want)) continue;
    lines.push({
      t: t0,
      e: t0 + +m[2],
      opp: false,
      w: w
        .map((x, i) => ({ s: x.raw.trim(), t: x.t, e: x.e, p: i < w.length - 1 && !/\s$/.test(x.raw) }))
        .filter(x => x.s),
      bg: [],
    });
  }
  return lines.length > 2 ? { kind: 'word', lines } : null;
}
export const yrc = (t, want) => words(t, /\((\d+),(\d+),\d+\)([^(]*)/g, false, want);
export const krc = (t, want) => words(t, /<(\d+),(\d+),\d+>([^<]*)/g, true, want);

const tag = (l, source) => (l ? { ...l, writers: [], source } : null);

// ---- NetEase Cloud Music: yrc (word) and lrc (line) in one answer
async function netease(want) {
  const q = query(want);
  const h = { referer: 'https://music.163.com/', cookie: 'os=pc' };
  const r = await get(`https://music.163.com/api/search/get?s=${q}&type=1&limit=10`, { headers: h });
  const list = (r?.result?.songs ?? []).map(s => ({
    id: s.id,
    title: s.name,
    artist: (s.artists ?? []).map(a => a.name).join('、'),
    dur: s.duration,
  }));
  for (const c of pick(want, list)) {
    const l = await get(`https://music.163.com/api/song/lyric/v1?id=${c.id}&lv=1&yv=1&tv=-1`, { headers: h });
    const got = [tag(yrc(l?.yrc?.lyric, want), 'NetEase'), tag(lrc(l?.lrc?.lyric, want), 'NetEase')].filter(Boolean);
    if (got.length) return got;
  }
  return [];
}

// ---- Kugou: krc (word), encrypted: base64, 'krc1' header, XOR with a fixed key, then zlib
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
export async function krcText(b64) {
  const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).slice(4);
  for (let i = 0; i < b.length; i++) b[i] ^= KRC_KEY[i % 16];
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate'))).text();
}
async function kugou(want) {
  const q = query(want);
  const r = await get(`http://mobilecdn.kugou.com/api/v3/search/song?keyword=${q}&page=1&pagesize=10`);
  const list = (r?.data?.info ?? []).map(s => ({
    hash: s.hash,
    title: s.songname,
    artist: s.singername,
    dur: s.duration * 1000,
  }));
  for (const c of pick(want, list)) {
    const s = await get(
      `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=${c.dur}&hash=${c.hash}`,
    );
    const k = s?.candidates?.[0];
    if (!k) continue;
    const d = await get(
      `https://lyrics.kugou.com/download?ver=1&client=pc&id=${k.id}&accesskey=${k.accesskey}&fmt=krc&charset=utf8`,
    );
    if (!d?.content) continue;
    const l = tag(krc(await krcText(d.content).catch(() => ''), want), 'Kugou');
    if (l) return [l];
  }
  return [];
}

// ---- QQ Music: lrc (line). Its search gives no length, so the lyrics' own last line must fit inside the song.
async function qq(want) {
  const h = { referer: 'https://y.qq.com/' };
  const q = query(want);
  const r = await get(`https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&key=${q}`, { headers: h });
  const list = (r?.data?.song?.itemlist ?? []).map(s => ({ mid: s.mid, title: s.name, artist: s.singer }));
  for (const c of pick(want, list)) {
    const l = await get(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${c.mid}&format=json&nobase64=1&g_tk=5381`,
      { headers: h },
    );
    const x = lrc(l?.lyric, want);
    if (x && (!want.dur || x.lines[x.lines.length - 1].t < want.dur + 2000)) return [tag(x, 'QQ Music')];
  }
  return [];
}

export const PROVIDERS = { netease, kugou, qq };

// GET /lyrics/find?t=title&a=artist&d=length in ms -> [lyrics...] (empty when none matched)
export async function find(want) {
  const all = await Promise.all(Object.values(PROVIDERS).map(p => p(want).catch(() => [])));
  return all.flat();
}
