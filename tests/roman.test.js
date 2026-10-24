// node tests/roman.test.js
const assert = require('assert');
const { translit, hasDeva, hasGuru } = require('../android/app/src/main/assets/roman.js');

const cases = {
  ਸੋਹਣੀ: 'Sohni',
  ਤੇਰੀ: 'Teri',
  ਤੂੰ: 'Tu',
  ਮੈਨੂੰ: 'Mainu',
  ਪੱਕਾ: 'Pakka',
  ਮੰਗ: 'Mang',
  ਦਿਲ: 'Dil',
  ਯਾਰ: 'Yaar',
  ਜ਼ਿੰਦਗੀ: 'Zindagi',
  मैं: 'Main',
  दिल: 'Dil',
  प्यार: 'Pyaar',
  तेरा: 'Tera',
  'Hello ਦਿਲ': 'Hello dil',
  // Urdu / Shahmukhi
  دل: 'Dil',
  'تیرا پیار': 'Tera pyaar',
  'میں تینوں': 'Main tainu',
  'عشق دا': 'Ishq da',
  بھلا: 'Bhala',
};
for (const [src, want] of Object.entries(cases)) assert.strictEqual(translit(src), want, src);
assert(hasDeva('मैं') && !hasDeva('ਮੈਂ') && hasGuru('ਮੈਂ'));

// one Indic script into another: Punjabi read in Hindi script and back, other scripts, Latin left alone
const { toScript } = require('../android/app/src/main/assets/roman.js');
const scripts = [
  ['ਸੋਹਣੀ ਤੇਰੀ ਅੱਖ', 'deva', 'सोहणी तेरी अक्ख'], // addak doubles the next consonant
  ['ਤੂੰ ਮੈਨੂੰ ਪਿਆਰ ਕਰਦੀ', 'deva', 'तूं मैनूं पिआर करदी'], // tippi -> anusvara
  ['ਇੱਕ ਉਹ ਏਥੇ', 'deva', 'इक्क उह एथे'],
  ['ਪੱ', 'deva', 'प'], // an addak ending a syllable: dropped, its consonant comes next
  ['तेरा प्यार', 'guru', 'ਤੇਰਾ ਪ੍ਯਾਰ'],
  ['कृष्ण', 'guru', 'ਕ੍ਰਿਸ਼ਣ'],
  ['हुस्न की तिजोरियाँ', 'guru', 'ਹੁਸਨ ਕੀ ਤਿਜੋਰਿਯਾਂ'], // plain clusters, bindi
  ['प्रेम', 'guru', 'ਪ੍ਰੇਮ'], // ...but ਰ stays subjoined
  ['ਮੈਂ Hello', 'guru', 'ਮੈਂ Hello'], // already Gurmukhi: untouched
  ['ভালোবাসা', 'deva', 'भालोबासा'], // Bengali
  ['પ્રેમ', 'deva', 'प्रेम'], // Gujarati
  ['love you', 'deva', 'love you'],
];
for (const [src, to, want] of scripts) assert.strictEqual(toScript(src, to), want, `${src} -> ${to}`);
// other Brahmic scripts romanize too (through Devanagari)
assert.strictEqual(translit('ভালোবাসা'), 'Bhaalobaasa');
console.log('roman ok');
