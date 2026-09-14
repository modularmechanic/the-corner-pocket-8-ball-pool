import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAL_GAIN, ShotInputController, type KeyInput, type PointerInput, type ShotInputCommand, type ShotInputContext, type ShotInputView } from '../src/ui/shot-input-controller';

function rig(overrides: Partial<ShotInputContext> = {}) {
  const context: ShotInputContext = { canAct: true, blocked: false, phase: 'ready', width: 600, cueView: true, ownTurn: true, ...overrides };
  const commands: ShotInputCommand[] = [], calls: string[] = [], aimed: { x: number; y: number }[] = [];
  // Pointer lock is unavailable unless a test turns it on, so the original tests keep today's click flow.
  const scene = { aimAngle: .4 as number | null, direction: { x: 0, y: -8 }, control: null as 'coin' | 'chalk' | null, aim: { angle: 0, power: 0, pullback: 0, contactEditing: false }, lockApi: false };
  const view: ShotInputView = {
    requestPointerLock: () => { calls.push('request-lock'); return scene.lockApi; },
    exitPointerLock: () => calls.push('exit-lock'),
    aimAt: (x, y) => { aimed.push({ x, y }); return scene.aimAngle; },
    screenDirection: () => scene.direction,
    tableAt: (x, y) => ({ x: x / 100, z: y / 100 }),
    tableControlAt: () => scene.control,
    showPlacement: () => calls.push('placement'),
    showAim: aim => { scene.aim = aim; },
    beginOrbit: () => calls.push('begin-orbit'), orbitBy: (dx, dy) => calls.push(`orbit ${dx},${dy}`),
    rotateView: (yaw, pitch) => calls.push(`rotate ${yaw},${pitch}`), endOrbit: () => calls.push('end-orbit'),
    resetAimPointer: () => {}, capturePointer: (id, grab) => calls.push(`capture ${id}${grab ? ' grab' : ''}`), releasePointer: () => {},
  };
  const clock = { now: 10_000 };
  const input = new ShotInputController(view, () => context, command => commands.push(command), () => clock.now);
  const pointer = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ id: 1, x, y, button: 0, buttons: 0, primary: true, shift: false, ...extra });
  const key = (code: string, extra: Partial<KeyInput> = {}): KeyInput => ({ code, repeat: false, shift: false, target: 'other', ...extra });
  const click = (x: number, y: number) => { input.pointerDown(pointer(x, y)); input.pointerUp(pointer(x, y)); };
  /** A mouse move that reports movement, as every lock-capable browser does; forgets the aim it caused. */
  const hover = (x = 0, y = 0) => { input.pointerMove(pointer(x, y, { dx: 2, dy: 1 })); aimed.length = 0; calls.length = 0; };
  return { input, context, commands, calls, aimed, scene, clock, pointer, key, click, hover };
}

test('first click locks direction, pullback sets power and the second click shoots', () => {
  const { input, commands, scene, pointer, click } = rig();
  input.setTip(.3, -.4); input.setElevation(.2);
  click(100, 200);
  assert.equal(input.setup.stage, 'power'); assert.equal(input.setup.angle, .4); assert.equal(input.setup.power, .05);
  assert.equal(scene.aim.angle, .4, 'the scene sees the one aim value');
  input.pointerMove(pointer(100, 335));
  assert.equal(scene.aim.pullback, input.setup.power);
  click(100, 335);
  assert.deepEqual(commands, [{ type: 'shoot', shot: { angle: .4, power: .8, elevation: .2, tipX: .3, tipY: -.4 } }]);
  input.pointerMove(pointer(100, 100)); assert.equal(input.setup.power, .05, 'pushing forward never goes below the minimum');
  input.cancel();
  assert.equal(input.setup.stage, 'aim'); assert.equal(input.setup.elevation, 0); assert.equal(input.setup.tipY, 0);
  assert.equal(input.setup.angle, .4, 'cancel keeps the aim direction');
});

test('held S and E adjust contact and elevation without moving direction, stage or charge', () => {
  const { input, pointer, key, click } = rig();
  click(200, 100); input.pointerMove(pointer(200, 145));
  const power = input.setup.power;
  assert.equal(input.keyDown(key('KeyS')), true);
  input.pointerMove(pointer(250, 195));
  assert.equal(input.setup.stage, 'power'); assert.equal(input.setup.angle, .4); assert.equal(input.setup.power, power);
  assert.ok(Math.abs(input.setup.tipX - .3) < 1e-9 && Math.abs(input.setup.tipY + .3) < 1e-9);
  input.keyUp('KeyS'); assert.equal(input.setup.adjustment, null);
  input.pointerMove(pointer(250, 195)); assert.equal(input.setup.power, power, 'returning from a modifier must not jump the charge');
  input.keyDown(key('KeyE')); input.pointerMove(pointer(250, 145)); input.keyUp('KeyE');
  assert.ok(Math.abs(input.setup.elevation - .2) < 1e-9); assert.equal(input.setup.stage, 'power');
  input.keyDown(key('KeyS')); click(250, 145);
  assert.equal(input.setup.stage, 'power', 'clicks are ignored while a modifier is held');
  input.keyDown(key('KeyX')); assert.deepEqual([input.setup.tipX, input.setup.tipY, input.setup.elevation], [0, 0, 0]);
});

test('contact and elevation are bounded, fine travel is a quarter, and invalid pointer data is ignored', () => {
  const { input, pointer, key } = rig();
  input.toggleAdjustment('elevation'); input.pointerMove(pointer(0, -10000));
  assert.equal(input.setup.elevation, Math.PI / 3); input.pointerMove(pointer(0, 10000)); assert.equal(input.setup.elevation, 0);
  input.setTip(1, 1); assert.ok(Math.hypot(input.setup.tipX, input.setup.tipY) <= .80000001);
  const prior = { ...input.setup };
  input.setTip(NaN, Infinity); input.setElevation(NaN); input.setPower(NaN); input.pointerMove(pointer(NaN, 1));
  assert.deepEqual({ ...input.setup }, prior);
  const normal = rig(), fine = rig();
  for (const { input: each } of [normal, fine]) { each.pointerEnter({ x: 0, y: 0 }); each.keyDown(key('KeyS')); }
  normal.input.pointerMove(pointer(100, 0)); fine.input.pointerMove(pointer(100, 0, { shift: true }));
  assert.equal(fine.input.setup.tipX, normal.input.setup.tipX / 4); assert.equal(fine.input.setup.stage, 'aim');
  normal.input.pointerMove(pointer(100, 0, { shift: true })); assert.equal(normal.input.setup.tipX, .6, 'switching to fine mid-drag never jumps');
  normal.input.pointerMove(pointer(120, 0, { shift: true })); assert.ok(Math.abs(normal.input.setup.tipX - .63) < 1e-9);
});

test('arrow keys adjust aim, power, contact and elevation; Shift is finer; Space locks then shoots', () => {
  const { input, commands, key } = rig();
  input.keyDown(key('ArrowRight')); input.keyDown(key('ArrowLeft', { shift: true }));
  assert.ok(Math.abs(input.setup.angle - .012 * .8) < 1e-12);
  assert.equal(input.keyDown(key('Space', { target: 'button' })), false, 'a focused button keeps its own Space');
  input.keyDown(key('Space')); assert.equal(input.setup.stage, 'power');
  input.keyDown(key('ArrowUp')); input.keyDown(key('ArrowUp', { shift: true }));
  assert.ok(Math.abs(input.setup.power - (.05 + .03 + .006)) < 1e-12);
  input.keyDown(key('KeyS')); input.keyDown(key('ArrowRight')); input.keyDown(key('ArrowDown', { shift: true })); input.keyUp('KeyS');
  assert.ok(Math.abs(input.setup.tipX - .06) < 1e-12 && Math.abs(input.setup.tipY + .012) < 1e-12);
  input.keyDown(key('KeyE')); input.keyDown(key('ArrowUp')); input.keyUp('KeyE');
  assert.ok(Math.abs(input.setup.elevation - Math.PI / 180) < 1e-12);
  input.keyDown(key('Space', { repeat: true })); assert.equal(commands.length, 0, 'auto-repeat never shoots');
  input.keyDown(key('Space')); assert.equal(commands[0].type, 'shoot');
  assert.equal(input.keyDown(key('KeyC', { target: 'text' })), false); input.keyDown(key('KeyC')); input.keyDown(key('KeyB'));
  assert.deepEqual(commands.slice(1), [{ type: 'chalk' }, { type: 'cue-locker' }]);
});

test('Escape cancels a prepared strike even while typing', () => {
  const { input, key, click } = rig();
  input.setTip(.2, .2); click(0, 0);
  assert.equal(input.keyDown(key('Escape', { target: 'text' })), false);
  assert.deepEqual([input.setup.stage, input.setup.tipX], ['aim', 0]);
});

test('right-drag and R orbit temporarily, preserve the prepared strike and resume a held modifier', () => {
  const { input, calls, pointer, key, click } = rig();
  input.setTip(.2, 0); click(0, 0); const power = input.setup.power; calls.length = 0;
  input.pointerDown(pointer(10, 10, { button: 2, id: 7 }));
  assert.equal(input.orbiting, true); assert.equal(input.canAct, false);
  input.pointerMove(pointer(30, 15, { id: 7, buttons: 2 }));
  input.pointerUp(pointer(30, 15, { id: 7, button: 2 }));
  assert.deepEqual(calls, ['begin-orbit', 'capture 7 grab', 'orbit 20,5', 'end-orbit']);
  assert.deepEqual([input.orbiting, input.setup.stage, input.setup.power, input.setup.tipX], [false, 'power', power, .2]);
  calls.length = 0;
  input.keyDown(key('KeyS')); input.keyDown(key('KeyR')); input.keyDown(key('ArrowLeft')); input.frame(.5);
  assert.equal(input.setup.adjustment, null, 'S is held but does not adjust during a look');
  input.keyUp('KeyR');
  assert.deepEqual(calls, ['begin-orbit', 'rotate -0.5,0', 'end-orbit']);
  assert.equal(input.setup.adjustment, 'spin', 'releasing the look resumes the held contact modifier');
  assert.deepEqual([input.setup.stage, input.setup.tipX], ['power', .2]);
});

test('changing camera requires a fresh aim lock but keeps contact and elevation', () => {
  const { input, commands, key, click } = rig();
  input.setTip(-.3, .1); input.setElevation(.5); click(0, 0);
  input.keyDown(key('KeyV')); input.keyDown(key('KeyF')); input.keyDown(key('KeyF', { repeat: true }));
  assert.deepEqual(commands, [{ type: 'camera', toggleOverhead: true }, { type: 'camera', toggleOverhead: false }]);
  input.cameraChanged();
  assert.deepEqual([input.setup.stage, input.setup.tipX, input.setup.tipY, input.setup.elevation], ['aim', -.3, .1, .5]);
});

test('no shot input is accepted when the seat cannot act; placement, table controls and blocked menus behave', () => {
  const idle = rig({ canAct: false });
  idle.click(0, 0); idle.input.keyDown(idle.key('Space')); idle.input.keyDown(idle.key('KeyS')); idle.input.keyDown(idle.key('ArrowRight'));
  assert.deepEqual([idle.input.setup.stage, idle.input.setup.adjustment, idle.input.setup.angle, idle.commands.length], ['aim', null, 0, 0]);
  idle.scene.control = 'coin'; idle.click(0, 0);
  assert.deepEqual(idle.commands, [{ type: 'coin' }], 'table controls stay clickable between turns');
  const placing = rig({ phase: 'ball-in-hand' });
  placing.input.pointerMove(placing.pointer(150, 50)); placing.click(150, 50);
  assert.deepEqual(placing.calls, ['placement']); assert.deepEqual(placing.commands, [{ type: 'place', x: 1.5, z: .5 }]);
  const menu = rig({ blocked: true });
  assert.equal(menu.input.keyDown(menu.key('KeyR')), false); menu.input.pointerDown(menu.pointer(0, 0, { button: 2 }));
  assert.equal(menu.input.orbiting, false);
});

test('cue view: an unlocked click only takes the cue; locked movement aims and pulls back the two-click shot', () => {
  const { input, commands, calls, aimed, scene, pointer, click, hover } = rig(); scene.lockApi = true;
  hover(300, 200); assert.equal(input.lockHint, true);
  input.setTip(.2, 0); click(300, 200);
  assert.deepEqual([calls, input.setup.stage, commands.length, aimed.length], [['request-lock'], 'aim', 0, 0], 'the taking click neither aims nor locks aim');
  input.pointerLockChanged(true);
  assert.deepEqual([input.pointerLocked, input.lockHint], [true, false]);
  // A locked pointer's screen position is frozen; only its movement counts, and the first report after locking is dropped.
  input.pointerMove(pointer(300, 200, { dx: 900 })); input.pointerMove(pointer(300, 200, { dx: 40 })); input.pointerMove(pointer(300, 200, { dx: 25 }));
  assert.deepEqual(aimed.map(point => point.x), [300, 340, 365]);
  click(300, 200);
  assert.equal(input.setup.stage, 'power'); assert.equal(calls.some(call => call.startsWith('capture')), false, 'pointer capture throws while locked');
  input.pointerMove(pointer(300, 200, { dy: 90 }));
  assert.ok(Math.abs(input.setup.power - .55) < 1e-9);
  click(300, 200);
  assert.deepEqual(commands, [{ type: 'shoot', shot: { angle: .4, power: .55, elevation: 0, tipX: .2, tipY: 0 } }]);
  input.cancel(); click(300, 200);
  assert.equal(input.setup.stage, 'power', 'the lock outlasts the shot: the next click locks aim straight away');
});

test('losing the lock to Escape cancels like Escape; releases for dialogs, overhead and other turns keep the setup', () => {
  const { input, context, calls, scene, click, hover } = rig(); scene.lockApi = true;
  hover(); click(0, 0); input.pointerLockChanged(true); input.setTip(.3, 0); click(0, 0);
  assert.equal(input.setup.stage, 'power');
  input.pointerLockChanged(false);
  assert.deepEqual([input.pointerLocked, input.setup.stage, input.setup.tipX], [false, 'aim', 0], 'a browser unlock (Escape, blur) is a cancel');
  const playing = { blocked: false, cueView: true, ownTurn: true, phase: 'ready' as const };
  for (const change of [{ blocked: true }, { cueView: false }, { ownTurn: false }, { phase: 'ball-in-hand' as const }]) {
    Object.assign(context, playing); input.pointerLockChanged(true); input.setTip(.3, 0); calls.length = 0;
    input.frame(0); assert.deepEqual(calls, [], 'the lock holds while this device plays in the cue view');
    Object.assign(context, change); input.frame(0); input.frame(0);
    assert.deepEqual(calls, ['exit-lock'], `released once for ${JSON.stringify(change)}`);
    input.pointerLockChanged(false);
    assert.deepEqual([input.pointerLocked, input.setup.tipX], [false, .3], 'a release the game asked for is not a cancel');
  }
  Object.assign(context, playing, { phase: 'rolling' }); input.pointerLockChanged(true); calls.length = 0;
  input.frame(0); assert.deepEqual(calls, [], 'the lock is kept while the shot rolls');
  input.releasePointerLock(); input.pointerLockChanged(false); assert.equal(input.setup.tipX, .3, 'window blur releases without a second cancel');
});

test('refusals right after Escape never turn pointer lock off; a later click always retries', () => {
  const { input, calls, scene, clock, click, hover } = rig(); scene.lockApi = true;
  hover(); click(0, 0); input.pointerLockChanged(true);
  input.pointerLockChanged(false); // Escape
  const requests = () => calls.filter(call => call === 'request-lock').length;
  calls.length = 0;
  // Chrome: "The user has exited the lock before this request was completed."
  for (let i = 0; i < 6; i++) { clock.now += 200; click(0, 0); input.pointerLockError(); }
  assert.deepEqual([requests(), input.setup.stage, input.lockHint], [6, 'aim', true], 'quick clicks inside the cooldown keep asking and never lock aim instead');
  clock.now += 1500; click(0, 0); input.pointerLockError();
  clock.now += 6000; click(0, 0); input.pointerLockError();
  clock.now += 6000; click(0, 0); input.pointerLockError();
  assert.deepEqual([requests(), input.setup.stage, input.lockHint], [9, 'aim', true], 'occasional refusals expire before they add up');
  clock.now += 6000; click(0, 0); input.pointerLockChanged(true);
  assert.equal(input.pointerLocked, true, 'the cursor is captured again');
});

test('pointer lock falls back to the unlocked click flow when unavailable, refused repeatedly, without movement data or outside the cue view', () => {
  const missing = rig(); missing.hover(); missing.click(0, 0);
  assert.equal(missing.input.setup.stage, 'power', 'no Pointer Lock API: the first click locks aim as before');
  const sandboxed = rig(); sandboxed.scene.lockApi = true; sandboxed.hover();
  for (let i = 0; i < 3; i++) { sandboxed.clock.now += 400; sandboxed.click(0, 0); sandboxed.input.pointerLockError(); }
  assert.deepEqual([sandboxed.input.setup.stage, sandboxed.input.lockHint], ['aim', false], 'three quick refusals outside any cooldown mean locking cannot work here');
  sandboxed.click(0, 0); assert.equal(sandboxed.input.setup.stage, 'power');
  // Safari 15 and older: pointer events without movementX would freeze aim under a lock.
  const noMovement = rig(); noMovement.scene.lockApi = true;
  noMovement.input.pointerMove(noMovement.pointer(10, 10)); noMovement.input.pointerMove(noMovement.pointer(20, 10, { dx: 0, dy: 0 }));
  assert.equal(noMovement.input.lockHint, false);
  noMovement.click(20, 10);
  assert.deepEqual([noMovement.calls.includes('request-lock'), noMovement.input.setup.stage], [false, 'power'], 'no movement data: aim stays unlocked');
  const finger = rig(); finger.scene.lockApi = true; finger.input.pointerMove(finger.pointer(0, 0, { dx: 30, touch: true }));
  assert.equal(finger.input.lockHint, false, 'finger movement never enables the mouse lock');
  const overhead = rig({ cueView: false }); overhead.scene.lockApi = true; overhead.hover(); overhead.click(0, 0);
  assert.deepEqual([overhead.calls.includes('request-lock'), overhead.input.setup.stage, overhead.input.lockHint], [false, 'power', false], 'overhead keeps a visible cursor and point-to-aim');
});

test('locked movement spikes are clamped and the first report after locking is ignored', () => {
  const { input, aimed, scene, pointer, click, hover } = rig(); scene.lockApi = true;
  hover(100, 100); click(100, 100); input.pointerLockChanged(true);
  input.pointerMove(pointer(100, 100, { dx: 3000, dy: -2000 }));
  input.pointerMove(pointer(100, 100, { dx: 4000 })); input.pointerMove(pointer(100, 100, { dx: -151, dy: 90 })); input.pointerMove(pointer(100, 100, { dx: NaN }));
  assert.deepEqual(aimed, [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 100, y: 190 }, { x: 100, y: 190 }]);
  input.pointerLockChanged(false); input.pointerLockChanged(true); aimed.length = 0;
  input.pointerMove(pointer(100, 100, { dx: 80 })); input.pointerMove(pointer(100, 100, { dx: 5 }));
  assert.deepEqual(aimed.map(point => point.x), [100, 105], 'every new lock drops its first report');
});

test('right-drag orbit keeps working on a locked pointer from movement alone', () => {
  const { input, calls, scene, pointer, click, hover } = rig(); scene.lockApi = true;
  hover(50, 50); click(50, 50); input.pointerLockChanged(true); input.pointerMove(pointer(50, 50, { dx: 1 })); calls.length = 0;
  input.pointerDown(pointer(50, 50, { button: 2 }));
  input.pointerMove(pointer(50, 50, { buttons: 2, dx: 12, dy: -4 })); input.pointerMove(pointer(50, 50, { buttons: 2, dx: 3 }));
  input.pointerUp(pointer(50, 50, { button: 2 }));
  assert.deepEqual(calls, ['begin-orbit', 'orbit 12,-4', 'orbit 3,0', 'end-orbit']);
});

test('keyboard chalk, contact and elevation keep working under the lock', () => {
  const { input, commands, scene, pointer, key, click, hover } = rig(); scene.lockApi = true;
  hover(); click(0, 0); input.pointerLockChanged(true); input.pointerMove(pointer(0, 0, { dx: 1 }));
  input.keyDown(key('KeyC')); assert.deepEqual(commands, [{ type: 'chalk' }]);
  input.keyDown(key('KeyS')); input.pointerMove(pointer(0, 0, { dx: 50 })); input.keyUp('KeyS');
  assert.ok(Math.abs(input.setup.tipX - .3) < 1e-9, 'S with mouse movement sets contact while locked');
  input.keyDown(key('KeyE')); input.pointerMove(pointer(0, 0, { dy: -50 })); input.keyUp('KeyE');
  assert.ok(Math.abs(input.setup.elevation - .2) < 1e-9);
  input.keyDown(key('KeyX')); assert.deepEqual([input.setup.tipX, input.setup.elevation, input.pointerLocked], [0, 0, true]);
});

test('a finger on the table never locks aim or shoots; ball in hand still places', () => {
  const { input, commands, calls, aimed, scene, pointer } = rig(); scene.lockApi = true;
  const tap = (x: number, y: number) => { input.pointerDown(pointer(x, y, { touch: true })); input.pointerMove(pointer(x + 30, y + 90, { touch: true, buttons: 1 })); input.pointerUp(pointer(x + 30, y + 90, { touch: true })); };
  tap(100, 100); tap(100, 100);
  assert.deepEqual([input.setup.stage, input.setup.angle, commands.length, aimed.length, calls.includes('request-lock')], ['aim', 0, 0, 0, false]);
  input.toggleEngage(); input.setSliderPower(.8); tap(100, 100); tap(100, 100);
  assert.deepEqual([input.setup.stage, input.setup.power, commands.length], ['power', .8, 0], 'an engaged cue ignores table taps');
  const placing = rig({ phase: 'ball-in-hand' });
  placing.input.pointerMove(placing.pointer(150, 50, { touch: true })); placing.input.pointerDown(placing.pointer(150, 50, { touch: true }));
  assert.deepEqual([placing.calls, placing.commands], [['placement'], [{ type: 'place', x: 1.5, z: .5 }]]);
});

test('the aim dial turns the cue by a geared fraction of the finger turn and wraps', () => {
  const { input, scene } = rig();
  input.rotateDial(.4);
  assert.ok(Math.abs(input.setup.angle - .4 * DIAL_GAIN) < 1e-12); assert.equal(scene.aim.angle, input.setup.angle);
  input.rotateDial(Math.PI * 2 - .4);
  assert.ok(Math.abs(input.setup.angle) < 1e-12, 'a finger crossing the dial seam is a small turn back, not a full circle');
  for (let i = 0; i < 20; i++) input.rotateDial(3);
  assert.ok(input.setup.angle > -Math.PI && input.setup.angle <= Math.PI);
  assert.ok(Math.abs(input.setup.angle - Math.atan2(Math.sin(15), Math.cos(15))) < 1e-9);
  const turned = input.setup.angle;
  input.rotateDial(NaN); input.toggleEngage(); input.rotateDial(1);
  assert.equal(input.setup.angle, turned, 'engaged aim stays locked');
  const idle = rig({ canAct: false }); idle.input.rotateDial(1); assert.equal(idle.input.setup.angle, 0);
});

test('touch engage, slider and Shoot: power only while engaged, letting go never shoots, Shoot is gated', () => {
  const { input, commands, scene } = rig();
  input.setTip(0, -.3); input.setElevation(.2);
  input.setSliderPower(.7); input.touchShoot();
  assert.deepEqual([input.setup.power, commands.length], [.65, 0], 'the slider and Shoot wait for Engage');
  input.toggleEngage();
  assert.deepEqual([input.setup.stage, input.setup.power], ['power', 0]);
  input.touchShoot(); assert.equal(commands.length, 0, 'no shot without power');
  input.setSliderPower(.02); assert.equal(input.setup.power, 0, 'the bottom of the slider is no power');
  input.setSliderPower(1.4); assert.equal(input.setup.power, 1);
  input.setSliderPower(.72);
  assert.deepEqual([input.setup.power, scene.aim.pullback, commands.length], [.72, .72, 0], 'the cue pulls back with the slider and nothing shoots');
  input.toggleAdjustment('spin'); input.touchShoot(); assert.equal(commands.length, 0, 'an open contact adjustment blocks Shoot');
  input.toggleAdjustment('spin'); input.touchShoot();
  assert.deepEqual(commands, [{ type: 'shoot', shot: { angle: 0, power: .72, elevation: .2, tipX: 0, tipY: -.3 } }]);
  input.toggleEngage();
  assert.deepEqual([input.setup.stage, input.setup.elevation, input.setup.tipY], ['aim', .2, -.3], 'disengaging keeps contact and elevation');
  const idle = rig({ canAct: false }); idle.input.toggleEngage(); idle.input.touchShoot();
  assert.deepEqual([idle.input.setup.stage, idle.commands.length], ['aim', 0]);
});

test('Space and the shot button cannot send a zero-power shot after Engage', () => {
  const { input, commands, key } = rig();
  input.toggleEngage(); input.keyDown(key('Space')); input.advance();
  assert.deepEqual([commands.length, input.setup.stage], [0, 'power']);
  input.setSliderPower(.4); input.keyDown(key('Space'));
  assert.deepEqual(commands, [{ type: 'shoot', shot: { angle: 0, power: .4, elevation: 0, tipX: 0, tipY: 0 } }]);
});

test('a mouse taking over from a finger mid-shot keeps the slider power and pulls back along the cue', () => {
  const { input, pointer } = rig();
  input.pointerMove(pointer(40, 700, { touch: true })); input.toggleEngage(); input.setSliderPower(.7);
  input.pointerMove(pointer(520, 90));
  assert.equal(input.setup.power, .7, 'the first mouse move re-anchors instead of wiping the power');
  input.pointerMove(pointer(520, 120));
  assert.ok(Math.abs(input.setup.power - (.7 + 30 / 180)) < 1e-9, 'pulling back toward the player adds power');
  input.pointerMove(pointer(60, 650, { touch: true })); input.setSliderPower(.3); input.pointerMove(pointer(300, 300));
  assert.equal(input.setup.power, .3);
});
