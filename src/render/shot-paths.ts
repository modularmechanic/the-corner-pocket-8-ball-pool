import * as THREE from 'three';
import {
  FAN_RAY_COUNT,
  shotPreview,
  shotGuideRisk,
  type PreviewFan,
  type PreviewSegment,
  type PreviewShot,
} from '../simulation/shot-preview';
import { TABLE, type GameState } from '../simulation/types';

const VERTEX = `varying vec2 guideUv;
void main(){guideUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const COLORS = `vec3 riskColor(float score){
  vec3 green=vec3(.24,.94,.43),yellow=vec3(1.0,.84,.19),red=vec3(1.0,.22,.13);
  vec3 low=mix(green,yellow,smoothstep(.10,.58,score));
  return mix(low,red,smoothstep(.53,.94,score));
}`;
const RIBBON = `varying vec2 guideUv;
uniform float opacity,halo,arrows,clock,pathLength,colored,risk;
${COLORS}
void main(){
  float across=abs(guideUv.y*2.0-1.0);
  float aa=max(fwidth(across),.008);
  float lineWidth=mix(.72,.12,arrows);
  float crisp=1.0-smoothstep(lineWidth-aa,lineWidth+aa,across);
  float phase=fract(guideUv.x*pathLength/.62-clock*.92);
  float chevron=1.0-smoothstep(.022,.022+max(fwidth(phase)*1.4,.012),abs(phase-.74+across*.23));
  chevron*=smoothstep(.43,.48,phase)*(1.0-smoothstep(.78,.83,phase))*(1.0-smoothstep(.82,.98,across));
  float mark=max(crisp,chevron*arrows);
  float glow=exp(-pow(across/mix(.9,.32,arrows),2.0))*.7+chevron*arrows*.35;
  float ends=smoothstep(0.0,.012,guideUv.x)*smoothstep(0.0,.012,1.0-guideUv.x);
  gl_FragColor=vec4(mix(vec3(1.0),riskColor(risk),colored),mix(mark,glow,halo)*opacity*ends);
}`;
const FAN = `varying vec2 guideUv;
uniform float opacity,risk;
${COLORS}
void main(){
  float across=abs(guideUv.y*2.0-1.0);
  float edge=1.0-smoothstep(.985,1.0,across);
  float ends=smoothstep(0.0,.065,guideUv.x)*smoothstep(0.0,.025,1.0-guideUv.x);
  // The outer portion is a little warmer; the central route retains the exact
  // power/cut score. This is a visual difficulty gradient, not probability.
  float score=clamp(risk+across*across*.12*guideUv.x,0.0,1.0);
  gl_FragColor=vec4(riskColor(score),opacity*edge*ends*(.75+.25*guideUv.x));
}`;
const RING = `varying vec2 guideUv;
uniform float opacity;
void main(){
  float radius=length(guideUv-0.5)*2.0;
  float aa=max(fwidth(radius),0.008);
  float core=1.0-smoothstep(0.032-aa,0.032+aa,abs(radius-0.80));
  float glow=exp(-pow((radius-0.80)/0.11,2.0))*0.14;
  gl_FragColor=vec4(vec3(1.0),min(1.0,core+glow)*opacity);
}`;
function guideMaterial(fragmentShader: string, opacity: number, halo = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader,
    uniforms: {
      opacity: { value: opacity },
      halo: { value: halo },
      arrows: { value: 0 },
      clock: { value: 0 },
      pathLength: { value: 1 },
      colored: { value: 0 },
      risk: { value: 0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
type PathMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

/** Five fixed ribbons, one fixed 33-strip fan, and a ring. No meshes, materials,
 * index buffers or shader programs are created while aiming. */
export class ShotPaths {
  private group = new THREE.Group();
  private geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private paths: { core: PathMesh; glow: PathMesh }[] = [];
  private ghost: PathMesh;
  private fan: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fanPositions = new Float32Array(FAN_RAY_COUNT * 2 * 3);
  private fanEdges: PreviewSegment[] = [
    { kind: 'object', from: { x: 0, z: 0 }, to: { x: 0, z: 0 }, strength: 1 },
    { kind: 'object', from: { x: 0, z: 0 }, to: { x: 0, z: 0 }, strength: 1 },
  ];
  private clock = 0;
  private geometryInputs: number[] = [];
  private hasGeometry = false;
  private cutAngle: number | null = null;
  private disposed = false;
  constructor(scene: THREE.Scene) {
    this.group.name = 'shot-guidance';
    this.group.visible = false;
    scene.add(this.group);
    for (let i = 0; i < 5; i++) {
      const core = new THREE.Mesh(this.geometry, guideMaterial(RIBBON, 0.86));
      const glow = new THREE.Mesh(this.geometry, guideMaterial(RIBBON, 0.1, 1));
      core.name = i < 2 ? `shot-approach-edge-${i}` : i < 4 ? `shot-object-edge-${i - 2}` : 'shot-cue-continuation';
      glow.name = `${core.name}-glow`;
      core.position.y = 0.021;
      glow.position.y = 0.0205;
      core.renderOrder = 7;
      glow.renderOrder = 6;
      this.group.add(glow, core);
      this.paths.push({ core, glow });
    }
    const geometry = new THREE.BufferGeometry(),
      uv = new Float32Array(FAN_RAY_COUNT * 2 * 2),
      indices: number[] = [];
    geometry.setAttribute('position', new THREE.BufferAttribute(this.fanPositions, 3).setUsage(THREE.DynamicDrawUsage));
    for (let i = 0; i < FAN_RAY_COUNT; i++) {
      uv.set([0, i / (FAN_RAY_COUNT - 1), 1, i / (FAN_RAY_COUNT - 1)], i * 4);
      if (i < FAN_RAY_COUNT - 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    this.fan = new THREE.Mesh(geometry, guideMaterial(FAN, 0.2));
    this.fan.name = 'shot-cut-fan';
    this.fan.position.y = 0.0195;
    this.fan.renderOrder = 5;
    this.fan.frustumCulled = false;
    this.group.add(this.fan);
    const radius = TABLE.radius / 0.8;
    this.ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
      guideMaterial(RING, 0.86),
    );
    this.ghost.name = 'shot-contact-ring';
    this.ghost.renderOrder = 8;
    this.ghost.position.y = 0.022;
    this.group.add(this.ghost);
  }
  update(state: GameState, shot: PreviewShot, visible: boolean, focus = false, dt = 1 / 60): void {
    if (this.disposed) return;
    this.group.visible = visible && state.phase === 'ready';
    if (!this.group.visible) return;
    this.clock = (this.clock + (Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0)) % 1024;
    // Animation is a uniform update, not 33 new geometry queries and a GPU
    // buffer upload. Match snapshots also change for clocks unrelated to aiming.
    for (const path of this.paths) {
      path.core.material.uniforms.clock.value = this.clock;
      path.glow.material.uniforms.clock.value = this.clock;
    }
    if (!this.geometryChanged(state, shot.angle, focus)) {
      if (this.cutAngle !== null) {
        const risk = shotGuideRisk(shot.power ?? 0.65, this.cutAngle);
        this.fan.material.uniforms.risk.value = risk;
        for (let i = 2; i < 4; i++) {
          this.paths[i].core.material.uniforms.risk.value = risk;
          this.paths[i].glow.material.uniforms.risk.value = risk;
        }
      }
      return;
    }
    const preview = shotPreview(state, shot, focus);
    this.cutAngle = preview.fan?.cutAngle ?? null;
    for (let i = 0; i < 2; i++) this.setPath(i, preview.corridor[i], true, 0);
    this.fan.visible = !!preview.fan && preview.fan.cutAngle > 0.001;
    if (preview.fan) {
      this.placeFan(preview.fan);
      for (let i = 0; i < 2; i++) {
        const ray = preview.fan.rays[i === 0 ? 0 : FAN_RAY_COUNT - 1];
        this.fanEdges[i].from = ray.from;
        this.fanEdges[i].to = ray.to;
        this.setPath(i + 2, this.fanEdges[i], false, preview.fan.risk);
      }
    } else {
      this.setPath(2, null, false, 0);
      this.setPath(3, null, false, 0);
    }
    this.setPath(4, preview.segments.find((segment) => segment.kind === 'cue') ?? null, false, 0);
    this.ghost.visible = !!preview.ghost;
    if (preview.ghost) this.ghost.position.set(preview.ghost.x, 0.022, preview.ghost.z);
  }
  private geometryChanged(state: GameState, angle: number, focus: boolean): boolean {
    let cursor = 0,
      changed = !this.hasGeometry;
    const accept = (value: number) => {
      if (!Object.is(this.geometryInputs[cursor], value)) changed = true;
      this.geometryInputs[cursor++] = value;
    };
    accept(angle);
    accept(focus ? 1 : 0);
    accept(state.balls.length);
    for (const ball of state.balls) {
      accept(ball.id);
      accept(ball.pocketed ? 1 : 0);
      accept(ball.x);
      accept(ball.z);
      accept(ball.elevation ?? 0);
    }
    const obstacles = state.arcade?.obstacles ?? [];
    accept(obstacles.length);
    for (const obstacle of obstacles) {
      accept(obstacle.id);
      accept(obstacle.hp > 0 ? 1 : 0);
      accept(obstacle.x);
      accept(obstacle.z);
      accept(obstacle.width);
      accept(obstacle.depth);
    }
    let portals = 0;
    for (const hazard of state.arcade?.hazards ?? [])
      if (hazard.kind === 'portal') {
        portals++;
        accept(hazard.id);
        accept(hazard.x);
        accept(hazard.z);
        accept(hazard.radius);
      }
    accept(portals);
    if (this.geometryInputs.length !== cursor) changed = true;
    this.geometryInputs.length = cursor;
    this.hasGeometry = true;
    return changed;
  }
  private setPath(index: number, segment: PreviewSegment | null, arrows: boolean, risk: number): void {
    const path = this.paths[index],
      length = segment ? Math.hypot(segment.to.x - segment.from.x, segment.to.z - segment.from.z) : 0;
    path.core.visible = path.glow.visible = !!segment && length > 0.02;
    if (!segment || length <= 0.02) return;
    this.place(path.core, segment, arrows ? 0.082 : 0.02, 0.021);
    this.place(path.glow, segment, arrows ? 0.112 : 0.054, 0.0205);
    for (const [mesh, halo] of [
      [path.core, false],
      [path.glow, true],
    ] as const) {
      const uniforms = mesh.material.uniforms;
      uniforms.arrows.value = arrows ? 1 : 0;
      uniforms.clock.value = this.clock;
      uniforms.pathLength.value = length;
      uniforms.risk.value = risk;
      uniforms.colored.value = segment.kind === 'object' ? 1 : 0;
      uniforms.opacity.value = halo ? 0.1 : segment.kind === 'cue' ? 0.55 : 0.9;
    }
  }
  private placeFan(fan: PreviewFan): void {
    for (let i = 0; i < FAN_RAY_COUNT; i++) {
      const ray = fan.rays[i],
        offset = i * 6;
      this.fanPositions[offset] = ray.from.x;
      this.fanPositions[offset + 1] = 0;
      this.fanPositions[offset + 2] = ray.from.z;
      this.fanPositions[offset + 3] = ray.to.x;
      this.fanPositions[offset + 4] = 0;
      this.fanPositions[offset + 5] = ray.to.z;
    }
    this.fan.geometry.attributes.position.needsUpdate = true;
    this.fan.material.uniforms.risk.value = fan.risk;
    this.fan.material.uniforms.opacity.value = 0.22 * Math.sin(fan.cutAngle);
  }
  private place(mesh: PathMesh, segment: PreviewSegment, width: number, y: number): void {
    const dx = segment.to.x - segment.from.x,
      dz = segment.to.z - segment.from.z,
      length = Math.hypot(dx, dz);
    mesh.position.set((segment.from.x + segment.to.x) / 2, y, (segment.from.z + segment.to.z) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.scale.set(length, 1, width);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.ghost.geometry.dispose();
    this.fan.geometry.dispose();
    this.fan.material.dispose();
    for (const { core, glow } of this.paths) {
      core.material.dispose();
      glow.material.dispose();
    }
    this.ghost.material.dispose();
    this.group.clear();
  }
}
