import { optionalPlacement, type GameState, type Shot } from '../simulation/types';

type Adjustment = 'spin' | 'elevation';
type Point = { x: number; y: number };
export interface PointerInput {
  id: number;
  x: number;
  y: number;
  button: number;
  buttons: number;
  primary: boolean;
  shift: boolean;
  /** Movement since the previous event; a locked pointer reports only this. */
  dx?: number;
  dy?: number;
  /** A finger never aims, locks aim or shoots from the table. */
  touch?: boolean;
}
export interface KeyInput {
  code: string;
  repeat: boolean;
  shift: boolean;
  target: 'text' | 'button' | 'other';
}
export interface ShotInputContext {
  /** The seat may act now: controls its turn, no dialog, request or reset in progress. Orbit is tracked here. */
  canAct: boolean;
  /** Menus, a reset animation or an unstarted table ignore table shortcuts and orbit. */
  blocked: boolean;
  phase: GameState['phase'];
  /** An optional placement's choices (see optionalPlacementChoice): 'kitchen', only the 'lie', or null. */
  optionalPlacement: 'kitchen' | 'lie' | null;
  /** Canvas width in CSS pixels; a full pullback is 30% of it, at most 180 px. */
  width: number;
  /** The behind-the-cue view is selected (not overhead or table inspection): the only view that locks the pointer. */
  cueView: boolean;
  /** A person at this device controls the current turn, including while that shot rolls. */
  ownTurn: boolean;
}
export interface ShotSetupState {
  stage: 'aim' | 'power';
  adjustment: Adjustment | null;
  angle: number;
  power: number;
  elevation: number;
  tipX: number;
  tipY: number;
}
export type ShotInputCommand =
  | { type: 'shoot'; shot: Shot }
  | { type: 'place'; x: number; z: number }
  | { type: 'chalk' }
  | { type: 'coin' }
  | { type: 'cue-locker' }
  | { type: 'camera'; toggleOverhead: boolean };
/** The scene seam: projections, camera look and pointer capture. */
export interface ShotInputView {
  aimAt(x: number, y: number): number | null;
  screenDirection(angle: number): Point;
  tableAt(x: number, y: number): { x: number; z: number } | null;
  tableControlAt(x: number, y: number): 'coin' | 'chalk' | null;
  showPlacement(point: { x: number; z: number } | null): void;
  showAim(aim: {
    angle: number;
    power: number;
    elevation: number;
    tipX: number;
    tipY: number;
    pullback: number;
    contactEditing: boolean;
  }): void;
  beginOrbit(): void;
  orbitBy(dx: number, dy: number): void;
  rotateView(yaw: number, pitch: number): void;
  endOrbit(): void;
  resetAimPointer(): void;
  capturePointer(id: number, grab: boolean): void;
  releasePointer(id: number | null): void;
  /** Asks the browser to lock the pointer; false when the Pointer Lock API is missing. The outcome arrives as pointerLockChanged/pointerLockError. */
  requestPointerLock(): boolean;
  exitPointerLock(): void;
}

/** A full finger turn of the aim dial turns the cue a quarter turn. */
export const DIAL_GAIN = 0.25;
/** Browsers refuse a new pointer lock for about a second after one ends (Chrome after Escape); refusals this soon never count. */
export const LOCK_COOLDOWN_MS = 1500;
/** A counted refusal is forgotten this long after the last one. */
export const LOCK_REFUSAL_MEMORY_MS = 5000;
/** Chained refusals outside the cooldown (no permission, sandboxed page) that turn locking off for the session. */
export const LOCK_REFUSAL_LIMIT = 3;
/** Largest locked movement accepted from one event; Chrome on Windows can report spikes of thousands of pixels. */
export const LOCKED_MOVE_LIMIT = 400;
/**
 * Which controls a pointer drives. A pen counts as a mouse only once a real mouse has been used in this session on a device
 * with a fine pointer: Android reports a fine pointer whenever a stylus is present, and a hovering stylus must never aim.
 */
export const inputSchemeFor = (pointerType: string, seenMouse: boolean, coarseOnly: boolean): 'touch' | 'mouse' =>
  pointerType === 'mouse' || (pointerType === 'pen' && seenMouse && !coarseOnly) ? 'mouse' : 'touch';
/** The touch Shoot button (and Space after Engage) needs an engaged cue with power set. */
export const canTouchShoot = (setup: Readonly<ShotSetupState>, canAct: boolean, phase: GameState['phase']) =>
  canAct && phase === 'ready' && setup.stage === 'power' && setup.power > 0 && !setup.adjustment;
const finite = (...values: number[]) => values.every(Number.isFinite);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clampTip = (x: number, y: number) => {
  const scale = Math.min(1, 0.8 / (Math.hypot(x, y) || 1));
  return { tipX: x * scale, tipY: y * scale };
};

/** Owns the two-click shot setup, held modifiers and temporary orbit; emits table commands without touching the DOM. */
export class ShotInputController {
  private readonly setupState: ShotSetupState = {
    stage: 'aim',
    adjustment: null,
    angle: 0,
    power: 0.65,
    elevation: 0,
    tipX: 0,
    tipY: 0,
  };
  private powerAnchor = { x: 0, y: 0, dx: 1, dy: 0, power: 0.05 };
  private adjustmentAnchor: Point = { x: 0, y: 0 };
  private shotPointer: number | null = null;
  private orbitPointer: { id: number; x: number; y: number } | null = null;
  private keyboardOrbit = false;
  private readonly held = new Set<string>();
  private lastPointer: Point = { x: 0, y: 0 };
  private locked = false;
  private releasingLock = false;
  private unlockedAt = -Infinity;
  private refusals = 0;
  private lastRefusalAt = -Infinity;
  /** Pointer lock is only useful where pointer events report mouse movement (not Safari 15 and older). */
  private movementReported = false;
  private skipLockedMove = false;
  private touchPointer = false;
  /** Place behind head string was chosen for an optional placement; otherwise it is played from the lie. */
  private placementChosen = false;
  constructor(
    private readonly view: ShotInputView,
    private readonly context: () => ShotInputContext,
    private readonly emit: (command: ShotInputCommand) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get setup(): Readonly<ShotSetupState> {
    return this.setupState;
  }
  get orbiting() {
    return !!this.orbitPointer || this.keyboardOrbit;
  }
  get canAct() {
    return this.context().canAct && !this.orbiting;
  }
  get pointerLocked() {
    return this.locked;
  }
  /** The phase this device plays: an optional placement is shot from where the cue ball lies ('ready') until Place
   * behind head string is chosen, and then placed like ball in hand. */
  get phase(): GameState['phase'] {
    const context = this.context();
    return context.optionalPlacement && !this.placing ? 'ready' : context.phase;
  }
  /** Placing an optional placement behind the head string, until it is placed or cancelled. */
  get placing() {
    return this.placementChosen && this.context().optionalPlacement === 'kitchen';
  }
  /** The Place behind head string control: shown for an optional placement this seat may act on, usable at 'kitchen'. */
  get placementOption() {
    const context = this.context();
    return context.canAct ? context.optionalPlacement : null;
  }
  /** A table view as this device plays it (see phase); the match state itself never changes. */
  played<T extends Pick<GameState, 'phase' | 'balls' | 'mode' | 'turn'>>(view: T): T {
    return optionalPlacement(view) && !this.placing ? { ...view, phase: 'ready' } : view;
  }
  /** "Click to take the cue": the cue view is waiting for a click to lock the pointer. */
  get lockHint() {
    const { cueView } = this.context();
    return (
      this.lockAvailable &&
      !this.locked &&
      cueView &&
      this.canAct &&
      this.phase === 'ready' &&
      this.setupState.stage === 'aim'
    );
  }
  // ponytail: a page that refuses every lock but is clicked less often than LOCK_REFUSAL_MEMORY_MS keeps retrying, one swallowed click each time; detect the refusal reason if that shows up.
  private get lockAvailable() {
    return this.movementReported && this.refusals < LOCK_REFUSAL_LIMIT;
  }

  /** Escape, blur, dialogs and turn changes: drop the setup and any look, keeping aim direction and power. */
  cancel() {
    this.placementChosen = false;
    this.keyboardOrbit = false;
    this.held.clear();
    this.endOrbit();
    this.view.resetAimPointer();
    this.releaseShotPointer();
    Object.assign(this.setupState, { stage: 'aim', adjustment: null, elevation: 0, tipX: 0, tipY: 0 });
    this.publish();
  }
  /** A fresh rack also faces the cue forward. */
  newRack(power?: number) {
    this.setupState.angle = 0;
    this.cancel();
    if (power !== undefined) this.setPower(power);
  }
  /** A different projection changes the pullback axis: require a fresh aim lock, keeping contact and elevation. */
  cameraChanged() {
    this.setupState.stage = 'aim';
    this.keyboardOrbit = false;
    this.endOrbit();
    this.publish();
  }

  /** Place behind head string button or P: switch an optional placement between placing it and playing from the lie. */
  togglePlacement() {
    const placing = !this.placementChosen;
    if (placing && this.placementOption !== 'kitchen') return;
    this.cancel();
    this.placementChosen = placing;
  }
  /** Shot button or Space: lock aim, then shoot. */
  advance(x = this.lastPointer.x, y = this.lastPointer.y) {
    const setup = this.setupState;
    if (!this.canAct || this.phase !== 'ready' || setup.adjustment) return;
    this.view.resetAimPointer();
    if (setup.stage === 'power') {
      if (canTouchShoot(setup, this.canAct, this.phase)) this.emit({ type: 'shoot', shot: this.shot() });
      return;
    }
    const direction = this.view.screenDirection(setup.angle);
    if (finite(setup.angle, x, y, direction.x, direction.y)) {
      const length = Math.hypot(direction.x, direction.y) || 1;
      setup.stage = 'power';
      setup.power = 0.05;
      this.powerAnchor = { x, y, dx: direction.x / length, dy: direction.y / length, power: setup.power };
    }
    this.publish();
  }
  /** Contact/elevation buttons for touch screens. */
  toggleAdjustment(mode: Adjustment) {
    this.setAdjustment(this.setupState.adjustment === mode ? null : mode);
  }
  setPower(value: number) {
    if (Number.isFinite(value)) this.setupState.power = Math.max(0.05, Math.min(1, value));
    this.publish();
  }
  setElevation(value: number) {
    if (Number.isFinite(value)) this.setupState.elevation = Math.max(0, Math.min(Math.PI / 3, value));
    this.publish();
  }
  setTip(x: number, y: number) {
    if (finite(x, y)) Object.assign(this.setupState, clampTip(x, y));
    this.publish();
  }

  /** Touch aim dial: a finger turn in radians (any wrap) turns the cue by DIAL_GAIN of it, until the cue is engaged. */
  rotateDial(radians: number) {
    const setup = this.setupState;
    if (!Number.isFinite(radians) || !this.canAct || this.phase !== 'ready' || setup.stage !== 'aim') return;
    setup.angle = wrap(setup.angle + wrap(radians) * DIAL_GAIN);
    this.publish();
  }
  /** Touch Engage: lock aim with no power set (the desktop first click); pressing again disengages, keeping contact and elevation. */
  toggleEngage() {
    const setup = this.setupState;
    if (setup.stage === 'power') {
      setup.stage = 'aim';
      this.publish();
      return;
    }
    if (!this.canAct || this.phase !== 'ready') return;
    Object.assign(setup, { stage: 'power', adjustment: null, power: 0 });
    // A mouse taking over mid-shot pulls back along the cue, as after a click.
    const direction = this.view.screenDirection(setup.angle),
      length = Math.hypot(direction.x, direction.y);
    if (finite(direction.x, direction.y) && length > 0)
      Object.assign(this.powerAnchor, { dx: direction.x / length, dy: direction.y / length });
    this.view.resetAimPointer();
    this.reanchorPower();
    this.publish();
  }
  /** Touch power slider position, 0 (bottom) to 1; the bottom 5% is no power. Only an engaged cue listens, and letting go never shoots. */
  setSliderPower(value: number) {
    if (!Number.isFinite(value) || this.setupState.stage !== 'power' || !this.canAct || this.phase !== 'ready') return;
    this.setupState.power = value < 0.05 ? 0 : Math.min(1, value);
    // A mouse on a touch laptop continues from the slider's power rather than its own last pull-back.
    this.reanchorPower();
    this.publish();
  }
  /** Touch Shoot button. */
  touchShoot() {
    if (canTouchShoot(this.setupState, this.canAct, this.phase)) this.emit({ type: 'shoot', shot: this.shot() });
  }

  /** Browser pointer lock state. Losing a lock this controller did not release is an Escape: cancel the setup. */
  pointerLockChanged(locked: boolean) {
    const released = this.releasingLock;
    this.releasingLock = false;
    if (locked === this.locked) return;
    this.locked = locked;
    this.view.resetAimPointer();
    if (locked) {
      this.refusals = 0;
      this.skipLockedMove = true;
      this.reanchorPower();
    } else {
      this.unlockedAt = this.now();
      if (!released) this.cancel();
    }
  }
  /** A refused lock. Refusals during the re-lock cooldown are ignored and a counted refusal expires, so a later click retries. */
  pointerLockError() {
    const now = this.now();
    if (now - this.unlockedAt < LOCK_COOLDOWN_MS) return;
    this.refusals = now - this.lastRefusalAt > LOCK_REFUSAL_MEMORY_MS ? 1 : this.refusals + 1;
    this.lastRefusalAt = now;
  }
  /** Dialogs, other views, turns this device does not play and window blur show the cursor again without cancelling. */
  releasePointerLock() {
    if (this.locked && !this.releasingLock) {
      this.releasingLock = true;
      this.view.exitPointerLock();
    }
  }

  pointerEnter(pointer: Pick<PointerInput, 'x' | 'y'>) {
    if (this.locked) return;
    this.lastPointer = { x: pointer.x, y: pointer.y };
    this.view.resetAimPointer();
    if (this.setupState.adjustment) this.adjustmentAnchor = { ...this.lastPointer };
    else this.reanchorPower();
  }
  pointerLeave() {
    this.view.resetAimPointer();
  }
  pointerMove(input: PointerInput) {
    if (!input.touch && (input.dx || input.dy) && finite(input.dx ?? 0, input.dy ?? 0)) this.movementReported = true;
    // Switching between finger and mouse re-anchors, so a mouse never jumps the aim or the slider's power.
    if (!this.locked && this.touchPointer !== !!input.touch) {
      this.touchPointer = !!input.touch;
      this.pointerEnter(input);
    }
    const pointer = this.lockedPosition(input, true),
      dx = pointer.x - this.lastPointer.x,
      dy = pointer.y - this.lastPointer.y,
      setup = this.setupState;
    this.lastPointer = { x: pointer.x, y: pointer.y };
    if (pointer.buttons & 2) {
      if (!this.orbitPointer && !this.beginPointerOrbit(pointer)) return;
      const orbit = this.orbitPointer!;
      if (orbit.id === pointer.id) {
        this.view.orbitBy(pointer.x - orbit.x, pointer.y - orbit.y);
        orbit.x = pointer.x;
        orbit.y = pointer.y;
      }
      return;
    }
    if (this.orbitPointer) {
      this.endOrbit();
      return;
    }
    if (this.keyboardOrbit) {
      this.view.orbitBy(dx, dy);
      return;
    }
    const { width } = this.context(),
      phase = this.phase;
    if (!this.canAct || (this.shotPointer !== null && this.shotPointer !== pointer.id)) return;
    if (phase === 'ball-in-hand') {
      this.view.showPlacement(this.view.tableAt(pointer.x, pointer.y));
      return;
    }
    if (phase !== 'ready' || pointer.touch) return;
    if (setup.adjustment) this.moveAdjustment(pointer.x, pointer.y, pointer.shift);
    else if (setup.stage === 'aim') this.moveAim(pointer.x, pointer.y, pointer.shift);
    else if (finite(pointer.x, pointer.y, width)) {
      const anchor = this.powerAnchor,
        distance = -(pointer.x - anchor.x) * anchor.dx - (pointer.y - anchor.y) * anchor.dy;
      setup.power = Math.max(0.05, Math.min(1, anchor.power + distance / Math.max(40, Math.min(180, width * 0.3))));
    }
    this.publish();
  }
  pointerDown(input: PointerInput) {
    const pointer = this.lockedPosition(input);
    if (pointer.button === 2) {
      this.beginPointerOrbit(pointer);
      return;
    }
    if (this.orbiting || this.setupState.adjustment) return;
    if (pointer.button !== 0 || this.shotPointer !== null || !pointer.primary || this.context().blocked) return;
    // A hidden locked cursor cannot target the coin slot or chalk.
    const control = this.locked ? null : this.view.tableControlAt(pointer.x, pointer.y);
    if (control) {
      this.emit({ type: control });
      return;
    }
    if (!this.canAct) return;
    this.lastPointer = { x: pointer.x, y: pointer.y };
    const phase = this.phase;
    if (phase === 'ball-in-hand') {
      const point = this.view.tableAt(pointer.x, pointer.y);
      if (point) this.emit({ type: 'place', ...point });
      return;
    }
    if (phase !== 'ready' || pointer.touch) return;
    // In the cue view an unlocked click only takes the cue: it locks the pointer, never aim or a shot.
    // Only while aiming: a shot click after an unlocked aim lock must shoot, not take the cue.
    if (
      !this.locked &&
      this.setupState.stage === 'aim' &&
      this.lockAvailable &&
      this.context().cueView &&
      this.view.requestPointerLock()
    )
      return;
    if (this.setupState.stage === 'aim') this.moveAim(pointer.x, pointer.y, pointer.shift);
    this.shotPointer = pointer.id;
    if (!this.locked) this.view.capturePointer(pointer.id, false);
  }
  pointerUp(input: PointerInput) {
    const pointer = this.lockedPosition(input);
    if (this.orbitPointer?.id === pointer.id && pointer.button === 2) {
      this.endOrbit();
      return;
    }
    if (pointer.button !== 0 || this.shotPointer !== pointer.id) return;
    this.releaseShotPointer();
    this.advance(pointer.x, pointer.y);
  }
  pointerLost(id: number) {
    if (this.shotPointer === id) this.shotPointer = null;
    if (this.orbitPointer?.id === id) this.endOrbit();
  }

  /** Returns true when the key was used and its browser default should be prevented. */
  keyDown(key: KeyInput): boolean {
    const { code } = key,
      setup = this.setupState;
    if (code === 'Escape') {
      this.cancel();
      return false;
    }
    if (this.context().blocked || key.target === 'text') return false;
    if (code === 'KeyF' || code === 'KeyV') {
      if (!key.repeat) this.emit({ type: 'camera', toggleOverhead: code === 'KeyV' });
      return true;
    }
    if (code === 'KeyB') {
      if (!key.repeat) this.emit({ type: 'cue-locker' });
      return true;
    }
    if (code === 'KeyR') {
      if (!this.keyboardOrbit) {
        this.beginLook();
        this.keyboardOrbit = true;
        this.held.add(code);
      }
      return true;
    }
    if (this.keyboardOrbit) {
      if (!code.startsWith('Arrow')) return false;
      this.held.add(code);
      return true;
    }
    if (code === 'KeyP' && this.placementOption) {
      if (!key.repeat) this.togglePlacement();
      return true;
    }
    if (!this.canAct || this.phase !== 'ready') return false;
    if (code === 'KeyS' || code === 'KeyE') {
      if (!key.repeat) {
        this.held.add(code);
        this.setAdjustment(code === 'KeyS' ? 'spin' : 'elevation');
      }
      return true;
    }
    if (code === 'KeyC') {
      if (!key.repeat) this.emit({ type: 'chalk' });
      return true;
    }
    if (code === 'KeyX') {
      Object.assign(setup, { elevation: 0, tipX: 0, tipY: 0 });
      this.adjustmentAnchor = { ...this.lastPointer };
      this.publish();
      return true;
    }
    if (code === 'Space') {
      if (key.target === 'button') return false;
      if (!key.repeat) this.advance();
      return true;
    }
    if (!code.startsWith('Arrow')) return false;
    const direction = code === 'ArrowUp' || code === 'ArrowRight' ? 1 : -1,
      fine = key.shift ? 0.2 : 1,
      horizontal = code === 'ArrowLeft' || code === 'ArrowRight';
    if (setup.adjustment === 'spin')
      Object.assign(
        setup,
        clampTip(
          setup.tipX + (horizontal ? direction * 0.06 * fine : 0),
          setup.tipY + (horizontal ? 0 : direction * 0.06 * fine),
        ),
      );
    else if (setup.adjustment === 'elevation')
      this.setElevation(setup.elevation + ((direction * Math.PI) / 180) * fine);
    else if (setup.stage === 'aim' && horizontal) setup.angle += direction * 0.012 * fine;
    else if (setup.stage === 'power' && !horizontal) {
      this.setPower(setup.power + direction * 0.03 * fine);
      this.reanchorPower();
    }
    if (setup.adjustment) this.adjustmentAnchor = { ...this.lastPointer };
    this.publish();
    return true;
  }
  keyUp(code: string) {
    this.held.delete(code);
    if (code === 'KeyR' && this.keyboardOrbit) {
      this.keyboardOrbit = false;
      if (!this.orbitPointer) this.endOrbit();
    }
    const adjustment = this.setupState.adjustment;
    if ((code === 'KeyS' && adjustment === 'spin') || (code === 'KeyE' && adjustment === 'elevation'))
      this.setAdjustment(this.heldAdjustment());
  }
  /** R + arrows rotate the view while held. A pointer lock lasts only while this device plays its turn in the cue view. */
  frame(dt: number) {
    const { blocked, cueView, ownTurn } = this.context(),
      phase = this.phase;
    if (blocked || !cueView || !ownTurn || (phase !== 'ready' && phase !== 'rolling')) this.releasePointerLock();
    if (!this.keyboardOrbit) return;
    const axis = (positive: string, negative: string) =>
      (this.held.has(positive) ? 1 : 0) - (this.held.has(negative) ? 1 : 0);
    this.view.rotateView(axis('ArrowRight', 'ArrowLeft') * dt, axis('ArrowUp', 'ArrowDown') * dt * 0.65);
  }

  private shot(): Shot {
    const { angle, power, elevation, tipX, tipY } = this.setupState;
    return { angle, power, elevation, tipX, tipY };
  }
  /** A locked pointer's screen position is frozen; integrate its clamped movement into a virtual position instead. The first move after locking is dropped. */
  private lockedPosition(pointer: PointerInput, move = false): PointerInput {
    if (!this.locked) return pointer;
    const skip = move && this.skipLockedMove;
    if (move) this.skipLockedMove = false;
    const delta = (value?: number) =>
      skip || !Number.isFinite(value) ? 0 : Math.max(-LOCKED_MOVE_LIMIT, Math.min(LOCKED_MOVE_LIMIT, value!));
    return { ...pointer, x: this.lastPointer.x + delta(pointer.dx), y: this.lastPointer.y + delta(pointer.dy) };
  }
  private publish() {
    const { angle, power, elevation, tipX, tipY, stage, adjustment } = this.setupState;
    this.view.showAim({
      angle,
      power,
      elevation,
      tipX,
      tipY,
      pullback: stage === 'power' ? power : 0.02,
      contactEditing: !!adjustment,
    });
  }
  private heldAdjustment(): Adjustment | null {
    return this.held.has('KeyS') ? 'spin' : this.held.has('KeyE') ? 'elevation' : null;
  }
  private reanchorPower() {
    const { x, y } = this.lastPointer;
    if (finite(x, y)) Object.assign(this.powerAnchor, { x, y, power: this.setupState.power });
  }
  private setAdjustment(mode: Adjustment | null) {
    if (mode && (!this.canAct || this.phase !== 'ready')) return;
    this.setupState.adjustment = mode;
    if (mode) this.adjustmentAnchor = { ...this.lastPointer };
    else this.reanchorPower();
    this.view.resetAimPointer();
    this.publish();
  }
  private moveAdjustment(x: number, y: number, fine: boolean) {
    if (!finite(x, y)) return;
    const setup = this.setupState,
      anchor = this.adjustmentAnchor,
      scale = fine ? 0.25 : 1;
    if (setup.adjustment === 'spin')
      Object.assign(
        setup,
        clampTip(setup.tipX + (x - anchor.x) * 0.006 * scale, setup.tipY - (y - anchor.y) * 0.006 * scale),
      );
    else if (setup.adjustment === 'elevation')
      setup.elevation = Math.max(0, Math.min(Math.PI / 3, setup.elevation + (anchor.y - y) * 0.004 * scale));
    this.adjustmentAnchor = { x, y };
  }
  private moveAim(x: number, y: number, fine: boolean) {
    const angle = this.view.aimAt(x, y),
      setup = this.setupState;
    if (angle !== null && Number.isFinite(angle))
      setup.angle += Math.atan2(Math.sin(angle - setup.angle), Math.cos(angle - setup.angle)) * (fine ? 0.2 : 1);
    this.publish();
  }
  private releaseShotPointer() {
    const id = this.shotPointer;
    this.shotPointer = null;
    if (id !== null) this.view.releasePointer(id);
  }
  private beginLook() {
    this.releaseShotPointer();
    this.setupState.adjustment = null;
    this.reanchorPower();
    this.view.beginOrbit();
    this.view.resetAimPointer();
    this.publish();
  }
  private beginPointerOrbit(pointer: PointerInput) {
    if (this.context().blocked || !pointer.primary) return false;
    this.beginLook();
    this.orbitPointer = { id: pointer.id, x: pointer.x, y: pointer.y };
    // Pointer capture throws while the pointer is locked; the lock already delivers every event.
    if (!this.locked) this.view.capturePointer(pointer.id, true);
    return true;
  }
  /** Ending a look restores the selected view and resumes a still-held S/E modifier. */
  private endOrbit() {
    const pointer = this.orbitPointer;
    this.orbitPointer = null;
    this.view.releasePointer(pointer?.id ?? null);
    if (!this.keyboardOrbit) this.view.endOrbit();
    this.view.resetAimPointer();
    this.reanchorPower();
    if (!this.keyboardOrbit) {
      const held = this.heldAdjustment();
      if (held) {
        this.setupState.adjustment = held;
        this.adjustmentAnchor = { ...this.lastPointer };
      }
    }
    this.publish();
  }
}
