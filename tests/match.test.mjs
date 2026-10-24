// phone.js Match.score: the cautious name -> Spotify track match, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({
  window: {},
  Api: {},
  Lrclib: {},
  Lyrics: {},
  setTimeout,
  clearTimeout,
  URLSearchParams,
});
vm.runInContext(
  fs.readFileSync(new URL('../android/app/src/main/assets/phone.js', import.meta.url), 'utf8') + ';this.Match=Match',
  ctx,
);
const { score } = ctx.Match;
const want = { title: 'Stronger', artist: 'Kanye West', dur: 311867 };

test('the same recording matches', () => {
  assert.ok(score(want, { title: 'Stronger', artist: 'Kanye West', dur: 311000 }) >= 0.9);
  assert.ok(
    score(
      { title: 'Kesariya', artist: 'Arijit Singh, Pritam' },
      { title: 'Kesariya (From "Brahmastra")', artist: 'Pritam, Arijit Singh' },
    ) >= 0.7,
  );
});

test('another version, artist or length never does', () => {
  assert.equal(score(want, { title: 'Stronger - Live', artist: 'Kanye West', dur: 311000 }), 0);
  assert.equal(score(want, { title: 'Stronger (A-Trak Remix)', artist: 'Kanye West', dur: 311000 }), 0);
  assert.equal(score(want, { title: 'Stronger', artist: 'Britney Spears', dur: 311000 }), 0);
  assert.equal(score(want, { title: 'Stronger', artist: 'Kanye West', dur: 330000 }), 0);
  // ...but a remix the player names finds that remix
  assert.ok(
    score(
      { ...want, title: 'Stronger (A-Trak Remix)' },
      { title: 'Stronger - A-Trak Remix', artist: 'Kanye West', dur: 311000 },
    ) > 0,
  );
});
