export type RenderQuality = 'auto' | 'performance' | 'high' | 'veryHigh' | 'ultra';
export type AdaptiveTier = 'refined' | 'balanced' | 'fast' | 'light' | 'minimum';

export interface RenderBudget {
  readonly tier: AdaptiveTier | 'performance' | 'high' | 'veryHigh' | 'ultra';
  readonly maxDpr: number;
  readonly pixels: number;
  readonly bloom: boolean;
  readonly shadowLights: 1 | 3;
  readonly shadowSize: number;
  readonly reflectionSize: 128 | 256;
  /** Real refraction through the pub glassware. Off below the top tiers: it costs a full
   * scene-colour pass every frame, where alpha glass costs nothing. */
  readonly glassTransmission: boolean;
  /** Pixel budget while the camera is moving, as a fraction of `pixels`. A moving camera hides the
   * resolution drop. Very High keeps this at 1 to preserve native 1440p during an orbit. */
  readonly motionPixelScale: number;
}

const AUTO_BUDGETS: readonly RenderBudget[] = [
  {
    tier: 'refined',
    maxDpr: 1.25,
    pixels: 1920 * 1080,
    bloom: true,
    shadowLights: 3,
    shadowSize: 1024,
    reflectionSize: 128,
    glassTransmission: false,
    motionPixelScale: 0.8,
  },
  {
    tier: 'balanced',
    maxDpr: 1.25,
    pixels: 1920 * 1080,
    bloom: false,
    shadowLights: 3,
    shadowSize: 1024,
    reflectionSize: 128,
    glassTransmission: false,
    motionPixelScale: 0.8,
  },
  {
    tier: 'fast',
    maxDpr: 1.25,
    pixels: 1920 * 1080,
    bloom: false,
    shadowLights: 1,
    shadowSize: 768,
    reflectionSize: 128,
    glassTransmission: false,
    motionPixelScale: 0.8,
  },
  {
    tier: 'light',
    maxDpr: 1,
    pixels: 1600 * 900,
    bloom: false,
    shadowLights: 1,
    shadowSize: 512,
    reflectionSize: 128,
    glassTransmission: false,
    motionPixelScale: 0.8,
  },
  {
    tier: 'minimum',
    maxDpr: 0.75,
    pixels: 1_048_576,
    bloom: false,
    shadowLights: 1,
    shadowSize: 512,
    reflectionSize: 128,
    glassTransmission: false,
    motionPixelScale: 0.8,
  },
];

export function graphicsBudget(quality: RenderQuality, tier = 1, mobile = false): RenderBudget {
  if (quality === 'auto') {
    const index = Math.max(mobile ? 2 : 0, Math.min(4, Number.isFinite(tier) ? Math.floor(tier) : 1));
    const budget = AUTO_BUDGETS[index];
    return mobile
      ? { ...budget, maxDpr: [1, 0.85, 0.7][index - 2], pixels: [2_073_600, 1_474_560, 1_048_576][index - 2] }
      : budget;
  }
  if (quality === 'performance')
    return {
      tier: quality,
      maxDpr: 1,
      pixels: 1600 * 900,
      bloom: false,
      shadowLights: 1,
      shadowSize: 512,
      reflectionSize: 128,
      glassTransmission: false,
      motionPixelScale: 1,
    };
  if (quality === 'ultra')
    return {
      tier: quality,
      maxDpr: 3,
      pixels: 8_294_400,
      bloom: true,
      shadowLights: 3,
      shadowSize: 2048,
      reflectionSize: 256,
      glassTransmission: true,
      motionPixelScale: 0.7,
    };
  // Native 1440p even in motion. Alpha glass avoids an extra scene pass; bloom's own
  // targets are reduced independently without downscaling the table or labels.
  if (quality === 'veryHigh')
    return {
      tier: quality,
      maxDpr: 2,
      pixels: 2560 * 1440,
      bloom: true,
      shadowLights: 3,
      shadowSize: 1024,
      reflectionSize: 256,
      glassTransmission: false,
      motionPixelScale: 1,
    };
  return {
    tier: quality,
    maxDpr: 1.5,
    pixels: 1920 * 1080,
    bloom: true,
    shadowLights: 1,
    shadowSize: 1024,
    reflectionSize: 128,
    glassTransmission: false,
    motionPixelScale: 0.85,
  };
}

/** Native density is a ceiling, never an excuse to supersample a 1× display. */
export function budgetDpr(
  budget: RenderBudget,
  width: number,
  height: number,
  deviceDpr: number,
  maxWidth = 16384,
  maxHeight = 16384,
  /** Fraction of the tier's pixel budget to spend. Below 1 while the camera moves. */
  pixelScale = 1,
): number {
  if (!(width > 0 && height > 0)) return 1;
  const native = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const pixels = budget.pixels * (Number.isFinite(pixelScale) ? Math.max(0.1, Math.min(1, pixelScale)) : 1);
  return Math.max(
    0.05,
    Math.min(native, budget.maxDpr, Math.sqrt(pixels / (width * height)), maxWidth / width, maxHeight / height),
  );
}

export interface FrameSample {
  /** Actual requestAnimationFrame interval, not a capped simulation delta. */
  frameMs: number;
  /** CPU time including scene update and draw submission. */
  cpuMs: number;
  /** Asynchronous GPU time for a previous completed render, when supported. */
  gpuMs: number | null;
  /** Asset reflection capture / resize / tab wake is not a sustained workload. */
  maintenance?: boolean;
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

/** Common display rates, clamped to 60–120 Hz; jittery rAF cadence snaps to the nearest. */
const REFRESH_RATES = [60, 75, 90, 100, 120] as const;

/** Interquartile mean of frame intervals: ignores hitches like a median, but
 * alternating 8/25 ms presentation averages to 60 Hz instead of picking a side. */
function cadenceHz(intervals: readonly number[]): number {
  const sorted = [...intervals].sort((a, b) => a - b),
    trim = sorted.length >> 2,
    middle = sorted.slice(trim, sorted.length - trim);
  // A stable 30/20 FPS GPU bottleneck must not be mistaken for a slow monitor
  // when Safari exposes no GPU timer. Assume at least 60 Hz.
  const hz = Math.max(60, (middle.length * 1000) / middle.reduce((sum, ms) => sum + ms, 0));
  return REFRESH_RATES.reduce((best, rate) => (Math.abs(rate - hz) < Math.abs(best - hz) ? rate : best));
}

/** Slow downgrades and much slower upgrades avoid quality pumping during a shot.
 * Stable 60 Hz presentation with 2 ms render cost is refresh-limited, not overload. */
export class AdaptiveRenderBudget {
  private tierIndex: number;
  private quality: RenderQuality = 'auto';
  private elapsed = 0;
  private cooldown = 3;
  private slowWindows = 0;
  private fastWindows = 0;
  private samples: FrameSample[] = [];
  private refreshHz: number = 60;
  private pendingHz = 60;
  private pendingWindows = 0;
  constructor(readonly mobile = false) {
    this.tierIndex = mobile ? 2 : 1;
  }
  get budget(): RenderBudget {
    return graphicsBudget(this.quality, this.tierIndex, this.mobile);
  }
  /** Best budget this quality can reach. Shader-structural state (shadow casters,
   * light slots) follows it so adaptive tier changes never recompile programs. */
  get ceiling(): RenderBudget {
    return graphicsBudget(this.quality, 0, this.mobile);
  }
  /** Auto follows observed refresh; manual presets expose their design target. Phones stay at 60 Hz. */
  get targetMs(): number {
    if (this.mobile || this.quality === 'veryHigh' || this.quality === 'ultra') return 1000 / 60;
    return 1000 / (this.quality === 'auto' ? this.refreshHz : 120);
  }
  setQuality(quality: RenderQuality): void {
    this.quality = quality;
    this.tierIndex = this.mobile ? 2 : 1;
    this.resetWindow(3);
  }
  resetWindow(cooldown = 2): void {
    this.samples = [];
    this.elapsed = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.cooldown = cooldown;
  }
  observe(sample: FrameSample): boolean {
    if (this.quality !== 'auto') return false;
    // Hidden documents suspend rAF, so this gap also restarts refresh detection after visibilitychange.
    if (!Number.isFinite(sample.frameMs) || sample.frameMs <= 0 || sample.frameMs > 250) {
      this.resetWindow();
      this.pendingWindows = 0;
      return false;
    }
    this.cooldown = Math.max(0, this.cooldown - sample.frameMs / 1000);
    if (sample.maintenance) return false;
    this.elapsed += sample.frameMs / 1000;
    this.samples.push(sample);
    if (this.elapsed < 1 || this.samples.length < 15) return false;
    const samples = this.samples;
    this.samples = [];
    this.elapsed = 0;
    // The refresh rate moves up or down (monitor switch) only after three windows agree.
    const cadence = cadenceHz(samples.map((frame) => frame.frameMs));
    if (cadence === this.refreshHz) this.pendingWindows = 0;
    else {
      this.pendingWindows = cadence === this.pendingHz ? this.pendingWindows + 1 : 1;
      this.pendingHz = cadence;
      if (this.pendingWindows >= 3) {
        this.refreshHz = cadence;
        this.pendingWindows = 0;
      }
    }
    // Windows that disagree with the detected rate are a transition, not a workload verdict.
    const settled = cadence === this.refreshHz,
      refreshMs = 1000 / this.refreshHz,
      target = this.targetMs;
    const cpu = percentile(
      samples.map((frame) => frame.cpuMs),
      0.75,
    );
    const gpuSamples = samples.flatMap((frame) => (frame.gpuMs === null ? [] : [frame.gpuMs]));
    const gpu = percentile(gpuSamples, 0.75);
    const frame = percentile(
      samples.map((frame) => frame.frameMs),
      0.75,
    );
    const missedRefresh = frame > refreshMs * 1.4;
    const renderCost = Math.max(cpu, gpu);
    // A 7.2 ms GPU workload left the measured 120 Hz session at ~114 FPS:
    // submission, compositing and presentation still need part of the 8.3 ms.
    const missedHighRefresh =
      !this.mobile && refreshMs <= 8.4 && frame > target * 1.055 && (!gpuSamples.length || renderCost > target * 0.7);
    const slow = settled && (renderCost > target * 0.84 || (!gpuSamples.length && missedRefresh) || missedHighRefresh);
    // Without GPU timers, do not raise quality until there is both CPU headroom
    // and an unbroken observed refresh cadence. Refresh-limited frames stay sharp.
    // Require substantial spare time before adding passes/pixels back. This
    // keeps a successful downgrade from immediately undoing its own headroom.
    const fast = settled && renderCost < target * 0.5 && frame < refreshMs * 1.12;
    if (this.cooldown > 0) {
      this.slowWindows = 0;
      this.fastWindows = 0;
      return false;
    }
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    this.fastWindows = fast ? this.fastWindows + 1 : 0;
    const minimum = this.mobile ? 2 : 0;
    if (this.slowWindows >= 2 && this.tierIndex < 4) {
      this.tierIndex++;
      this.resetWindow(4);
      return true;
    }
    if (this.fastWindows >= 10 && this.tierIndex > minimum) {
      this.tierIndex--;
      this.resetWindow(6);
      return true;
    }
    return false;
  }
}

export interface FrameStatistics {
  readonly fps: number;
  readonly frameMs: number;
  readonly p95FrameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly samples: number;
}

/** A rolling three-second window. Percentiles are calculated only when inspected. */
export class RenderFrameHistory {
  private frames: FrameSample[] = [];
  private duration = 0;
  record(sample: FrameSample): void {
    if (!Number.isFinite(sample.frameMs) || sample.frameMs <= 0 || sample.frameMs > 250) {
      this.frames = [];
      this.duration = 0;
      return;
    }
    this.frames.push(sample);
    this.duration += sample.frameMs;
    while (this.frames.length > 1 && (this.duration > 3000 || this.frames.length > 720))
      this.duration -= this.frames.shift()!.frameMs;
  }
  snapshot(): Readonly<FrameStatistics> {
    const count = this.frames.length;
    const gpu = this.frames.flatMap((frame) => (frame.gpuMs === null ? [] : [frame.gpuMs]));
    return Object.freeze({
      fps: this.duration ? (count * 1000) / this.duration : 0,
      frameMs: count ? this.duration / count : 0,
      p95FrameMs: percentile(
        this.frames.map((frame) => frame.frameMs),
        0.95,
      ),
      cpuMs: count ? this.frames.reduce((sum, frame) => sum + frame.cpuMs, 0) / count : 0,
      gpuMs: gpu.length ? gpu.reduce((sum, ms) => sum + ms, 0) / gpu.length : null,
      samples: count,
    });
  }
}

/** Compare transforms directly; visibility changes and moving child meshes count. */
export class ShadowRevision {
  private previous: number[] = [];
  changed(values: readonly number[]): boolean {
    let dirty = values.length !== this.previous.length;
    for (let index = 0; index < values.length; index++) {
      if (values[index] !== this.previous[index]) dirty = true;
      this.previous[index] = values[index];
    }
    this.previous.length = values.length;
    return dirty;
  }
  invalidate(): void {
    this.previous = [];
  }
}

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Non-blocking GPU queries. No gl.finish(), no synchronous readback of pending work. */
export class GpuFrameTimer {
  private extension: TimerExtension | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private frame = 0;
  constructor(private gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  }
  get supported(): boolean {
    return this.extension !== null;
  }
  begin(): number | null {
    const extension = this.extension;
    if (!extension || this.gl.isContextLost()) return null;
    let result: number | null = null;
    const disjoint = this.gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length && this.gl.getQueryParameter(this.pending[0], this.gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift()!;
      if (!disjoint) result = (this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number) / 1_000_000;
      this.gl.deleteQuery(query);
    }
    if (disjoint) {
      for (const query of this.pending) this.gl.deleteQuery(query);
      this.pending = [];
    }
    if (this.frame++ % 4 === 0 && this.pending.length < 3 && !disjoint) {
      this.active = this.gl.createQuery();
      if (this.active) this.gl.beginQuery(extension.TIME_ELAPSED_EXT, this.active);
    }
    return result;
  }
  end(discard = false): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    if (discard) this.gl.deleteQuery(this.active);
    else this.pending.push(this.active);
    this.active = null;
  }
  dispose(): void {
    if (this.gl.isContextLost()) {
      this.active = null;
      this.pending = [];
      return;
    }
    if (this.active) this.end(true);
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }
}
