import { describe, it, expect, vi } from 'vitest';
import { AudioService, STATIONS, isAudioFile } from '../src/desktop/audio.js';

// A WebAudio stand-in that THROWS on any invalid parameter, so scheduling bugs cannot hide.
function fakeCtx() {
  const log = { nodes: 0, starts: 0, ramps: 0 };
  const chk = (v, t) => { if (!Number.isFinite(v)) throw new Error(`non-finite value ${v}`); if (t !== undefined && (!Number.isFinite(t) || t < 0)) throw new Error(`bad time ${t}`); };
  const param = () => ({
    setValueAtTime: (v, t) => chk(v, t),
    linearRampToValueAtTime: (v, t) => { chk(v, t); log.ramps++; },
    exponentialRampToValueAtTime: (v, t) => { chk(v, t); if (v <= 0) throw new Error('exp ramp to <=0'); log.ramps++; },
    setTargetAtTime: (v, t, tc) => { chk(v, t); if (!(tc > 0)) throw new Error(`bad time constant ${tc}`); },
  });
  const node = (extra = {}) => { log.nodes++; return { connect: (n) => n, disconnect() {}, ...extra }; };
  return {
    log, currentTime: 0, sampleRate: 8000, destination: node(), state: 'suspended',
    resume: async function () { this.state = 'running'; }, suspend: async function () { this.state = 'suspended'; }, close() {},
    createGain: () => node({ gain: param() }),
    createOscillator: () => node({ type: '', frequency: param(), detune: param(), start: (t) => { chk(0, t); log.starts++; }, stop: (t) => chk(0, t) }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createBufferSource: () => node({ buffer: null, loop: false, start: (t, o) => { chk(0, t); chk(o ?? 0); log.starts++; }, stop: (t) => chk(0, t ?? 0) }),
    createConvolver: () => node({ buffer: null }),
    createDynamicsCompressor: () => node(),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}
function setup(opts = {}) {
  const ctx = fakeCtx();
  let timer = null;
  const el = { src: '', volume: 1, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute() { this.src = ''; }, onended: null, onerror: null };
  const svc = new AudioService({
    readBytes: () => new Uint8Array([1, 2, 3]), volume: 40, random: (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(),
    createContext: () => ctx, createAudio: () => el, setTimer: (fn) => { timer = fn; return 1; }, clearTimer: () => { timer = null; },
    urlFor: () => 'blob:fake', revoke: vi.fn(), ...opts,
  });
  return { svc, ctx, el, tick: (secs) => { for (let t = 0; t < secs; t += 0.25) { ctx.currentTime += 0.25; timer?.(); } }, timerActive: () => timer !== null };
}

describe('generative stations', () => {
  for (const st of STATIONS) {
    it(`${st.name}: plays for 3 simulated minutes with only valid audio parameters`, async () => {
      const { svc, ctx, tick } = setup();
      expect(await svc.play({ type: 'gen', id: st.id })).toBe(true);
      expect(svc.info()).toMatchObject({ playing: true, title: st.name, error: null });
      tick(180);
      expect(ctx.log.starts).toBeGreaterThan(20); // it really scheduled sound
      await svc.stop();
    });
  }
  it('stopping clears the scheduler timer and cuts the station off', async () => {
    const { svc, timerActive } = setup();
    await svc.play({ type: 'gen', id: 'lofi' });
    expect(timerActive()).toBe(true);
    await svc.stop();
    expect(timerActive()).toBe(false);
    expect(svc.info()).toMatchObject({ playing: false, source: null });
  });
  it('pause/resume use the context clock; toggle starts a default station when idle', async () => {
    const { svc, ctx } = setup();
    await svc.toggle();
    expect(svc.info().playing).toBe(true);
    await svc.pause();
    expect(ctx.state).toBe('suspended');
    expect(svc.info().playing).toBe(false);
    await svc.toggle();
    expect(ctx.state).toBe('running');
    expect(svc.info().playing).toBe(true);
  });
  it('next/prev cycle through the stations', async () => {
    const { svc } = setup();
    await svc.play({ type: 'gen', id: STATIONS[0].id });
    await svc.next();
    expect(svc.info().title).toBe(STATIONS[1].name);
    await svc.prev(); await svc.prev();
    expect(svc.info().title).toBe(STATIONS[STATIONS.length - 1].name);
  });
  it('unknown station reports an error instead of throwing', async () => {
    const { svc } = setup();
    expect(await svc.play({ type: 'gen', id: 'nope' })).toBe(false);
    expect(svc.info().error).toMatch(/Không có đài/);
  });
  it('volume is clamped and applied; listeners are notified and can unsubscribe', async () => {
    const { svc } = setup();
    const seen = [];
    const off = svc.on((i) => seen.push(i.volume));
    await svc.play({ type: 'gen', id: 'rain' });
    svc.setVolume(250); svc.setVolume(-5);
    expect(svc.info().volume).toBe(0);
    off(); svc.setVolume(30);
    expect(seen).toContain(100);
    expect(seen).not.toContain(30);
  });
});

describe('files and streams', () => {
  it('plays an audio file from the virtual disk and goes to the next queued file when it ends', async () => {
    const { svc, el } = setup();
    svc.setQueue(['/m/a.mp3', '/m/b.ogg']);
    expect(await svc.play({ type: 'file', path: '/m/a.mp3' })).toBe(true);
    expect(el.src).toBe('blob:fake');
    expect(svc.info().title).toBe('a.mp3');
    el.onended();
    await vi.waitFor(() => expect(svc.info().title).toBe('b.ogg'));
    el.onended();
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.info().playing).toBe(false); // end of queue
  });
  it('rejects unsupported files and bad URLs with a message', async () => {
    const { svc } = setup();
    expect(await svc.play({ type: 'file', path: '/m/doc.txt' })).toBe(false);
    expect(svc.info().error).toMatch(/không hỗ trợ/);
    expect(await svc.play({ type: 'url', url: 'javascript:alert(1)' })).toBe(false);
    expect(svc.info().error).toMatch(/http/);
    expect(await svc.play({ type: 'url', url: 'not a url' })).toBe(false);
  });
  it('autoplay blocked by the browser becomes an error, not an exception', async () => {
    const { svc, el } = setup();
    el.play = vi.fn(async () => { throw new Error('NotAllowedError'); });
    expect(await svc.play({ type: 'url', url: 'https://example.com/radio.mp3' })).toBe(false);
    expect(svc.info().error).toBe('NotAllowedError');
  });
  it('plays a stream url and frees the previous blob url when switching', async () => {
    const { svc, el } = setup();
    await svc.play({ type: 'file', path: '/m/a.mp3' });
    await svc.play({ type: 'url', url: 'https://example.com/live.mp3' });
    expect(svc.revoke).toHaveBeenCalledWith('blob:fake');
    expect(el.src).toBe('https://example.com/live.mp3');
  });
  it('isAudioFile', () => {
    expect(['a.MP3', 'x.m4a', 'y.wav', 'z.flac'].every(isAudioFile)).toBe(true);
    expect(['a.txt', 'mp3', 'a.exe'].some(isAudioFile)).toBe(false);
  });
});
