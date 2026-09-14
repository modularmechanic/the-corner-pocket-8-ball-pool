/** CPU-only benchmark. Run with `node --import tsx scripts/benchmark-cpu.ts`. */
import { initPhysics } from '../src/simulation/game';
import { LocalMatch } from '../src/match/local';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--frames' || !/^\d+$/.test(args[1])))
  throw new Error('Usage: node --import tsx scripts/benchmark-cpu.ts [--frames 6000]');
const frames = args.length ? Number(args[1]) : 6000;
if (!Number.isSafeInteger(frames) || frames < 100 || frames > 1_000_000)
  throw new Error('--frames must be an integer from 100 to 1000000.');
const step = 1 / 120,
  warmup = 500;
await initPhysics();
function measure(workload: string, action: () => void) {
  for (let i = 0; i < warmup; i++) action();
  const samples: number[] = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    action();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const rounded = (value: number) => Number(value.toFixed(5));
  return {
    workload,
    meanMs: rounded(samples.reduce((sum, value) => sum + value, 0) / frames),
    p95Ms: rounded(samples[Math.floor(frames * 0.95)]),
    p99Ms: rounded(samples[Math.floor(frames * 0.99)]),
  };
}
const idle = new LocalMatch({ seed: 'benchmark-idle', options: { level: 5 } });
const moving = new LocalMatch({ seed: 'benchmark-moving', options: { level: 5 }, nextSeed: () => 'benchmark-moving' });
try {
  const results = [
    measure('idle Match update, state, actor and event drain', () => {
      idle.update(step);
      void idle.state;
      void idle.actor;
      idle.drainEvents();
    }),
    measure('repeated full-power breaks, Match update, state, actor and event drain', () => {
      if (moving.state.phase !== 'rolling') {
        moving.dispatch({ type: 'reset' });
        moving.dispatch({ type: 'shoot', shot: { angle: 0, power: 1 } });
      }
      moving.update(step);
      void moving.state;
      void moving.actor;
      moving.drainEvents();
    }),
    measure('settled-state HUD cache key serialization (no DOM)', () => {
      const state = idle.state,
        arcadeUI = { ...state.arcade, clock: undefined };
      JSON.stringify([
        state.cues,
        state.chalked,
        state.phase,
        state.turn,
        state.format,
        state.teamOrder,
        state.groups,
        state.shotCount,
        state.message,
        state.balls.filter((ball) => ball.pocketed).map((ball) => ball.id),
        state.winner,
        arcadeUI,
      ]);
    }),
  ];
  console.log(
    JSON.stringify(
      {
        scope: 'CPU only: excludes rendering, DOM, audio, networking and asset loading; not an FPS measurement',
        runtime: process.version,
        platform: `${process.platform}/${process.arch}`,
        framesPerWorkload: frames,
        warmupPerWorkload: warmup,
        simulatedStepSeconds: step,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  idle.dispose();
  moving.dispose();
}
