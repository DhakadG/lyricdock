// LyricDock cloud. One Worker, three hostnames:
//   lyricdock.losthusky.qzz.io        public info page
//   art.lyricdock.losthusky.qzz.io    API (/v1/*) + promoted videos (/m/*)
//   admin.lyricdock.losthusky.qzz.io  dashboard, password-protected (admin.js)
// Docs: docs/lyricdock-cloud.md

import { still } from './apple.js';
import { config, resolve, choose, mediaTier, serveR2, maintain, track } from './store.js';
import { admin } from './admin.js';
import SITE from './site.html';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range', 'Access-Control-Expose-Headers': '*' };
const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': cache } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), t0 = Date.now(), ev = { kind: 'api', path: url.pathname };
    if (url.hostname.startsWith('admin.')) return admin(req, env, ctx, url);
    let res;
    try { res = await publicApi(req, env, ctx, url, ev); }
    catch (e) { ev.detail = String(e?.message || e); res = json({ error: 'upstream or internal error' }, 502); }
    if (req.method !== 'OPTIONS') log(env, req, url, ev, res, Date.now() - t0);
    return res;
  },
  async scheduled(_, env) { await maintain(env, await config(env, true)); },
};

async function publicApi(req, env, ctx, url, ev) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method not allowed' }, 405);
  const p = url.pathname, q = url.searchParams;
  if (!url.hostname.startsWith('art.')) { // the info site
    ev.kind = 'page';
    return p === '/' ? new Response(SITE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } }) : json({ error: 'not found' }, 404);
  }

  const m = p.match(/^\/m\/(\d+\/(?:square|tall)\/[a-z0-9_]+)\.mp4$/);
  if (m) {
    ev.kind = 'media'; ev.tier = 'r2'; ev.album_id = m[1].split('/')[0]; ev.media_key = m[1];
    const r = await serveR2(req, env, m[1], CORS);
    if (r?.status === 302) ev.tier = 'apple-fallback';
    ev.bytes = +(r?.headers.get('content-length') || 0);
    return r || json({ error: 'not found' }, 404);
  }
  if (!p.startsWith('/v1/')) return json({ error: 'not found' }, 404);

  const cfg = await config(env);
  if (!cfg.api_enabled) return json({ error: 'API paused' }, 503);
  if (cfg.blocked.includes(q.get('d'))) return json({ error: 'blocked' }, 403);
  if (p === '/v1/health') return json({ ok: true });
  if (p === '/v1/ping') { ev.kind = 'ping'; return json({ ok: true }); }

  // Rung 1: the edge cache. Same question (minus who asks) = same answer, no KV, no Apple.
  const ck = new URL(url); ['d', 'v'].forEach(k => ck.searchParams.delete(k)); ck.searchParams.sort();
  const cacheKey = new Request(ck.href), hitRes = await caches.default.match(cacheKey);
  if (hitRes) {
    const meta = JSON.parse(hitRes.headers.get('x-ld-ev') || '{}');
    Object.assign(ev, meta, { kind: p === '/v1/cover' ? 'cover' : 'api', tier: `edge/${meta.mtier || '-'}` });
    return hitRes;
  }
  const res = await answer(env, cfg, url, ev);
  if (res.status === 200 || res.status === 404) {
    const c = res.clone(), h = new Headers(c.headers);
    h.set('cache-control', `public, max-age=${cfg.edge_ttl}`);
    h.set('x-ld-ev', JSON.stringify({ album_id: ev.album_id, media_key: ev.media_key, album: ev.album, artist: ev.artist, mtier: ev.mtier }));
    ctx.waitUntil(caches.default.put(cacheKey, new Response(c.body, { status: c.status, headers: h })));
  }
  return res;
}

// Rungs 2 + 3: KV index, else Apple.
async function answer(env, cfg, url, ev) {
  const p = url.pathname, q = url.searchParams;
  const artist = (q.get('artist') || '').split(/,\s*/)[0].trim(), albumName = (q.get('album') || '').trim();
  if (!artist || !albumName || artist.length > 200 || albumName.length > 300) return json({ error: 'artist and album are required' }, 400);
  const { album, src } = await resolve(env, cfg, artist, albumName);
  Object.assign(ev, { tier: src, album_id: album?.id, album: album?.name, artist: album?.artist });

  if (p === '/v1/album') {
    if (!album) return json({ album: null }, 404);
    const { tracks, ...rest } = album;
    return json({ album: publicAlbum(rest), tracks });
  }
  if (p === '/v1/track') {
    const title = (q.get('title') || '').trim().toLowerCase();
    const t = album && title && album.tracks.filter(t => t.name.toLowerCase().startsWith(title)).sort((a, b) => a.name.length - b.name.length)[0];
    return t ? json({ track: t, album: publicAlbum({ ...album, tracks: undefined }) }) : json({ track: null }, 404);
  }
  if (p === '/v1/cover') {
    ev.kind = 'cover';
    if (!album) return json({ video: null, still: null }, 404);
    const shape = q.get('shape') === 'tall' ? 'tall' : 'square';
    const px = Math.min(cfg.max_px, Math.max(64, +q.get('px') || 1080));
    // still = the real album cover (as large as Apple has it, up to px); poster = the video's first frame (up to 3840)
    const tall = shape === 'tall' && album.tall_art_url, cw = Math.min(px, album.cover_w || px);
    const pw = Math.min(px, (tall ? album.tall_w : album.art_w) || px), ph = tall ? Math.round(pw * 4 / 3) : pw;
    const out = { album: { id: album.id, name: album.name, artist: album.artist }, still: still(album.cover_url || album.art_url, cw, cw),
      poster: still(tall ? album.tall_art_url : album.art_url, pw, ph), colors: album.colors, video: null };
    const v = choose(shape === 'tall' ? album.tall_variants : album.square_variants, { px, hevc: cfg.allow_hevc && q.get('hevc') === '1', q: q.get('q') });
    if (v) {
      const key = `${album.id}/${shape}/${v.n}`, tier = await mediaTier(env, key);
      Object.assign(ev, { media_key: key, mtier: tier, tier: `${src}/${tier}` }); // lookup rung / media rung, e.g. "index/r2"
      out.video = tier === 'r2' ? `${url.origin}/m/${key}.mp4` : v.url;
      out.variant = { n: v.n, codec: v.codec, w: v.w, h: v.h, bw: v.bw, tier };
    }
    return json(out, v ? 200 : 404);
  }
  return json({ error: 'not found' }, 404);
}

function publicAlbum(a) {
  const { square_variants, tall_variants, square_m3u8, tall_m3u8, tracks, ...rest } = a;
  return { ...rest, motion: { square: (square_variants || []).map(({ url, ...v }) => v), tall: (tall_variants || []).map(({ url, ...v }) => v) } };
}

// One Analytics Engine data point per request. Geo comes from Cloudflare's edge (request.cf), never the app.
function log(env, req, url, ev, res, ms) {
  const cf = req.cf || {}, q = url.searchParams, ua = req.headers.get('user-agent') || '';
  const model = (/Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(ua) || [])[1] || (/Windows|Mac OS X|Linux|iPhone|iPad/.exec(ua) || [])[0] || '';
  track(env, { ...ev, status: res.status, ms, device: q.get('d'), version: q.get('v'), model, country: cf.country, city: cf.city, colo: cf.colo,
    lat: cf.latitude, lon: cf.longitude, px: q.get('px'), hevc: q.has('hevc') ? +(q.get('hevc') === '1') : -1 });
}
