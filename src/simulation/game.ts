import { canEquipCue, equippedCue, normalizeCues } from './cues';
import type * as R from '@dimforge/rapier3d-compat';
import {
  initialState,
  legalTargets,
  POCKETS,
  TABLE,
  other,
  seededRandom,
  type Ball,
  type GameState,
  type Shot,
  type ShotResult,
  type GameOptions,
  type TableEvent,
  type PowerUp,
} from './types';
import { groupChoice, settleShot } from './settlement';
import {
  inPlacementZone,
  isClearBallSpot,
  isCueLie,
  snookered,
  TABLE_RAILS,
  TABLE_NOSES,
  surfaceDragAt,
  rollingDeceleration,
  STICKY_DRAG,
  AIR_DRAG,
} from './table-geometry';
import { createArcade, LAYOUTS, makePickup, pickupPosition } from './arcade';

function readOnlyView<T extends object>(source: T): T {
  const views = new WeakMap<object, object>();
  const view = (target: object): object => {
    const existing = views.get(target);
    if (existing) return existing;
    const proxy = new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key);
        return value && typeof value === 'object' ? view(value) : value;
      },
      set() {
        throw new TypeError('PoolGame.state is read-only; edit snapshot() and call arrange().');
      },
      deleteProperty() {
        throw new TypeError('PoolGame.state is read-only; edit snapshot() and call arrange().');
      },
      defineProperty() {
        throw new TypeError('PoolGame.state is read-only; edit snapshot() and call arrange().');
      },
      setPrototypeOf() {
        throw new TypeError('PoolGame.state is read-only; edit snapshot() and call arrange().');
      },
      preventExtensions() {
        throw new TypeError('PoolGame.state is read-only; edit snapshot() and call arrange().');
      },
    });
    views.set(target, proxy);
    return proxy;
  };
  return view(source) as T;
}

let initialization: Promise<void> | null = null;
const GRAVITY = 14;
const FLIGHT_EPSILON = 0.004;
let RAPIER: typeof R.default;
// Loaded lazily so a failed .wasm download rejects here, inside the caller's error handling, not during bundle evaluation.
export function initPhysics() {
  return (initialization ??= import('@dimforge/rapier3d-compat').then((module) => {
    RAPIER = module.default;
    // Compat types declare init(), but the browser build aliases @dimforge/rapier3d, which instantiates on import and has none.
    return RAPIER.init?.();
  }));
}
export class PoolGame {
  private current!: GameState;
  private stateView!: Readonly<GameState>;
  private world!: R.World;
  /** Read-only live view. Use snapshot() and arrange() to change an arrangement. */
  get state(): Readonly<GameState> {
    return this.stateView;
  }
  private bodies = new Map<number, R.RigidBody>();
  private colliderIds = new Map<number, number>();
  private colliderKeys = new Map<number, string>();
  private activeContacts = new Set<string>();
  private events = new RAPIER.EventQueue(true);
  private shotResult: ShotResult = { firstContact: null, potted: [], railAfterContact: false, breakRails: [] };
  private legalBefore: number[] = [];
  private stillTime = 0;
  private rollTime = 0;
  private obstacleColliders = new Map<number, number>();
  private obstacleCooldown = new Map<number, number>();
  private zoneOccupants = new Map<number, Set<number>>();
  private portalCooldown = new Map<number, number>();
  private hazardRewards = new Set<string>();
  private portalRewardPending = false;
  private pickupRandom!: () => number;
  private pickupDraws = 0;
  private nextPickupAt = 0;
  private nextPickupId = 2;
  private cueSpin = { side: 0, follow: 0, energy: 0, elevation: 0, tipY: 0, dx: 1, dz: 0, contact: false };
  private pendingSpin = { x: 0, z: 0 };
  onEvent?: (event: TableEvent) => void;
  constructor(seed: string, options: GameOptions = {}) {
    const state = initialState(seed, options.format, options.rules);
    state.arcade = createArcade(
      typeof options.layout === 'string' && Object.hasOwn(LAYOUTS, options.layout) ? options.layout : 'crossfire',
      seed,
      options.level,
    );
    this.arrange(state);
  }
  /** Rebuild a complete table without exposing Rapier handles or shared mutable state. */
  arrange(input: GameState): void {
    const state = structuredClone(input),
      continuation = state.simulation;
    delete state.simulation;
    state.cues = normalizeCues(state.cues, state.format, state.arcade?.level);
    state.rules = state.rules === 'old' ? 'old' : 'new';
    state.shotsLeft = state.shotsLeft === 1 || state.shotsLeft === 2 ? state.shotsLeft : 0;
    state.freeShot = state.freeShot === true;
    state.nominated = state.nominated === 'solids' || state.nominated === 'stripes' ? state.nominated : null;
    state.rebreak = state.rebreak === true;
    if (
      state.balls.length !== 16 ||
      new Set(state.balls.map((b) => b.id)).size !== 16 ||
      state.balls.some(
        (b) =>
          !Number.isInteger(b.id) ||
          b.id < 0 ||
          b.id > 15 ||
          ![b.x, b.z, b.vx, b.vz, b.elevation ?? 0, b.vy ?? 0].every(Number.isFinite) ||
          (b.elevation ?? 0) < 0,
      )
    )
      throw new Error('An arrangement requires sixteen uniquely numbered balls with finite positions and velocities.');
    if (
      state.arcade?.obstacles.some(
        (o) => ![o.x, o.z, o.width, o.depth, o.hp, o.maxHp].every(Number.isFinite) || o.width <= 0 || o.depth <= 0,
      )
    )
      throw new Error('Arrangement obstacles require finite positive dimensions.');
    state.balls.sort((a, b) => a.id - b.id);
    for (const ball of state.balls) {
      ball.elevation = ball.elevation ?? 0;
      ball.vy = ball.vy ?? 0;
      ball.airborne = !ball.pocketed && (ball.elevation > FLIGHT_EPSILON || Math.abs(ball.vy) > 0.18);
      if (ball.pocketed) {
        ball.vx = 0;
        ball.vz = 0;
        ball.vy = 0;
      }
    }
    this.world?.free();
    this.events.free();
    this.events = new RAPIER.EventQueue(true);
    this.bodies.clear();
    this.colliderIds.clear();
    this.colliderKeys.clear();
    this.obstacleColliders.clear();
    this.activeContacts = new Set(continuation?.activeContacts ?? []);
    this.current = state;
    this.stateView = readOnlyView(state);
    this.shotResult = continuation?.shotResult ?? {
      firstContact: null,
      potted: [],
      railAfterContact: false,
      breakRails: [],
      offTable: [],
    };
    this.legalBefore = continuation?.legalBefore ?? legalTargets(state).map((b) => b.id);
    this.stillTime = continuation?.stillTime ?? 0;
    this.rollTime = continuation?.rollTime ?? 0;
    this.portalRewardPending = continuation?.portalRewardPending ?? false;
    this.obstacleCooldown = new Map(continuation?.obstacleCooldown ?? []);
    this.portalCooldown = new Map(continuation?.portalCooldown ?? []);
    this.zoneOccupants = new Map((continuation?.zoneOccupants ?? []).map(([id, zones]) => [id, new Set(zones)]));
    this.hazardRewards = new Set(continuation?.hazardRewards ?? []);
    this.cueSpin = continuation?.cueSpin ?? {
      side: 0,
      follow: 0,
      energy: 0,
      elevation: 0,
      tipY: 0,
      dx: 1,
      dz: 0,
      contact: false,
    };
    this.pendingSpin = continuation?.pendingSpin ?? { x: 0, z: 0 };
    const random = seededRandom(state.seed + ':pickup-stream');
    this.pickupDraws = continuation?.pickupDraws ?? 0;
    for (let i = 0; i < this.pickupDraws; i++) random();
    this.pickupRandom = () => {
      this.pickupDraws++;
      return random();
    };
    this.nextPickupAt = continuation?.nextPickupAt ?? (state.arcade?.clock ?? 0) + 5 + this.pickupRandom() * 4;
    this.nextPickupId =
      continuation?.nextPickupId ?? Math.max(2, ...(state.arcade?.pickups ?? []).map((p) => p.id + 1));
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 120;
    this.world.numSolverIterations = 12;
    for (const [id, rail] of TABLE_RAILS.entries()) {
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(rail.halfWidth, rail.halfHeight, rail.halfDepth)
          .setTranslation(rail.x, rail.y, rail.z)
          .setRestitution(rail.restitution)
          .setFriction(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      );
      this.colliderIds.set(collider.handle, -1);
      this.colliderKeys.set(collider.handle, `rail:${id}`);
    }
    for (const [id, nose] of TABLE_NOSES.entries()) {
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(nose.radius)
          .setTranslation(nose.x, nose.y, nose.z)
          .setRestitution(nose.restitution)
          .setFriction(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      );
      this.colliderIds.set(collider.handle, -1);
      this.colliderKeys.set(collider.handle, `nose:${id}`);
    }
    for (const ball of this.current.balls) {
      // Rapier resolves all three sphere axes. Cloth support/gravity are applied
      // below so a resting flat rack receives no perpetual gravity impulses.
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(ball.x, TABLE.radius + (ball.elevation || 0), ball.z)
          .lockRotations()
          .setCcdEnabled(true)
          .setCanSleep(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(TABLE.radius)
          .setRestitution(0.96)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setFriction(0)
          .setDensity(1)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      this.bodies.set(ball.id, body);
      this.colliderIds.set(collider.handle, ball.id);
      this.colliderKeys.set(collider.handle, `ball:${ball.id}`);
      body.setEnabled(!ball.pocketed);
      body.setLinvel({ x: ball.vx, y: ball.vy || 0, z: ball.vz }, false);
      if (!ball.airborne && !ball.elevation && !ball.vy && !ball.vx && !ball.vz) body.sleep();
    }
    for (const obstacle of this.current.arcade?.obstacles || []) {
      if (obstacle.hp <= 0) continue;
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(obstacle.width / 2, 0.26, obstacle.depth / 2)
          .setTranslation(obstacle.x, 0.2, obstacle.z)
          .setRestitution(0.74)
          .setFriction(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      );
      this.colliderIds.set(collider.handle, -2 - obstacle.id);
      this.obstacleColliders.set(obstacle.id, collider.handle);
      this.colliderKeys.set(collider.handle, `obstacle:${obstacle.id}`);
    }
  }
  private emit(event: Omit<TableEvent, 'time'>) {
    this.onEvent?.({ ...event, time: this.rollTime });
  }
  chalkCue(): boolean {
    if (this.current.phase !== 'ready' || this.current.chalked[this.current.turn]) return false;
    this.current.chalked[this.current.turn] = true;
    const cue = this.current.balls[0];
    this.emit({ kind: 'chalk', x: cue.x, z: cue.z, strength: 0.65, ball: 0 });
    return true;
  }
  equipCue(seat: number, cue: unknown): boolean {
    if (
      !['ready', 'ball-in-hand'].includes(this.current.phase) ||
      !Number.isInteger(seat) ||
      seat < 0 ||
      seat >= this.current.cues.length ||
      !canEquipCue(cue, this.current.arcade?.level)
    )
      return false;
    this.current.cues[seat] = cue;
    return true;
  }
  shoot(shot: Shot): boolean {
    if (
      this.current.phase !== 'ready' ||
      !Number.isFinite(shot?.angle) ||
      !Number.isFinite(shot?.power) ||
      shot.power < 0.03 ||
      shot.power > 1
    )
      return false;
    const elevation = shot.elevation === undefined ? 0 : shot.elevation,
      tipX = shot.tipX === undefined ? 0 : shot.tipX,
      tipY = shot.tipY === undefined ? 0 : shot.tipY;
    if (
      ![elevation, tipX, tipY].every(Number.isFinite) ||
      elevation < 0 ||
      elevation > Math.PI / 3 ||
      Math.hypot(tipX, tipY) > 0.80000001
    )
      return false;
    const cue = this.current.balls[0];
    if (cue.pocketed) return false;
    const chalked = this.current.chalked[this.current.turn];
    this.current.chalked[this.current.turn] = false;
    this.current.lastShot = { angle: shot.angle, power: shot.power, elevation, tipX, tipY };
    this.legalBefore = legalTargets(this.current).map((b) => b.id);
    this.shotResult = { firstContact: null, potted: [], railAfterContact: false, breakRails: [], offTable: [] };
    this.current.lastPotted = [];
    this.current.foul = false;
    this.current.phase = 'rolling';
    this.current.message = 'A little patience. Let the table do its thing.';
    this.stillTime = 0;
    this.rollTime = 0;
    this.obstacleCooldown.clear();
    this.zoneOccupants.clear();
    this.portalCooldown.clear();
    this.hazardRewards.clear();
    if (this.current.arcade) this.current.arcade.combo = 0;
    const arcade = this.current.arcade,
      buffs = arcade?.buffs[this.current.turn];
    if (arcade && buffs) {
      arcade.activeShot = {
        overdrive: buffs.overdrive > 0,
        frozen: buffs.frozen > 0,
        ward: buffs.ward > 0,
        focus: buffs.focus > 0,
        sticky: buffs.sticky > 0,
        chalked,
        elevation,
        tipX,
        tipY,
      };
      buffs.overdrive = 0;
      buffs.frozen = 0;
      buffs.ward = 0;
      buffs.focus = 0;
      buffs.jammed = 0;
      buffs.sticky = 0;
    }
    const equipment = equippedCue(this.current);
    const efficiency = 1 - ((chalked ? 0.04 : 0.22) * (tipX * tipX + tipY * tipY)) / 0.64;
    const strikeSpeed = Math.min(
      23,
      (1.4 + shot.power * 15) *
        equipment.power *
        (arcade?.activeShot.overdrive ? 1.3 : 1) *
        (arcade?.activeShot.frozen ? 0.65 : 1) *
        efficiency,
    );
    // Deliberate arcade jump: a hard, low contact can scoop the ball; a raised
    // cue contributes lift too. The vertical launch consumes horizontal energy.
    const hard = Math.max(0, (shot.power - 0.55) / 0.45),
      low = Math.max(0, (-tipY - 0.3) / 0.5);
    const rawLift = Math.min(
      5.4,
      (4.2 * low * Math.pow(hard, 0.85) + 3.1 * Math.sin(elevation) ** 2 * Math.max(0, (shot.power - 0.4) / 0.6)) *
        (chalked ? 1.05 : 1),
    );
    const lift = rawLift > 0.45 ? rawLift : 0;
    const flatSpeed = strikeSpeed * Math.cos(elevation);
    const speed = Math.sqrt(Math.max(flatSpeed * flatSpeed * 0.45, flatSpeed * flatSpeed - lift * lift * 0.75));
    cue.vx = Math.cos(shot.angle) * speed;
    cue.vz = Math.sin(shot.angle) * speed;
    cue.vy = lift;
    cue.elevation = 0;
    cue.airborne = lift > 0.1;
    const grip = (chalked ? 1.12 : 0.8) * equipment.spin,
      side = tipX * speed * 0.13 * grip,
      follow = tipY * speed * 0.26 * grip * (1 + 0.55 * Math.sin(elevation));
    this.cueSpin = {
      side,
      follow,
      energy: side * side + follow * follow,
      elevation,
      tipY,
      dx: Math.cos(shot.angle),
      dz: Math.sin(shot.angle),
      contact: false,
    };
    this.pendingSpin = { x: 0, z: 0 };
    this.bodies.get(0)!.setLinvel({ x: cue.vx, y: lift, z: cue.vz }, true);
    this.emit({ kind: 'cue', strength: shot.power, x: cue.x, z: cue.z, ball: 0, elevation, tipX, tipY, chalked });
    if (cue.airborne)
      this.emit({ kind: 'jump', strength: Math.min(1, lift / 5.4), x: cue.x, z: cue.z, ball: 0, elevation: 0 });
    return true;
  }
  /** Places the cue ball in the kitchen, or keeps it where it lies when placement is optional. */
  placeCue(x: number, z: number): boolean {
    if (this.current.phase !== 'ball-in-hand' || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (isCueLie(this.current, { x, z })) {
      this.current.phase = 'ready';
      this.current.message = 'Playing from where the cue ball lies.';
      return true;
    }
    if (!inPlacementZone(this.current, { x, z }) || !isClearBallSpot(this.current, { x, z }, 0, 'placement'))
      return false;
    this.respot(0, x, z);
    // A New Rules free ball needs the foul snooker to still exist from the new position.
    if (this.current.rules === 'new' && this.current.freeShot)
      this.current.freeShot = snookered(this.current, this.current.turn);
    this.current.phase = 'ready';
    this.current.message = 'Cue ball placed. Find your angle.';
    return true;
  }
  chooseGroup(group: unknown): boolean {
    const changes = groupChoice(this.current, group);
    if (changes) Object.assign(this.current, changes);
    return !!changes;
  }
  private respot(id: number, x: number, z: number) {
    const ball = this.current.balls[id];
    ball.x = x;
    ball.z = z;
    ball.vx = 0;
    ball.vz = 0;
    ball.vy = 0;
    ball.airborne = false;
    ball.elevation = 0;
    ball.pocketed = false;
    const body = this.bodies.get(id)!;
    body.setEnabled(true);
    body.setTranslation({ x, y: TABLE.radius, z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  step(dt = 1 / 120): boolean {
    if (!Number.isFinite(dt) || dt <= 0 || this.current.phase === 'over') return false;
    dt = Math.min(dt, 1 / 30);
    this.advancePickups(dt);
    if (this.current.phase !== 'rolling') return false;
    // No body travels more than one third of its radius in a collision step.
    const maxSpeed = Math.max(...this.current.balls.map((b) => Math.hypot(b.vx, b.vy || 0, b.vz)));
    const steps = Math.max(1, Math.ceil((maxSpeed * dt) / (TABLE.radius / 3)));
    for (let i = 0; i < steps; i++) if (this.integrateStep(dt / steps)) return true;
    return false;
  }
  /** Catch up quiet tables at pickup event boundaries, on the fixed-step clock. */
  advanceIdle(seconds: number): void {
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      this.current.phase === 'rolling' ||
      this.current.phase === 'over' ||
      !this.current.arcade
    )
      return;
    let remaining = seconds;
    while (remaining > 1e-9) {
      const arcade = this.current.arcade;
      const deadline = Math.min(
        this.nextPickupAt,
        ...arcade.pickups.filter((p) => p.available && p.expiresAt !== undefined).map((p) => p.expiresAt!),
      );
      const untilEvent = Math.max(1 / 120, Math.ceil((deadline - (arcade.clock ?? 0)) * 120 - 1e-8) / 120);
      const elapsed = Math.min(remaining, untilEvent);
      this.advancePickups(elapsed);
      remaining -= elapsed;
    }
  }
  private integrateStep(dt: number): boolean {
    if (this.current.phase !== 'rolling') return false;
    const energyBefore = this.current.balls.reduce(
      (sum, b) =>
        sum + (b.pocketed ? 0 : b.vx * b.vx + b.vz * b.vz + (b.vy || 0) ** 2 + 2 * GRAVITY * (b.elevation || 0)),
      0,
    );
    this.rollTime += dt;
    this.world.timestep = dt;
    // Symmetric gravity integration conserves flight energy between collisions.
    for (const ball of this.current.balls)
      if (!ball.pocketed && ball.airborne) {
        const body = this.bodies.get(ball.id)!;
        const velocity = body.linvel();
        body.setLinvel({ x: velocity.x, y: velocity.y - (GRAVITY * dt) / 2, z: velocity.z }, true);
      }
    this.world.step(this.events);
    this.events.drainCollisionEvents((a, b, started) => {
      const key = [this.colliderKeys.get(a), this.colliderKeys.get(b)].sort().join('|');
      if (!started) {
        this.activeContacts.delete(key);
        return;
      }
      // Rebuilt worlds announce existing contact pairs again. A restored touch
      // must not repeat spin transfer, block damage or collision events.
      if (this.activeContacts.has(key)) return;
      this.activeContacts.add(key);
      const ia = this.colliderIds.get(a),
        ib = this.colliderIds.get(b);
      if (ia === undefined || ib === undefined) return;
      if (ia < -1 || ib < -1) {
        const obstacleId = -(ia < -1 ? ia : ib) - 2,
          ballId = ia >= 0 ? ia : ib;
        if (ballId < 0) return;
        const ball = this.current.balls[ballId],
          obstacle = this.current.arcade!.obstacles.find((o) => o.id === obstacleId)!;
        const speed = Math.hypot(ball.vx, ball.vz);
        this.shotResult.obstacleContact = true;
        if (speed > 0.55 && this.rollTime - (this.obstacleCooldown.get(obstacleId) ?? -1) > 0.12 && obstacle.hp > 0) {
          this.obstacleCooldown.set(obstacleId, this.rollTime);
          const damage = (speed > 9 ? 2 : 1) * (this.current.arcade!.activeShot.overdrive ? 2 : 1);
          obstacle.hp = Math.max(0, obstacle.hp - damage);
          this.emit({
            kind: 'obstacle',
            strength: Math.min(1, speed / 10),
            x: ball.x,
            z: ball.z,
            obstacle: obstacleId,
            destroyed: obstacle.hp === 0,
          });
          if (obstacle.hp === 0) {
            const handle = this.obstacleColliders.get(obstacleId)!;
            const collider = this.world.getCollider(handle);
            if (collider) this.world.removeCollider(collider, true);
            this.colliderIds.delete(handle);
            this.obstacleColliders.delete(obstacleId);
            if (this.current.arcade!.activeShot.overdrive)
              this.bodies
                .get(ballId)!
                .setLinvel({ x: ball.vx * 0.72, y: this.bodies.get(ballId)!.linvel().y, z: ball.vz * 0.72 }, true);
            const arcade = this.current.arcade!;
            arcade.destroyed[this.current.turn]++;
            arcade.scores[this.current.turn] += obstacle.maxHp * 50;
            if (obstacle.material === 'hex') arcade.buffs[this.current.turn].jammed = 1;
            else this.addPickup(obstacle.x, obstacle.z);
          }
        }
        return;
      }
      if (this.shotResult.firstContact === null) {
        if (ia === 0 && ib > 0) this.shotResult.firstContact = ib;
        if (ib === 0 && ia > 0) this.shotResult.firstContact = ia;
      }
      if (((ia === 0 && ib > 0) || (ib === 0 && ia > 0)) && !this.cueSpin.contact) {
        this.cueSpin.contact = true;
        this.pendingSpin.x += this.cueSpin.dx * this.cueSpin.follow;
        this.pendingSpin.z += this.cueSpin.dz * this.cueSpin.follow;
        this.cueSpin.follow = 0;
      }
      if ((ia === 0 && ib === -1) || (ib === 0 && ia === -1)) {
        const cue = this.current.balls[0],
          nx = Math.abs(cue.x) > 5.3 ? Math.sign(cue.x) : 0,
          nz = nx ? 0 : Math.sign(cue.z);
        this.pendingSpin.x -= nz * this.cueSpin.side * 0.8;
        this.pendingSpin.z += nx * this.cueSpin.side * 0.8;
        this.cueSpin.side *= 0.6;
      }
      if ((ia === -1 || ib === -1) && this.shotResult.firstContact !== null) {
        this.shotResult.railAfterContact = true;
        const id = ia === -1 ? ib : ia;
        if (id > 0 && !this.shotResult.breakRails.includes(id)) this.shotResult.breakRails.push(id);
      }
      const ba = this.current.balls[ia >= 0 ? ia : ib],
        bb = ia >= 0 && ib >= 0 ? this.current.balls[ib] : null;
      let speed = 0;
      if (bb) {
        const dx = bb.x - ba.x,
          dy = (bb.elevation || 0) - (ba.elevation || 0),
          dz = bb.z - ba.z,
          len = Math.hypot(dx, dy, dz) || 1;
        speed = Math.abs(((ba.vx - bb.vx) * dx + ((ba.vy || 0) - (bb.vy || 0)) * dy + (ba.vz - bb.vz) * dz) / len);
      } else speed = Math.abs(ba.x) > 5.3 ? Math.abs(ba.vx) : Math.abs(ba.vz);
      if (speed > 0.12)
        this.emit({
          kind: bb ? 'ball' : 'cushion',
          strength: Math.min(1, speed / 11),
          x: bb ? (ba.x + bb.x) / 2 : ba.x,
          z: bb ? (ba.z + bb.z) / 2 : ba.z,
          ball: ba.id,
          elevation: ba.elevation || 0,
        });
    });
    let moving = false;
    for (const ball of this.current.balls) {
      if (ball.pocketed) continue;
      const body = this.bodies.get(ball.id)!;
      const p = body.translation(),
        v = body.linvel();
      const wasAirborne = !!ball.airborne;
      let vy = Math.max(-10, Math.min(8, v.y - (wasAirborne ? (GRAVITY * dt) / 2 : 0)));
      let height = Math.max(0, p.y - TABLE.radius);
      let landed = false;
      if (p.y <= TABLE.radius + FLIGHT_EPSILON && vy <= 0.18) {
        landed = wasAirborne;
        // Felt absorbs the vertical impact; a small bounce is retained only for
        // fast descents. Tiny contacts settle without repeatedly waking the rack.
        const rebound = vy < -2.4 ? -vy * 0.13 : 0;
        height = 0;
        vy = rebound > 0.45 ? rebound : 0;
        body.setTranslation({ x: p.x, y: TABLE.radius, z: p.z }, false);
        if (landed)
          this.emit({
            kind: 'land',
            strength: Math.min(1, Math.abs(v.y) / 5),
            x: p.x,
            z: p.z,
            ball: ball.id,
            elevation: 0,
          });
      }
      ball.elevation = height;
      ball.vy = vy;
      ball.airborne = height > FLIGHT_EPSILON || vy > 0.18;
      if (ball.airborne && !wasAirborne)
        this.emit({
          kind: 'jump',
          strength: Math.min(1, Math.max(vy, Math.sqrt(2 * GRAVITY * height)) / 5.4),
          x: p.x,
          z: p.z,
          ball: ball.id,
          elevation: height,
        });
      ball.x = p.x;
      ball.z = p.z;
      const pocket = !ball.airborne && POCKETS.some((pk) => Math.hypot(p.x - pk.x, p.z - pk.z) < TABLE.pocketRadius);
      const out = Math.abs(p.x) > 5.96 || Math.abs(p.z) > 3.15;
      if (pocket || out) {
        ball.pocketed = true;
        ball.vx = 0;
        ball.vz = 0;
        ball.vy = 0;
        ball.airborne = false;
        body.setEnabled(false);
        if (pocket) this.shotResult.potted.push(ball.id);
        else (this.shotResult.offTable ??= []).push(ball.id);
        this.emit({
          kind: pocket ? 'pocket' : 'out',
          strength: Math.min(1, 0.45 + Math.hypot(v.x, v.y, v.z) / 15),
          x: p.x,
          z: p.z,
          ball: ball.id,
          elevation: height,
        });
        continue;
      }
      const speed = Math.hypot(v.x, v.z);
      const zoneDrag = ball.airborne ? 1 : surfaceDragAt(this.current.arcade, { x: p.x, z: p.z });
      const drag = ball.airborne
        ? speed * AIR_DRAG
        : rollingDeceleration(
            speed,
            zoneDrag * (ball.id === 0 && this.current.arcade?.activeShot.sticky ? STICKY_DRAG : 1),
          );
      const next = Math.max(0, speed - dt * drag) * (landed ? 0.985 : 1);
      const ratio = speed > 0 ? next / speed : 0;
      ball.vx = v.x * ratio;
      ball.vz = v.z * ratio;
      if (next < 0.035 && !ball.airborne) {
        ball.vx = 0;
        ball.vz = 0;
      } else moving = true;
      if (ball.airborne) moving = true;
      if (!body.isSleeping()) body.setLinvel({ x: ball.vx, y: ball.vy || 0, z: ball.vz }, false);
    }
    // Dense rack contacts can inject energy through iterative restitution solving.
    // Preserve solved directions while bounding kinetic plus gravitational energy.
    // Flat shots retain the exact speed-squared guard used by hard rack breaks.
    const kineticAfter = this.current.balls.reduce(
      (sum, b) => sum + (b.pocketed ? 0 : b.vx * b.vx + b.vz * b.vz + (b.vy || 0) ** 2),
      0,
    );
    const potentialAfter = this.current.balls.reduce(
      (sum, b) => sum + (b.pocketed ? 0 : 2 * GRAVITY * (b.elevation || 0)),
      0,
    );
    if (kineticAfter + potentialAfter > energyBefore && kineticAfter > 0) {
      const scale = Math.sqrt(Math.max(0, energyBefore - potentialAfter) / kineticAfter);
      for (const ball of this.current.balls)
        if (!ball.pocketed) {
          ball.vx *= scale;
          ball.vz *= scale;
          ball.vy = (ball.vy || 0) * scale;
          const body = this.bodies.get(ball.id)!;
          if (!body.isSleeping()) body.setLinvel({ x: ball.vx, y: ball.vy, z: ball.vz }, false);
        }
    }
    this.applyCueSpin(dt);
    for (const ball of this.current.balls)
      if (!ball.pocketed) {
        this.applyHazards(ball);
        this.collectPickups(ball);
      }
    this.stillTime = moving ? 0 : this.stillTime + dt;
    if (this.stillTime > 0.18 || this.rollTime > 28) {
      for (const b of this.current.balls) {
        b.vx = 0;
        b.vz = 0;
        b.vy = 0;
        b.airborne = false;
        if (!b.pocketed) b.elevation = 0;
        const body = this.bodies.get(b.id)!;
        body.setTranslation({ x: b.x, y: TABLE.radius + (b.elevation || 0), z: b.z }, false);
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.sleep();
      }
      const settled = settleShot(this.current, this.shotResult, {
        legalBefore: this.legalBefore,
        shooter: this.current.turn,
        pendingPortal: this.portalRewardPending,
      });
      this.current = settled.state;
      this.stateView = readOnlyView(this.current);
      for (const spot of settled.respots) this.respot(spot.id, spot.x, spot.z);
      for (const event of settled.events) this.emit(event);
      this.portalRewardPending = false;
      return true;
    }
    return false;
  }
  private applyCueSpin(dt: number) {
    const cue = this.current.balls[0],
      spin = this.cueSpin;
    if (cue.pocketed) {
      this.pendingSpin = { x: 0, z: 0 };
      return;
    }
    // Spin grips the cloth, not the air. Raised low-side strikes curve more;
    // rotating horizontal velocity keeps this controlled without creating energy.
    const curve = cue.airborne
      ? 0
      : spin.side *
        Math.sin(spin.elevation) *
        0.14 *
        (1 + Math.max(0, -spin.tipY) * 0.7) *
        equippedCue(this.current).curve *
        dt;
    if (Math.abs(curve) > 1e-9) {
      const x = cue.vx,
        z = cue.vz;
      cue.vx = x * Math.cos(curve) - z * Math.sin(curve);
      cue.vz = x * Math.sin(curve) + z * Math.cos(curve);
    }
    if (!cue.airborne && (this.pendingSpin.x || this.pendingSpin.z)) {
      const before = cue.vx * cue.vx + cue.vz * cue.vz;
      let x = cue.vx + this.pendingSpin.x,
        z = cue.vz + this.pendingSpin.z;
      const requested = x * x + z * z,
        allowed = Math.min(23 * 23, before + spin.energy);
      if (requested > allowed && requested > 0) {
        const scale = Math.sqrt(allowed / requested);
        x *= scale;
        z *= scale;
      }
      spin.energy = Math.max(0, spin.energy - Math.max(0, x * x + z * z - before));
      cue.vx = x;
      cue.vz = z;
      this.pendingSpin = { x: 0, z: 0 };
    }
    const body = this.bodies.get(0)!;
    if (Math.hypot(cue.vx, cue.vz) > 0.001) body.setLinvel({ x: cue.vx, y: cue.vy || 0, z: cue.vz }, true);
    spin.follow *= Math.exp(-(cue.airborne ? 0.12 : 0.9) * dt);
    spin.side *= Math.exp(-(cue.airborne ? 0.08 : 0.3) * dt);
    spin.energy *= Math.exp(-(cue.airborne ? 0.12 : 0.8) * dt);
  }
  private addPickup(x: number, z: number) {
    const arcade = this.current.arcade;
    if (!arcade) return;
    const active = arcade.pickups.filter((p) => p.available);
    if (active.length >= 3) {
      const oldest = active.reduce((a, b) => ((a.expiresAt ?? Infinity) < (b.expiresAt ?? Infinity) ? a : b));
      oldest.available = false;
      this.emit({ kind: 'expire', x: oldest.x, z: oldest.z, pickup: oldest.id, power: oldest.power, strength: 0.35 });
    }
    this.nextPickupId = Math.max(this.nextPickupId, ...arcade.pickups.map((p) => p.id + 1));
    const pickup = makePickup(this.current.seed, this.nextPickupId++, x, z, arcade.clock || 0);
    arcade.pickups = arcade.pickups.filter((p) => p.available);
    arcade.pickups.push(pickup);
    this.emit({ kind: 'spawn', x, z, pickup: pickup.id, power: pickup.power, strength: 0.45 });
  }
  // LocalMatch reuses its frozen state view on a quiet table and refreshes only the clock.
  // Every other visible idle change here (spawn, expiry) must emit an event to invalidate that view.
  private advancePickups(dt: number) {
    const arcade = this.current.arcade;
    if (!arcade) return;
    arcade.clock = (arcade.clock || 0) + dt;
    for (const pickup of arcade.pickups)
      if (pickup.available && pickup.expiresAt !== undefined && arcade.clock >= pickup.expiresAt) {
        pickup.available = false;
        this.emit({ kind: 'expire', x: pickup.x, z: pickup.z, pickup: pickup.id, power: pickup.power, strength: 0.35 });
      }
    arcade.pickups = arcade.pickups.filter((p) => p.available);
    if (arcade.clock >= this.nextPickupAt) {
      if (arcade.pickups.length < 3) {
        const position = pickupPosition(this.current, this.pickupRandom);
        if (position) this.addPickup(position.x, position.z);
      }
      this.nextPickupAt = arcade.clock + 5 + this.pickupRandom() * 4;
    }
  }
  private collectPickups(ball: Ball) {
    const arcade = this.current.arcade;
    if (!arcade || ball.id !== 0 || ball.airborne || Math.hypot(ball.vx, ball.vz) < 0.25) return;
    for (const pickup of arcade.pickups) {
      if (!pickup.available || Math.hypot(ball.x - pickup.x, ball.z - pickup.z) > pickup.radius + TABLE.radius)
        continue;
      pickup.available = false;
      const power =
        pickup.power ?? makePickup(this.current.seed, pickup.id, pickup.x, pickup.z, arcade.clock || 0).power!;
      if (power === 'portal') this.portalRewardPending = true;
      else if (power === 'frost') arcade.buffs[other(this.current.turn)].frozen = 1;
      else arcade.buffs[this.current.turn][power] = 1;
      arcade.scores[this.current.turn] += 25;
      this.emit({
        kind: 'pickup',
        power,
        reason: 'pickup',
        pickup: pickup.id,
        x: pickup.x,
        z: pickup.z,
        ball: ball.id,
        strength: 1,
      });
    }
  }
  private applyHazards(ball: Ball) {
    const arcade = this.current.arcade;
    if (!arcade) return;
    const previous = this.zoneOccupants.get(ball.id) || new Set<number>();
    const occupied = new Set<number>();
    for (const hazard of arcade.hazards) {
      if (Math.hypot(ball.x - hazard.x, ball.z - hazard.z) >= hazard.radius) continue;
      occupied.add(hazard.id);
      if (ball.airborne) continue;
      const speed = Math.hypot(ball.vx, ball.vz);
      if (previous.has(hazard.id) || speed < 0.25) continue;
      if (hazard.kind === 'portal') {
        if (this.rollTime < (this.portalCooldown.get(ball.id) || 0)) continue;
        const destination = arcade.hazards.find((h) => h.id === hazard.link && h.kind === 'portal');
        if (!destination) continue;
        // Pick a clear exit. Never teleport into another ball, a block, or a pocket.
        const heading = Math.atan2(ball.vz, ball.vx),
          distance = destination.radius + TABLE.radius + 0.1;
        for (const offset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
          const angle = heading + offset,
            x = destination.x + Math.cos(angle) * distance,
            z = destination.z + Math.sin(angle) * distance;
          if (!isClearBallSpot(this.current, { x, z }, ball.id, 'portal-exit')) continue;
          const fromX = ball.x,
            fromZ = ball.z;
          ball.x = x;
          ball.z = z;
          ball.vx = Math.cos(angle) * speed;
          ball.vz = Math.sin(angle) * speed;
          ball.vy = 0;
          ball.elevation = 0;
          ball.airborne = false;
          ball.teleport = (ball.teleport || 0) + 1;
          const body = this.bodies.get(ball.id)!;
          body.setTranslation({ x, y: TABLE.radius, z }, true);
          body.setLinvel({ x: ball.vx, y: 0, z: ball.vz }, true);
          this.portalCooldown.set(ball.id, this.rollTime + 0.8);
          occupied.add(destination.id);
          this.emit({ kind: 'hazard', hazard: 'portal', x, z, fromX, fromZ, strength: 0.8, ball: ball.id });
          break;
        }
        break;
      }
      if (hazard.kind === 'ramp' || hazard.kind === 'electric') {
        const along = ball.vx * Math.cos(hazard.angle || 0) + ball.vz * Math.sin(hazard.angle || 0);
        if (hazard.kind === 'ramp' && along < speed * 0.25) continue;
        const nextSpeed = Math.min(23, speed * (hazard.kind === 'ramp' ? 1.14 : 1.18));
        ball.vx *= nextSpeed / speed;
        ball.vz *= nextSpeed / speed;
        if (hazard.kind === 'ramp') {
          ball.vy = Math.min(2.45, 2.05 + speed * 0.02);
          ball.airborne = true;
          this.emit({
            kind: 'jump',
            x: ball.x,
            z: ball.z,
            ball: ball.id,
            elevation: ball.elevation || 0,
            strength: ball.vy / 5.4,
          });
        }
        this.bodies.get(ball.id)!.setLinvel({ x: ball.vx, y: ball.vy || 0, z: ball.vz }, true);
      }
      if (hazard.kind === 'smoke' && ball.id === 0) arcade.buffs[this.current.turn].jammed = 1;
      const rewardKey = ball.id + ':' + hazard.id;
      if ((hazard.kind === 'electric' || hazard.kind === 'ramp') && !this.hazardRewards.has(rewardKey)) {
        arcade.scores[this.current.turn] += 15;
        this.hazardRewards.add(rewardKey);
      }
      this.emit({
        kind: 'hazard',
        hazard: hazard.kind,
        x: ball.x,
        z: ball.z,
        strength: Math.min(1, 0.3 + speed / 15),
        ball: ball.id,
      });
    }
    this.zoneOccupants.set(ball.id, occupied);
  }
  /** Detached table data without the continuation metadata that only arrange() needs. */
  detachedState(): GameState {
    return structuredClone(this.current);
  }
  snapshot(): GameState {
    return {
      ...this.detachedState(),
      simulation: structuredClone({
        shotResult: this.shotResult,
        legalBefore: this.legalBefore,
        stillTime: this.stillTime,
        rollTime: this.rollTime,
        portalRewardPending: this.portalRewardPending,
        pickupDraws: this.pickupDraws,
        nextPickupAt: this.nextPickupAt,
        nextPickupId: this.nextPickupId,
        obstacleCooldown: [...this.obstacleCooldown],
        portalCooldown: [...this.portalCooldown],
        zoneOccupants: [...this.zoneOccupants].map(([id, zones]) => [id, [...zones]]),
        hazardRewards: [...this.hazardRewards],
        activeContacts: [...this.activeContacts],
        cueSpin: this.cueSpin,
        pendingSpin: this.pendingSpin,
      }),
    };
  }
  dispose() {
    this.events.free();
    this.world.free();
  }
}
