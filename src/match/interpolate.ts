import type { Ball } from '../simulation/types';

/** Sample all three axes on one snapshot timeline; never blend through a teleport or a pot. */
export function interpolateBalls(before: Ball[], after: Ball[], alpha: number): Ball[] {
  const t = Math.max(0, Math.min(1, alpha));
  return before.map((ball, i) => {
    const next = after[i];
    if (!next || next.id !== ball.id || ball.pocketed || next.pocketed || (ball.teleport || 0) !== (next.teleport || 0)) return ball;
    const elevation = (ball.elevation || 0) + ((next.elevation || 0) - (ball.elevation || 0)) * t;
    return {
      ...ball,
      x: ball.x + (next.x - ball.x) * t,
      z: ball.z + (next.z - ball.z) * t,
      vx: ball.vx + (next.vx - ball.vx) * t,
      vz: ball.vz + (next.vz - ball.vz) * t,
      elevation,
      vy: (ball.vy || 0) + ((next.vy || 0) - (ball.vy || 0)) * t,
      airborne: elevation > .001 || (t < 1 ? !!ball.airborne : !!next.airborne),
    };
  });
}
