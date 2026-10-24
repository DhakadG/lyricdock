// Playback source "Listen": names the song playing nearby by its sound, like Shazam, and follows it song after song
// until Stop. The microphone (or, in a desktop browser, a shared tab / screen) stays open into a 20 s ring buffer with
// a loudness meter; a fingerprint is made on this device from the last few seconds (shazam.js, ~2 KB) and Shazam names
// it through LyricDock's server (web/src/worker.js /lyrics/shazam), with where in the song the clip started.
// Rhythm (after lyricsync.in): name a song once 4.5 s of sound were heard; while following it, check again every
// ~10 s (6 s clips) - a jump over 1 s is taken, smaller drift blended in; quiet pauses the clock, sound coming back
// resumes it and checks sooner; 30 s of quiet, or 8 s past the song's end, means the next song. Lyrics and the Spotify
// match come from Named (phone.js), as for other songs known by name.
const Listen = (() => {
  const n = Named(),
    SERVER = 'https://app.lyricdock.losthusky.qzz.io/lyrics/shazam',
    SILENCE = 0.0035, // RMS below this is "nothing playing"
    TAP = `registerProcessor('ld-tap', class extends AudioWorkletProcessor {
      constructor() { super(); this.b = new Float32Array(2048); this.n = 0; }
      process(i) { const c = i[0]; if (c && c.length) { const a = c[0], b = c[1];
        for (let k = 0; k < a.length; k++) { this.b[this.n++] = b ? (a[k] + b[k]) / 2 : a[k];
          if (this.n === 2048) { this.port.postMessage(this.b.slice(0)); this.n = 0; } } } return true; } });`;
  const now = () => performance.now();

  // ---- the ear: open audio, the last 20 s, how loud
  const ear = {
    on: false,
    kind: '',
    ctx: null,
    stream: null,
    nodes: [],
    rate: 48000,
    ring: null,
    w: 0,
    total: 0,
    lastWall: 0,
    audibleSince: 0,
    silentSince: 0,
    lastGap: 0,
    async start(kind) {
      this.stop();
      let stream;
      if (kind === 'tab') {
        // Chrome only shares sound with a picture: a tiny one, dropped from the graph
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { max: 640 }, frameRate: { max: 1 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
        });
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach(t => t.stop());
          throw new Error('no sound was shared - pick the tab that plays and turn on "Share tab audio"');
        }
        stream
          .getTracks()
          .forEach(t => t.addEventListener('ended', () => this.stream === stream && stop('Sharing stopped')));
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        // a call or another app can take the mic: keepAlive takes it back
        stream
          .getAudioTracks()
          .forEach(t => t.addEventListener('ended', () => this.stream === stream && setTimeout(keepAlive, 400)));
      }
      const ctx = new AudioContext();
      if (ctx.state === 'suspended')
        await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 350))]);
      const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())),
        mute = ctx.createGain();
      mute.gain.value = 0; // keeps the graph pulling without playing it back
      let tap;
      // (a data: URL: the phone app's file:// page can't load a worklet from a blob: one)
      // its file (the web app allows only its own scripts), else a data: URL (the phone app's file:// page refuses the
      // file and blob: ones), else the older ScriptProcessor below
      const load = u =>
        ctx.audioWorklet?.addModule(u).then(
          () => true,
          () => false,
        );
      const worklet = (await load('listen-tap.js')) || (await load('data:text/javascript;base64,' + btoa(TAP)));
      if (worklet) {
        tap = new AudioWorkletNode(ctx, 'ld-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2 });
        tap.port.onmessage = e => this.push(e.data);
      } else {
        tap = ctx.createScriptProcessor(2048, 1, 1);
        tap.onaudioprocess = e => this.push(Float32Array.from(e.inputBuffer.getChannelData(0)));
      }
      src.connect(tap);
      tap.connect(mute);
      mute.connect(ctx.destination);
      Object.assign(this, {
        on: true,
        kind,
        ctx,
        stream,
        nodes: [src, tap, mute],
        rate: ctx.sampleRate,
        ring: new Float32Array(Math.ceil(ctx.sampleRate * 20)),
        w: 0,
        total: 0,
        lastWall: now(),
        audibleSince: 0,
        silentSince: now(),
        lastGap: 0,
      });
    },
    stop() {
      this.stream?.getTracks().forEach(t => t.stop());
      this.nodes.forEach(x => {
        try {
          x.disconnect();
        } catch (e) {}
      });
      this.ctx?.close().catch(() => {});
      Object.assign(this, { on: false, ctx: null, stream: null, nodes: [] });
    },
    push(f) {
      const r = this.ring;
      let sum = 0;
      for (let i = 0; i < f.length; i++) {
        r[this.w] = f[i];
        this.w = (this.w + 1) % r.length;
        sum += f[i] * f[i];
      }
      this.total += f.length;
      this.lastWall = now();
      if (Math.sqrt(sum / f.length) > SILENCE) {
        if (!this.audibleSince) {
          if (this.silentSince && now() - this.silentSince > 700) this.lastGap = now(); // a pause, seek or new song
          this.audibleSince = now();
        }
        this.silentSince = 0;
      } else if (!this.silentSince) this.silentSince = now();
      else if (now() - this.silentSince > 400) this.audibleSince = 0;
      tick();
    },
    audibleFor() {
      return this.audibleSince ? (now() - this.audibleSince) / 1000 : 0;
    },
    silentFor() {
      return this.silentSince ? (now() - this.silentSince) / 1000 : 0;
    },
    // the last `sec` seconds as 16 kHz Int16 (quiet sound lifted, so there are enough peaks), and when they began
    clip(sec) {
      const k = Math.min(Math.floor(sec * this.rate), this.total, this.ring.length),
        ratio = this.rate / 16000,
        out = new Int16Array(Math.floor(k / ratio));
      let j0 = (this.w - k + this.ring.length) % this.ring.length,
        peak = 0;
      const at = i => this.ring[(j0 + i) % this.ring.length];
      const f = new Float32Array(out.length);
      for (let i = 0; i < out.length; i++) {
        const a = Math.floor(i * ratio),
          b = Math.min(k, Math.floor((i + 1) * ratio)); // box filter: cheap anti-aliasing
        let s = 0;
        for (let x = a; x < b; x++) s += at(x);
        f[i] = s / Math.max(1, b - a);
        peak = Math.max(peak, Math.abs(f[i]));
      }
      const gain = peak > 0 && peak < 0.25 ? 0.5 / peak : 1;
      for (let i = 0; i < out.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * gain * 32767)));
      return { pcm: out, start: this.lastWall - (k / this.rate) * 1000 };
    },
  };

  // ---- the clock: runs on its own between fingerprints
  const clock = {
    base: 0,
    wall: now(),
    running: false,
    pos() {
      return this.running ? this.base + (now() - this.wall) : this.base;
    },
    set(p) {
      this.base = p;
      this.wall = now();
    },
    play() {
      if (!this.running) ((this.wall = now()), (this.running = true));
    },
    pause() {
      if (this.running) ((this.base = this.pos()), (this.running = false));
    },
    // a fresh fingerprint says the song is at `est` now: big jumps snap, small drift is blended in
    correct(est) {
      const d = est - this.pos();
      this.set(Math.abs(d) > 1000 ? est : this.pos() + 0.7 * d);
    },
  };

  let want = '',
    song = null, // {key}: Shazam's id for the song followed
    inflight = false,
    nextAt = 0,
    fails = 0,
    paused = false,
    gapSeen = 0,
    retryAt = 0,
    retries = 0,
    beat = 0;
  const say = m => window.notice?.(m, 4000);
  const pos = () => n.msg({ type: 'pos', pos: clock.pos(), playing: clock.running });

  function tick() {
    if (!ear.on || inflight) return;
    const t = now();
    const dur = song && n.dur(); // Spotify's length, once Match found the song
    if (song && (ear.silentFor() > 30 || (dur && clock.pos() > dur + 8000))) {
      song = null; // the song is over: listen for the next one
      clock.pause();
      pos();
      return;
    }
    // quiet: hold the words; sound coming back is a resume, a seek or a new song
    if (ear.silentFor() > 1.6) {
      if (song && clock.running) {
        clock.pause();
        paused = true;
        pos();
      }
      return;
    }
    if (paused && ear.audibleFor() > 0) {
      paused = false;
      clock.play();
      nextAt = t + 3000;
      pos();
    }
    if (ear.lastGap !== gapSeen) {
      gapSeen = ear.lastGap;
      if (song) nextAt = Math.min(nextAt, t + 3500); // a short gap: check sooner
    }
    if (t < nextAt) return;
    const heard = ear.audibleFor();
    if (!song) heard >= 4.5 && identify(Math.min(10, Math.max(5, heard)));
    else if (heard >= 3.2) identify(Math.min(6, heard));
  }

  async function identify(sec) {
    inflight = true;
    const { pcm, start } = ear.clip(sec);
    let r;
    try {
      r = await fetch(SERVER, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(window.Account?.headers() ?? {}) },
        body: JSON.stringify(Sig.make(pcm)),
      }).then(x => x.json());
      if (r.error) throw new Error(r.error);
    } catch (e) {
      inflight = false;
      fails++;
      nextAt = now() + 6000;
      if (fails === 1) say(`Couldn't ask Shazam: ${e.message || e}`);
      return;
    }
    inflight = false;
    if (!ear.on) return;
    if (!r.found) {
      fails++;
      nextAt = now() + Math.min(2500 * (1 + fails), 12000);
      if (!song && fails === 3) say("Still can't name it - turn the music up or move closer");
      return;
    }
    fails = 0;
    const est = r.offset * 1000 + (now() - start); // where the song is right now
    if (song?.key === r.key) {
      clock.correct(est);
      nextAt = now() + 10000;
      pos();
      return;
    }
    // While following a song, another one has to be named twice in a row: Shazam can name a remix on one check and
    // the original on the next (same chorus), which restarted the song each time.
    if (song && song.maybe !== r.key) {
      song.maybe = r.key;
      nextAt = now() + 3000;
      return;
    }
    song = { key: r.key };
    clock.set(est);
    clock.play();
    nextAt = now() + 8000;
    n.msg({
      type: 'track',
      id: 'sz' + r.key,
      title: r.title,
      artist: r.artist,
      a1: r.artist.split(/,|&| feat\.| x /)[0].trim(),
      album: r.album,
      isrc: r.isrc,
      art: r.art,
      appName: 'Listening',
    });
    pos();
  }

  // never stop on its own: take the mic back after a call, wake audio the browser put to sleep
  async function keepAlive() {
    if (!want) return;
    if (ear.on && ear.ctx?.state === 'suspended') return void ear.ctx.resume().catch(() => {});
    const live = ear.on && ear.stream?.getAudioTracks().some(t => t.readyState === 'live');
    if (live && now() - ear.lastWall < 5000) return void (retries = 0);
    if (want === 'tab') return void (live || stop('Sharing stopped'));
    if (now() < retryAt) return;
    try {
      await ear.start('mic');
      retries = 0;
    } catch (e) {
      if (/NotAllowed|Security/.test(e?.name) && document.visibilityState === 'visible')
        stop('LyricDock can no longer use the microphone - allow it, then Listen again');
      else retryAt = now() + Math.min(30000, 1500 * 2 ** ++retries);
    }
  }
  setInterval(keepAlive, 2000);

  async function start() {
    const kind = Settings.S.listenFrom === 'tab' && navigator.mediaDevices?.getDisplayMedia ? 'tab' : 'mic';
    try {
      await ear.start(kind);
    } catch (e) {
      ear.stop();
      say(
        /NotAllowed|Security/.test(e?.name)
          ? kind === 'mic'
            ? 'LyricDock needs the microphone to listen - allow it and try again'
            : 'LyricDock was not allowed to hear the tab'
          : `Couldn't start listening: ${e.message || e}`,
      );
      return false;
    }
    want = kind;
    // a source picked by hand would keep the screen: tapping Listen is a choice too, undone by Stop
    if (!['auto', 'listen'].includes(Settings.S.source)) {
      before = Settings.S.source;
      Settings.set('source', 'listen', false);
    }
    song = null;
    fails = retries = 0;
    nextAt = 0;
    clearInterval(beat);
    beat = setInterval(() => song && pos(), 1000); // the beat the screen's clock follows
    say(kind === 'tab' ? 'Listening to the shared sound…' : 'Listening… keep the music playing');
    return true;
  }

  let before = null; // the source picked by hand before Listen took the screen
  function stop(msg) {
    want = '';
    song = null;
    if (before && Settings.S.source === 'listen') Settings.set('source', before, false);
    before = null;
    ear.stop();
    clearInterval(beat);
    clock.pause();
    pos();
    if (msg) say(msg);
  }

  return {
    available: () => !!navigator.mediaDevices?.getUserMedia && !!window.AudioContext,
    listen: start,
    stop: () => stop(),
    listening: () => !!want,
    app: n.app,
    onMessage: n.onMessage,
  };
})();
window.Listen = Listen;
