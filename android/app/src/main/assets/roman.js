// Indic -> casual Latin romanization for lyrics (Gurmukhi/Punjabi and Devanagari/Hindi).
// Both scripts use the same ISCII-derived layout, 0x100 apart, so one table keyed by offset covers both.
// ponytail: heuristic schwa deletion, reads like lyric-site romanization, not ISO 15919.
const Roman = (() => {
  const DEVA = 0x0900, GURU = 0x0A00;
  const CONS = {
    0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng', 0x1A: 'ch', 0x1B: 'chh', 0x1C: 'j', 0x1D: 'jh', 0x1E: 'nj',
    0x1F: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n',
    0x2A: 'p', 0x2B: 'ph', 0x2C: 'b', 0x2D: 'bh', 0x2E: 'm', 0x2F: 'y', 0x30: 'r', 0x32: 'l', 0x33: 'l', 0x35: 'v',
    0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h', 0x58: 'q', 0x59: 'kh', 0x5A: 'gh', 0x5B: 'z', 0x5C: 'r', 0x5D: 'rh',
    0x5E: 'f', 0x5F: 'y',
  };
  const VOW = { 0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0A: 'oo', 0x0B: 'ri', 0x0F: 'e', 0x10: 'ai', 0x13: 'o', 0x14: 'au' };
  const MATRA = { 0x3E: 'aa', 0x3F: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo', 0x43: 'ri', 0x47: 'e', 0x48: 'ai', 0x4B: 'o', 0x4C: 'au' };
  const NUKTA = { k: 'q', g: 'gh', j: 'z', ph: 'f', d: 'r', dh: 'rh', s: 'sh' };
  const NASAL = [0x01, 0x02], VIRAMA = 0x4D, NUK = 0x3C;

  const hasDeva = s => /[ऀ-ॿ]/.test(s);
  const hasGuru = s => /[਀-੿]/.test(s);
  const isIndic = s => hasDeva(s) || hasGuru(s);

  const offset = ch => {
    const c = ch.codePointAt(0);
    if (c >= DEVA && c < DEVA + 0x80) return { o: c - DEVA, guru: false };
    if (c >= GURU && c < GURU + 0x80) return { o: c - GURU, guru: true };
    return null;
  };

  // One word -> units: { c: consonant, v: null (inherent) | '' (virama) | 'aa'..., gem, nasal } or { x: literal }
  function units(word) {
    const out = [];
    let gem = false;
    for (const ch of word) {
      const k = offset(ch);
      const last = out[out.length - 1];
      if (!k) { out.push({ x: ch }); continue; }
      const { o, guru } = k;
      if (CONS[o] !== undefined && !(guru && o === 0x70)) { out.push({ c: CONS[o], v: null, gem }); gem = false; }
      else if (VOW[o]) out.push({ x: VOW[o], vowel: true });
      else if (guru && (o === 0x72 || o === 0x73)) out.push({ x: o === 0x73 ? 'u' : 'i', vowel: true, bearer: true });
      else if (MATRA[o]) {
        if (last?.bearer) { last.x = MATRA[o]; last.bearer = false; }
        else if (last?.c !== undefined) last.v = MATRA[o];
        else out.push({ x: MATRA[o], vowel: true });
      }
      else if (o === VIRAMA && last?.c !== undefined) last.v = '';
      else if (o === NUK && last?.c !== undefined) last.c = NUKTA[last.c] ?? last.c;
      else if (NASAL.includes(o) || (guru && o === 0x70)) {
        if (last?.c !== undefined && last.v === null) last.v = 'a'; // nasal sign makes the inherent vowel audible
        if (last) last.nasal = true; else out.push({ x: 'n' });
      }
      else if (guru && o === 0x71) gem = true;
      else if (o === 0x03) out.push({ x: 'h' });
      else if (guru && o === 0x74) out.push({ x: 'ik onkar' });
      else if (o === 0x64 || o === 0x65) out.push({ x: '.' });
      else if (o >= 0x66 && o <= 0x6F) out.push({ x: String(o - 0x66) });
    }
    return out;
  }

  const sounds = u => u.vowel || (u.c !== undefined && u.v !== '');

  function word(w) {
    const u = units(w);
    // Schwa deletion: drop the inherent 'a' word-finally, and in V C _ C V / V C _ C# contexts.
    for (let i = 0; i < u.length; i++) {
      if (u[i].c === undefined || u[i].v !== null) continue;
      const prev = u[i - 1], next = u[i + 1];
      const final = !next || next.c === undefined && !next.vowel;
      const nextVoiced = next?.c !== undefined && (next.v !== null || i + 2 >= u.length);
      // prev.nasal: deleting would make a 3-consonant cluster (zind-a-gi), so keep it.
      u[i].v = final || (prev && sounds(prev) && !prev.nasal && nextVoiced) ? '' : 'a';
    }
    let s = '';
    u.forEach((x, i) => {
      if (x.c === undefined) { s += x.x + (x.nasal ? 'n' : ''); return; }
      let v = x.v;
      const end = i === u.length - 1;
      if (end && v === 'ee') v = 'i';                 // teri, sohni
      if (end && v === 'aa') v = 'a';                 // tera, paara
      if (end && x.nasal && v === 'oo') { s += (x.gem ? x.c[0] : '') + x.c + 'u'; return; } // tu, nu, mainu
      s += (x.gem ? x.c[0] : '') + x.c + v + (x.nasal ? 'n' : '');
    });
    return s;
  }

  // cap=false for mid-line fragments (single syllables of word-synced lyrics).
  function translit(text, cap = true) {
    if (!isIndic(text)) return text;
    const out = text.replace(/[ऀ-ॿ਀-੿]+/g, word);
    return cap ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  }

  return { translit, hasDeva, hasGuru, isIndic };
})();
if (typeof module !== 'undefined') module.exports = Roman;
