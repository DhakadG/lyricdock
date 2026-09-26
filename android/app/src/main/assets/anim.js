// Word animation ported from Spicy Lyrics (AGPL-3.0, github.com/Spikerko/spicy-lyrics):
// src/modules/Spring.ts (itself a port of Fraktality/spr, MIT) and the word curves + constants
// from src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts. Personal use only.
const Anim = (() => {
  const TAU = Math.PI * 2;

  class Spring {
    constructor(p, f, d) { this.p = p; this.g = p; this.v = 0; this.f = f; this.d = d; }
    set(g, snap) { this.g = g; if (snap) { this.p = g; this.v = 0; } }
    step(dt) {
      const d = this.d, f = this.f * TAU, g = this.g;
      let p = this.p, v = this.v;
      const o = p - g;
      if (d === 1) {
        const q = Math.exp(-f * dt), w = dt * q;
        p = o * (q + w * f) + v * w + g;
        v = v * (q - w * f) - o * (w * f * f);
      } else if (d < 1) {
        const q = Math.exp(-d * f * dt), c = Math.sqrt(1 - d * d);
        const i = Math.cos(dt * f * c), j = Math.sin(dt * f * c);
        const z = j / c, y = j / (f * c);
        p = (o * (i + z * d) + v * y) * q + g;
        v = (v * (i - z * d) - o * (z * f)) * q;
      } else {
        const c = Math.sqrt(d * d - 1), r1 = -f * (d + c), r2 = -f * (d - c);
        const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
        const co2 = (v - o * r1) / (2 * f * c), co1 = e1 * (o - co2);
        p = co1 + co2 * e2 + g;
        v = co1 * r1 + co2 * e2 * r2;
      }
      this.p = p; this.v = v;
      return p;
    }
  }

  // Natural cubic spline (what the `cubic-spline` package Spicy uses computes).
  function spline(pts) {
    const x = pts.map(p => p[0]), y = pts.map(p => p[1]), n = x.length;
    const h = [], a = [], l = [1], mu = [0], z = [0], c = Array(n).fill(0), b = [], d = [];
    for (let i = 0; i < n - 1; i++) h[i] = x[i + 1] - x[i];
    for (let i = 1; i < n - 1; i++) {
      a[i] = 3 / h[i] * (y[i + 1] - y[i]) - 3 / h[i - 1] * (y[i] - y[i - 1]);
      l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (a[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    for (let j = n - 2; j >= 0; j--) {
      c[j] = (j === 0 ? 0 : z[j]) - mu[j] * c[j + 1];
      b[j] = (y[j + 1] - y[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
      d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }
    return t => {
      t = Math.min(x[n - 1], Math.max(x[0], t));
      let i = 0;
      while (i < n - 2 && t > x[i + 1]) i++;
      const dx = t - x[i];
      return y[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx;
    };
  }

  const Scale = spline([[0, 0.95], [0.7, 1.0505], [1, 1]]);
  const YOffset = spline([[0, 1 / 100], [0.9, -(1 / 60)], [1, 0]]);
  const Glow = spline([[0, 0], [0.15, 1], [0.6, 1], [1, 0]]);

  const springs = () => ({ s: new Spring(Scale(0), 0.88, 0.64), y: new Spring(YOffset(0), 1.45, 0.4), g: new Spring(Glow(0), 1.18, 0.56) });

  // One word: state from playback position, springs toward the curve targets, write only what changed.
  function word(w, p, dt, opts) {
    const k = w.e > w.t ? Math.min(1, Math.max(0, (p - w.t) / (w.e - w.t))) : p >= w.t ? 1 : 0;
    const state = p < w.t ? 0 : p >= w.e ? 2 : 1;
    if (!w.sp) w.sp = springs();
    const pct = state === 1 ? k : state === 2 ? 1 : 0;
    w.sp.s.set(Scale(pct));
    w.sp.y.set(YOffset(pct));
    w.sp.g.set(Glow(pct));
    const s = w.sp.s.step(dt), y = w.sp.y.step(dt), g = w.sp.g.step(dt);
    const grad = state === 0 ? -20 : state === 2 ? 100 : -20 + 120 * k;
    const st = w.el.style;
    const put = (prop, val) => { if (w[prop] !== val) { w[prop] = val; st.setProperty(prop, val); } };
    put('--gp', grad.toFixed(1) + '%');
    put('scale', opts.lift ? s.toFixed(4) : '1');
    put('transform', opts.lift ? `translate3d(0, ${(y).toFixed(4)}em, 0)` : 'none');
    put('--tsr', (4 + 2 * g).toFixed(1) + 'px');
    put('--tso', opts.glow ? Math.min(g * 35, 100).toFixed(0) + '%' : '0%');
  }

  // ---- interlude dots (Spicy's DotAnimations / DotGroupAnimations). Each dot owns a third of the gap and
  // fills as its share passes; the group grows in, breathes, pops just before the next line and vanishes.
  const DotScale = spline([[0, 0.75], [0.7, 1.05], [1, 1]]);
  const DotY = spline([[0, 0], [0.9, -0.12], [1, 0]]);
  const DotGlow = spline([[0, 0], [0.6, 1], [1, 1]]);
  const DotOpacity = spline([[0, 0.35], [0.6, 1], [1, 1]]);
  const put = (w, prop, val) => { if (w[prop] !== val) { w[prop] = val; w.el.style.setProperty(prop, val); } };

  function dot(d, p, dt) {
    const k = d.e > d.t ? Math.min(1, Math.max(0, (p - d.t) / (d.e - d.t))) : p >= d.t ? 1 : 0;
    if (!d.sp) d.sp = { s: new Spring(DotScale(0), 0.7, 0.6), y: new Spring(DotY(0), 1.25, 0.4),
      g: new Spring(DotGlow(0), 1, 0.5), o: new Spring(DotOpacity(0), 1, 0.5) };
    d.sp.s.set(DotScale(k)); d.sp.y.set(DotY(k)); d.sp.g.set(DotGlow(k)); d.sp.o.set(DotOpacity(k));
    const s = d.sp.s.step(dt), y = d.sp.y.step(dt), g = d.sp.g.step(dt), o = d.sp.o.step(dt);
    put(d, 'scale', s.toFixed(4));
    put(d, 'transform', `translate3d(0, ${y.toFixed(4)}em, 0)`);
    put(d, 'opacity', o.toFixed(3));
    put(d, '--tsr', (4 + 6 * g).toFixed(1) + 'px');
    put(d, '--tso', Math.min(g * 35, 100).toFixed(0) + '%');
  }

  // Piecewise-linear through [seconds, value] points; the springs smooth it.
  const lerpAt = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1);
    }
    return pts[pts.length - 1][1];
  };

  function dotGroup(g, p, dt) {
    const T = Math.max(0.3, (g.e - g.t) / 1000), x = (p - g.t) / 1000;
    if (!g.scalePts) { // grow in by 0.2s, pulse 0.95/1.05 every 2.25s, pop to 1.15 then collapse over the last 75ms
      const pts = [[0, 0], [0.2, 1.05]];
      for (let t = 0.2 + 2.25, i = 1; t < T - 0.3; t += 2.25, i++) pts.push([t, i % 2 ? 0.95 : 1.05]);
      pts.push([T - 0.075, 1.15], [T, 0]);
      g.scalePts = pts;
      g.opPts = [[0, 0], [Math.min(0.5, T / 3), 1], [T - 0.075, 1], [T, 0]];
      g.sp = { s: new Spring(0, 5, 0.7), o: new Spring(0, 1.25, 0.4) };
    }
    g.sp.s.set(lerpAt(g.scalePts, x));
    g.sp.o.set(lerpAt(g.opPts, x));
    put(g, 'scale', Math.max(0, g.sp.s.step(dt)).toFixed(4));
    put(g, 'opacity', Math.min(1, Math.max(0, g.sp.o.step(dt))).toFixed(3));
  }

  // Line left the active window: snap springs to rest so the next pass starts clean.
  function rest(words, sung) {
    for (const w of words) {
      if (!w.sp) continue;
      const k = sung ? 1 : 0;
      w.sp.s.set(Scale(k), true); w.sp.y.set(YOffset(k), true); w.sp.g.set(Glow(k), true);
      for (const prop of ['--gp', 'scale', 'transform', '--tsr', '--tso']) { w.el.style.removeProperty(prop); w[prop] = undefined; }
    }
  }

  function restDots(line) {
    for (const d of [line.grp, ...line.dd]) {
      d.sp = null; d.scalePts = null;
      for (const prop of ['scale', 'transform', 'opacity', '--tsr', '--tso']) { d.el.style.removeProperty(prop); d[prop] = undefined; }
    }
  }

  return { Spring, spline, word, rest, dot, dotGroup, restDots };
})();
