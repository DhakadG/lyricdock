// shazam.js: the fingerprint's container, offline (that Shazam recognises it was checked against the real service).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ctx = vm.createContext({ btoa });
vm.runInContext(
  fs.readFileSync(new URL('../android/app/src/main/assets/shazam.js', import.meta.url), 'utf8') + ';this.Sig=Sig',
  ctx,
);

test('a fingerprint of 6 s of tones: header, CRC, lengths, peaks', () => {
  const pcm = new Int16Array(16000 * 6);
  for (let i = 0; i < pcm.length; i++)
    pcm[i] =
      8000 * Math.sin((2 * Math.PI * 440 * i) / 16000) + 6000 * Math.sin((2 * Math.PI * (900 + (i >> 11)) * i) / 16000);
  const { uri, samplems } = ctx.Sig.make(pcm);
  assert.equal(samplems, 6000);
  assert.ok(uri.startsWith('data:audio/vnd.shazam.sig;base64,'));
  const b = Buffer.from(uri.split(',')[1], 'base64');
  assert.equal(b.readUInt32LE(0), 0xcafe2580);
  assert.equal(b.readUInt32LE(4), zlib.crc32(b.subarray(8)));
  assert.equal(b.readUInt32LE(8), b.length - 48);
  assert.equal(b.readUInt32LE(52), b.length - 48);
  assert.equal(b.readUInt32LE(28), 3 << 27); // 16 kHz
  assert.equal(b.readUInt32LE(40), pcm.length + 3840);
  assert.ok(b.length > 48 + 8 + 16, 'some peaks were found');
  assert.equal(b.readInt32LE(56) & 0xfffffff0, 0x60030040); // the first band's tag
});
