// The index (KV), the activity log (Analytics Engine) and the storage ladder (R2). docs/lyricdock-cloud.md.
//
// Request path, cheapest first:  edge cache (Cache API) -> KV index -> Apple (search + album page, once per album)
// Media path:                     app cache -> R2 copy (only "hot" files) -> Apple's CDN (everything else)
// Nothing on the request path writes to a database: plays are logged to Analytics Engine, and a cron every
// 30 min reads those counts to copy hot files into R2 and drop cold ones.
//
// KV keys:  cfg            settings
//           l:<artist|album>  lookup -> { a: album id | null, at }        metadata { a, n }
//           a:<id>         album + tracks + variants                    metadata { n, ar, m, f, g, y, t }
//           m:<id/shape/variant>  a promoted / pinned file               metadata { tier, bytes, at, pin }

import { norm, search, fetchAlbum } from './apple.js';

export const DEFAULTS = {
  api_enabled: true,    // kill switch for the public API
  promote_hits: 3,      // plays within promote_days before a video is copied to R2
  promote_days: 14,
  evict_days: 30,       // R2 copies not played for this long are deleted (unless pinned)
  r2_budget_gb: 10,     // hard cap for R2 videos; least recently played go first
  neg_days: 7,          // "Apple has nothing" is believed this long, then asked again
  refresh_days: 30,     // albums without motion art are re-checked this often (Apple adds some later)
  max_px: 2160,         // largest video side handed out
  allow_hevc: true,     // offer HEVC variants to clients that say they decode it
  edge_ttl: 600,        // seconds a lookup answer stays in the edge cache
  blocked: [],          // device ids refused by the API
};

let cfgCache = null, cfgAt = 0;
export async function config(env, fresh) {
  if (!fresh && cfgCache && Date.now() - cfgAt < 30000) return cfgCache;
  cfgCache = { ...DEFAULTS, ...(await env.KV.get('cfg', { type: 'json', cacheTtl: fresh ? undefined : 60 })) };
  cfgAt = Date.now();
  return cfgCache;
}
export async function setConfig(env, patch) {
  const cur = await config(env, true), next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    const d = DEFAULTS[k];
    next[k] = Array.isArray(d) ? [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))].slice(0, 500) : typeof d === 'boolean' ? !!v : Math.max(0, +v || 0);
  }
  await env.KV.put('cfg', JSON.stringify(next));
  cfgCache = next; cfgAt = Date.now();
  return next;
}

// ---- Analytics Engine: one data point per request (fire-and-forget, no database).
// blobs: 1 kind, 2 path, 3 tier, 4 album id, 5 media key, 6 country, 7 city, 8 colo, 9 app version, 10 model, 11 detail, 12 album, 13 artist,
//        14 platform (android / web / pwa), 15 screen (WxH@dpr), 16 time zone, 17 language
// doubles: 1 status, 2 ms, 3 bytes, 4 lat, 5 lon, 6 px, 7 hevc (1/0/-1 unknown)
export function track(env, e) {
  env.AE?.writeDataPoint({
    indexes: [(e.device || '').slice(0, 96)],
    blobs: [e.kind, e.path, e.tier, e.album_id, e.media_key, e.country, e.city, e.colo, e.version, e.model, e.detail, e.album, e.artist,
      e.plat, e.screen, e.tz, e.lang].map(v => String(v ?? '').slice(0, 300)),
    doubles: [e.status, e.ms, e.bytes, e.lat, e.lon, e.px, e.hevc ?? -1].map(v => +v || 0),
  });
}
export async function aeQuery(env, sql, retry = 1) {
  if (!env.CF_API_TOKEN) throw new Error('CF_API_TOKEN secret not set (needed to read Analytics Engine)');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`, { method: 'POST', headers: { authorization: `Bearer ${env.CF_API_TOKEN}` }, body: `${sql} FORMAT JSON` });
  // AE's SQL API sometimes 500s when the dashboard sends its dozen queries at once: one more try.
  if (r.status >= 500 && retry) { await new Promise(res => setTimeout(res, 400)); return aeQuery(env, sql, 0); }
  if (!r.ok) throw new Error(`Analytics Engine ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).data;
}

// ---- index
export const getAlbum = (env, id) => env.KV.get(`a:${id}`, { type: 'json', cacheTtl: 300 });

async function ingest(env, cand) {
  const { album, tracks } = await fetchAlbum(cand.id, cand.url);
  album.fetched_at = Date.now();
  album.tracks = tracks;
  await env.KV.put(`a:${album.id}`, JSON.stringify(album), { metadata: { n: album.name, ar: album.artist, m: album.has_motion, f: album.fetched_at, g: album.genre, y: album.release_date, t: tracks.length, art: album.cover_url || album.art_url } });
  return album;
}

// artist + album -> indexed album (or null). `src` says which rung answered: 'index' or 'apple'.
export async function resolve(env, cfg, artist, albumName) {
  const key = `l:${norm(artist)}|${norm(albumName)}`.slice(0, 500), now = Date.now();
  const fresh = a => a && (a.has_motion || now - a.fetched_at < cfg.refresh_days * 864e5);
  const lk = await env.KV.get(key, { type: 'json', cacheTtl: 300 });
  if (lk) {
    const a = lk.a ? await getAlbum(env, lk.a) : null;
    if (lk.a ? fresh(a) : now - lk.at < cfg.neg_days * 864e5) return { album: a, src: 'index' };
  }
  let got = null;
  for (const c of (await search(artist, albumName)).slice(0, 2)) { // an edition with motion art beats one without
    const known = await getAlbum(env, c.id);
    const a = fresh(known) ? known : await ingest(env, c);
    if (!got || (a.has_motion && !got.has_motion)) got = a;
    if (got.has_motion) break;
  }
  await env.KV.put(key, JSON.stringify({ a: got?.id ?? null, at: now }), { metadata: { a: got?.id ?? null, n: got?.name ?? null, at: now } });
  return { album: got, src: 'apple' };
}

// ---- which file: the smallest resolution that covers `px`, then the lowest bitrate there ('max': highest).
// Apple ships ~15 encodes per video (360p..2160p, H.264 + HEVC), so "compression" is picking the right one.
export function choose(vs, { px, hevc, q }) {
  const ok = (vs || []).filter(v => v.codec === 'avc1' || (hevc && v.codec === 'hvc1'));
  if (!ok.length) return null;
  const side = v => Math.min(v.w, v.h), sizes = [...new Set(ok.map(side))].sort((a, b) => a - b);
  const R = sizes.find(s => s >= px * 0.9) ?? sizes.at(-1); // 10% under is invisible, and often a size class smaller
  const at = ok.filter(v => side(v) === R).sort((a, b) => a.bw - b.bw);
  return q === 'max' ? at.at(-1) : at[0];
}

// ---- media ladder
export const mediaTier = async (env, key) => (await env.KV.get(`m:${key}`, { type: 'json', cacheTtl: 300 }))?.tier === 'r2' ? 'r2' : 'apple';

function variantOf(album, key) {
  const [, shape, n] = key.split('/');
  return (shape === 'tall' ? album.tall_variants : album.square_variants)?.find(v => v.n === n) || null;
}

// Apple -> R2, streamed (no buffering).
export async function promote(env, key) {
  const album = await getAlbum(env, key.split('/')[0]), v = album && variantOf(album, key);
  if (!v) throw new Error('unknown media key');
  const r = await fetch(v.url), len = +r.headers.get('content-length');
  if (!r.ok || !len) throw new Error(`Apple HTTP ${r.status}`);
  const { readable, writable } = new FixedLengthStream(len);
  await Promise.all([r.body.pipeTo(writable), env.R2.put(`m/${key}.mp4`, readable, { httpMetadata: { contentType: 'video/mp4' } })]);
  const prev = await env.KV.get(`m:${key}`, { type: 'json' });
  const rec = { tier: 'r2', bytes: len, at: Date.now(), pin: !!prev?.pin, url: v.url, codec: v.codec, w: v.w, h: v.h };
  await env.KV.put(`m:${key}`, JSON.stringify(rec), { metadata: { tier: 'r2', bytes: len, at: rec.at, pin: rec.pin } });
  return rec;
}
export async function setPin(env, key, pin) {
  const rec = { ...(await env.KV.get(`m:${key}`, { type: 'json' })), pin: !!pin };
  rec.tier ||= 'apple';
  await env.KV.put(`m:${key}`, JSON.stringify(rec), { metadata: { tier: rec.tier, bytes: rec.bytes || 0, at: rec.at || 0, pin: rec.pin } });
  if (pin && rec.tier !== 'r2') await promote(env, key);
}
export async function demote(env, keys) {
  if (!keys.length) return 0;
  await env.R2.delete(keys.map(k => `m/${k}.mp4`));
  await Promise.all(keys.map(k => env.KV.delete(`m:${k}`)));
  return keys.length;
}

export async function listAll(env, prefix, cap = 10000) {
  const out = [];
  let cursor;
  do {
    const r = await env.KV.list({ prefix, cursor, limit: 1000 });
    out.push(...r.keys);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < cap);
  return out;
}

// Cron (every 30 min) or from the dashboard: promote hot files, evict cold ones, enforce the budget.
export async function maintain(env, cfg) {
  const rows = await aeQuery(env, `SELECT blob5 AS key, SUM(_sample_interval) AS n, MAX(timestamp) AS last FROM lyricdock_events
    WHERE blob1 = 'cover' AND blob5 != '' AND timestamp > NOW() - INTERVAL '${Math.max(cfg.promote_days, cfg.evict_days)}' DAY GROUP BY key`);
  const stats = new Map(rows.map(r => [r.key, { n: +r.n, last: Date.parse(String(r.last).replace(' ', 'T') + 'Z') }]));
  const inR2 = (await listAll(env, 'm:')).filter(k => k.metadata?.tier === 'r2');
  const r2Keys = new Set(inR2.map(k => k.name.slice(2)));
  // promote: plays in the promotion window. (Counts cover the longer window; close enough for a ladder.)
  const recent = await aeQuery(env, `SELECT blob5 AS key, SUM(_sample_interval) AS n FROM lyricdock_events WHERE blob1 = 'cover' AND blob5 != ''
    AND timestamp > NOW() - INTERVAL '${cfg.promote_days}' DAY GROUP BY key HAVING n >= ${cfg.promote_hits}`);
  let promoted = 0;
  for (const r of recent) if (!r2Keys.has(r.key)) { try { await promote(env, r.key); promoted++; } catch (e) { console.warn('promote', r.key, e.message); } }
  // evict: unpinned copies not played within evict_days, then least recently played over the budget
  const now = Date.now(), cold = inR2.filter(k => !k.metadata?.pin && (stats.get(k.name.slice(2))?.last || k.metadata?.at || 0) < now - cfg.evict_days * 864e5).map(k => k.name.slice(2));
  let evicted = await demote(env, cold);
  const left = inR2.filter(k => !cold.includes(k.name.slice(2))).sort((a, b) => (stats.get(a.name.slice(2))?.last || 0) - (stats.get(b.name.slice(2))?.last || 0));
  let total = left.reduce((s, k) => s + (k.metadata?.bytes || 0), 0);
  const over = [];
  for (const k of left) { if (total <= cfg.r2_budget_gb * 2 ** 30) break; if (!k.metadata?.pin) { over.push(k.name.slice(2)); total -= k.metadata?.bytes || 0; } }
  evicted += await demote(env, over);
  return { promoted, evicted, r2_bytes: total };
}

// R2 copy with range requests. Not in R2 (evicted since the answer was cached): send the player to Apple.
export async function serveR2(req, env, key, cors) {
  const k = `m/${key}.mp4`, rh = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  let range, size;
  if (rh && (rh[1] || rh[2])) {
    size = (await env.R2.head(k))?.size;
    if (size != null) {
      const start = rh[1] ? +rh[1] : Math.max(0, size - +rh[2]), end = rh[1] && rh[2] ? Math.min(+rh[2], size - 1) : size - 1;
      if (start > end) return new Response(null, { status: 416, headers: { ...cors, 'content-range': `bytes */${size}` } });
      range = { offset: start, length: end - start + 1 };
    }
  }
  const obj = await env.R2.get(k, { range, onlyIf: req.headers });
  if (!obj) {
    const album = await getAlbum(env, key.split('/')[0]), v = album && variantOf(album, key);
    return v ? Response.redirect(v.url, 302) : null;
  }
  const h = new Headers(cors);
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'public, max-age=31536000, immutable');
  if (!('body' in obj)) return new Response(null, { status: 304, headers: h });
  h.set('content-length', String(range ? range.length : obj.size));
  if (range) h.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`);
  return new Response(req.method === 'HEAD' ? null : obj.body, { status: range ? 206 : 200, headers: h });
}
