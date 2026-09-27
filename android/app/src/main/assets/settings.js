// Settings: one schema drives defaults, persistence (localStorage) and the in-app panel.
// The panel reuses Spicy Lyrics' settings-panel markup/classes (sl-sp-*), styled in index.html.
const Settings = (() => {
  const SCHEMA = [
    { group: 'Layout' },
    { k: 'layout', label: 'Layout', type: 'choice', def: 'split', opts: [
      ['split', 'Default'], ['lyrics', 'Lyrics only'], ['compact', 'Compact'], ['tv', 'TV view'], ['cinema', 'Cinema'], ['nowbar', 'Now Bar']] },
    { k: 'progress', label: 'Progress bar', type: 'choice', def: 'bottom', opts: [['bottom', 'Bottom'], ['top', 'Top'], ['off', 'Off']] },
    { k: 'times', label: 'Show times', desc: 'Elapsed and total time next to the progress bar', type: 'toggle', def: false },
    { k: 'hideAfter', label: 'Hide controls after', type: 'range', min: 2, max: 10, step: 1, def: 4, unit: 's' },
    { k: 'orientation', label: 'Orientation', type: 'choice', def: 'auto', opts: [['auto', 'Auto-rotate (all 4)'], ['landscape', 'Landscape'], ['portrait', 'Portrait']] },
    { k: 'edgeMode', label: 'Notch & edge spacing', desc: 'Auto reads the camera cutout and rounded corners from the phone',
      type: 'choice', def: 'auto', opts: [['auto', 'Auto'], ['manual', 'Manual']] },
    { k: 'edgePad', label: 'Side padding', type: 'range', min: 0, max: 80, step: 2, def: 24, unit: 'px', when: s => s.edgeMode === 'manual' },
    { k: 'cornerPad', label: 'Progress bar corner inset', type: 'range', min: 0, max: 80, step: 2, def: 20, unit: 'px', when: s => s.edgeMode === 'manual' },

    { group: 'Now playing' },
    { k: 'showLiked', label: 'Show liked (heart)', desc: 'Tap the heart to like / unlike', type: 'toggle', def: true },
    { k: 'showQuality', label: 'Show audio quality', type: 'toggle', def: true },

    { group: 'Background' },
    { k: 'bg', label: 'Background', type: 'choice', def: 'dynamic', opts: [
      ['dynamic', 'Dynamic'], ['blur', 'Blurred art'], ['gradient', 'Colour gradient'], ['black', 'Black']] },
    { k: 'bgSpeed', label: 'Motion speed', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0.35, when: s => s.bg === 'dynamic' },
    { k: 'bgWarp', label: 'Warp', type: 'range', min: 0, max: 1, step: 0.05, def: 1, when: s => s.bg === 'dynamic' },
    { k: 'bgDim', label: 'Dim', type: 'range', min: 0, max: 0.8, step: 0.05, def: 0.2, when: s => s.bg !== 'black' },

    { group: 'Lyrics' },
    { k: 'roman', label: 'Romanization', desc: 'Smart keeps Hindi (Devanagari) as is and romanizes everything else',
      type: 'choice', def: 'smart', opts: [['smart', 'Smart (keep Hindi)'], ['always', 'Always'], ['off', 'Original script']] },
    { k: 'size', label: 'Text size', type: 'range', min: 0.6, max: 1.6, step: 0.05, def: 1, unit: '×' },
    { k: 'align', label: 'Alignment', type: 'choice', def: 'left', opts: [['left', 'Left'], ['center', 'Centre']] },
    { k: 'anchor', label: 'Active line position', desc: 'How far down the screen the current line sits', type: 'range', min: 0.2, max: 0.6, step: 0.05, def: 0.35 },
    { k: 'blurLines', label: 'Blur distant lines', type: 'toggle', def: true },
    { k: 'glow', label: 'Glow on sung words', type: 'toggle', def: true },
    { k: 'lift', label: 'Lift sung words', type: 'toggle', def: true },
    { k: 'credits', label: 'Show credits', desc: 'Written by / Provided by under the lyrics', type: 'toggle', def: true },
    { k: 'tapSeek', label: 'Tap a line to jump to it', type: 'toggle', def: true },
    { k: 'offset', label: 'Sync offset', desc: 'Positive shows lyrics later, negative earlier', type: 'range', min: -1000, max: 1000, step: 10, def: 0, unit: 'ms' },
    { k: 'apiKey', label: 'Spicy Lyrics API key (optional)', type: 'text', def: '', placeholder: 'sl_pk_…',
      desc: 'Your own publishable key with "No origin header" allowed. Fills gaps the desktop cache misses.' },

    { group: 'Animations' },
    { k: 'trackAnim', label: 'Next / previous', type: 'choice', def: 'slide', opts: [
      ['slide', 'Slide'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['flip', 'Flip'], ['blur', 'Blur'], ['stack', 'Card stack'], ['none', 'None']] },
    { k: 'ppAnim', label: 'Play / pause', type: 'choice', def: 'both', opts: [
      ['both', 'Pulse + shrink'], ['pulse', 'Pulse'], ['shrink', 'Shrink art'], ['ripple', 'Ripple'], ['none', 'None']] },
    { k: 'scroll', label: 'Lyrics scroll', type: 'choice', def: 'smooth', opts: [['smooth', 'Smooth'], ['spring', 'Springy'], ['snappy', 'Snappy']] },
    { k: 'animSpeed', label: 'Animation speed', type: 'range', min: 0.5, max: 2, step: 0.1, def: 1, unit: '×' },

    { group: 'Playback source' },
    { k: 'source', label: 'Source', type: 'choice', def: 'auto',
      desc: 'Auto: the desktop bridge while Spotify plays on the PC, otherwise your Spotify account (phone, speakers…)',
      opts: [['auto', 'Auto'], ['bridge', 'Desktop (Spicetify)'], ['web', 'Spotify account']] },
    { k: 'spClientId', label: 'Spotify Client ID', type: 'text', def: '', placeholder: '32 hex characters',
      desc: 'From developer.spotify.com - redirect URI http://127.0.0.1:8976/callback. No client secret needed.' },
    { label: 'Spotify account', type: 'action', text: () => (window.Web?.loggedIn() ? 'Sign out' : 'Sign in'),
      run: () => (Web.loggedIn() ? Web.logout() : Web.login()), info: () => window.Web?.status() ?? '' },

    { group: 'Presets', desc: 'Saved on the desktop, so another phone can reuse them' },
    { label: 'Presets', type: 'presets' },

    { group: 'Connection' },
    { label: 'Link', type: 'info', value: () => window.dockStatus?.() ?? '' },
    { label: 'Pairing code', desc: 'Enter once in Spotify → LyricDock (top bar) → Pair phone', type: 'info', value: () => window.Rtc?.code ?? '' },
  ];

  const KEY = 'dock:settings';
  const defaults = Object.fromEntries(SCHEMA.filter(x => x.k).map(x => [x.k, x.def]));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const fresh = !saved; // first run on this phone: take the desktop's last settings when the bridge sends them
  const S = { ...defaults, ...saved };
  const listeners = [];
  let presets = {}, presetHook = () => {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const notify = (k, v) => listeners.forEach(f => f(k, v));

  // Every change is saved immediately - sliders included (not only on release).
  function set(k, v, rerender = true) {
    S[k] = v;
    save();
    notify(k, v);
    if (rerender) render();
  }

  // ---- panel (Spicy Lyrics sl-sp-* structure)
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (x, v) => {
    v = +v;
    if (x.unit === 'ms') return `${v > 0 ? '+' : ''}${v} ms`;
    if (x.unit === 's') return `${v} s`;
    if (x.unit) return `${+v.toFixed(2)}${x.unit}`;
    return v.toFixed(2);
  };

  function slider(x) {
    const wrap = el('div', 'sl-sp-slider');
    const tw = el('div', 'sl-sp-slider-track-wrap');
    const track = el('div', 'sl-sp-slider-track'), fill = el('div', 'sl-sp-slider-fill');
    const input = el('input', 'sl-sp-slider-input');
    Object.assign(input, { type: 'range', min: x.min, max: x.max, step: x.step, value: S[x.k] });
    const bipolar = x.min < 0 && x.max > 0;
    const meta = el('div', 'sl-sp-slider-meta');
    const val = el('span', 'sl-sp-slider-value'), reset = el('button', 'sl-sp-slider-reset', 'Reset');
    const paint = v => {
      const f = (v - x.min) / (x.max - x.min), c = bipolar ? (0 - x.min) / (x.max - x.min) : 0;
      fill.style.left = Math.min(f, c) * 100 + '%';
      fill.style.width = Math.abs(f - c) * 100 + '%';
      val.textContent = fmt(x, v);
      reset.style.visibility = +v === x.def ? 'hidden' : 'visible';
    };
    // Touch-safe: the native range input grabs any touch that lands on it, which hijacks scrolling the sheet.
    // It is visual only here; a drag must go sideways (>8px, more horizontal than vertical) before it moves the
    // value, a vertical swipe scrolls as normal (touch-action: pan-y), and a plain tap changes nothing.
    input.tabIndex = -1;
    const valueAt = cx => {
      const r = tw.getBoundingClientRect(), f = Math.min(1, Math.max(0, (cx - r.left) / r.width));
      const v = x.min + Math.round(f * (x.max - x.min) / x.step) * x.step;
      return +v.toFixed(4);
    };
    let g = null;
    tw.addEventListener('pointerdown', e => { g = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false }; });
    tw.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { g = null; return; } // a scroll, not a slide
        if (Math.abs(dx) < 8) return;
        g.on = true;
        tw.setPointerCapture(e.pointerId);
        wrap.classList.add('dragging');
      }
      const v = valueAt(e.clientX);
      if (v !== +input.value) { input.value = v; paint(v); set(x.k, v, false); }
    });
    const end = () => { g = null; wrap.classList.remove('dragging'); };
    tw.addEventListener('pointerup', end);
    tw.addEventListener('pointercancel', end);
    reset.onclick = () => { input.value = x.def; paint(x.def); set(x.k, x.def, false); };
    tw.append(track, fill);
    if (bipolar) { const ctr = el('div', 'sl-sp-slider-center'); ctr.style.left = (0 - x.min) / (x.max - x.min) * 100 + '%'; tw.append(ctr); }
    tw.append(input);
    meta.append(val, reset);
    wrap.append(tw, meta);
    paint(S[x.k]);
    return wrap;
  }

  function control(x) {
    if (x.type === 'info') return el('span', 'sl-sp-description', x.value());
    if (x.type === 'action') {
      const box = el('div', 'sl-presets'), b = el('button', 'sl-text-btn', x.text());
      b.onclick = () => x.run();
      box.append(b, el('span', 'sl-sp-description', x.info()));
      return box;
    }
    if (x.type === 'text') {
      const i = el('input', 'sl-input');
      Object.assign(i, { value: S[x.k] || '', placeholder: x.placeholder || '', spellcheck: false, autocomplete: 'off' });
      i.onchange = () => set(x.k, i.value.trim());
      return i;
    }
    if (x.type === 'presets') {
      const box = el('div', 'sl-presets');
      const names = Object.keys(presets).sort();
      const sel = el('select', 'sl-sp-select');
      for (const n of names) { const o = el('option', null, n); o.value = n; sel.append(o); }
      if (!names.length) sel.append(el('option', null, 'No presets yet'));
      const btn = (label, fn) => { const b = el('button', 'sl-text-btn', label); b.onclick = fn; return b; };
      const name = el('input', 'sl-input');
      name.placeholder = 'New preset name';
      box.append(sel, btn('Apply', () => presets[sel.value] && load(presets[sel.value])),
        btn('Delete', () => names.length && presetHook('delete', sel.value)),
        name, btn('Save current', () => name.value.trim() && presetHook('save', name.value.trim().slice(0, 40))));
      return box;
    }
    if (x.type === 'toggle') {
      const l = el('label', 'sl-sp-toggle'), i = el('input');
      i.type = 'checkbox';
      i.checked = !!S[x.k];
      i.onchange = () => set(x.k, i.checked);
      l.append(i, el('span', 'sl-sp-toggle-track'));
      return l;
    }
    if (x.type === 'choice') {
      const s = el('select', 'sl-sp-select');
      for (const [v, name] of x.opts) { const o = el('option', null, name); o.value = v; o.selected = S[x.k] === v; s.append(o); }
      s.onchange = () => set(x.k, s.value);
      return s;
    }
    return slider(x);
  }

  function render() {
    const body = document.querySelector('#settings .sl-modal-main-section');
    if (!body) return;
    const top = body.scrollTop;
    // Rows live in an inner, auto-height wrapper: multi-column on the fixed-height scroller itself would
    // overflow into extra columns off to the side (settings "missing") instead of scrolling.
    const cols = el('div', 'sl-cols');
    body.replaceChildren(cols);
    cols.append(...SCHEMA.filter(x => !x.when || x.when(S)).map(x => {
      if (x.group) return el('div', 'sl-sp-section-title', x.group);
      const row = el('div', 'sl-sp-row' + (['range', 'text', 'presets', 'action'].includes(x.type) ? ' sl-sp-row--stacked' : ''));
      const lw = el('div', 'sl-sp-label-wrap');
      lw.append(el('div', 'sl-sp-label', x.label));
      if (x.desc) lw.append(el('div', 'sl-sp-description', x.desc));
      const c = el('div', 'sl-sp-control');
      c.append(control(x));
      row.append(lw, c);
      return row;
    }));
    body.scrollTop = top;
  }

  const open = () => { render(); document.body.classList.add('settings-open'); };
  const close = () => document.body.classList.remove('settings-open');
  const reset = () => { Object.assign(S, defaults, { apiKey: S.apiKey }); save(); notify('*'); render(); };
  // Apply a whole settings object (preset or the desktop's last settings). Unknown keys are ignored.
  function load(obj) {
    for (const k of Object.keys(defaults)) if (obj && k in obj && k !== 'apiKey') S[k] = obj[k];
    if (obj?.apiKey && !S.apiKey) S.apiKey = obj.apiKey;
    save(); notify('*'); render();
  }

  // Serializable copy of the schema for the desktop panel (functions dropped; actions/info/presets are phone-only).
  const schema = () => SCHEMA.filter(x => x.group || (x.k && x.type !== 'info'))
    .filter((x, i, a) => !x.group || (a[i + 1] && !a[i + 1].group)) // drop sections with nothing editable (Presets, Connection)
    .map(({ group, k, label, type, def, opts, min, max, step, unit, desc, placeholder }) =>
      ({ group, k, label, type, def, opts, min, max, step, unit, desc, placeholder }));
  // A change from the desktop panel: only known keys, and only values of the default's type.
  const setRemote = (k, v) => { if (k in defaults && typeof v === typeof defaults[k] && (x => !x.opts || x.opts.some(o => o[0] === v))(SCHEMA.find(x => x.k === k))) set(k, v); };

  return {
    S, set, setRemote, schema, open, close, reset, load, fresh, render,
    onChange: f => listeners.push(f),
    setPresets: p => { presets = p && typeof p === 'object' ? p : {}; render(); },
    onPreset: f => { presetHook = f; },
  };
})();
