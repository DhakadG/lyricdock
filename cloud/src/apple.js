// Apple Music catalogue, read the way a browser would: no developer key, no scraped token.
//  1. music.apple.com's own search page finds the album (the public iTunes Search API is the fallback; it
//     rate-limits Cloudflare's shared IPs, so it is only a fallback).
//  2. The album page embeds its data as JSON (<script id="serialized-server-data">): the real cover, still artwork up
//     to 4K, the square + tall motion artwork HLS playlists, editorial notes, audio badges, colours, track list.
//  3. The two HLS master playlists become lists of directly loopable MP4 variants.
// Same approach as github.com/m8tec/apple-music-animated-artworks, ported to a Worker.
// NB: step 2 relies on an undocumented page structure, so fetchAlbum() fails loudly when it stops matching.

const UA = { 'user-agent': 'Mozilla/5.0 (LyricDock cloud; +https://lyricdock.losthusky.qzz.io)' };

// Only ever fetch Apple hosts, whatever ends up in a URL we were handed or parsed out of a page.
function hostOk(url, domain) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && (u.hostname === domain || u.hostname.endsWith('.' + domain));
  } catch { return false; }
}

// fetch with a timeout, retries on 429 / 5xx / network errors, and Cloudflare edge caching (ignored elsewhere).
async function get(url, { tries = 3, timeout = 8000, ttl = 3600 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: UA, signal: AbortSignal.timeout(timeout),
        cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '400-499': 60, '500-599': 0 } },
      });
      if (r.ok) return r;
      r.body?.cancel();
      err = new Error(`HTTP ${r.status} ${new URL(url).pathname}`);
      if (r.status !== 429 && r.status < 500) break; // other 4xx won't get better
    } catch (e) { err = e; }
    if (i < tries - 1) await new Promise(done => setTimeout(done, 250 * 2 ** i));
  }
  throw err;
}

// "Midnights (3am Edition)", "Midnights - Deluxe", "MIDNIGHTS" -> "midnights"
export function norm(s) {
  // Strip only Latin-style accents (U+0300-036F) and recompose, so Devanagari matras / Japanese dakuten survive.
  const base = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase().replace(/&/g, ' and ');
  const clean = t => t.replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  // Falls back to the unstripped title so "(Untitled)" doesn't normalise to "" and match everything.
  return clean(base.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '')) || clean(base);
}

// A music.apple.com page -> its embedded JSON.
async function pageData(url) {
  if (!hostOk(url, 'music.apple.com')) throw new Error(`refusing to fetch ${url}`);
  const html = await (await get(url)).text();
  const m = html.match(/<script[^>]*\bid=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('page: no serialized-server-data');
  try { return JSON.parse(m[1]); } catch { throw new Error('page: serialized-server-data is not valid JSON'); }
}

// Every non-array object in the tree, parents before children, in document order (iterative: no deep call stacks).
function* walk(root, maxDepth = 14) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [o, d] = stack.pop();
    if (!o || typeof o !== 'object' || d > maxDepth) continue;
    if (!Array.isArray(o)) yield o;
    const kids = Object.values(o);
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
  }
}

// First object anywhere in `o` that has key `k` (the page layout moves around; keys are stable).
function findKey(o, k) {
  for (const x of walk(o, 12)) if (k in x) return x;
  return null;
}

// Whole words: "ye" is in "ye west" but not in "kanye west".
const words = (have, want) => ` ${have} `.includes(` ${want} `);

// Inputs normalised. 3 = same album name; 2 = Apple's name extends ours ("x" -> "x deluxe") or ours extends a
// long-enough Apple name (so "the twilight saga new moon" doesn't land on "twilight"); 0 = no.
// The artist must match by whole words, except on compilations: Spotify names the track artist, Apple "Various
// Artists" - those need the exact album name.
export function matchScore(a, b, ra, rb) {
  if (!ra || !rb) return 0;
  const va = ra === 'various artists';
  if (!(words(ra, a) || words(a, ra) || va)) return 0;
  const s = rb === b ? 3 : words(rb, b) || (words(b, rb) && rb.length >= 0.6 * b.length) ? 2 : 0;
  return va && a !== ra && s !== 3 ? 0 : s;
}
const artistCloseness = (ra, a) => ra === a ? 2 : words(ra, a) || words(a, ra) ? 1 : 0;

const albumId = cd => String(cd.identifiers?.storeAdamID || cd.url.split(/[?#]/)[0].split('/').pop());

async function pageCandidates(term, country) {
  const d = await pageData(`https://music.apple.com/${country}/search?term=${encodeURIComponent(term)}`);
  const seen = new Set(), out = [];
  for (const it of walk(d)) {
    const cd = it.contentDescriptor;
    if (cd?.kind !== 'album' || !cd.url || !it.artwork || seen.has(cd.url)) continue;
    seen.add(cd.url);
    out.push({
      id: albumId(cd), url: cd.url.split(/[?#]/)[0],
      name: it.title || it.titleLinks?.[0]?.title || '',
      by: it.subtitleLinks?.[0]?.title || String(it.subtitle || '').split('·').pop(),
    });
  }
  return out;
}

// Documented, stable fallback for when the web search page changes shape.
async function itunesCandidates(term, country) {
  const r = await get(`https://itunes.apple.com/search?media=music&entity=album&limit=25&country=${country}&term=${encodeURIComponent(term)}`);
  return ((await r.json()).results || []).filter(x => x.collectionId && x.collectionViewUrl).map(x => (
    { id: String(x.collectionId), url: x.collectionViewUrl.split('?')[0], name: x.collectionName, by: x.artistName }));
}

function rank(cands, artist, album) {
  const a = norm(artist), b = norm(album), out = [];
  for (const c of cands) {
    const ra = norm(c.by), s = matchScore(a, b, ra, norm(c.name));
    if (s) out.push({ id: c.id, url: c.url, score: s, aa: artistCloseness(ra, a) });
  }
  // Best title first; artist closeness breaks ties; Apple's own order (stable sort) breaks the rest.
  return out.sort((x, y) => y.score - x.score || y.aa - x.aa).slice(0, 3).map(({ id, url, score }) => ({ id, url, score }));
}

// Album candidates for artist + album, best match first.
export async function search(artist, album, country = 'us') {
  if (!/^[a-z]{2}$/i.test(country)) throw new Error(`bad storefront: ${country}`);
  const term = `${artist} ${album}`.slice(0, 200);
  let hits = [], err;
  try { hits = rank(await pageCandidates(term, country), artist, album); } catch (e) { err = e; }
  if (!hits.length) {
    try { hits = rank(await itunesCandidates(term, country), artist, album); } catch (e) { if (err) throw err; }
  }
  return hits;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "March 3, 2010" | "3 March 2010" | "2010-03-03" -> "2010-03-03"; anything else -> null (caller falls back to the year).
// Parsed by hand: Date.parse on free text is implementation-defined and depends on the runtime's timezone.
function parseDate(s) {
  s = String(s || '').trim();
  let y, mo, d, m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) [, y, mo, d] = m;
  else if ((m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) [, mo, d, y] = m;
  else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(s))) [, d, mo, y] = m;
  else return null;
  const n = /^\d+$/.test(mo) ? +mo : MONTHS.indexOf(mo.slice(0, 3).toLowerCase()) + 1;
  return n >= 1 && n <= 12 ? `${y}-${String(n).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}

export function parsePage(data) {
  const hdr = findKey(data, 'videoArtwork') || findKey(data, 'quaternaryTitle') || {};
  const art = hdr.artwork?.dictionary, tall = hdr.tallArtwork?.dictionary;
  const cover = findKey(data, 'containerArtwork')?.containerArtwork?.dictionary || art; // the real cover; `art` can be the motion poster
  const sq = hdr.videoArtwork?.dictionary?.motionDetailSquare, tv = hdr.tallVideoArtwork?.dictionary?.motionDetailTall;
  const [genre, year] = String(hdr.quaternaryTitle || '').split('·').map(s => s.trim());
  const foot = String(findKey(data, 'numberOfSocialBadges')?.description || '').split('\n'); // "March 3, 2010" / "19 songs, …" / "℗ 2010 …"
  const tracks = [], seen = new Set();
  for (const it of walk(data)) {
    const cd = it.contentDescriptor, id = cd?.identifiers?.storeAdamID;
    if (cd?.kind !== 'song' || !('trackNumber' in it) || id == null || seen.has(String(id))) continue;
    seen.add(String(id));
    tracks.push({ id: String(id), name: it.title, artist: it.artistName || null, number: it.trackNumber,
      disc: it.discNumber || 1, duration_ms: it.duration || null, preview_url: it.previewUrl || null, explicit: it.showExplicitBadge ? 1 : 0, composer: it.composer || null });
  }
  tracks.sort((x, y) => x.disc - y.disc || x.number - y.number);
  return {
    name: hdr.title || null, artist: hdr.subtitleLinks?.[0]?.title || null,
    artist_id: hdr.subtitleLinks?.[0]?.segue?.destination?.contentDescriptor?.identifiers?.storeAdamID || null,
    genre: genre || null, release_date: parseDate(foot[0]) || year || null,
    copyright: foot.find(l => /^[℗©]/.test(l)) || null, track_count: hdr.trackCount ?? tracks.length, explicit: hdr.showExplicitBadge ? 1 : 0,
    tracks,
    cover_url: cover?.url || null, cover_w: cover?.width || null, cover_h: cover?.height || null,
    art_url: art?.url || null, art_w: art?.width || null, art_h: art?.height || null,
    tall_art_url: tall?.url || null, tall_w: tall?.width || null, tall_h: tall?.height || null,
    colors: art ? { bg: art.bgColor, text1: art.textColor1, text2: art.textColor2, text3: art.textColor3, text4: art.textColor4 } : null,
    notes: hdr.modalPresentationDescriptor?.paragraphText || null,
    badges: hdr.audioBadges || null,
    square_m3u8: sq?.video || null, tall_m3u8: tv?.video || null,
  };
}

// HLS master -> every variant. Apple stores each variant as one fragmented MP4 ("<name>-.mp4") that the
// playlist addresses by byte range, so that file alone is a complete loopable video.
export function parseVariants(m3u8, base) {
  const lines = m3u8.split(/\r?\n/), out = [];
  lines.forEach((l, i) => {
    if (!l.startsWith('#EXT-X-STREAM-INF:')) return;
    const codec = (/CODECS="([a-z0-9]{4})/i.exec(l) || [])[1], res = /RESOLUTION=(\d+)x(\d+)/.exec(l);
    const bw = +((/[:,]BANDWIDTH=(\d+)/.exec(l) || [])[1] || 0), uri = lines[i + 1]?.trim();
    if (!codec || !res || !uri || uri.startsWith('#')) return;
    const url = new URL(uri, base).href.replace(/\.m3u8$/, '-.mp4');
    if (!/-\.mp4$/.test(url) || !hostOk(url, 'apple.com')) return;
    out.push({ n: url.match(/_video_(.+)-\.mp4$/)?.[1] || String(i), codec, w: +res[1], h: +res[2], bw, url });
  });
  return out;
}

// Motion artwork is a bonus: a missing or broken playlist must never sink the whole album.
async function variants(m3u8) {
  if (!m3u8 || !hostOk(m3u8, 'apple.com')) return null;
  try { return parseVariants(await (await get(m3u8, { tries: 2 })).text(), m3u8); } catch { return null; }
}

// Everything we index about one album: one page fetch + two small playlist fetches.
export async function fetchAlbum(id, url) {
  const { tracks, ...page } = parsePage(await pageData(url));
  if (!page.name) throw new Error(`album ${id}: page layout not recognised (no title found)`);
  const [sv, tv] = await Promise.all([variants(page.square_m3u8), variants(page.tall_m3u8)]);
  return {
    album: { id, url, ...page, square_variants: sv, tall_variants: tv, has_motion: (sv?.length || tv?.length) ? 1 : 0 },
    tracks: tracks.map(t => ({ ...t, album_id: id, artist: t.artist || page.artist })),
  };
}

// mzstatic artwork template -> concrete URL. Apple resizes on its CDN; the source goes up to 3840 px.
// {c} (crop code) shows up in some templates; "bb" = bounding box, i.e. no crop.
export const still = (tpl, w, h, fmt = 'jpg') => tpl
  ? tpl.replace(/\{w\}/g, w).replace(/\{h\}/g, h).replace(/\{f\}/g, fmt).replace(/\{c\}/g, 'bb')
  : null;
