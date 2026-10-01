// Apple Music catalogue, read the way a browser would: no developer key, no scraped token.
//  1. iTunes Search API (public, documented) finds the album and its music.apple.com page.
//  2. The album page embeds its data as JSON (<script id="serialized-server-data">): still artwork up to 4K,
//     the square + tall motion artwork HLS playlists, editorial notes, audio badges, colours.
//  3. iTunes Lookup API gives the track list.
// Same approach as github.com/m8tec/apple-music-animated-artworks, ported to a Worker.

const UA = { 'user-agent': 'Mozilla/5.0 (LyricDock cloud; +https://lyricdock.losthusky.qzz.io)' };

// "Midnights (3am Edition)", "Midnights - Deluxe", "MIDNIGHTS" -> "midnights"
export function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// A music.apple.com page -> its embedded JSON.
async function pageData(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).pathname.split('/')[2]} page`);
  const m = (await r.text()).match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('page: no serialized-server-data');
  return JSON.parse(m[1]);
}
function* walk(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 14) return;
  if (!Array.isArray(o)) yield o;
  for (const v of Object.values(o)) yield* walk(v, depth + 1);
}

// 3 = same album name, 2 = Apple's name extends ours ("X" vs "X (Deluxe)") or ours extends a long-enough Apple
// name, 0 = no. The artist must match too, except on compilations (Spotify names the track artist, Apple "Various Artists").
export function matchScore(a, b, ra, rb) {
  if (!ra || !rb) return 0;
  const artistOk = ra.includes(a) || a.includes(ra) || ra === 'various artists';
  const score = rb === b ? 3 : rb.includes(b) || (b.includes(rb) && rb.length >= 0.6 * b.length) ? 2 : 0;
  return artistOk && (ra !== 'various artists' || score === 3 || a === ra) ? score : 0;
}

// Album candidates for artist + album (Apple's web search page), best match first.
export async function search(artist, album, country = 'us') {
  const d = await pageData(`https://music.apple.com/${country}/search?term=${encodeURIComponent(`${artist} ${album}`.slice(0, 200))}`);
  const a = norm(artist), b = norm(album), seen = new Set(), out = [];
  for (const it of walk(d)) {
    const cd = it.contentDescriptor;
    if (cd?.kind !== 'album' || !cd.url || !it.artwork || seen.has(cd.url)) continue;
    seen.add(cd.url);
    const name = it.title || it.titleLinks?.[0]?.title || '', by = it.subtitleLinks?.[0]?.title || String(it.subtitle || '').split('·').pop();
    const score = matchScore(a, b, norm(by), norm(name));
    if (score) out.push({ id: String(cd.identifiers?.storeAdamID || cd.url.split('/').pop()), url: cd.url, score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 3);
}

// First object anywhere in `o` that has key `k` (the page layout moves around; keys are stable).
function findKey(o, k, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 12) return null;
  if (k in o && !Array.isArray(o)) return o;
  for (const v of Object.values(o)) { const f = findKey(v, k, depth + 1); if (f) return f; }
  return null;
}

export function parsePage(data) {
  const hdr = findKey(data, 'videoArtwork') || findKey(data, 'quaternaryTitle') || {};
  const art = hdr.artwork?.dictionary, tall = hdr.tallArtwork?.dictionary;
  const sq = hdr.videoArtwork?.dictionary?.motionDetailSquare, tv = hdr.tallVideoArtwork?.dictionary?.motionDetailTall;
  const [genre, year] = String(hdr.quaternaryTitle || '').split('·').map(s => s.trim());
  const foot = String(findKey(data, 'numberOfSocialBadges')?.description || '').split('\n'); // "March 3, 2010" / "19 songs, …" / "℗ 2010 …"
  const tracks = [];
  for (const it of walk(data)) {
    if (it.contentDescriptor?.kind !== 'song' || !('trackNumber' in it)) continue;
    tracks.push({ id: String(it.contentDescriptor.identifiers?.storeAdamID), name: it.title, artist: it.artistName || null, number: it.trackNumber,
      disc: it.discNumber || 1, duration_ms: it.duration || null, preview_url: it.previewUrl || null, explicit: it.showExplicitBadge ? 1 : 0, composer: it.composer || null });
  }
  const cover = findKey(data, 'containerArtwork')?.containerArtwork?.dictionary || art; // the real cover; `art` can be the motion poster
  return {
    cover_url: cover?.url || null, cover_w: cover?.width || null, cover_h: cover?.height || null,
    name: hdr.title || null, artist: hdr.subtitleLinks?.[0]?.title || null,
    artist_id: hdr.subtitleLinks?.[0]?.segue?.destination?.contentDescriptor?.identifiers?.storeAdamID || null,
    genre: genre || null, release_date: foot[0] && Date.parse(foot[0]) ? new Date(Date.parse(foot[0]) + 432e5).toISOString().slice(0, 10) : year || null,
    copyright: foot.find(l => /^[℗©]/.test(l)) || null, track_count: hdr.trackCount ?? tracks.length, explicit: hdr.showExplicitBadge ? 1 : 0,
    tracks,
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
    const codec = (/CODECS="([a-z0-9]{4})/.exec(l) || [])[1], res = /RESOLUTION=(\d+)x(\d+)/.exec(l);
    const bw = +((/[:,]BANDWIDTH=(\d+)/.exec(l) || [])[1] || 0), uri = lines[i + 1]?.trim();
    if (!codec || !res || !uri || uri.startsWith('#')) return;
    const url = new URL(uri, base).href.replace(/\.m3u8$/, '-.mp4');
    if (!/^https:\/\/[^/]+\.apple\.com\/.+-\.mp4$/.test(url)) return;
    out.push({ n: url.match(/_video_(.+)-\.mp4$/)?.[1] || String(i), codec, w: +res[1], h: +res[2], bw, url });
  });
  return out;
}

async function variants(m3u8) {
  if (!m3u8) return null;
  const r = await fetch(m3u8, { headers: UA });
  return r.ok ? parseVariants(await r.text(), m3u8) : null;
}

// Everything we index about one album: one page fetch + two small playlist fetches.
export async function fetchAlbum(id, url) {
  const { tracks, ...page } = parsePage(await pageData(url));
  const [sv, tv] = await Promise.all([variants(page.square_m3u8), variants(page.tall_m3u8)]);
  return {
    album: { id, url, ...page, square_variants: sv, tall_variants: tv, has_motion: sv?.length || tv?.length ? 1 : 0 },
    tracks: tracks.map(t => ({ ...t, album_id: id, artist: t.artist || page.artist })),
  };
}

// mzstatic artwork template -> concrete URL. Apple resizes on its CDN; the source goes up to 3840 px.
export const still = (tpl, w, h) => tpl ? tpl.replace('{w}', w).replace('{h}', h).replace('{f}', 'jpg') : null;
