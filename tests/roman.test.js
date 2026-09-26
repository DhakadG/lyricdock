// node tests/roman.test.js
const assert = require('assert');
const { translit, hasDeva, hasGuru } = require('../android/app/src/main/assets/roman.js');

const cases = {
  'ਸੋਹਣੀ': 'Sohni', 'ਤੇਰੀ': 'Teri', 'ਤੂੰ': 'Tu', 'ਮੈਨੂੰ': 'Mainu', 'ਪੱਕਾ': 'Pakka', 'ਮੰਗ': 'Mang',
  'ਦਿਲ': 'Dil', 'ਯਾਰ': 'Yaar', 'ਜ਼ਿੰਦਗੀ': 'Zindagi',
  'मैं': 'Main', 'दिल': 'Dil', 'प्यार': 'Pyaar', 'तेरा': 'Tera',
  'Hello ਦਿਲ': 'Hello dil',
};
for (const [src, want] of Object.entries(cases)) assert.strictEqual(translit(src), want, src);
assert(hasDeva('मैं') && !hasDeva('ਮੈਂ') && hasGuru('ਮੈਂ'));
console.log('roman ok');
