import type { GameState, Shot } from '../simulation/types';

type Adjustment = 'spin' | 'elevation';
type Point = { x: number; y: number };
export interface PointerInput {
  id: number; x: number; y: number; button: number; buttons: number; primary: boolean; shift: boolean;
  /** Movement since the previous event; a locked pointer reports only this. */
  dx?: number; dy?: number;
  /** A finger never aims, locks aim or shoots from the table. */
  touch?: boolean;
}
export interface KeyInput { code: string; repeat: boolean; shift: boolean; target: 'text' | 'button' | 'other' }
export interface ShotInputContext {
  /** The seat may act now: controls its turn, no dialog, request or reset in progress. Orbit is tracked here. */
  canAct: boolean;
  /** Menus, a reset animation or an unstarted table ignore table shortcuts and orbit. */
  blocked: boolean;
  phase: GameState['phase'];
  /** Canvas width in CSS pixels; a full pullback is 30% of it, at most 180 px. */
  width: number;
  /** The behind-the-cue view is selected (not overhead or table inspection): the only view that locks the pointer. */
  cueView: boolean;
  /** A person at this device controls the current turn, including while that shot rolls. */
  ownTurn: boolean;
}
export interface ShotSetupState { stage: 'aim' | 'power'; adjustment: Adjustment | null; angle: number; power: number; elevation: number; tipX: number; tipY: number }
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
  showAim(aim: { angle: number; power: number; elevation: number; tipX: number; tipY: number; pullback: number; contactEditing: boolean }): void;
  beginOrbit(): void; orbitBy(dx: number, dy: number): void; rotateView(yaw: number, pitch: number): void; endOrbit(): void;
  resetAimPointer(): void;
  capturePointer(id: number, grab: boolean): void;
  releasePointer(id: number | null): void;
  /** Asks the browser to lock the pointer; false when the Pointer Lock API is missing. The outcome arrives as pointerLockChanged/pointerLockError. */
  requestPointerLock(): boolean;
  exitPointerLock(): void;
}

/** A full finger turn of the aim dial turns the cue a quarter turn. */
export const DIAL_GAIN = .25;
/** The touch Shoot button needs an engaged cue with power set. */
export const canTouchShoot = (setup: Readonly<ShotSetupState>, canAct: boolean, phase: GameState['phase']) =>
  canAct && phase === 'ready' && setup.stage === 'power' && setup.power > 0 && !setup.adjustment;
const finite = (...values: number[]) => values.every(Number.isFinite);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clampTip = (x: number, y: number) => { const scale = Math.min(1, .8 / (Math.hypot(x, y) || 1)); return { tipX: x * scale, tipY: y * scale }; };

/** Owns the two-click shot setup, held modifiers and temporary orbit; emits table commands without touching the DOM. */
export class ShotInputController {
  private readonly setupState: ShotSetupState = { stage: 'aim', adjustment: null, angle: 0, power: .65, elevation: 0, tipX: 0, tipY: 0 };
  private powerAnchor = { x: 0, y: 0, dx: 1, dy: 0, power: .05 };
  private adjustmentAnchor: Point = { x: 0, y: 0 };
  private shotPointer: number | null = null;
  private orbitPointer: { id: number; x: number; y: number } | null = null;
  private keyboardOrbit = false;
  private readonly held = new Set<string>();
  private lastPointer: Point = { x: 0, y: 0 };
  private locked = false;
  private releasingLock = false;
  private lockErrors = 0;
  constructor(private readonly view: ShotInputView, private readonly context: () => ShotInputContext, private readonly emit: (command: ShotInputCommand) => void) {}

  get setup(): Readonly<ShotSetupState> { return this.setupState; }
  get orbiting() { return !!this.orbitPointer || this.keyboardOrbit; }
  get canAct() { return this.context().canAct && !this.orbiting; }
  get pointerLocked() { return this.locked; }
  /** "Click to take the cue": the cue view is waiting for a click to lock the pointer. */
  get lockHint() { const { cueView, phase } = this.context(); return this.lockAvailable && !this.locked && cueView && this.canAct && phase === 'ready'; }
  // ponytail: two consecutive refusals (no API permission, sandboxing) mean today's unlocked controls for the session; one refusal is often Chrome's re-lock cooldown after Escape.
  private get lockAvailable() { return this.lockErrors < 2; }

  /** Escape, blur, dialogs and turn changes: drop the setup and any look, keeping aim direction and power. */
  cancel() {
    this.keyboardOrbit = false; this.held.clear(); this.endOrbit();
    this.view.resetAimPointer(); this.releaseShotPointer();
    Object.assign(this.setupState, { stage: 'aim', adjustment: null, elevation: 0, tipX: 0, tipY: 0 });
    this.publish();
  }
  /** A fresh rack also faces the cue forward. */
  newRack(power?: number) { this.setupState.angle = 0; this.cancel(); if (power !== undefined) this.setPower(power); }
  /** A different projection changes the pullback axis: require a fresh aim lock, keeping contact and elevation. */
  cameraChanged() { this.setupState.stage = 'aim'; this.keyboardOrbit = false; this.endOrbit(); this.publish(); }

  /** Shot button or Space: lock aim, then shoot. */
  advance(x = this.lastPointer.x, y = this.lastPointer.y) {
    const setup = this.setupState;
    if (!this.canAct || this.context().phase !== 'ready' || setup.adjustment) return;
    this.view.resetAimPointer();
    if (setup.stage === 'power') { this.emit({ type: 'shoot', shot: this.shot() }); return; }
    const direction = this.view.screenDirection(setup.angle);
    if (finite(setup.angle, x, y, direction.x, direction.y)) {
      const length = Math.hypot(direction.x, direction.y) || 1;
      setup.stage = 'power'; setup.power = .05;
      this.powerAnchor = { x, y, dx: direction.x / length, dy: direction.y / length, power: setup.power };
    }
    this.publish();
  }
  /** Contact/elevation buttons for touch screens. */
  toggleAdjustment(mode: Adjustment) { this.setAdjustment(this.setupState.adjustment === mode ? null : mode); }
  setPower(value: number) { if (Number.isFinite(value)) this.setupState.power = Math.max(.05, Math.min(1, value)); this.publish(); }
  setElevation(value: number) { if (Number.isFinite(value)) this.setupState.elevation = Math.max(0, Math.min(Math.PI / 3, value)); this.publish(); }
  setTip(x: number, y: number) { if (finite(x, y)) Object.assign(this.setupState, clampTip(x, y)); this.publish(); }

  /** Touch aim dial: a finger turn in radians (any wrap) turns the cue by DIAL_GAIN of it, until the cue is engaged. */
  rotateDial(radians: number) {
    const setup = this.setupState;
    if (!Number.isFinite(radians) || !this.canAct || this.context().phase !== 'ready' || setup.stage !== 'aim') return;
    setup.angle = wrap(setup.angle + wrap(radians) * DIAL_GAIN);
    this.publish();
  }
  /** Touch Engage: lock aim with no power set (the desktop first click); pressing again disengages, keeping contact and elevation. */
  toggleEngage() {
    const setup = this.setupState;
    if (setup.stage === 'power') { setup.stage = 'aim'; this.publish(); return; }
    if (!this.canAct || this.context().phase !== 'ready') return;
    Object.assign(setup, { stage: 'power', adjustment: null, power: 0 });
    this.view.resetAimPointer(); this.publish();
  }
  /** Touch power slider position, 0 (bottom) to 1; the bottom 5% is no power. Only an engaged cue listens, and letting go never shoots. */
  setSliderPower(value: number) {
    if (!Number.isFinite(value) || this.setupState.stage !== 'power' || !this.canAct || this.context().phase !== 'ready') return;
    this.setupState.power = value < .05 ? 0 : Math.min(1, value);
    this.publish();
  }
  /** Touch Shoot button. */
  touchShoot() { if (canTouchShoot(this.setupState, this.canAct, this.context().phase)) this.emit({ type: 'shoot', shot: this.shot() }); }

  /** Browser pointer lock state. Losing a lock this controller did not release is an Escape: cancel the setup. */
  pointerLockChanged(locked: boolean) {
    const released = this.releasingLock; this.releasingLock = false;
    if (locked === this.locked) return;
    this.locked = locked; this.view.resetAimPointer();
    if (locked) { this.lockErrors = 0; this.reanchorPower(); }
    else if (!released) this.cancel();
  }
  pointerLockError() { this.lockErrors++; }
  /** Dialogs, other views, turns this device does not play and window blur show the cursor again without cancelling. */
  releasePointerLock() { if (this.locked && !this.releasingLock) { this.releasingLock = true; this.view.exitPointerLock(); } }

  pointerEnter(pointer: Pick<PointerInput, 'x' | 'y'>) {
    if (this.locked) return;
    this.lastPointer = { x: pointer.x, y: pointer.y }; this.view.resetAimPointer();
    if (this.setupState.adjustment) this.adjustmentAnchor = { ...this.lastPointer }; else this.reanchorPower();
  }
  pointerLeave() { this.view.resetAimPointer(); }
  pointerMove(input: PointerInput) {
    const pointer = this.lockedPosition(input), dx = pointer.x - this.lastPointer.x, dy = pointer.y - this.lastPointer.y, setup = this.setupState;
    this.lastPointer = { x: pointer.x, y: pointer.y };
    if (pointer.buttons & 2) {
      if (!this.orbitPointer && !this.beginPointerOrbit(pointer)) return;
      const orbit = this.orbitPointer!;
      if (orbit.id === pointer.id) { this.view.orbitBy(pointer.x - orbit.x, pointer.y - orbit.y); orbit.x = pointer.x; orbit.y = pointer.y; }
      return;
    }
    if (this.orbitPointer) { this.endOrbit(); return; }
    if (this.keyboardOrbit) { this.view.orbitBy(dx, dy); return; }
    const { phase, width } = this.context();
    if (!this.canAct || this.shotPointer !== null && this.shotPointer !== pointer.id) return;
    if (phase === 'ball-in-hand') { this.view.showPlacement(this.view.tableAt(pointer.x, pointer.y)); return; }
    if (phase !== 'ready' || pointer.touch) return;
    if (setup.adjustment) this.moveAdjustment(pointer.x, pointer.y, pointer.shift);
    else if (setup.stage === 'aim') this.moveAim(pointer.x, pointer.y, pointer.shift);
    else if (finite(pointer.x, pointer.y, width)) {
      const anchor = this.powerAnchor, distance = -(pointer.x - anchor.x) * anchor.dx - (pointer.y - anchor.y) * anchor.dy;
      setup.power = Math.max(.05, Math.min(1, anchor.power + distance / Math.max(40, Math.min(180, width * .3))));
    }
    this.publish();
  }
  pointerDown(input: PointerInput) {
    const pointer = this.lockedPosition(input);
    if (pointer.button === 2) { this.beginPointerOrbit(pointer); return; }
    if (this.orbiting || this.setupState.adjustment) return;
    if (pointer.button !== 0 || this.shotPointer !== null || !pointer.primary || this.context().blocked) return;
    // A hidden locked cursor cannot target the coin slot or chalk.
    const control = this.locked ? null : this.view.tableControlAt(pointer.x, pointer.y);
    if (control) { this.emit({ type: control }); return; }
    if (!this.canAct) return;
    this.lastPointer = { x: pointer.x, y: pointer.y };
    const phase = this.context().phase;
    if (phase === 'ball-in-hand') { const point = this.view.tableAt(pointer.x, pointer.y); if (point) this.emit({ type: 'place', ...point }); return; }
    if (phase !== 'ready' || pointer.touch) return;
    // In the cue view an unlocked click only takes the cue: it locks the pointer, never aim or a shot.
    if (!this.locked && this.lockAvailable && this.context().cueView && this.view.requestPointerLock()) return;
    if (this.setupState.stage === 'aim') this.moveAim(pointer.x, pointer.y, pointer.shift);
    this.shotPointer = pointer.id;
    if (!this.locked) this.view.capturePointer(pointer.id, false);
  }
  pointerUp(input: PointerInput) {
    const pointer = this.lockedPosition(input);
    if (this.orbitPointer?.id === pointer.id && pointer.button === 2) { this.endOrbit(); return; }
    if (pointer.button !== 0 || this.shotPointer !== pointer.id) return;
    this.releaseShotPointer(); this.advance(pointer.x, pointer.y);
  }
  pointerLost(id: number) {
    if (this.shotPointer === id) this.shotPointer = null;
    if (this.orbitPointer?.id === id) this.endOrbit();
  }

  /** Returns true when the key was used and its browser default should be prevented. */
  keyDown(key: KeyInput): boolean {
    const { code } = key, setup = this.setupState;
    if (code === 'Escape') { this.cancel(); return false; }
    if (this.context().blocked || key.target === 'text') return false;
    if (code === 'KeyF' || code === 'KeyV') { if (!key.repeat) this.emit({ type: 'camera', toggleOverhead: code === 'KeyV' }); return true; }
    if (code === 'KeyB') { if (!key.repeat) this.emit({ type: 'cue-locker' }); return true; }
    if (code === 'KeyR') { if (!this.keyboardOrbit) { this.beginLook(); this.keyboardOrbit = true; this.held.add(code); } return true; }
    if (this.keyboardOrbit) { if (!code.startsWith('Arrow')) return false; this.held.add(code); return true; }
    if (!this.canAct || this.context().phase !== 'ready') return false;
    if (code === 'KeyS' || code === 'KeyE') { if (!key.repeat) { this.held.add(code); this.setAdjustment(code === 'KeyS' ? 'spin' : 'elevation'); } return true; }
    if (code === 'KeyC') { if (!key.repeat) this.emit({ type: 'chalk' }); return true; }
    if (code === 'KeyX') { Object.assign(setup, { elevation: 0, tipX: 0, tipY: 0 }); this.adjustmentAnchor = { ...this.lastPointer }; this.publish(); return true; }
    if (code === 'Space') { if (key.target === 'button') return false; if (!key.repeat) this.advance(); return true; }
    if (!code.startsWith('Arrow')) return false;
    const direction = code === 'ArrowUp' || code === 'ArrowRight' ? 1 : -1, fine = key.shift ? .2 : 1, horizontal = code === 'ArrowLeft' || code === 'ArrowRight';
    if (setup.adjustment === 'spin') Object.assign(setup, clampTip(setup.tipX + (horizontal ? direction * .06 * fine : 0), setup.tipY + (horizontal ? 0 : direction * .06 * fine)));
    else if (setup.adjustment === 'elevation') this.setElevation(setup.elevation + direction * Math.PI / 180 * fine);
    else if (setup.stage === 'aim' && horizontal) setup.angle += direction * .012 * fine;
    else if (setup.stage === 'power' && !horizontal) { this.setPower(setup.power + direction * .03 * fine); this.reanchorPower(); }
    if (setup.adjustment) this.adjustmentAnchor = { ...this.lastPointer };
    this.publish();
    return true;
  }
  keyUp(code: string) {
    this.held.delete(code);
    if (code === 'KeyR' && this.keyboardOrbit) { this.keyboardOrbit = false; if (!this.orbitPointer) this.endOrbit(); }
    const adjustment = this.setupState.adjustment;
    if (code === 'KeyS' && adjustment === 'spin' || code === 'KeyE' && adjustment === 'elevation') this.setAdjustment(this.heldAdjustment());
  }
  /** R + arrows rotate the view while held. A pointer lock lasts only while this device plays its turn in the cue view. */
  frame(dt: number) {
    const { blocked, cueView, ownTurn, phase } = this.context();
    if (blocked || !cueView || !ownTurn || phase !== 'ready' && phase !== 'rolling') this.releasePointerLock();
    if (!this.keyboardOrbit) return;
    const axis = (positive: string, negative: string) => (this.held.has(positive) ? 1 : 0) - (this.held.has(negative) ? 1 : 0);
    this.view.rotateView(axis('ArrowRight', 'ArrowLeft') * dt, axis('ArrowUp', 'ArrowDown') * dt * .65);
  }

  private shot(): Shot { const { angle, power, elevation, tipX, tipY } = this.setupState; return { angle, power, elevation, tipX, tipY }; }
  /** A locked pointer's screen position is frozen; integrate its movement into a virtual position instead. */
  private lockedPosition(pointer: PointerInput): PointerInput {
    return this.locked ? { ...pointer, x: this.lastPointer.x + (pointer.dx || 0), y: this.lastPointer.y + (pointer.dy || 0) } : pointer;
  }
  private publish() {
    const { angle, power, elevation, tipX, tipY, stage, adjustment } = this.setupState;
    this.view.showAim({ angle, power, elevation, tipX, tipY, pullback: stage === 'power' ? power : .02, contactEditing: !!adjustment });
  }
  private heldAdjustment(): Adjustment | null { return this.held.has('KeyS') ? 'spin' : this.held.has('KeyE') ? 'elevation' : null; }
  private reanchorPower() { const { x, y } = this.lastPointer; if (finite(x, y)) Object.assign(this.powerAnchor, { x, y, power: this.setupState.power }); }
  private setAdjustment(mode: Adjustment | null) {
    if (mode && (!this.canAct || this.context().phase !== 'ready')) return;
    this.setupState.adjustment = mode;
    if (mode) this.adjustmentAnchor = { ...this.lastPointer }; else this.reanchorPower();
    this.view.resetAimPointer(); this.publish();
  }
  private moveAdjustment(x: number, y: number, fine: boolean) {
    if (!finite(x, y)) return;
    const setup = this.setupState, anchor = this.adjustmentAnchor, scale = fine ? .25 : 1;
    if (setup.adjustment === 'spin') Object.assign(setup, clampTip(setup.tipX + (x - anchor.x) * .006 * scale, setup.tipY - (y - anchor.y) * .006 * scale));
    else if (setup.adjustment === 'elevation') setup.elevation = Math.max(0, Math.min(Math.PI / 3, setup.elevation + (anchor.y - y) * .004 * scale));
    this.adjustmentAnchor = { x, y };
  }
  private moveAim(x: number, y: number, fine: boolean) {
    const angle = this.view.aimAt(x, y), setup = this.setupState;
    if (angle !== null && Number.isFinite(angle)) setup.angle += Math.atan2(Math.sin(angle - setup.angle), Math.cos(angle - setup.angle)) * (fine ? .2 : 1);
    this.publish();
  }
  private releaseShotPointer() { const id = this.shotPointer; this.shotPointer = null; if (id !== null) this.view.releasePointer(id); }
  private beginLook() {
    this.releaseShotPointer(); this.setupState.adjustment = null; this.reanchorPower();
    this.view.beginOrbit(); this.view.resetAimPointer(); this.publish();
  }
  private beginPointerOrbit(pointer: PointerInput) {
    if (this.context().blocked || !pointer.primary) return false;
    this.beginLook(); this.orbitPointer = { id: pointer.id, x: pointer.x, y: pointer.y };
    // Pointer capture throws while the pointer is locked; the lock already delivers every event.
    if (!this.locked) this.view.capturePointer(pointer.id, true);
    return true;
  }
  /** Ending a look restores the selected view and resumes a still-held S/E modifier. */
  private endOrbit() {
    const pointer = this.orbitPointer; this.orbitPointer = null;
    this.view.releasePointer(pointer?.id ?? null);
    if (!this.keyboardOrbit) this.view.endOrbit();
    this.view.resetAimPointer(); this.reanchorPower();
    if (!this.keyboardOrbit) { const held = this.heldAdjustment(); if (held) { this.setupState.adjustment = held; this.adjustmentAnchor = { ...this.lastPointer }; } }
    this.publish();
  }
}
