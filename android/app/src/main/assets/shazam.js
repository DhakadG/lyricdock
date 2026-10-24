// Song recognition by sound (listen.js): a Shazam-style audio fingerprint, made on the device from a few seconds of
// 16 kHz mono audio, so only ~2 KB leaves it (web/src/worker.js /lyrics/shazam sends it on). The format is the one
// Shazam's apps send - spectral peaks in four frequency bands - as worked out by SongRec (github.com/marin-m/SongRec).
// Sig.make(Int16Array of 16 kHz samples) -> { uri, samplems }.
const Sig = (() => {
  const N = 2048,
    BINS = 1025,
    RING = 256;
  // numpy.hanning(2050)[1:-1]
  const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / 2049));

  // In-place radix-2 FFT of a real signal (im starts at 0).
  const REV = new Uint16Array(N);
  for (let i = 0, bits = Math.log2(N); i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    REV[i] = r;
  }
  const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / N)),
    SIN = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / N));
  function power(x) {
    const re = new Float64Array(N),
      im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[REV[i]] = x[i];
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1,
        step = N / size;
      for (let s = 0; s < N; s += size)
        for (let k = 0; k < half; k++) {
          const a = s + k,
            b = a + half,
            c = COS[k * step],
            d = SIN[k * step];
          const tr = re[b] * c - im[b] * d,
            ti = re[b] * d + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
    }
    const out = new Float32Array(BINS);
    for (let i = 0; i < BINS; i++) out[i] = Math.max((re[i] * re[i] + im[i] * im[i]) / (1 << 17), 1e-10);
    return out;
  }

  function peaksOf(samples) {
    const ring = new Int16Array(N),
      ffts = Array.from({ length: RING }, () => new Float32Array(BINS)),
      spread = Array.from({ length: RING }, () => new Float32Array(BINS)),
      win = new Float32Array(N),
      bands = [[], [], [], []];
    let ri = 0,
      fi = 0,
      si = 0,
      spreadDone = 0;
    const at = (i, k) => (((i + k) % RING) + RING) % RING;
    for (let c = 0; c + 128 <= samples.length; c += 128) {
      ring.set(samples.subarray(c, c + 128), ri);
      ri = (ri + 128) & (N - 1);
      for (let i = 0; i < N; i++) win[i] = ring[(i + ri) & (N - 1)] * HANN[i];
      const f = power(win);
      ffts[fi] = f;
      fi = (fi + 1) % RING;

      // spreading: across frequency, then into the 1st, 3rd and 6th earlier spread ffts
      const sp = Float32Array.from(f);
      for (let p = 0; p <= 1022; p++) sp[p] = Math.max(sp[p], sp[p + 1], sp[p + 2]);
      for (let p = 0; p < BINS; p++) {
        let m = sp[p];
        for (const back of [1, 3, 6]) {
          const o = spread[at(si, -back)];
          m = Math.max(m, o[p]);
          o[p] = m;
        }
      }
      spread[si] = sp;
      si = (si + 1) % RING;
      spreadDone++;
      if (spreadDone < 46) continue;

      // recognition: local maxima of the fft 46 back, against the spread ffts around it
      const f46 = ffts[at(fi, -46)],
        s49 = spread[at(si, -49)];
      for (let b = 10; b <= 1014; b++) {
        const v = f46[b];
        if (v < 1 / 64 || v < s49[b - 1]) continue;
        let m = 0;
        for (const o of [-10, -7, -4, -3, 1, 2, 5, 8]) m = Math.max(m, s49[b + o]);
        if (v <= m) continue;
        for (const o of [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249])
          m = Math.max(m, spread[at(si, o)][b - 1]);
        if (v <= m) continue;
        const mag = x => Math.max(Math.log(x), 1 / 64) * 1477.3 + 6144;
        const pm = mag(v),
          before = mag(f46[b - 1]),
          after = mag(f46[b + 1]);
        const v1 = pm * 2 - before - after,
          v2 = ((after - before) * 32) / v1;
        const bin = (b * 64 + Math.trunc(v2)) & 0xffff,
          hz = Math.trunc(bin * (16000 / 2 / 1024 / 64));
        const band =
          hz >= 250 && hz < 520
            ? 0
            : hz >= 520 && hz < 1450
              ? 1
              : hz >= 1450 && hz < 3500
                ? 2
                : hz >= 3500 && hz <= 5500
                  ? 3
                  : -1;
        if (band >= 0) bands[band].push({ pass: spreadDone - 46, mag: Math.trunc(pm) & 0xffff, bin });
      }
    }
    return bands;
  }

  const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = u8 => {
    let c = 0xffffffff;
    for (const x of u8) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function encode(bands, numSamples) {
    const body = [];
    const i32 = v => {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setInt32(0, v, true);
      body.push(...b);
    };
    i32(0x40000000);
    i32(0); // size, below
    bands.forEach((peaks, band) => {
      if (!peaks.length) return;
      const p = [];
      let last = 0;
      for (const k of peaks) {
        if (k.pass - last >= 255) {
          p.push(0xff, k.pass & 0xff, (k.pass >> 8) & 0xff, (k.pass >> 16) & 0xff, (k.pass >>> 24) & 0xff);
          last = k.pass;
        }
        p.push(k.pass - last, k.mag & 0xff, k.mag >> 8, k.bin & 0xff, k.bin >> 8);
        last = k.pass;
      }
      i32(0x60030040 + band);
      i32(p.length);
      body.push(...p);
      while (body.length % 4) body.push(0);
    });
    const out = new Uint8Array(48 + body.length),
      dv = new DataView(out.buffer);
    out.set(body, 48);
    dv.setUint32(0, 0xcafe2580, true);
    dv.setUint32(8, body.length, true);
    dv.setUint32(12, 0x94119c00, true);
    dv.setUint32(28, 3 << 27, true); // 16 kHz
    dv.setUint32(40, numSamples + 16000 * 0.24, true);
    dv.setUint32(44, (15 << 19) + 0x40000, true);
    dv.setUint32(52, body.length, true);
    dv.setUint32(4, crc32(out.subarray(8)), true);
    return out;
  }

  const b64 = u8 => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return {
    make: samples => ({
      uri: 'data:audio/vnd.shazam.sig;base64,' + b64(encode(peaksOf(samples), samples.length)),
      samplems: Math.round((samples.length / 16000) * 1000),
    }),
  };
})();
