// blend.js: one version's words with another's word timing, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(
  fs.readFileSync(new URL('../android/app/src/main/assets/blend.js', import.meta.url), 'utf8') + ';this.Blend=Blend',
  ctx,
);
const { blend, of } = ctx.Blend;
const W = (s, t, e, p = false) => ({ s, t, e, p });
const donor = {
  kind: 'word',
  source: 'Kugou',
  lines: [
    { t: 1000, e: 2600, w: [W('hello', 1000, 1400), W('my', 1400, 1600), W('friend', 1600, 2600)] },
    {
      t: 3000,
      e: 4400,
      w: [W('good', 3000, 3300, true), W('by', 3300, 3500, true), W('e', 3500, 3700), W('now', 3700, 4400)],
    },
  ],
};

test("the base's words, the donor's times; unmatched words fill the gaps", () => {
  const base = {
    kind: 'line',
    source: 'LRCLIB',
    lines: [
      { t: 900, s: 'Hello, my dear friend!' },
      { t: 2900, s: 'Goodbye now' },
    ],
  };
  const b = blend(base, donor);
  assert.equal(b.source, 'Blend');
  assert.equal(b.kind, 'word');
  assert.deepEqual(
    b.lines[0].w.map(w => [w.s, w.t]),
    [
      ['Hello,', 1000],
      ['my', 1400],
      ['dear', 1600], // not in the donor: squeezed between "my" and "friend"
      ['friend!', 1600],
    ],
  );
  // "good"+"by"+"e" were one word split in syllables: they match "Goodbye"
  assert.deepEqual(
    b.lines[1].w.map(w => [w.s, w.t, w.e]),
    [
      ['Goodbye', 3000, 3700],
      ['now', 3700, 4400],
    ],
  );
});

test('Hindi in Devanagari takes the timing of the same words in Latin letters, spelled differently', () => {
  const c2 = vm.createContext({});
  for (const f of ['roman.js', 'blend.js'])
    vm.runInContext(fs.readFileSync(new URL(`../android/app/src/main/assets/${f}`, import.meta.url), 'utf8'), c2);
  vm.runInContext('this.B = Blend', c2);
  const base = { kind: 'line', source: 'LRCLIB', lines: [{ t: 0, s: 'केसरिया तेरा इश्क़ है, पिया' }] };
  const kugou = {
    kind: 'word',
    source: 'Kugou',
    lines: [
      {
        t: 900,
        e: 4000,
        w: [
          W('Kesariya', 900, 1700),
          W('tera', 1700, 2900),
          W('ishq', 2900, 3200),
          W('hai', 3200, 3500),
          W('piya', 3500, 4000),
        ],
      },
    ],
  };
  const b = c2.B.blend(base, kugou);
  assert.deepEqual(
    b.lines[0].w.map(w => [w.s, w.t]),
    [
      ['केसरिया', 900],
      ['तेरा', 1700],
      ['इश्क़', 2900],
      ['है,', 3200],
      ['पिया', 3500],
    ],
  );
});

test('another song (too few words in common) is no blend', () => {
  const other = { kind: 'line', source: 'LRCLIB', lines: [{ t: 0, s: 'something else entirely here' }] };
  assert.equal(blend(other, donor), null);
});

test('of(): only without real word sync, and never a donor as the base', () => {
  const rank = l => ({ 'Spotify:line': 3, 'Kugou:word': 2, 'Apple Music:word': 9 })[`${l.source}:${l.kind}`] ?? 0;
  const base = {
    kind: 'line',
    source: 'Spotify',
    lines: [
      { t: 900, s: 'hello my friend' },
      { t: 2900, s: 'goodbye now' },
    ],
  };
  assert.equal(of([base, donor], rank)?.via, 'Spotify words, Kugou timing');
  assert.equal(of([base, donor, { kind: 'word', source: 'Apple Music', lines: [] }], rank), null);
  assert.equal(of([donor], rank), null);
});
