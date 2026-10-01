// node tests/cloud.test.mjs
import assert from 'node:assert';
import { norm, parseVariants, parsePage, matchScore } from '../cloud/src/apple.js';

const ms = (a, b, ra, rb) => matchScore(norm(a), norm(b), norm(ra), norm(rb));
assert.strictEqual(ms('Gorillaz', 'Plastic Beach', 'Gorillaz', 'Plastic Beach (Deluxe Version)'), 3); // edition suffix dropped by norm
assert.strictEqual(ms('Gorillaz', 'Plastic', 'Gorillaz', 'Plastic Beach'), 2);
assert.strictEqual(ms('Various Artists', 'The Twilight Saga: New Moon (OST)', 'Various Artists', 'Twilight (OST)'), 0); // too short a part
assert.strictEqual(ms('Bon Iver', 'The Twilight Saga: New Moon (OST) [Deluxe]', 'Various Artists', 'The Twilight Saga: New Moon (OST)'), 3);
assert.strictEqual(ms('Bon Iver', 'New Moon', 'Various Artists', 'New Moon Hits'), 0); // compilation needs the exact name
assert.strictEqual(ms('Taylor Swift', 'Midnights', 'Gorillaz', 'Midnights'), 0);
assert.strictEqual(ms('Ye', 'Donda', 'Kanye West', 'Donda'), 0); // whole words: "ye" is not in "kanye"
assert.strictEqual(norm('दिल से'), 'दिल से'); // matras survive
assert.strictEqual(norm('(Untitled)'), 'untitled'); // never "" (which would match everything)
assert.strictEqual(norm('Simon & Garfunkel'), 'simon and garfunkel');
assert.strictEqual(parseVariants('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.6",RESOLUTION=10x10\nhttps://a.apple.com@evil.com/x_video_a.m3u8', 'https://mvod.itunes.apple.com/p.m3u8').length, 0); // off-host
import { choose } from '../cloud/src/store.js';

assert.strictEqual(norm('Midnights (3am Edition)'), 'midnights');
assert.strictEqual(norm('Midnights - Deluxe'), 'midnights');
assert.strictEqual(norm('Beyoncé [Platinum]'), 'beyonce');

const base = 'https://mvod.itunes.apple.com/a/b/P1_default.m3u8';
const vs = parseVariants(`#EXTM3U
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=9,CODECS="avc1.640020",RESOLUTION=1080x1080,URI="x_iframes.m3u8"
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1,BANDWIDTH=1022967,CODECS="avc1.64001f",RESOLUTION=486x486
P1_Anull_video_gr210_sdr_486x486.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2040046,CODECS="avc1.64001f",RESOLUTION=486x486
P1_Anull_video_gr230_sdr_486x486.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=963358,CODECS="hvc1.2.20000000.L123.B0",RESOLUTION=486x486
P1_Anull_video_gr610_sdr_486x486.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=11987575,CODECS="avc1.640020",RESOLUTION=1080x1080
P1_Anull_video_gr290_sdr_1080x1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9868951,CODECS="hvc1.2.20000000.L153.B0",RESOLUTION=2160x2160
https://mvod.itunes.apple.com/a/b/P1_Anull_video_gr693_sdr_2160x2160.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=27523994,CODECS="hvc1.2.20000000.L153.B0",RESOLUTION=2160x2160
P1_Anull_video_gr698_sdr_2160x2160.m3u8`, base);
assert.strictEqual(vs.length, 6);
assert.deepStrictEqual(vs[0], { n: 'gr210_sdr_486x486', codec: 'avc1', w: 486, h: 486, bw: 1022967, url: 'https://mvod.itunes.apple.com/a/b/P1_Anull_video_gr210_sdr_486x486-.mp4' });

// phone, cover 506 device px, no HEVC -> smallest H.264 that covers it, lowest bitrate
assert.strictEqual(choose(vs, { px: 480 }).n, 'gr210_sdr_486x486');
assert.strictEqual(choose(vs, { px: 480, hevc: true }).n, 'gr610_sdr_486x486');
assert.strictEqual(choose(vs, { px: 506 }).n, 'gr210_sdr_486x486'); // within 10%
assert.strictEqual(choose(vs, { px: 560 }).n, 'gr290_sdr_1080x1080');
// 4K desktop
assert.strictEqual(choose(vs, { px: 2160, hevc: true }).n, 'gr693_sdr_2160x2160');
assert.strictEqual(choose(vs, { px: 2160, hevc: true, q: 'max' }).n, 'gr698_sdr_2160x2160');
assert.strictEqual(choose(vs, { px: 2160 }).n, 'gr290_sdr_1080x1080'); // no HEVC: best H.264
assert.strictEqual(choose([], { px: 1 }), null);

const page = parsePage({ data: [{ data: { sections: [
  { items: [{ title: 'Plastic Beach', subtitleLinks: [{ title: 'Gorillaz' }], quaternaryTitle: 'Pop · 2010', trackCount: 1,
    artwork: { dictionary: { url: 'https://x/{w}x{h}bb.{f}', width: 3840, height: 3840, bgColor: '000000' } },
    videoArtwork: { dictionary: { motionDetailSquare: { video: 'https://mvod.itunes.apple.com/sq.m3u8' } } },
    modalPresentationDescriptor: { paragraphText: 'notes' }, audioBadges: { lossless: true } }] },
  { items: [{ title: 'Orchestral Intro', trackNumber: 1, discNumber: 1, duration: 69387, composer: 'Damon Albarn', contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '859844930' } } }] },
  { items: [{ numberOfSocialBadges: 10, description: 'March 3, 2010\n19 songs, 1 hour 8 minutes\n℗ 2010 Parlophone' }] },
] } }] });
assert.strictEqual(page.square_m3u8, 'https://mvod.itunes.apple.com/sq.m3u8');
assert.strictEqual(page.art_w, 3840);
assert.strictEqual(page.notes, 'notes');
assert.strictEqual(page.tall_m3u8, null);
assert.deepStrictEqual([page.name, page.artist, page.genre, page.release_date, page.copyright], ['Plastic Beach', 'Gorillaz', 'Pop', '2010-03-03', '℗ 2010 Parlophone']);
assert.deepStrictEqual([page.tracks.length, page.tracks[0].id, page.tracks[0].composer], [1, '859844930', 'Damon Albarn']);
assert.strictEqual(parsePage({ x: [{ numberOfSocialBadges: 1, description: '3 March 2010' }] }).release_date, '2010-03-03');
console.log('cloud ok');
