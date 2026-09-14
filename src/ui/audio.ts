import type { Ball, TableEvent } from '../simulation/types';

const FILES = { ball: ['clack-1'], cue: ['cue-1', 'cue-2', 'cue-3'], pocket: ['pocket-1', 'pocket-2', 'pocket-3'] };
export class TableAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private roomSend: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private voices = 0;
  private lastVariant = new Map<string, number>();
  private rolling: { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode } | null = null;
  private _enabled = true;
  private _volume = 0.65;
  private readonly ambience = 0.18;
  private eventCount = 0;
  private effectVoices = 0;
  get enabled() {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    this.syncGain();
  }
  get volume() {
    return this._volume;
  }
  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
    this.syncGain();
  }
  private syncGain() {
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, 0.025);
  }
  async prepare() {
    if (this.loading) return this.loading;
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 5;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.82;
    this.dry.connect(this.master);
    this.roomSend = ctx.createGain();
    this.roomSend.gain.value = 0.12;
    const room = ctx.createConvolver(),
      impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 0.42), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      let filtered = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        filtered = filtered * 0.64 + (Math.random() * 2 - 1) * 0.36;
        data[i] = filtered * Math.exp(-t * 15) * 0.11 * (t > 0.022 ? 1 : 0);
      }
      for (const [t, g] of [
        [0.023, 0.18],
        [0.049, 0.12],
        [0.083, 0.08],
      ])
        data[Math.floor((t + c * 0.003) * ctx.sampleRate)] += g;
    }
    room.buffer = impulse;
    this.roomSend.connect(room);
    room.connect(this.master);
    this.loading = Promise.all(
      Object.values(FILES)
        .flat()
        .map(async (name) => {
          const response = await fetch(`audio/${name}.wav`);
          if (!response.ok) throw new Error(`Audio unavailable: ${name}`);
          this.buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
        }),
    )
      .then(() => {
        this.createRollingBed();
      })
      .catch((error) => {
        console.warn('Table audio could not load:', error);
      });
    return this.loading;
  }
  unlock(): Promise<void> {
    const prepared = this.prepare();
    // Resume while the initiating pointer/keyboard gesture is still active.
    const resumed = this.enabled && this.context?.state === 'suspended' ? this.context.resume() : Promise.resolve();
    return Promise.all([prepared, resumed]).then(() => undefined);
  }

  private createRollingBed() {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
      data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      low = 0.94 * low + 0.06 * (Math.random() * 2 - 1);
      data[i] = low * 0.3;
    }
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain(),
      pan = ctx.createStereoPanner();
    source.buffer = buffer;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 780;
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.master!);
    source.start();
    this.rolling = { source, gain, pan };
  }
  updateRolling(balls: Ball[]) {
    if (!this.context || !this.rolling) return;
    let energy = 0,
      position = 0;
    for (const b of balls)
      if (!b.pocketed && !b.airborne) {
        const speed = Math.hypot(b.vx, b.vz);
        energy += speed;
        position += b.x * speed;
      }
    const level = Math.min(0.17, energy * 0.004) * this.ambience;
    this.rolling.gain.gain.setTargetAtTime(this.enabled ? level : 0, this.context.currentTime, 0.08);
    this.rolling.pan.pan.setTargetAtTime(
      energy ? Math.max(-0.7, Math.min(0.7, position / energy / 6)) : 0,
      this.context.currentTime,
      0.1,
    );
  }
  play(event: TableEvent, delay = 0) {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running' || this.voices >= 28 || event.strength < 0.012) return;
    if (event.kind === 'chalk' || event.kind === 'coin') {
      this.playMechanism(event.kind, delay);
      return;
    }
    if (event.kind === 'expire' || event.kind === 'jump') return;
    if (['power', 'pickup', 'status', 'hazard', 'spawn'].includes(event.kind)) {
      this.playEffect(event, delay);
      return;
    }
    const category = event.kind === 'cue' ? 'cue' : event.kind === 'pocket' ? 'pocket' : 'ball';
    const choices = FILES[category];
    let pick = Math.floor(Math.random() * choices.length);
    if (choices.length > 1 && pick === this.lastVariant.get(category)) pick = (pick + 1) % choices.length;
    this.lastVariant.set(category, pick);
    const buffer = this.buffers.get(choices[pick]);
    if (!buffer) return;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      filter = ctx.createBiquadFilter(),
      pan = ctx.createStereoPanner();
    source.buffer = buffer;
    const soft = event.kind === 'cushion' || event.kind === 'land' || event.kind === 'out',
      obstacle = event.kind === 'obstacle';
    source.playbackRate.value = (soft ? 0.72 : obstacle ? 0.62 : 1) * (1 + (Math.random() - 0.5) * 0.045);
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = soft ? 1300 : obstacle ? 2400 : 6500 + event.strength * 10500;
    const distance = 1 - Math.max(0, -event.z) * 0.035;
    gain.gain.value =
      Math.pow(event.strength, 0.62) * (soft ? 0.56 : obstacle ? 0.82 : category === 'pocket' ? 0.68 : 0.85) * distance;
    pan.pan.value = Math.max(-0.8, Math.min(0.8, event.x / 7.1));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.dry!);
    pan.connect(this.roomSend!);
    this.voices++;
    this.eventCount++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
    source.start(ctx.currentTime + delay + (category === 'pocket' ? 0.075 : 0));
    if (event.kind === 'obstacle' && event.destroyed)
      for (let i = 0; i < 3; i++)
        this.play({ ...event, kind: 'ball', strength: event.strength * (0.2 - i * 0.04) }, delay + 0.04 + i * 0.037);
  }
  playMechanism(kind: 'coin' | 'chalk', delay = 0) {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running' || this.voices >= 28) return;
    const duration = kind === 'chalk' ? 0.62 : 1.18;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate),
      samples = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / ctx.sampleRate,
        noise = Math.random() * 2 - 1;
      low = 0.78 * low + 0.22 * noise;
      if (kind === 'chalk') {
        const scrape = Math.max(0, Math.sin(t * Math.PI * 8));
        samples[i] = (noise - low) * 0.2 * scrape * Math.sin((Math.PI * t) / duration);
      } else {
        let value = 0;
        // Inharmonic metal partials, followed by the spring-loaded drawer and latch.
        for (const [start, amp] of [
          [0.02, 0.25],
          [0.14, 0.17],
          [0.22, 0.1],
          [0.38, 0.07],
        ]) {
          const age = t - start;
          if (age >= 0)
            value +=
              amp *
              Math.exp(-age * 26) *
              (Math.sin(age * 2 * Math.PI * 2180) + 0.5 * Math.sin(age * 2 * Math.PI * 3511));
        }
        for (const start of [0.43, 0.82, 1.04]) {
          const age = t - start;
          if (age >= 0 && age < 0.13)
            value += Math.exp(-age * 40) * (low * 0.7 + Math.sin(age * 2 * Math.PI * 126) * 0.17);
        }
        if (t > 0.46 && t < 0.82) value += low * 0.12 * Math.sin(((t - 0.46) / 0.36) * Math.PI);
        samples[i] = value;
      }
    }
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      pan = ctx.createStereoPanner();
    source.buffer = buffer;
    gain.gain.value = kind === 'coin' ? 0.55 : 0.45;
    pan.pan.value = kind === 'coin' ? 0.25 : -0.15;
    source.connect(gain);
    gain.connect(pan);
    pan.connect(this.dry!);
    pan.connect(this.roomSend!);
    this.voices++;
    this.eventCount++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
    source.start(ctx.currentTime + delay);
    if (kind === 'coin')
      for (let i = 0; i < 5; i++)
        this.play(
          { kind: 'ball', strength: 0.16 + i * 0.018, x: 2 - i * 0.6, z: 3, time: 0 },
          delay + 0.63 + i * 0.077,
        );
  }
  private playEffect(event: TableEvent, delay: number) {
    const ctx = this.context!;
    if (this.effectVoices >= 8) return;
    const kind = event.hazard || event.status || event.power || 'pickup';
    const duration = kind === 'portal' ? 0.42 : kind === 'smoke' ? 0.4 : kind === 'electric' ? 0.16 : 0.25;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate),
      data = buffer.getChannelData(0);
    const chime =
      event.kind === 'pickup' || event.kind === 'status' || event.kind === 'power' || event.kind === 'spawn';
    let phase = 0,
      low = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      low = 0.82 * low + 0.18 * (Math.random() * 2 - 1);
      phase += (2 * Math.PI * (chime ? 430 + 620 * t : 140 + 160 * t)) / ctx.sampleRate;
      const grain = kind === 'electric' ? (Math.random() * 2 - 1) * (Math.sin(t * 94) > 0.15 ? 1 : 0.13) : low;
      data[i] =
        (chime ? Math.sin(phase) * 0.35 + low * 0.3 : grain) *
        Math.sin(Math.PI * Math.min(1, t * 9)) *
        Math.pow(1 - t, 2);
    }
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain(),
      pan = ctx.createStereoPanner();
    source.buffer = buffer;
    filter.type = kind === 'electric' ? 'highpass' : 'lowpass';
    filter.frequency.value = kind === 'slime' ? 600 : kind === 'water' ? 1500 : kind === 'smoke' ? 800 : 2800;
    gain.gain.value =
      (event.kind === 'spawn' ? 0.045 : kind === 'electric' ? 0.075 : chime ? 0.15 : 0.2) * event.strength;
    pan.pan.value = Math.max(-0.8, Math.min(0.8, event.x / 7.1));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.dry!);
    pan.connect(this.roomSend!);
    this.voices++;
    this.effectVoices++;
    this.eventCount++;
    source.onended = () => {
      this.voices--;
      this.effectVoices--;
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
    source.start(ctx.currentTime + delay);
  }
  preview() {
    this.unlock();
    void this.loading?.then(() => {
      for (const [i, kind] of ['cue', 'ball', 'cushion', 'pocket'].entries())
        this.play({ kind: kind as TableEvent['kind'], strength: 0.65, x: (i - 1.5) * 2, z: 0, time: 0 }, i * 0.65);
    });
  }
  diagnostics() {
    return {
      state: this.context?.state || 'uninitialized',
      loaded: this.buffers.size,
      voices: this.voices,
      events: this.eventCount,
      enabled: this.enabled,
      volume: this.volume,
    };
  }
}
