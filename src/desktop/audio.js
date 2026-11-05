// System audio service: generative background music (WebAudio, no assets), plus playback of
// audio files stored on the virtual disk and of http(s) streams. Lives in the desktop, not in a window,
// so music keeps playing while apps are opened and closed.

export const STATIONS = [
  { id: 'ambient', name: 'Ambient Void', desc: 'Pad êm và chuông nhẹ' },
  { id: 'lofi', name: 'Lo-fi Chill', desc: 'Piano điện, trống nhẹ, tiếng đĩa than' },
  { id: 'piano', name: 'Piano đêm', desc: 'Vài nốt piano thưa trong không gian rộng' },
  { id: 'rain', name: 'Mưa đêm', desc: 'Tiếng mưa và sấm xa' },
];
export const AUDIO_EXT = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' };
export const extOf = (p) => { const base = p.split('/').pop(); const i = base.lastIndexOf('.'); return i > 0 ? base.slice(i + 1).toLowerCase() : ''; };
export const isAudioFile = (p) => Object.prototype.hasOwnProperty.call(AUDIO_EXT, extOf(p));

const LOOKAHEAD = 1.6;
const TICK_MS = 250;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length];
const between = (rand, a, b) => a + rand() * (b - a);

// ---- tiny synth on top of an AudioContext ----
function makeVoice(ctx, dest, rand) {
  let noiseBuf = null;
  const noiseBuffer = () => {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    }
    return noiseBuf;
  };
  const env = (g, t, peak, attack, hold, release) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack + Math.max(0, hold), Math.max(0.01, release / 3));
  };
  return {
    tone(freq, t, hold, { type = 'sine', gain = 0.1, attack = 0.01, release = 0.5, lp = 0, detune = 0 } = {}) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (detune) o.detune.setValueAtTime(detune, t);
      const g = ctx.createGain();
      env(g, t, gain, attack, hold, release);
      let n = o;
      if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); o.connect(f); n = f; }
      n.connect(g); g.connect(dest);
      o.start(t); o.stop(t + attack + hold + release + 0.3);
    },
    kick(t, gain = 0.5) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ctx.createGain(); env(g, t, gain, 0.002, 0.04, 0.2);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.4);
    },
    noise(t, hold, { filter = 'bandpass', freq = 2000, q = 1, gain = 0.05, attack = 0.002, release = 0.05, loop = false } = {}) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.setValueAtTime(q, t);
      const g = ctx.createGain(); env(g, t, gain, attack, hold, release);
      s.connect(f); f.connect(g); g.connect(dest);
      s.start(t, rand() * 1.5); s.stop(t + attack + hold + release + 0.3);
      return s;
    },
    drone(t, { filter = 'lowpass', freq = 1200, gain = 0.08 } = {}) { // endless noise bed; returns stop()
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 1.5);
      s.connect(f); f.connect(g); g.connect(dest); s.start(t, rand() * 1.5);
      return () => { try { s.stop(); } catch { /* already stopped */ } };
    },
  };
}

// ---- stations: { start(t), tick(until), stop() } ----
const STATION_FACTORIES = {
  ambient(v, rand) {
    const chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
    const bells = [69, 72, 74, 76, 79, 81];
    let nextChord = 0, nextBell = 0, i = 0;
    return {
      start(t) { nextChord = t; nextBell = t + 2; },
      tick(until) {
        while (nextChord < until) {
          for (const n of chords[i % chords.length]) for (const d of [-7, 7]) v.tone(midi(n), nextChord, 6, { type: 'triangle', gain: 0.028, attack: 3, release: 4, lp: 900, detune: d });
          nextChord += 8; i++;
        }
        while (nextBell < until) {
          const f = midi(pick(rand, bells));
          v.tone(f, nextBell, 0.04, { gain: 0.05, attack: 0.005, release: 2.8 });
          v.tone(f * 2.01, nextBell, 0.02, { gain: 0.015, attack: 0.005, release: 1.6 });
          nextBell += between(rand, 1.8, 4.5);
        }
      },
      stop() {},
    };
  },
  lofi(v, rand) {
    const beat = 60 / 72, bar = beat * 4;
    const chords = [[48, 52, 55, 59], [45, 48, 52, 55], [50, 53, 57, 60], [43, 47, 50, 53]];
    let next = 0, i = 0, stopHiss = null, nextCrackle = 0;
    return {
      start(t) { next = t + 0.05; nextCrackle = t; stopHiss = v.drone(t, { filter: 'highpass', freq: 5500, gain: 0.004 }); },
      tick(until) {
        while (next < until) {
          const c = chords[i % chords.length], t = next;
          c.forEach((n, k) => v.tone(midi(n + 12), t + k * 0.018, 1.5, { type: 'triangle', gain: 0.04, attack: 0.008, release: 0.9, lp: 1800 }));
          if (rand() < 0.6) c.slice(1).forEach((n, k) => v.tone(midi(n + 12), t + beat * 2.5 + k * 0.015, 0.8, { type: 'triangle', gain: 0.025, attack: 0.008, release: 0.7, lp: 1600 }));
          for (const b of [0, 2]) v.tone(midi(c[0] - 12), t + b * beat, 0.6, { gain: 0.12, attack: 0.01, release: 0.3 });
          for (const b of [0, 2]) v.kick(t + b * beat, 0.5);
          for (const b of [1, 3]) v.noise(t + b * beat, 0.08, { freq: 1800, q: 0.8, gain: 0.07, release: 0.1 });
          for (let h = 0; h < 8; h++) v.noise(t + h * beat / 2 + (h % 2 ? beat * 0.06 : 0), 0.02, { filter: 'highpass', freq: 7000, gain: 0.018 + rand() * 0.012, release: 0.03 });
          next += bar; i++;
        }
        while (nextCrackle < until) { v.noise(nextCrackle, 0.008, { freq: 3000, q: 0.5, gain: 0.015 + rand() * 0.02, release: 0.01 }); nextCrackle += between(rand, 0.15, 1.2); }
      },
      stop() { stopHiss?.(); },
    };
  },
  piano(v, rand) {
    const scale = [60, 62, 64, 67, 69, 72, 74, 76];
    let next = 0;
    const note = (n, t, g) => {
      const f = midi(n);
      v.tone(f, t, 0.02, { type: 'triangle', gain: g, attack: 0.004, release: 3, lp: 2500 });
      v.tone(f * 2, t, 0.01, { gain: g * 0.3, attack: 0.003, release: 1.4 });
    };
    return {
      start(t) { next = t + 0.3; },
      tick(until) {
        while (next < until) {
          const n = pick(rand, scale);
          note(n, next, 0.07);
          if (rand() < 0.25) note(n - 7, next + 0.02, 0.04);
          next += between(rand, 0.7, 2.6);
        }
      },
      stop() {},
    };
  },
  rain(v, rand) {
    const stops = [];
    let nextDrop = 0, nextThunder = 0;
    return {
      start(t) {
        stops.push(v.drone(t, { filter: 'lowpass', freq: 650, gain: 0.1 }), v.drone(t, { filter: 'bandpass', freq: 3500, gain: 0.03 }));
        nextDrop = t; nextThunder = t + between(rand, 20, 40);
      },
      tick(until) {
        while (nextDrop < until) { v.noise(nextDrop, 0.015, { freq: between(rand, 2500, 6000), q: 2, gain: between(rand, 0.015, 0.05), release: 0.02 }); nextDrop += between(rand, 0.04, 0.22); }
        while (nextThunder < until) { v.noise(nextThunder, 3, { filter: 'lowpass', freq: 140, gain: 0.28, attack: 1.5, release: 4 }); nextThunder += between(rand, 40, 90); }
      },
      stop() { for (const s of stops) s(); },
    };
  },
};

export class AudioService {
  constructor({
    readBytes, volume = 40, random = Math.random,
    createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
    createAudio = () => new Audio(),
    setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (id) => clearInterval(id),
    urlFor = (bytes, mime) => URL.createObjectURL(new Blob([bytes], { type: mime })), revoke = (u) => URL.revokeObjectURL(u),
  }) {
    Object.assign(this, { readBytes, random, createContext, createAudio, setTimer, clearTimer, urlFor, revoke });
    this.volume = clamp01(volume / 100);
    this.source = null; this.playing = false; this.title = ''; this.error = null; this.queue = [];
    this.listeners = new Set();
    this.ctx = null; this.master = null; this.reverb = null; this.session = null; this.el = null; this.blobUrl = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  info() { return { playing: this.playing, source: this.source, title: this.title, error: this.error, volume: Math.round(this.volume * 100) }; }
  _emit() { for (const fn of [...this.listeners]) { try { fn(this.info()); } catch (e) { console.error(e); } } }

  _graph() {
    if (this.master) return;
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.setValueAtTime(this.volume, ctx.currentTime);
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (this.random() * 2 - 1) * (1 - i / len) ** 2.6; }
    this.reverb.buffer = buf;
    const wet = ctx.createGain(); wet.gain.setValueAtTime(0.38, ctx.currentTime);
    this.reverb.connect(wet); wet.connect(this.master);
  }

  _teardown() {
    const s = this.session;
    if (s) {
      this.clearTimer(s.timer);
      s.station.stop();
      const now = this.ctx.currentTime;
      s.bus.gain.setTargetAtTime(0.0001, now, 0.05); // fade out so cutting a station never clicks
      setTimeout(() => { try { s.bus.disconnect(); } catch { /* gone */ } }, 500);
      this.session = null;
    }
    if (this.el) { this.el.pause(); this.el.onended = null; this.el.onerror = null; this.el.removeAttribute('src'); }
    if (this.blobUrl) { this.revoke(this.blobUrl); this.blobUrl = null; }
  }

  async play(source) {
    this._teardown();
    this.error = null; this.source = source; this.playing = false;
    try {
      if (source.type === 'gen') await this._playGen(source);
      else if (source.type === 'file') await this._playFile(source);
      else if (source.type === 'url') await this._playUrl(source);
      else throw new Error('Nguồn nhạc không hợp lệ');
    } catch (e) { this.error = e.message ?? String(e); this.playing = false; }
    this._emit();
    return this.playing;
  }

  async _playGen({ id }) {
    const make = STATION_FACTORIES[id];
    if (!make) throw new Error('Không có đài này');
    this.ctx ??= this.createContext();
    await this.ctx.resume?.();
    this._graph();
    const ctx = this.ctx, bus = ctx.createGain();
    bus.gain.setValueAtTime(1, ctx.currentTime);
    const dry = ctx.createGain(); dry.gain.setValueAtTime(0.8, ctx.currentTime);
    bus.connect(dry); dry.connect(this.master); bus.connect(this.reverb);
    const station = make(makeVoice(ctx, bus, this.random), this.random);
    station.start(ctx.currentTime + 0.05);
    station.tick(ctx.currentTime + LOOKAHEAD);
    const timer = this.setTimer(() => station.tick(ctx.currentTime + LOOKAHEAD), TICK_MS);
    this.session = { station, bus, timer };
    this.title = STATIONS.find((s) => s.id === id).name;
    this.playing = true;
  }

  _audioEl() {
    if (!this.el) this.el = this.createAudio();
    this.el.volume = this.volume;
    this.el.onended = () => this.next(true);
    this.el.onerror = () => { this.error = 'Không phát được (định dạng không hỗ trợ?)'; this.playing = false; this._emit(); };
    return this.el;
  }

  async _playFile({ path }) {
    if (!isAudioFile(path)) throw new Error('Định dạng âm thanh không hỗ trợ');
    this.blobUrl = this.urlFor(this.readBytes(path), AUDIO_EXT[extOf(path)]);
    this.title = path.split('/').pop();
    const el = this._audioEl(); el.src = this.blobUrl;
    await el.play();
    this.playing = true;
  }

  async _playUrl({ url }) {
    let u;
    try { u = new URL(url); } catch { throw new Error('URL không hợp lệ'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Chỉ phát được http(s)');
    this.title = u.hostname;
    const el = this._audioEl(); el.src = u.href;
    await el.play();
    this.playing = true;
  }

  async pause() {
    if (!this.playing) return;
    if (this.source.type === 'gen') await this.ctx.suspend?.(); else this.el.pause();
    this.playing = false; this._emit();
  }

  async resume() {
    if (this.playing || !this.source || this.error) return;
    try {
      if (this.source.type === 'gen') await this.ctx.resume?.(); else await this.el.play();
      this.playing = true;
    } catch (e) { this.error = e.message; }
    this._emit();
  }

  async toggle(fallback = { type: 'gen', id: STATIONS[0].id }) {
    if (this.playing) await this.pause();
    else if (this.source && !this.error) await this.resume();
    else await this.play(fallback);
  }

  async stop() { this._teardown(); this.source = null; this.playing = false; this.title = ''; this._emit(); }

  setQueue(paths) { this.queue = [...paths]; }

  async next(auto = false, step = 1) {
    const s = this.source;
    if (!s) return;
    if (s.type === 'gen') {
      const i = STATIONS.findIndex((x) => x.id === s.id);
      await this.play({ type: 'gen', id: STATIONS[(i + step + STATIONS.length) % STATIONS.length].id });
    } else if (s.type === 'file') {
      const i = this.queue.indexOf(s.path), j = i + step;
      if (i >= 0 && j >= 0 && j < this.queue.length) await this.play({ type: 'file', path: this.queue[j] });
      else if (auto) { this.playing = false; this._emit(); }
    }
  }

  prev() { return this.next(false, -1); }

  setVolume(v) {
    this.volume = clamp01(v / 100);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    if (this.el) this.el.volume = this.volume;
    this._emit();
  }

  dispose() { this._teardown(); this.listeners.clear(); try { this.ctx?.close?.(); } catch { /* ignore */ } }
}
