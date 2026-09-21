import * as THREE from 'three';
import { TABLE, POCKETS, cueBallId, type GameState, type TableEvent } from '../simulation/types';
import { EFFECTS } from '../presentation/effects';

/** The two balls a ward protects: the striker's cue ball and the black. */
const BLACK_ID = 8;
const SHIELD_RADIUS = TABLE.radius * 1.68;
const RING_RADIUS = SHIELD_RADIUS * 1.06;
/** Seconds; also the window the impact ripple is evaluated over. */
const SAVE_RIPPLE = 0.75;

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  vNormal = normalMatrix * normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

/** Fresnel rim + a drifting weave. The centre stays near-transparent on purpose: the player aims through it. */
const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
uniform float uFlash;
uniform float uImpact;
uniform vec3 uImpactDir;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 2.4);
  float weave = smoothstep(0.6, 1.0, sin(vLocal.y * 34.0 - uTime * 2.2) * sin(vLocal.x * 26.0 + uTime * 1.6));
  // Kept deliberately dim: the scene runs bloom, and anything brighter blows out the ball underneath.
  float glow = rim * 1.25 + weave * (0.12 + rim * 0.5) + 0.025;
  float d = acos(clamp(dot(vLocal, uImpactDir), -1.0, 1.0));
  float ripple = exp(-pow((d - uImpact * 7.0) * 3.4, 2.0)) * exp(-uImpact * 4.0);
  glow += ripple * 2.7 + uFlash * (0.55 + rim * 2.0);
  // A white-hot edge; the ward green alone is too close to the baize to read from overhead.
  vec3 tint = uColor + vec3(pow(rim, 6.0) * 0.55 + uFlash * 0.35 + ripple * 0.6);
  gl_FragColor = vec4(tint * glow, clamp(glow, 0.0, 1.0) * uStrength);
}`;

interface Rig {
  group: THREE.Group;
  shell: THREE.Mesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>;
  rings: THREE.Mesh[];
  wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Ball this rig is riding this frame, or -1. */
  ball: number;
  strength: number;
  /** Seconds since the last save; >= SAVE_RIPPLE means idle. */
  impact: number;
  /** Seconds since the shield formed; drives the inward snap, kept apart from the save's outward recoil. */
  formAge: number;
  /** How hard the last save was, from the event's strength: a nudge and a smash should not read alike. */
  hit: number;
  waveAge: number;
  waveFrom: number;
}

/** A protective bubble around the warded balls, shown only while its owner is at the table.
 * Self-contained: `update` every frame, `handleEvent` for the save reaction, `dispose` at teardown. */
export class WardShield {
  private readonly group = new THREE.Group();
  private readonly rigs: Rig[] = [];
  private readonly shellGeometry = new THREE.IcosahedronGeometry(SHIELD_RADIUS, 3);
  private readonly ringGeometry = new THREE.TorusGeometry(RING_RADIUS, 0.011, 5, 40);
  private readonly waveGeometry = new THREE.RingGeometry(0.72, 1, 44);
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private clock = 0;
  /** Ward counters seen last frame, so a genuine 0 -> n grant bursts and a returning turn does not. */
  private seen: [number, number] = [0, 0];
  private pendingGrant: [boolean, boolean] = [false, false];
  constructor(private readonly scene: THREE.Scene) {
    const color = new THREE.Color(EFFECTS.ward.color);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 2; i++) this.rigs.push(this.buildRig(color));
    this.group.visible = false;
    scene.add(this.group);
  }
  private buildRig(color: THREE.Color): Rig {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      this.shellGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: color },
          uTime: { value: 0 },
          uStrength: { value: 0 },
          uFlash: { value: 0 },
          uImpact: { value: 9 },
          uImpactDir: { value: new THREE.Vector3(1, 0, 0) },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const rings = [0, 1].map((n) => {
      const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
      ring.rotation.x = Math.PI / 2 + (n ? 0.34 : 0);
      return ring;
    });
    const wave = new THREE.Mesh(
      this.waveGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    wave.rotation.x = -Math.PI / 2;
    wave.visible = false;
    group.add(shell, ...rings);
    // The wave lies on the cloth, so it hangs off the unscaled root: the rig's recoil must not stretch it.
    this.group.add(wave);
    // Two small groups that move every frame; culling them costs more than drawing them.
    group.frustumCulled = false;
    this.group.add(group);
    return { group, shell, rings, wave, ball: -1, strength: 0, impact: 9, formAge: 9, hit: 1, waveAge: 1, waveFrom: 0 };
  }
  /** Fires the impact ripple when the ward turns a ball away from a pocket. Tolerant of the exact event
   * tag the simulation settles on: anything carrying the ward power/status and a ball id counts. */
  handleEvent(event: TableEvent) {
    if (event.ball === undefined) return;
    if (event.power !== 'ward' && event.status !== 'ward') return;
    const rig = this.rigs.find((candidate) => candidate.ball === event.ball);
    if (!rig || rig.strength <= 0.01) return;
    this.strike(rig, event.x, event.z, Math.min(1, Math.max(0, event.strength || 1)));
  }
  private strike(rig: Rig, x: number, z: number, strength: number) {
    const dir = rig.shell.material.uniforms.uImpactDir.value as THREE.Vector3;
    dir.set(x - rig.group.position.x, 0, z - rig.group.position.z);
    if (dir.lengthSq() < 4e-4) {
      // The event landed on the ball centre; aim the ripple at the pocket it was heading for.
      const pocket = POCKETS.reduce((near, p) =>
        Math.hypot(p.x - rig.group.position.x, p.z - rig.group.position.z) <
        Math.hypot(near.x - rig.group.position.x, near.z - rig.group.position.z)
          ? p
          : near,
      );
      dir.set(pocket.x - rig.group.position.x, 0, pocket.z - rig.group.position.z);
    }
    dir.normalize();
    rig.impact = 0;
    rig.waveAge = 0;
    rig.waveFrom = SHIELD_RADIUS;
    rig.formAge = 9;
    rig.hit = 0.65 + 0.35 * strength;
  }
  update(state: GameState, dt: number) {
    const frameDt = Math.min(0.05, Math.max(0, dt));
    this.clock += frameDt;
    const buffs = state.arcade?.buffs;
    for (const player of [0, 1] as const) {
      const held = buffs?.[player]?.ward ?? 0;
      if (held > this.seen[player]) this.pendingGrant[player] = true;
      if (held <= 0) this.pendingGrant[player] = false;
      this.seen[player] = held;
    }
    const owner = state.turn;
    // The shield belongs to whoever is at the table: the owner's turn is the only time it is drawn.
    const active = (buffs?.[owner]?.ward ?? 0) > 0 && state.winner === null;
    const targets = active ? [cueBallId(state, owner), BLACK_ID] : [];
    const granting = active && this.pendingGrant[owner];
    if (granting) this.pendingGrant[owner] = false;
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      const ball = state.balls.find((b) => b.id === targets[i] && !b.pocketed);
      const want = ball ? 1 : 0;
      rig.ball = ball ? ball.id : -1;
      rig.strength += (want - rig.strength) * Math.min(1, frameDt * 7);
      if (ball) rig.group.position.set(ball.x, TABLE.radius + Math.max(0, ball.elevation || 0), ball.z);
      this.animate(rig, frameDt, granting && want === 1);
    }
    this.group.visible = this.rigs.some((rig) => rig.strength > 0.01);
  }
  private animate(rig: Rig, dt: number, granting: boolean) {
    if (granting && rig.impact > 1.5) {
      rig.formAge = 0;
      rig.waveAge = 0;
      rig.waveFrom = SHIELD_RADIUS * 0.5;
      rig.impact = 9;
    }
    rig.impact = Math.min(9, rig.impact + dt);
    rig.formAge = Math.min(9, rig.formAge + dt);
    const uniforms = rig.shell.material.uniforms;
    uniforms.uTime.value = this.clock;
    uniforms.uStrength.value = rig.strength;
    const saving = rig.impact < SAVE_RIPPLE ? Math.exp(-rig.impact * 9) * rig.hit : 0;
    const forming = Math.max(0, 1 - rig.formAge / 0.45);
    uniforms.uImpact.value = rig.impact;
    uniforms.uFlash.value = saving + forming * 0.9;
    // Recoil: a hit punches the bubble out and lets it wobble back; a fresh grant snaps it inward.
    const recoil = saving ? 1 + 0.3 * Math.exp(-rig.impact * 8) * Math.cos(rig.impact * 34) : 1;
    const snap = 1 + forming * forming * 0.85;
    rig.group.scale.setScalar(recoil * snap * (0.55 + 0.45 * rig.strength));
    // rings[0] is the flat containment circle and never tumbles: overhead needs one dependable ring.
    rig.rings[1].rotation.y = -this.clock * 0.8;
    rig.waveAge += dt;
    const wave = rig.wave;
    wave.visible = rig.waveAge < 0.55 && rig.strength > 0.01;
    if (wave.visible) {
      const t = rig.waveAge / 0.55;
      wave.scale.setScalar(rig.waveFrom + t * 1.15);
      wave.position.set(rig.group.position.x, 0.012, rig.group.position.z);
      wave.material.opacity = (1 - t) * (1 - t) * 0.85 * rig.strength;
    }
  }
  dispose() {
    this.scene.remove(this.group);
    for (const rig of this.rigs) {
      rig.shell.material.dispose();
      rig.wave.material.dispose();
    }
    this.shellGeometry.dispose();
    this.ringGeometry.dispose();
    this.waveGeometry.dispose();
    this.ringMaterial.dispose();
  }
}
