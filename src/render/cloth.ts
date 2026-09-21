import { seededRandom, type GameModeId } from '../simulation/types';
import type { RenderBudget } from './performance';

const tau = Math.PI * 2;
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const clamp255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);

/** Texels along one edge of a cloth tile, from the two things that actually decide how much cloth
 * a frame can show: the quality tier's pixel budget and the density the display really has. The
 * map tiles six times along the bed, so half the rendered frame's shorter side is already more
 * cloth than a shot resolves; on this M4 Pro that lands at 1024 for ultra and high on a 2x
 * display, 512 for the lower tiers or a 1x monitor, and 256 on a phone.
 *
 * 1024 is a hard ceiling, and measured rather than guessed: generating one tile costs 10-18 ms at
 * 256, 43-65 ms at 512, 179-250 ms at 1024, 713-948 ms at 2048 and 2.8 s at 4096, all synchronous
 * on the main thread. 2048 upward is a visible stall, not a frame, and 4096 also wants 53-213 MB
 * of VRAM for one cloth. Nothing here may pin the size high the way a global 4K setting did. */
export function clothTexels(budget: RenderBudget, viewportPixels: number, deviceDpr: number): number {
  const dpr = Math.min(budget.maxDpr, Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1);
  const rendered = Math.min(budget.pixels, Math.max(0, viewportPixels) * dpr * dpr);
  const wanted = Math.max(1, Math.sqrt(rendered) / 2);
  return Math.max(256, Math.min(1024, 2 ** Math.floor(Math.log2(wanted))));
}

/** Material tuning a generated map cannot carry. Cushions are the same cloth stretched over rubber,
 * so they always read a little flatter than the bed. `bump` multiplies the shared baize bump scale. */
export interface ClothLook {
  readonly name: string;
  readonly cloth: { sheen: number; sheenColor: string; normal: number; bump: number };
  readonly cushion: { sheen: number; sheenColor: string; normal: number; bump: number };
}

/** Eight-ball's pub cloth is the Blender bake and is left exactly as it was. */
export const BAKED_CLOTH_LOOK: ClothLook = {
  name: 'Blender fine tournament baize',
  cloth: { sheen: 0.12, sheenColor: '#77916a', normal: 0.3, bump: 1 },
  cushion: { sheen: 0.1, sheenColor: '#77916a', normal: 0.24, bump: 0.8 },
};

interface ClothStyle {
  readonly seed: string;
  readonly base: readonly [number, number, number];
  /** Texels one woven thread is given. Pitched in texels, not per tile: a frequency fixed per tile
   * falls under two texels a cycle on a small map and averages away to flat colour, so a lower
   * budget gets a coarser cloth it can actually resolve rather than the same cloth turned to mush. */
  readonly threadPitch: number;
  readonly weaveDepth: number;
  readonly weaveShade: number;
  /** Texels one nap fibre is given. */
  readonly fibrePitch: number;
  readonly nap: number;
  readonly napShade: number;
  readonly fuzz: number;
  readonly grain: number;
  readonly roughness: number;
  /** Stains, spills and bald patches. Zombie only; billiards uses a trace of it as wear. */
  readonly grime: number;
  readonly look: ClothLook;
}

type GeneratedMode = Exclude<GameModeId, 'eight-ball'>;

const CLOTH_STYLES: Record<GeneratedMode, ClothStyle> = {
  // Tournament baize: cold, deep, tight, and combed hard along the long axis.
  snooker: {
    seed: 'snooker-tournament-baize',
    base: [26, 80, 55],
    threadPitch: 9,
    weaveDepth: 0.05,
    weaveShade: 0.3,
    fibrePitch: 4,
    nap: 0.075,
    napShade: 0.62,
    fuzz: 0.34,
    grain: 0.018,
    roughness: 0.97,
    grime: 0,
    look: {
      name: 'Snooker tournament baize',
      cloth: { sheen: 0.17, sheenColor: '#8fae8a', normal: 0.42, bump: 1.15 },
      cushion: { sheen: 0.14, sheenColor: '#8fae8a', normal: 0.34, bump: 0.92 },
    },
  },
  // The same 12-foot table, the same family of cloth: warmer and a shade lighter, a nap that has
  // been played flat, and enough fuzz and faint wear to read as the older cloth of the two.
  billiards: {
    seed: 'english-billiards-baize',
    base: [40, 92, 60],
    threadPitch: 11,
    weaveDepth: 0.06,
    weaveShade: 0.46,
    fibrePitch: 6,
    nap: 0.032,
    napShade: 0.3,
    fuzz: 0.5,
    grain: 0.03,
    roughness: 0.98,
    grime: 0.14,
    look: {
      name: 'English billiards baize',
      cloth: { sheen: 0.12, sheenColor: '#9aab7c', normal: 0.36, bump: 1.05 },
      cushion: { sheen: 0.1, sheenColor: '#9aab7c', normal: 0.29, bump: 0.84 },
    },
  },
  // Not cue sports. Dark, matted, spilled on and scrubbed through in places.
  zombie: {
    seed: 'zombie-horde-cloth',
    base: [42, 54, 34],
    threadPitch: 16,
    weaveDepth: 0.1,
    weaveShade: 0.6,
    fibrePitch: 9,
    nap: 0.024,
    napShade: 0.2,
    fuzz: 0.85,
    grain: 0.06,
    roughness: 0.99,
    grime: 1,
    look: {
      name: 'Zombie horde cloth — stained and worn through',
      cloth: { sheen: 0.05, sheenColor: '#6b6a52', normal: 0.62, bump: 1.4 },
      cushion: { sheen: 0.04, sheenColor: '#6b6a52', normal: 0.5, bump: 1.12 },
    },
  },
};

export const clothLook = (mode: GameModeId): ClothLook =>
  mode === 'eight-ball' ? BAKED_CLOTH_LOOK : CLOTH_STYLES[mode].look;

export interface ClothSample {
  color: [number, number, number];
  height: number;
  roughness: number;
  bump: number;
}

/** One tile of woven baize. Every term is periodic over the tile in both axes, so the map repeats
 * without a seam however far the 12-foot bed stretches it; the per-texel noise is uncorrelated and
 * cannot make one either. The nap varies across the bed and barely along it, which is what makes it
 * read as combed down the table rather than as noise. */
export function clothSampler(mode: GeneratedMode, size: number): (x: number, y: number) => ClothSample {
  const style = CLOTH_STYLES[mode];
  const random = seededRandom(`${style.seed}-${size}`);
  // Counts per tile, rounded to a multiple of four so both the thread pattern and its half-rate
  // over/under checker close exactly across the tile edge — that is what keeps the repeat seamless.
  const quads = (pitch: number) => Math.max(4, 4 * Math.round(size / pitch / 4));
  const threads = quads(style.threadPitch),
    fibres = quads(style.fibrePitch),
    fibresFine = fibres + (fibres >> 1);
  return (x, y) => {
    const u = x / size,
      v = y / size;
    // Plain weave: warp and weft ridges swap which one sits on top every thread.
    const over = Math.sin(u * threads * Math.PI) * Math.sin(v * threads * Math.PI);
    const weave = (Math.cos(u * threads * tau) * (1 + over) + Math.cos(v * threads * tau) * (1 - over)) * 0.25;
    // Nap: fibres combed down the bed, so they band across it and stay near-constant along it.
    const fibre =
      Math.sin((v * fibres + Math.sin(u * 6 * tau) * 0.3) * tau) * 0.62 +
      Math.sin((v * fibresFine + Math.sin(u * 4 * tau) * 0.45) * tau) * 0.38;
    const noise = random() - 0.5;
    const relief = weave * style.weaveDepth + fibre * style.nap;
    let shade = weave * style.weaveShade + fibre * style.napShade + noise * style.fuzz;
    let rough = style.roughness + fibre * 0.05 + noise * 0.12;
    let [r, g, b] = style.base;
    if (style.grime) {
      const blotch =
        Math.sin((u * 2 + Math.sin(v * tau) * 0.35) * tau) * Math.sin((v * 3 + Math.sin(u * 2 * tau) * 0.4) * tau);
      const speck =
        Math.sin((u * 7 + Math.sin(v * 3 * tau)) * tau) * Math.sin((v * 5 + Math.sin(u * tau)) * tau);
      // A dried spill browns the green and sits dark; the opposite lobes are scrubbed bald.
      const stain = Math.max(0, blotch * 0.7 + speck * 0.45 + noise * 0.4) * style.grime;
      const bald = Math.max(0, -blotch * 0.8 - 0.25) * style.grime;
      r += stain * 30 + bald * 26;
      g += bald * 22 - stain * 16;
      b += bald * 18 - stain * 4;
      shade += bald * 0.25 - stain * 0.5;
      rough += stain * 0.12;
    }
    const lift = Math.max(0.35, 1 + shade * 0.24);
    return {
      color: [clamp255(r * lift), clamp255(g * lift), clamp255(b * lift)],
      height: relief + noise * style.grain,
      roughness: clamp01(rough),
      bump: clamp01(0.5 + relief * 6),
    };
  };
}
