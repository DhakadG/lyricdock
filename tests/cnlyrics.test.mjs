// web/src/cnlyrics.js: the parsers and the matcher, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { yrc, krc, lrc, score } from '../web/src/cnlyrics.js';

const want = { title: 'Blinding Lights', artist: 'The Weeknd', dur: 200040 };

test('yrc: absolute word times, header JSON and credits dropped', () => {
  const l = yrc(
    [
      '{"t":0,"c":[{"tx":"作词: "}]}',
      '[0,900](0,900,0)作词 : Max Martin',
      '[1000,500](1000,200,0)Yeah ',
      "[2000,800](2000,300,0)I've (2300,500,0)been",
      '[3000,600](3000,300,0)你(3300,300,0)好',
      '[4000,600](4000,600,0)end',
    ].join('\n'),
    want,
  );
  assert.equal(l.kind, 'word');
  assert.equal(l.lines.length, 4);
  assert.deepEqual(
    l.lines[1].w.map(w => [w.s, w.t, w.e, w.p]),
    [
      ["I've", 2000, 2300, false],
      ['been', 2300, 2800, false],
    ],
  );
  assert.equal(l.lines[2].w[0].p, true); // CJK: joined to the next syllable
});

test('krc: offsets from the line start, "Artist - Title" header dropped', () => {
  const l = krc(
    '[0,90]<0,22,0>The Weeknd - <23,22,0>Blinding Lights\n[1000,500]<0,200,0>a <200,300,0>b\n[2000,500]<0,500,0>c\n[3000,500]<0,500,0>d',
    want,
  );
  assert.equal(l.lines.length, 3);
  assert.deepEqual(
    l.lines[0].w.map(w => [w.t, w.e]),
    [
      [1000, 1200],
      [1200, 1500],
    ],
  );
});

test('lrc: repeated tags, ends from the next line, blank lines end a line', () => {
  const l = lrc('[00:01.00]a\n[00:02.00][00:05.00]b\n[00:03.00]\n[00:04.00]c', want);
  assert.deepEqual(
    l.lines.map(x => [x.t, x.e, x.s]),
    [
      [1000, 2000, 'a'],
      [2000, 3000, 'b'],
      [4000, 5000, 'c'],
      [5000, 10000, 'b'],
    ],
  );
});

test('score: same name needs the artist and a length within 3 s', () => {
  assert.ok(score(want, { title: 'Blinding Lights', artist: 'The Weeknd', dur: 201000 }) > 0);
  assert.equal(score(want, { title: 'Blinding Lights', artist: 'Someone Else', dur: 200000 }), -1);
  assert.equal(score(want, { title: 'Blinding Lights', artist: 'The Weeknd', dur: 260000 }), -1);
  assert.ok(
    score(
      { title: 'Kesariya', artist: 'Arijit Singh, Pritam' },
      { title: 'Kesariya', artist: 'Pritam、Arijit Singh' },
    ) >= 0,
  );
});
