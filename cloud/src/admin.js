// admin.lyricdock.losthusky.qzz.io: dashboard + its JSON API. Locked unless the ADMIN_PASSWORD secret is set.
// Metrics come from Analytics Engine (needs the CF_API_TOKEN secret), the index and cache from KV + R2.
// Login sets a signed, HttpOnly cookie valid 7 days.

import { config, setConfig, getAlbum, promote, demote, setPin, maintain, aeQuery, listAll, DEFAULTS } from './store.js';
import { fetchAlbum } from './apple.js';
import DASH from './admin.html';

const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enc = new TextEncoder();

async function sign(env, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(`ld-session:${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))))).replace(/=+$/, '');
}
// Scripts / tests: "Authorization: Bearer <ADMIN_API_TOKEN>" when that optional secret is set.
const bearer = async (req, env) => !!env.ADMIN_API_TOKEN && await sameSecret((req.headers.get('authorization') || '').replace(/^Bearer /, ''), env.ADMIN_API_TOKEN);
async function authed(req, env) {
  if (await bearer(req, env)) return true;
  const c = /(?:^|;\s*)ld_s=(\d+)\.([\w+/]+)/.exec(req.headers.get('cookie') || '');
  return !!c && +c[1] > Date.now() && (await sign(env, c[1])) === c[2];
}
async function sameSecret(a, b) { // compare digests: constant time regardless of input length
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

const LOGIN = msg => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>LyricDock admin</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d10;color:#eee;font:15px system-ui}form{display:grid;gap:12px;width:min(320px,90vw)}
input,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #333;background:#18181c;color:#eee}button{background:#1ed760;color:#000;border:0;font-weight:600}p{color:#f77;margin:0}</style>
<form method=post action=/login><h2>LyricDock admin</h2>${msg ? `<p>${msg}</p>` : ''}<input type=password name=password placeholder=Password autofocus required><button>Sign in</button></form>`;

export async function admin(req, env, ctx, url) {
  if (!env.ADMIN_PASSWORD) return html(LOGIN('Locked: set the ADMIN_PASSWORD secret first (see docs/lyricdock-cloud.md).'), 503);
  const p = url.pathname;
  if (p === '/login' && req.method === 'POST') {
    const pw = String((await req.formData()).get('password') || '');
    if (!(await sameSecret(pw, env.ADMIN_PASSWORD))) return html(LOGIN('Wrong password.'), 401);
    const exp = String(Date.now() + 7 * 864e5);
    return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `ld_s=${exp}.${await sign(env, exp)}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict` } });
  }
  if (p === '/logout') return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': 'ld_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' } });
  if (!(await authed(req, env))) return p.startsWith('/api/') ? json({ error: 'login required' }, 401) : html(LOGIN(''));
  if (p === '/') return html(DASH);
  if (!p.startsWith('/api/')) return json({ error: 'not found' }, 404);
  if (req.method === 'POST' && req.headers.get('origin') !== url.origin && !(await bearer(req, env))) return json({ error: 'bad origin' }, 403); // CSRF
  try { return await api(req, env, url, p.slice(5)); }
  catch (e) { return json({ error: String(e?.message || e) }, 500); }
}

const T = 'lyricdock_events';
const n = r => +r || 0;
// AE timestamps come back as "YYYY-MM-DD hh:mm:ss" (UTC)
const ms = s => Date.parse(String(s).replace(' ', 'T') + 'Z');

async function api(req, env, url, p) {
  const q = url.searchParams, body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const hours = Math.min(24 * 90, Math.max(1, +q.get('h') || 24)), W = `timestamp > NOW() - INTERVAL '${hours}' HOUR`;
  const S = 'SUM(_sample_interval)';

  if (p === 'overview') {
    const bucket = hours <= 24 ? 1 : hours <= 168 ? 6 : 24; // hours per chart bar
    const [totals, kinds, tiers, series, countries, points, topAlbums, errors, active, platforms, cfg, m, a, l] = await Promise.all([
      aeQuery(env, `SELECT ${S} AS n, SUM(double2 * _sample_interval) / ${S} AS ms, SUM(double3 * _sample_interval) AS bytes, COUNT(DISTINCT index1) AS devices, SUM(IF(double1 >= 500, _sample_interval, 0)) AS errors FROM ${T} WHERE ${W}`),
      aeQuery(env, `SELECT blob1 AS kind, ${S} AS n FROM ${T} WHERE ${W} GROUP BY kind`),
      aeQuery(env, `SELECT blob3 AS tier, ${S} AS n FROM ${T} WHERE ${W} AND blob1 IN ('cover', 'media') GROUP BY tier ORDER BY n DESC`),
      aeQuery(env, `SELECT toStartOfInterval(timestamp, INTERVAL '${bucket}' HOUR) AS t, blob1 AS kind, ${S} AS n, SUM(double2 * _sample_interval) / ${S} AS ms FROM ${T} WHERE ${W} GROUP BY t, kind ORDER BY t`),
      aeQuery(env, `SELECT blob6 AS country, ${S} AS n, COUNT(DISTINCT index1) AS devices FROM ${T} WHERE ${W} AND blob6 != '' GROUP BY country ORDER BY n DESC LIMIT 30`),
      aeQuery(env, `SELECT blob7 AS city, blob6 AS country, round(double4, 1) AS lat, round(double5, 1) AS lon, ${S} AS n, COUNT(DISTINCT index1) AS devices FROM ${T} WHERE ${W} AND double4 != 0 GROUP BY city, country, lat, lon ORDER BY n DESC LIMIT 500`),
      aeQuery(env, `SELECT blob4 AS id, blob12 AS name, blob13 AS artist, ${S} AS n FROM ${T} WHERE ${W} AND blob1 = 'cover' AND blob4 != '' GROUP BY id, name, artist ORDER BY n DESC LIMIT 15`),
      aeQuery(env, `SELECT timestamp AS ts, blob2 AS path, double1 AS status, blob11 AS detail FROM ${T} WHERE ${W} AND double1 >= 500 ORDER BY ts DESC LIMIT 20`),
      aeQuery(env, `SELECT COUNT(DISTINCT index1) AS active FROM ${T} WHERE timestamp > NOW() - INTERVAL '15' MINUTE AND index1 != ''`),
      aeQuery(env, `SELECT blob14 AS plat, COUNT(DISTINCT index1) AS devices, ${S} AS n FROM ${T} WHERE ${W} AND blob14 != '' GROUP BY plat ORDER BY devices DESC`),
      config(env, true), listAll(env, 'm:'), listAll(env, 'a:'), listAll(env, 'l:'),
    ]);
    const r2 = m.filter(k => k.metadata?.tier === 'r2'), t = totals[0] || {};
    return json({
      bucket: bucket * 36e5, config: cfg,
      totals: { n: n(t.n), ms: n(t.ms), bytes: n(t.bytes), devices: n(t.devices), errors: n(t.errors) },
      kinds, tiers, countries, points, topAlbums, platforms,
      series: series.map(r => ({ t: ms(r.t), kind: r.kind, n: n(r.n), ms: n(r.ms) })),
      errors: errors.map(e => ({ ...e, ts: ms(e.ts) })),
      devs: { active: n(active[0]?.active), total: n(t.devices) },
      r2: { files: r2.length, bytes: r2.reduce((s, k) => s + n(k.metadata?.bytes), 0), pinned: m.filter(k => k.metadata?.pin).length },
      idx: { albums: a.length, motion: a.filter(k => k.metadata?.m).length, tracks: a.reduce((s, k) => s + n(k.metadata?.t), 0), lookups: l.length, negative: l.filter(k => !k.metadata?.a).length },
    });
  }

  if (p === 'events') {
    const rows = await aeQuery(env, `SELECT timestamp AS ts, index1 AS device, blob1 AS kind, blob2 AS path, blob3 AS tier, blob4 AS album_id, blob5 AS media_key, blob6 AS country, blob7 AS city, blob8 AS colo,
      blob9 AS version, blob11 AS detail, blob12 AS album, blob13 AS artist, double1 AS status, double2 AS ms, double3 AS bytes FROM ${T} WHERE ${W} ORDER BY ts DESC LIMIT ${Math.min(500, +q.get('limit') || 200)}`);
    return json(rows.map(r => ({ ...r, ts: ms(r.ts) })));
  }

  if (p === 'devices') {
    const [rows, cfg] = await Promise.all([aeQuery(env, `SELECT index1 AS id, MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen, ${S} AS calls, argMax(blob9, timestamp) AS version, argMax(blob10, timestamp) AS model,
      argMax(blob7, timestamp) AS city, argMax(blob6, timestamp) AS country, MAX(double7) AS hevc, MAX(double6) AS px,
      argMax(blob14, timestamp) AS plat, argMax(blob15, timestamp) AS screen, argMax(blob16, timestamp) AS tz, argMax(blob17, timestamp) AS lang FROM ${T} WHERE timestamp > NOW() - INTERVAL '90' DAY AND index1 != '' GROUP BY id ORDER BY last_seen DESC LIMIT 500`), config(env, true)]);
    return json(rows.map(r => ({ ...r, first_seen: ms(r.first_seen), last_seen: ms(r.last_seen), hevc: r.hevc < 0 ? null : r.hevc, blocked: cfg.blocked.includes(r.id) })));
  }
  if (p === 'device' && req.method === 'POST') {
    const cfg = await config(env, true), id = String(body.id || '');
    await setConfig(env, { blocked: body.blocked ? [...cfg.blocked, id] : cfg.blocked.filter(x => x !== id) });
    return json({ ok: true });
  }

  if (p === 'albums') {
    const [keys, plays] = await Promise.all([listAll(env, 'a:'), aeQuery(env, `SELECT blob4 AS id, ${S} AS n, MAX(timestamp) AS last FROM ${T} WHERE timestamp > NOW() - INTERVAL '90' DAY AND blob1 = 'cover' AND blob4 != '' GROUP BY id`)]);
    const pm = new Map(plays.map(r => [r.id, r]));
    return json(keys.map(k => ({ id: k.name.slice(2), name: k.metadata?.n, artist: k.metadata?.ar, genre: k.metadata?.g, release_date: k.metadata?.y, has_motion: k.metadata?.m, fetched_at: k.metadata?.f,
      art_url: k.metadata?.art, track_count: k.metadata?.t, hits: n(pm.get(k.name.slice(2))?.n), last_hit: pm.has(k.name.slice(2)) ? ms(pm.get(k.name.slice(2)).last) : null })));
  }
  const am = p.match(/^album\/(\d+)(?:\/(refresh|delete))?$/);
  if (am) {
    const id = am[1], a = await getAlbum(env, id);
    if (!a) return json({ error: 'not found' }, 404);
    if (am[2] === 'refresh' && req.method === 'POST') {
      const { album, tracks } = await fetchAlbum(id, a.url);
      const rec = { ...album, tracks, fetched_at: Date.now() };
      await env.KV.put(`a:${id}`, JSON.stringify(rec), { metadata: { n: rec.name, ar: rec.artist, m: rec.has_motion, f: rec.fetched_at, g: rec.genre, y: rec.release_date, t: tracks.length, art: rec.cover_url || rec.art_url } });
      return json({ ok: true, has_motion: rec.has_motion });
    }
    if (am[2] === 'delete' && req.method === 'POST') {
      const media = (await listAll(env, `m:${id}/`)).map(k => k.name.slice(2));
      await demote(env, media);
      const looks = (await listAll(env, 'l:')).filter(k => k.metadata?.a === id).map(k => k.name);
      await Promise.all([...looks, `a:${id}`].map(k => env.KV.delete(k)));
      return json({ ok: true });
    }
    const [media, plays, looks] = await Promise.all([listAll(env, `m:${id}/`),
      aeQuery(env, `SELECT blob5 AS key, ${S} AS n, MAX(timestamp) AS last FROM ${T} WHERE timestamp > NOW() - INTERVAL '90' DAY AND blob4 = '${id}' AND blob5 != '' GROUP BY key`),
      listAll(env, 'l:')]);
    return json({ album: a, tracks: a.tracks || [],
      media: plays.map(r => ({ key: r.key, hits: n(r.n), last_hit: ms(r.last), ...(media.find(k => k.name === `m:${r.key}`)?.metadata || { tier: 'apple' }) }))
        .concat(media.filter(k => !plays.some(r => `m:${r.key}` === k.name)).map(k => ({ key: k.name.slice(2), hits: 0, ...k.metadata }))),
      lookups: looks.filter(k => k.metadata?.a === id).map(k => ({ key: k.name.slice(2), at: k.metadata?.at })) });
  }

  if (p === 'media') { // every file asked for in the last 90 days + everything in R2, with its rung
    const [keys, plays, cfg] = await Promise.all([listAll(env, 'm:'), aeQuery(env, `SELECT blob5 AS key, argMax(blob12, timestamp) AS album, argMax(blob13, timestamp) AS artist, ${S} AS n, MIN(timestamp) AS first, MAX(timestamp) AS last,
      SUM(IF(timestamp > NOW() - INTERVAL '${(await config(env)).promote_days}' DAY, _sample_interval, 0)) AS recent FROM ${T} WHERE timestamp > NOW() - INTERVAL '90' DAY AND blob5 != '' AND blob1 = 'cover' GROUP BY key ORDER BY last DESC LIMIT 1000`), config(env)]);
    const meta = new Map(keys.map(k => [k.name.slice(2), k.metadata || {}]));
    const rows = plays.map(r => ({ key: r.key, album: r.album, artist: r.artist, hits: n(r.n), recent: n(r.recent), first_hit: ms(r.first), last_hit: ms(r.last), ...(meta.get(r.key) || { tier: 'apple' }) }));
    for (const [k, m] of meta) if (!rows.some(r => r.key === k)) rows.push({ key: k, hits: 0, recent: 0, ...m });
    const tier = q.get('tier');
    return json({ rows: tier ? rows.filter(r => r.tier === tier) : rows, promote_hits: cfg.promote_hits });
  }
  if (p === 'media/action' && req.method === 'POST') {
    const key = String(body.key || '');
    if (!/^\d+\/(square|tall)\/[a-z0-9_]+$/.test(key)) return json({ error: 'bad key' }, 400);
    if (body.action === 'pin' || body.action === 'unpin') await setPin(env, key, body.action === 'pin');
    if (body.action === 'promote') await promote(env, key);
    if (body.action === 'evict') await demote(env, [key]);
    return json({ ok: true });
  }

  if (p === 'lookups') {
    const keys = await listAll(env, 'l:'), s = (q.get('q') || '').toLowerCase();
    return json(keys.filter(k => k.name.includes(s) && (q.get('negative') !== '1' || !k.metadata?.a)).slice(0, 500)
      .map(k => ({ key: k.name.slice(2), album_id: k.metadata?.a, name: k.metadata?.n, at: k.metadata?.at })));
  }
  if (p === 'r2') { // ground truth straight from the bucket
    const l = await env.R2.list({ prefix: 'm/', limit: 1000, cursor: q.get('cursor') || undefined });
    return json({ objects: l.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })), cursor: l.truncated ? l.cursor : null });
  }

  if (p === 'config') return json(req.method === 'POST' ? await setConfig(env, body) : { values: await config(env, true), defaults: DEFAULTS });
  if (p === 'maintenance' && req.method === 'POST') {
    if (body.action === 'run') return json(await maintain(env, await config(env, true)));
    if (body.action === 'purge-negative') {
      const neg = (await listAll(env, 'l:')).filter(k => !k.metadata?.a).map(k => k.name);
      await Promise.all(neg.map(k => env.KV.delete(k)));
      return json({ removed: neg.length });
    }
    return json({ error: 'unknown action' }, 400);
  }
  return json({ error: 'not found' }, 404);
}
