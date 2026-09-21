import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveRenderBudget,
  budgetDpr,
  graphicsBudget,
  RenderFrameHistory,
  ShadowRevision,
  GpuFrameTimer,
  type FrameSample,
} from '../src/render/performance';

function run(budget: AdaptiveRenderBudget, seconds: number, sample: FrameSample) {
  let changes = 0;
  for (let i = 0; i < Math.ceil((seconds * 1000) / sample.frameMs); i++) if (budget.observe(sample)) changes++;
  return changes;
}
/** Feeds per-frame intervals and reports every target the budget held along the way. */
function sequence(
  budget: AdaptiveRenderBudget,
  seconds: number,
  frameMs: (index: number) => number,
  cost = { cpuMs: 2, gpuMs: null as number | null },
) {
  const targets = new Set<number>();
  let changes = 0;
  for (let elapsed = 0, index = 0; elapsed < seconds * 1000; index++) {
    const ms = frameMs(index);
    elapsed += ms;
    if (budget.observe({ frameMs: ms, ...cost })) changes++;
    targets.add(budget.targetMs);
  }
  return { targets, changes };
}

test('Auto starts with bounded native resolution and mobile uses a smaller direct-render budget', () => {
  const desktop = new AdaptiveRenderBudget(),
    mobile = new AdaptiveRenderBudget(true);
  assert.equal(desktop.targetMs, 1000 / 60, 'desktop assumes 60 Hz until faster presentation is observed');
  assert.equal(mobile.targetMs, 1000 / 60);
  assert.equal(desktop.budget.tier, 'balanced');
  assert.equal(desktop.budget.bloom, false);
  assert.equal(mobile.budget.shadowLights, 1);
  assert.equal(mobile.budget.bloom, false);
  assert.equal(budgetDpr(desktop.budget, 1920, 1080, 1), 1, 'a 1× display must never be forced to 1.5×');
  assert.equal(budgetDpr(mobile.budget, 390, 844, 3), 1, 'phone density does not allocate a 3× framebuffer');
  for (const quality of ['auto', 'high', 'veryHigh', 'ultra', 'performance'] as const)
    for (const [w, h] of [
      [1920, 1080],
      [3840, 2160],
      [600, 2400],
      [15000, 12000],
    ]) {
      const budget = graphicsBudget(quality),
        dpr = budgetDpr(budget, w, h, 3, 8192, 4096);
      assert.ok(w * h * dpr * dpr <= budget.pixels + 1);
      assert.ok(w * dpr <= 8192 + 0.001 && h * dpr <= 4096 + 0.001);
    }
});

test('sustained overload removes extra shadow passes before reducing resolution, and cannot oscillate per frame', () => {
  const budget = new AdaptiveRenderBudget(),
    initial = budget.budget;
  const slow = { frameMs: 1000 / 120, cpuMs: 12, gpuMs: 14 };
  assert.equal(run(budget, 2, slow), 0, 'startup warmup is excluded');
  assert.equal(run(budget, 3.3, slow), 1);
  assert.equal(budget.budget.tier, 'fast');
  assert.equal(budget.budget.shadowLights, 1);
  assert.equal(budget.budget.maxDpr, initial.maxDpr);
  assert.equal(budget.budget.pixels, initial.pixels);
  assert.equal(run(budget, 3, slow), 0, 'one downgrade is followed by a cooldown');
  run(budget, 30, slow);
  assert.equal(budget.budget.tier, 'minimum');
  assert.equal(run(budget, 20, slow), 0, 'the floor is bounded');
});

test('refresh-limited 60 Hz with CPU headroom does not degrade to chase 120 FPS', () => {
  const budget = new AdaptiveRenderBudget();
  assert.equal(run(budget, 8, { frameMs: 1000 / 60, cpuMs: 2, gpuMs: null }), 0);
  assert.equal(budget.budget.tier, 'balanced');
  run(budget, 20, { frameMs: 1000 / 60, cpuMs: 2, gpuMs: null });
  assert.equal(budget.budget.tier, 'refined');
});

test('without GPU timers, stable 30 or 20 FPS is treated as overload rather than an upgrade opportunity', () => {
  for (const fps of [30, 20]) {
    const budget = new AdaptiveRenderBudget();
    assert.ok(run(budget, 7, { frameMs: 1000 / fps, cpuMs: 2, gpuMs: null }) >= 1);
    assert.notEqual(budget.budget.tier, 'balanced');
    assert.notEqual(budget.budget.tier, 'refined');
  }
});

test('GPU pressure still downgrades when a CPU-only measurement looks inexpensive', () => {
  const budget = new AdaptiveRenderBudget();
  run(budget, 7, { frameMs: 1000 / 60, cpuMs: 1.4, gpuMs: 15 });
  assert.equal(budget.budget.tier, 'fast');
});

test('Auto reserves GPU headroom instead of holding a measured 114 FPS workload just below its nominal deadline', () => {
  const budget = new AdaptiveRenderBudget();
  assert.equal(run(budget, 5.3, { frameMs: 8.8, cpuMs: 2.27, gpuMs: 7.21 }), 1);
  assert.equal(budget.budget.tier, 'fast');
  assert.equal(
    run(budget, 30, { frameMs: 1000 / 120, cpuMs: 2, gpuMs: 4.3 }),
    0,
    'healthy but modest headroom must not immediately restore the expensive tier',
  );
});

test('sustained misses after observed 120 Hz count as pressure, but an actual 60 Hz cadence does not', () => {
  const fastDisplay = new AdaptiveRenderBudget();
  run(fastDisplay, 4, { frameMs: 1000 / 120, cpuMs: 2, gpuMs: 6.2 });
  assert.equal(run(fastDisplay, 2.3, { frameMs: 8.9, cpuMs: 2, gpuMs: 6.2 }), 1);
  const normalDisplay = new AdaptiveRenderBudget();
  run(normalDisplay, 30, { frameMs: 1000 / 60, cpuMs: 2, gpuMs: 6.2 });
  assert.equal(normalDisplay.budget.tier, 'refined', '6.2 ms is headroom against a 16.7 ms deadline, not pressure');
});

test('the frame deadline follows the observed display refresh, clamped to 60-120 Hz', () => {
  for (const [frameMs, target] of [
    [1000 / 60, 1000 / 60],
    [1000 / 75, 1000 / 75],
    [1000 / 90, 1000 / 90],
    [1000 / 120, 1000 / 120],
    [1000 / 144, 1000 / 120],
    [1000 / 240, 1000 / 120],
    [1000 / 30, 1000 / 60],
    [16.2, 1000 / 60],
    [8.8, 1000 / 120],
  ] as const) {
    const budget = new AdaptiveRenderBudget();
    run(budget, 4, { frameMs, cpuMs: 1, gpuMs: 1 });
    assert.equal(budget.targetMs, target, `${frameMs.toFixed(2)} ms cadence`);
  }
  const phone = new AdaptiveRenderBudget(true);
  run(phone, 4, { frameMs: 1000 / 120, cpuMs: 1, gpuMs: 1 });
  assert.equal(phone.targetMs, 1000 / 60);
});

test('jittery 60 Hz presentation, including a burst of alternating 8/25 ms frames, never locks a 120 Hz deadline', () => {
  const alternating = new AdaptiveRenderBudget();
  const sustained = sequence(alternating, 20, (index) => (index % 2 ? 25 : 8));
  assert.deepEqual(
    [...sustained.targets],
    [1000 / 60],
    'real stutter may still lower quality, but never against a 120 Hz deadline',
  );
  const burst = new AdaptiveRenderBudget();
  sequence(burst, 6, () => 1000 / 60);
  assert.deepEqual(
    [...sequence(burst, 2, (index) => (index % 2 ? 25 : 8)).targets],
    [1000 / 60],
    'one short burst cannot switch the rate',
  );
  assert.deepEqual([...sequence(burst, 10, () => 1000 / 60).targets], [1000 / 60]);
});

test('moving from a 120 Hz to a 60 Hz monitor lowers the deadline without degrading quality', () => {
  const budget = new AdaptiveRenderBudget();
  sequence(budget, 6, () => 1000 / 120);
  assert.equal(budget.targetMs, 1000 / 120);
  const moved = sequence(budget, 6, () => 1000 / 60);
  assert.equal(budget.targetMs, 1000 / 60);
  assert.equal(moved.changes, 0);
  assert.equal(budget.budget.tier, 'balanced');
  sequence(budget, 6, () => 1000 / 120);
  assert.equal(budget.targetMs, 1000 / 120, 'and back up again');
  budget.observe({ frameMs: 5000, cpuMs: 2, gpuMs: null });
  assert.deepEqual(
    [...sequence(budget, 2, () => 1000 / 60).targets],
    [1000 / 120],
    'a hidden-tab gap restarts agreement rather than switching early',
  );
});

test('plus or minus 2 ms of frame jitter keeps the detected rate stable', () => {
  for (const hz of [60, 120]) {
    const budget = new AdaptiveRenderBudget(),
      jitter = (index: number) => 1000 / hz + 2 * Math.sin(index * 2.39996);
    const result = sequence(budget, 20, jitter, { cpuMs: 1, gpuMs: 1 });
    assert.equal(budget.targetMs, 1000 / hz);
    assert.ok(result.targets.size <= 2, 'at most the single startup switch to 120 Hz');
    assert.deepEqual([...sequence(budget, 20, jitter, { cpuMs: 1, gpuMs: 1 }).targets], [1000 / hz]);
  }
});

test('a 60 Hz display is not downgraded for GPU work that only misses a 120 Hz deadline', () => {
  const budget = new AdaptiveRenderBudget();
  assert.equal(run(budget, 30, { frameMs: 1000 / 60, cpuMs: 3, gpuMs: 9 }), 0);
  assert.equal(budget.budget.tier, 'balanced');
  assert.ok(
    run(budget, 10, { frameMs: 1000 / 60, cpuMs: 3, gpuMs: 15 }) >= 1,
    'work near the real 60 Hz deadline still downgrades',
  );
});

test('the budget ceiling that fixes shader structure never moves with the adaptive tier', () => {
  const desktop = new AdaptiveRenderBudget(),
    mobile = new AdaptiveRenderBudget(true);
  assert.equal(desktop.ceiling.tier, 'refined');
  assert.equal(desktop.ceiling.shadowLights, 3);
  assert.equal(mobile.ceiling.tier, 'fast');
  assert.equal(mobile.ceiling.shadowLights, 1);
  const tiers = new Set<string>();
  for (let i = 0; i < 20; i++) {
    run(desktop, 3, { frameMs: 1000 / 120, cpuMs: 12, gpuMs: 14 });
    tiers.add(desktop.budget.tier);
    assert.deepEqual(desktop.ceiling, graphicsBudget('auto', 0));
    assert.ok(desktop.budget.shadowLights <= desktop.ceiling.shadowLights);
  }
  assert.ok(tiers.has('fast') && tiers.has('minimum'));
  for (const quality of ['performance', 'high', 'ultra'] as const) {
    desktop.setQuality(quality);
    assert.deepEqual(desktop.ceiling, desktop.budget);
  }
});

test('asset captures, tab wake and occasional long frames do not pump quality', () => {
  const budget = new AdaptiveRenderBudget();
  run(budget, 4, { frameMs: 1000 / 120, cpuMs: 6, gpuMs: 6 });
  budget.observe({ frameMs: 150, cpuMs: 130, gpuMs: null, maintenance: true });
  assert.equal(run(budget, 4, { frameMs: 1000 / 120, cpuMs: 6, gpuMs: 6 }), 0);
  budget.observe({ frameMs: 10000, cpuMs: 6, gpuMs: null });
  assert.equal(run(budget, 1, { frameMs: 1000 / 120, cpuMs: 30, gpuMs: 30 }), 0);
  assert.equal(budget.budget.tier, 'balanced');
});

test('manual quality is stable, while returning to Auto restores the device starting budget', () => {
  const budget = new AdaptiveRenderBudget();
  budget.setQuality('ultra');
  assert.equal(run(budget, 30, { frameMs: 40, cpuMs: 30, gpuMs: 35 }), 0);
  assert.equal(budget.budget.tier, 'ultra');
  budget.setQuality('auto');
  assert.equal(budget.budget.tier, 'balanced');
  const mobile = new AdaptiveRenderBudget(true);
  run(mobile, 60, { frameMs: 1000 / 120, cpuMs: 1, gpuMs: 1 });
  assert.equal(mobile.budget.tier, 'fast', 'mobile never upgrades into bloom or desktop pixel density');
});

test('frame statistics report actual cadence, p95 stalls and elapsed CPU/GPU separately', () => {
  const history = new RenderFrameHistory();
  for (let i = 0; i < 100; i++) history.record({ frameMs: i < 10 ? 25 : 8, cpuMs: 2, gpuMs: i % 4 === 0 ? 5 : null });
  const stats = history.snapshot();
  assert.ok(Math.abs(stats.fps - 100000 / 970) < 1e-9);
  assert.equal(stats.p95FrameMs, 25);
  assert.equal(stats.cpuMs, 2);
  assert.equal(stats.gpuMs, 5);
  assert.ok(Object.isFrozen(stats));
  history.record({ frameMs: 10000, cpuMs: 2, gpuMs: null });
  assert.equal(history.snapshot().samples, 0);
  for (let i = 0; i < 600; i++) history.record({ frameMs: 10, cpuMs: 3, gpuMs: null });
  assert.equal(history.snapshot().samples, 300);
  assert.equal(history.snapshot().fps, 100);
  assert.equal(history.snapshot().gpuMs, null);
});

test('shadow revision catches visibility, flight height, nested cue/coin transforms and removal', () => {
  const revision = new ShadowRevision(),
    transforms = [1, 1, 0, 0.16, 0, 0, 0, 0, 1, 1, 1, 1];
  assert.equal(revision.changed(transforms), true);
  assert.equal(revision.changed([...transforms]), false);
  for (const [index, value] of [
    [3, 0.4],
    [1, 0],
    [5, 0.15],
  ]) {
    transforms[index] = value;
    assert.equal(revision.changed(transforms), true);
    assert.equal(revision.changed(transforms), false);
  }
  assert.equal(revision.changed([...transforms, 2, 1, 0.3]), true);
  assert.equal(revision.changed(transforms), true);
  revision.invalidate();
  assert.equal(revision.changed(transforms), true);
});

test('GPU telemetry never reads an unfinished query and discards disjoint or maintenance results', () => {
  let ready = false,
    disjoint = false,
    reads = 0,
    ends = 0,
    deletes = 0;
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: () => extension,
    isContextLost: () => false,
    getParameter: () => disjoint,
    createQuery: () => ({}),
    beginQuery: () => {},
    endQuery: () => {
      ends++;
    },
    deleteQuery: () => {
      deletes++;
    },
    getQueryParameter: (_query: unknown, parameter: number) => {
      if (parameter === 3) return ready;
      assert.ok(ready);
      reads++;
      return 4_500_000;
    },
  } as unknown as WebGL2RenderingContext;
  const timer = new GpuFrameTimer(gl);
  assert.equal(timer.supported, true);
  assert.equal(timer.begin(), null);
  timer.end();
  assert.equal(ends, 1);
  assert.equal(timer.begin(), null);
  timer.end();
  assert.equal(reads, 0);
  ready = true;
  assert.equal(timer.begin(), 4.5);
  timer.end();
  assert.equal(reads, 1);
  timer.begin();
  timer.end();
  timer.begin();
  timer.end(true);
  assert.equal(ends, 2);
  assert.equal(reads, 1);
  timer.begin();
  timer.end();
  timer.begin();
  timer.end();
  timer.begin();
  timer.end();
  timer.begin();
  timer.end();
  disjoint = true;
  assert.equal(timer.begin(), null);
  assert.equal(reads, 1);
  assert.ok(deletes >= 3);
  timer.dispose();
});

test('preset costs are bounded for native 1440p60 and lower tiers targeting high refresh', () => {
  const budget = new AdaptiveRenderBudget();
  for (const quality of ['performance', 'high', 'veryHigh', 'ultra'] as const) {
    budget.setQuality(quality);
    assert.equal(budget.targetMs, 1000 / (quality === 'high' || quality === 'performance' ? 120 : 60));
  }
  for (let tier = 0; tier < 5; tier++) {
    const auto = graphicsBudget('auto', tier);
    assert.ok(auto.pixels <= 1920 * 1080);
    assert.equal(auto.glassTransmission, false);
  }
  assert.equal(graphicsBudget('high').glassTransmission, false);
  assert.equal(graphicsBudget('high').shadowLights, 1);
});
