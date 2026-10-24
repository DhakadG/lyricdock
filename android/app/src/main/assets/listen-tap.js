// Listen's audio tap (listen.js): hands the page the sound in blocks of 2048 samples, mono. A file of its own so the web
// app's script-src 'self' allows it; the phone app's file:// page loads the same code from a data: URL instead.
registerProcessor(
  'ld-tap',
  class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.b = new Float32Array(2048);
      this.n = 0;
    }
    process(i) {
      const c = i[0];
      if (c && c.length) {
        const a = c[0],
          b = c[1];
        for (let k = 0; k < a.length; k++) {
          this.b[this.n++] = b ? (a[k] + b[k]) / 2 : a[k];
          if (this.n === 2048) {
            this.port.postMessage(this.b.slice(0));
            this.n = 0;
          }
        }
      }
      return true;
    }
  },
);
