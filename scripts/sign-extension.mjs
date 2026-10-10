// Sign the Spicetify extension build for a release: the loader (extension/lyricdock.js), the only part that downloads
// builds, only runs a dock-bridge.js whose signature checks out against the public key built into it, so whoever can push to
// the repo or the CDN still can't ship code into people's Spotify without this key.
//   node scripts/sign-extension.mjs           signs HEAD:extension/dock-bridge.js -> extension/dock-bridge.js.sig (release.ps1)
//   node scripts/sign-extension.mjs --new-key creates secrets/EXTENSION_SIGNING_JWK.json once (back it up!) and prints the public key
// The bytes signed are the committed blob (what jsDelivr serves for the tag), not the working tree (line endings may differ).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const root = new URL('..', import.meta.url), KEY = new URL('secrets/EXTENSION_SIGNING_JWK.json', root);
const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };

if (process.argv.includes('--new-key')) {
  if (existsSync(KEY)) throw new Error('secrets/EXTENSION_SIGNING_JWK.json exists already - refusing to replace it');
  const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  writeFileSync(KEY, JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)));
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', kp.publicKey);
  console.log('Public key for extension/lyricdock.js:', JSON.stringify({ kty, crv, x, y }));
} else {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(readFileSync(KEY, 'utf8')), ALG, false, ['sign']);
  const code = execFileSync('git', ['show', 'HEAD:extension/dock-bridge.js'], { cwd: root, maxBuffer: 1 << 26 });
  const sig = Buffer.from(await crypto.subtle.sign(SIG, key, code)).toString('base64url');
  writeFileSync(new URL('extension/dock-bridge.js.sig', root), sig);
  console.log(`Signed dock-bridge.js (${code.length} bytes) -> extension/dock-bridge.js.sig`);
}
