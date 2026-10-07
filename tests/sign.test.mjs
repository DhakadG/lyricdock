// node tests/sign.test.mjs - the extension signing key: the public key built into the loader and the bridge is the
// same, matches secrets/EXTENSION_SIGNING_JWK.json, and a signature made like sign-extension.mjs verifies the way they do.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const keyIn = f => { const m = /\{ kty: 'EC', crv: 'P-256', x: '([\w-]+)', y: '([\w-]+)' \}/.exec(read(f)); return { kty: 'EC', crv: 'P-256', x: m[1], y: m[2] }; };
const pub = keyIn('extension/lyricdock.js');
assert.deepEqual(keyIn('extension/dock-bridge.js'), pub);

const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
const verify = async (buf, sig) => crypto.subtle.verify(SIG, await crypto.subtle.importKey('jwk', pub, ALG, false, ['verify']),
  Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)), buf);
const secret = new URL('../secrets/EXTENSION_SIGNING_JWK.json', import.meta.url);
if (existsSync(secret)) {
  const priv = JSON.parse(readFileSync(secret, 'utf8'));
  assert.equal(priv.x, pub.x); assert.equal(priv.y, pub.y);
  const k = await crypto.subtle.importKey('jwk', priv, ALG, false, ['sign']), code = new TextEncoder().encode('(function dockBridge() {})();\n');
  const sig = Buffer.from(await crypto.subtle.sign(SIG, k, code)).toString('base64url');
  assert.ok(await verify(code, sig));
  assert.ok(!(await verify(new TextEncoder().encode('(function dockBridge() { evil() })();\n'), sig))); // tampered code
} else console.log('(no secrets/EXTENSION_SIGNING_JWK.json here: key match not checked)');
console.log('sign ok');
