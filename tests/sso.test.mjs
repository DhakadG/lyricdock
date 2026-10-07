// node tests/sso.test.mjs - login -> callback -> session round trip with Google mocked, plus the attacks it must refuse.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../auth/src/index.js';
import { verify, session, isAllowed, COOKIE } from '../auth/sso.js';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', ALLOWED_EMAILS: '', SSO_PRIVATE_JWK: readFileSync(process.env.SSO_KEY_FILE, 'utf8') };
const get = (path, cookie = '') => worker.fetch(new Request(`https://auth.lyricdock.losthusky.qzz.io${path}`, { headers: { cookie } }), env);
const setCookies = r => r.headers.getSetCookie();

let googleNonce, googleSays = {};
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(init.body);
  assert.ok(body.get('code_verifier'));
  const p = { iss: 'https://accounts.google.com', aud: 'cid', exp: Date.now() / 1000 + 600, nonce: googleNonce, email: 'Me@Gmail.com', email_verified: true, sub: '42', name: 'Me', ...googleSays };
  return new Response(JSON.stringify({ id_token: `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.y` }));
};

async function signInFlow(rd) {
  const r = await get(`/login?rd=${encodeURIComponent(rd)}`);
  assert.equal(r.status, 303);
  const g = new URL(r.headers.get('location'));
  assert.equal(g.host, 'accounts.google.com');
  assert.equal(g.searchParams.get('code_challenge_method'), 'S256');
  googleNonce = g.searchParams.get('nonce');
  const st = setCookies(r)[0].split(';')[0];
  return { state: g.searchParams.get('state'), st };
}

// happy path: back to the page asked for, cookie on LyricDock's domain (not the apex), verifiable with the public key only
let { state, st } = await signInFlow('https://app.lyricdock.losthusky.qzz.io/x?y=1');
let r = await get(`/callback?state=${state}&code=c`, st);
assert.equal(r.status, 303);
assert.equal(r.headers.get('location'), 'https://app.lyricdock.losthusky.qzz.io/x?y=1');
const sc = setCookies(r).find(c => c.startsWith(COOKIE));
assert.match(sc, /Domain=lyricdock\.losthusky\.qzz\.io; .*HttpOnly; Secure; SameSite=Lax/);
const jwt = sc.split(';')[0].split('=')[1];
const me = await session(new Request('https://x', { headers: { cookie: `${COOKIE}=${jwt}` } }));
assert.equal(me.email, 'me@gmail.com');
assert.ok(isAllowed(me, 'ME@gmail.com, b@c.d') && !isAllowed(me, '') && !isAllowed(null, 'me@gmail.com'));

// open redirect: foreign / look-alike / http targets, and the other losthusky.qzz.io sites (not LyricDock's), fall back
// to the auth home page
for (const bad of ['https://evil.com', 'https://losthusky.qzz.io.evil.com/', 'http://app.lyricdock.losthusky.qzz.io/', 'https://a@evil.com', 'javascript:alert(1)', '//evil.com',
  'https://losthusky.qzz.io/', 'https://ntfy.losthusky.qzz.io/', 'https://xlyricdock.losthusky.qzz.io/'])
  assert.equal(new URL((await get(`/login?rd=${encodeURIComponent(bad)}`, `${COOKIE}=${jwt}`)).headers.get('location')).href, 'https://auth.lyricdock.losthusky.qzz.io/', bad);

// login CSRF: a state from another browser (no / wrong state cookie) is refused
({ state, st } = await signInFlow('https://auth.lyricdock.losthusky.qzz.io/'));
assert.equal((await get(`/callback?state=${state}&code=c`)).status, 400);
assert.equal((await get(`/callback?state=WRONG&code=c`, st)).status, 400);
// Google answers that must be refused: wrong audience, replayed nonce, unverified email
for (const bad of [{ aud: 'other' }, { nonce: 'replay' }, { email_verified: false }, { iss: 'https://evil.com' }]) {
  ({ state, st } = await signInFlow('https://auth.lyricdock.losthusky.qzz.io/'));
  googleSays = bad;
  assert.equal((await get(`/callback?state=${state}&code=c`, st)).status, 400, JSON.stringify(bad));
}
googleSays = {};
// allowlist
env.ALLOWED_EMAILS = 'someone@else.com';
({ state, st } = await signInFlow('https://auth.lyricdock.losthusky.qzz.io/'));
assert.equal((await get(`/callback?state=${state}&code=c`, st)).status, 400);

// forged tokens: tampered payload, alg none, the state token used as a session
const [h, p, s] = jwt.split('.');
const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'admin@x.com' })).toString('base64url');
assert.equal(await verify(`${h}.${evil}.${s}`), null);
assert.equal(await verify(`${Buffer.from('{"alg":"none","typ":"JWT","kid":"mupbl6zw"}').toString('base64url')}.${p}.`), null);
assert.equal(await verify(st.split('=')[1]), null);
console.log('sso ok');
