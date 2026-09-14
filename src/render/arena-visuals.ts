import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ArcadeState, Hazard, Obstacle, Pickup } from '../simulation/types';
import { effectDefinition } from '../presentation/effects';
import { canvasTexture, woodTexture } from './materials';
import { enableTableShadows } from './table-model';

interface ObstacleVisual { source: Obstacle; group: THREE.Group; body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>; pips: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[]; cracks: THREE.LineSegments; flash: number; material: Obstacle['material']; hp: number }
interface HazardVisual { source: Hazard; group: THREE.Group; spinner?: THREE.Group; arcs?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; arcStep: number; ripples: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[]; clouds: THREE.Sprite[] }
interface PickupVisual { source: Pickup; group: THREE.Group; capsule: THREE.Group; halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> }
interface Visual<T> { source: T; group: THREE.Group }

const PIP_COLORS = { wood: new THREE.Color('#edbf6a'), steel: new THREE.Color('#b3d8e3'), hex: new THREE.Color('#c5a3ef') };
const SPENT_PIP = new THREE.Color('#354044');
const ARC_VERTICES = 3 * 8 * 2;

const sameObstacle = (a: Obstacle, b: Obstacle) => a.x === b.x && a.z === b.z && a.width === b.width && a.depth === b.depth && a.material === b.material && a.maxHp === b.maxHp;
const sameHazard = (a: Hazard, b: Hazard) => a.kind === b.kind && a.x === b.x && a.z === b.z && a.radius === b.radius && a.angle === b.angle && a.link === b.link;
const samePickup = (a: Pickup, b: Pickup) => a.x === b.x && a.z === b.z && a.radius === b.radius && a.power === b.power;

function disposeGroup(group: THREE.Object3D) {
  group.removeFromParent();
  group.traverse(object => {
    // Sprites share one geometry across the whole application.
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose();
    const material = (object as THREE.Mesh).material;
    if (material) for (const item of Array.isArray(material) ? material : [material]) item.dispose();
  });
}

export interface ArenaTextures { wood(): THREE.Texture; smoke(): THREE.Texture }
/** Canvas-drawn when first needed, so browser only. */
export const ARENA_TEXTURES: ArenaTextures = {
  wood: woodTexture,
  smoke: () => canvasTexture(128, 128, ctx => { const gradient = ctx.createRadialGradient(64,64,0,64,64,62); gradient.addColorStop(0, '#e7efedb0'); gradient.addColorStop(.4, '#d7e2e977'); gradient.addColorStop(1, '#c4d4df00'); ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128); }),
};

/** Arcade obstacles, hazards and pickups, rebuilt per id only when their shape changes. */
export class ArenaVisuals {
  private obstacleVisuals = new Map<number, ObstacleVisual>();
  private hazardVisuals = new Map<number, HazardVisual>();
  private pickupVisuals = new Map<number, PickupVisual>();
  readonly obstacles: ReadonlyMap<number, { readonly group: THREE.Group }> = this.obstacleVisuals;
  readonly hazards: ReadonlyMap<number, { readonly group: THREE.Group }> = this.hazardVisuals;
  readonly pickups: ReadonlyMap<number, { readonly group: THREE.Group }> = this.pickupVisuals;
  private smokeTexture?: THREE.Texture;
  private seen = new Set<number>();
  constructor(private scene: THREE.Scene, private textures: ArenaTextures = ARENA_TEXTURES) {}

  /** Flashes a struck obstacle; returns its visual for the impact effect. */
  strikeObstacle(id: number): { readonly material: Obstacle['material'] } | undefined {
    const visual = this.obstacleVisuals.get(id); if (visual) visual.flash = 1;
    return visual;
  }

  update(arcade: Pick<ArcadeState, 'obstacles' | 'hazards' | 'pickups'> | undefined, clock: number, dt: number) {
    const obstacles = arcade?.obstacles ?? [], hazards = arcade?.hazards ?? [], pickups = arcade?.pickups ?? [];
    this.sync(this.obstacleVisuals, obstacles, sameObstacle, obstacle => this.buildObstacle(obstacle), visual => { visual.body.material.map?.dispose(); disposeGroup(visual.group); });
    this.sync(this.hazardVisuals, hazards, sameHazard, hazard => this.buildHazard(hazard), visual => disposeGroup(visual.group));
    this.sync(this.pickupVisuals, pickups, samePickup, pickup => this.buildPickup(pickup), visual => disposeGroup(visual.group));
    for (const obstacle of obstacles) {
      const visual = this.obstacleVisuals.get(obstacle.id)!;
      visual.group.visible = obstacle.hp > 0;
      visual.flash = Math.max(0, visual.flash - dt * 5);
      visual.body.material.emissiveIntensity = visual.flash * .55;
      visual.cracks.visible = obstacle.hp < obstacle.maxHp;
      if (visual.hp !== obstacle.hp) { visual.hp = obstacle.hp; for (let i = 0; i < visual.pips.length; i++) visual.pips[i].material.color.copy(i < obstacle.hp ? PIP_COLORS[visual.material] : SPENT_PIP); }
    }
    for (const pickup of pickups) {
      const visual = this.pickupVisuals.get(pickup.id)!;
      visual.group.visible = pickup.available; visual.capsule.rotation.y = clock * .55 + pickup.id * .7;
      visual.halo.material.opacity = .5 + Math.sin(clock * 2 + pickup.id) * .15;
    }
    for (const visual of this.hazardVisuals.values()) this.animateHazard(visual, clock);
  }

  dispose() {
    for (const visual of this.obstacleVisuals.values()) { visual.body.material.map?.dispose(); disposeGroup(visual.group); }
    for (const visual of [...this.hazardVisuals.values(), ...this.pickupVisuals.values()]) disposeGroup(visual.group);
    this.obstacleVisuals.clear(); this.hazardVisuals.clear(); this.pickupVisuals.clear();
    this.smokeTexture?.dispose(); this.smokeTexture = undefined;
  }

  private sync<T extends { id: number }, V extends Visual<T>>(visuals: Map<number, V>, items: readonly T[], same: (a: T, b: T) => boolean, build: (item: T) => V, dispose: (visual: V) => void) {
    const seen = this.seen; seen.clear();
    for (const item of items) {
      seen.add(item.id);
      const visual = visuals.get(item.id);
      if (visual && same(visual.source, item)) continue;
      if (visual) dispose(visual);
      const next = build(item); enableTableShadows(next.group); visuals.set(item.id, next);
    }
    if (visuals.size > seen.size) for (const [id, visual] of visuals) if (!seen.has(id)) { dispose(visual); visuals.delete(id); }
  }

  private buildPickup(pickup: Pickup): PickupVisual {
    const power=pickup.power||'focus',color=effectDefinition(power).color,radius=pickup.radius;
    const group=new THREE.Group();group.position.set(pickup.x,0,pickup.z);this.scene.add(group);
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(radius*.71,radius*.79,.04,40),new THREE.MeshStandardMaterial({color:'#4c554a',metalness:.8,roughness:.3}));plinth.position.y=.02;plinth.castShadow=true;group.add(plinth);
    const capsule=new THREE.Group();capsule.position.y=.17;group.add(capsule);
    const material=new THREE.MeshPhysicalMaterial({color,emissive:color,emissiveIntensity:.55,metalness:.32,roughness:.2,clearcoat:.8});
    const add=(geometry:THREE.BufferGeometry,x=0,y=0,z=0,mat:THREE.Material=material)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;capsule.add(mesh);return mesh;};
    if(power==='overdrive'){
      const flame=new THREE.Shape();flame.moveTo(0,-.13);flame.bezierCurveTo(-.2,-.1,-.17,.075,-.07,.12);flame.bezierCurveTo(-.055,.035,.025,.03,.015,.26);flame.bezierCurveTo(.22,.09,.2,-.07,0,-.13);
      const body=add(new THREE.ExtrudeGeometry(flame,{depth:.07,bevelEnabled:true,bevelSize:.012,bevelThickness:.014,bevelSegments:2,steps:1}),0,0,-.035);body.rotation.x=-.38;
      const core=add(new THREE.ConeGeometry(.06,.2,7),.015,-.005,.06,new THREE.MeshStandardMaterial({color:'#ffe49a',emissive:'#ffd473',emissiveIntensity:1.4}));core.rotation.z=-.16;
    }else if(power==='frost'){
      add(new THREE.IcosahedronGeometry(.125,0));
      for(let i=0;i<5;i++){const angle=i/5*Math.PI*2,crystal=add(new THREE.OctahedronGeometry(.085,0),Math.cos(angle)*.075,.015,Math.sin(angle)*.075);crystal.scale.set(.48,2.1,.48);crystal.rotation.z=Math.cos(angle)*.38;crystal.rotation.x=Math.sin(angle)*.38;}
    }else if(power==='ward'){
      const shield=new THREE.Shape();shield.moveTo(-.16,.13);shield.lineTo(.16,.13);shield.lineTo(.145,-.035);shield.quadraticCurveTo(.11,-.14,0,-.23);shield.quadraticCurveTo(-.11,-.14,-.145,-.035);shield.closePath();
      const body=add(new THREE.ExtrudeGeometry(shield,{depth:.065,bevelEnabled:true,bevelSize:.012,bevelThickness:.014,bevelSegments:2,steps:1}),0,.05,-.03);body.rotation.x=-.36;
      const crest=add(new THREE.BoxGeometry(.16,.028,.02),0,.015,.059,new THREE.MeshStandardMaterial({color:'#e0ffe8',emissive:'#c8efcb',emissiveIntensity:.35}));crest.rotation.x=-.36;
      add(new THREE.BoxGeometry(.028,.16,.02),0,.01,.07,new THREE.MeshStandardMaterial({color:'#e0ffe8',emissive:'#c8efcb',emissiveIntensity:.35}));
    }else if(power==='focus'){
      const ring=add(new THREE.TorusGeometry(.13,.018,8,40));ring.rotation.x=Math.PI/2;
      for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const mark=add(new THREE.BoxGeometry(.095,.035,.025),Math.cos(angle)*.16,0,Math.sin(angle)*.16);mark.rotation.y=-angle;}
      add(new THREE.SphereGeometry(.035,16,12));
    }else{
      const ring=add(new THREE.TorusGeometry(.14,.025,10,48));ring.rotation.x=.35;
      const second=add(new THREE.TorusGeometry(.1,.013,8,36));second.rotation.y=Math.PI/2;second.rotation.z=.4;
      add(new THREE.IcosahedronGeometry(.067,1),0,0,0,new THREE.MeshPhysicalMaterial({color:'#e0c4ff',emissive:'#b684ff',emissiveIntensity:1.2,transparent:true,opacity:.65,roughness:.08}));
    }
    const halo=new THREE.Mesh(new THREE.RingGeometry(radius*.93,radius,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));halo.rotation.x=-Math.PI/2;halo.position.y=.025;group.add(halo);
    return { source: { ...pickup }, group, capsule, halo };
  }

  private buildHazard(hazard: Hazard): HazardVisual {
    const copper = '#bd8652';
    const group = new THREE.Group(); group.position.set(hazard.x, 0, hazard.z); group.rotation.y = -(hazard.angle || 0); this.scene.add(group);
    const visual: HazardVisual = { source: { ...hazard }, group, ripples: [], clouds: [], arcStep: NaN };
    const radius = hazard.radius;
    const disc = (r: number, material: THREE.Material, y = .017) => { const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 80), material); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; group.add(mesh); return mesh; };
    const ring = (inner: number, outer: number, color: string, opacity = .8, y = .021) => {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; group.add(mesh); return mesh;
    };
    if (hazard.kind === 'ramp') {
      disc(radius, new THREE.MeshStandardMaterial({ color: '#473d28', transparent: true, opacity: .38, roughness: .8, depthWrite: false }));
      ring(radius - .015, radius, copper, .7);
      // A shallow copper launch plate rises in the same direction as the simulation's ramp angle.
      const halfLength = radius * .72, halfWidth = radius * .54;
      const ramp = new THREE.BufferGeometry();
      const low = .11 * (1 - halfLength / radius), high = .11 * (1 + halfLength / radius);
      const vertices = [ -halfLength,low,-halfWidth, halfLength,high,-halfWidth, halfLength,high,halfWidth, -halfLength,low,halfWidth, -halfLength,.005,-halfWidth, halfLength,.005,-halfWidth, halfLength,.005,halfWidth, -halfLength,.005,halfWidth ];
      ramp.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); ramp.setIndex([0,2,1,0,3,2,1,2,6,1,6,5,0,1,5,0,5,4,3,7,6,3,6,2]); ramp.computeVertexNormals();
      ramp.addGroup(0,6,0); ramp.addGroup(6,18,1);
      const mesh = new THREE.Mesh(ramp, [new THREE.MeshPhysicalMaterial({ color: copper, metalness: .72, roughness: .32, clearcoat: .2, side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({color:'#344045',metalness:.8,roughness:.43,side:THREE.DoubleSide})]); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
      for (const sign of [-1,1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(halfLength * 2,.018,.024),new THREE.MeshStandardMaterial({color:'#e2b977',metalness:.8,roughness:.24}));
        rail.position.set(0,(low+high)/2 + .012,sign*(halfWidth-.017)); rail.rotation.z = Math.atan2(high-low,halfLength*2); rail.castShadow=true; group.add(rail);
        for (const along of [-.6,.6]) {
          const x=along*halfLength,y=low+(x+halfLength)/(halfLength*2)*(high-low);
          const screw = new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,.012,8),new THREE.MeshStandardMaterial({color:'#d7d1bf',metalness:.9,roughness:.24}));
          screw.position.set(x,y+.013,sign*(halfWidth-.04)); group.add(screw);
        }
      }
      const chevrons: THREE.Vector3[] = [];
      for (const x of [-.28, .05, .38]) { const a = x * radius, y = .11 * (a / radius + 1) + .005, previousY = .11 * ((a - .1) / radius + 1) + .005; chevrons.push(new THREE.Vector3(a - .1, previousY, -.13), new THREE.Vector3(a, y, 0), new THREE.Vector3(a, y, 0), new THREE.Vector3(a - .1, previousY, .13)); }
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(chevrons), new THREE.LineBasicMaterial({ color: '#ffdd93' })));
    } else if (hazard.kind === 'portal') {
      const color = Math.min(hazard.id, hazard.link ?? hazard.id) % 2 ? '#cb95ff' : '#7bdfeb';
      disc(radius * .89, new THREE.MeshPhysicalMaterial({ color: '#091a20', metalness: .55, roughness: .12, clearcoat: 1 }),.023);
      const well = new THREE.Mesh(new THREE.CylinderGeometry(radius*.84,radius*.78,.1,64,1,true),new THREE.MeshStandardMaterial({color:'#26363e',metalness:.8,roughness:.27,side:THREE.DoubleSide})); well.position.y=.075; group.add(well);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius*.885,radius*.105,12,72),new THREE.MeshPhysicalMaterial({color:copper,metalness:.85,roughness:.25,clearcoat:.25})); rim.rotation.x=-Math.PI/2;rim.position.y=.108;rim.castShadow=true;group.add(rim);
      for(let i=0;i<8;i++) {
        const angle=i/8*Math.PI*2;
        const lug=new THREE.Mesh(new RoundedBoxGeometry(radius*.18,.055,radius*.2,2,.008),new THREE.MeshStandardMaterial({color:'#3a4649',metalness:.8,roughness:.33}));
        lug.position.set(Math.cos(angle)*radius*.885,.144,Math.sin(angle)*radius*.885);lug.rotation.y=Math.PI/2-angle;lug.castShadow=true;group.add(lug);
        const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.008,6),new THREE.MeshStandardMaterial({color:'#e8cb85',metalness:.9,roughness:.25}));bolt.position.set(lug.position.x,.175,lug.position.z);group.add(bolt);
      }
      ring(radius * .77, radius * .8, color, .85,.12);
      const spinner = new THREE.Group(); group.add(spinner); visual.spinner = spinner;
      for (let i = 0; i < 5; i++) {
        const segment = new THREE.Mesh(new THREE.RingGeometry(radius * (.34 + i * .08), radius * (.35 + i * .08), 40, 1, i * 1.4, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        segment.rotation.x = -Math.PI / 2; segment.position.y = .024 + i * .001; spinner.add(segment);
      }
      const halo = ring(radius * .83, radius * .855, color, .65, .15); visual.ripples.push(halo);
    } else if (hazard.kind === 'water' || hazard.kind === 'slime') {
      const color = hazard.kind === 'water' ? '#528f9a' : '#749334';
      disc(radius, new THREE.MeshPhysicalMaterial({ color, metalness: .15, roughness: hazard.kind === 'water' ? .07 : .19, clearcoat: 1, clearcoatRoughness: .07, transparent: true, opacity: .75, envMapIntensity: 1.3, depthWrite: false }));
      ring(radius - .017, radius, hazard.kind === 'water' ? '#a7d4df' : '#c3d878', .55);
      for (let i = 0; i < 3; i++) { const ripple = ring(radius * .3, radius * .3 + .009, hazard.kind === 'water' ? '#c6e5e9' : '#d2e27e', .3, .022 + i * .001); visual.ripples.push(ripple); }
      if (hazard.kind === 'slime') {
        for (let i = 0; i < 6; i++) {
          const angle = i * 2.4, r = radius * (.2 + (i % 3) * .19);
          const bubble = new THREE.Mesh(new THREE.SphereGeometry(.027 + (i % 3) * .009, 12, 8), new THREE.MeshPhysicalMaterial({ color: '#a4b952', roughness: .12, transparent: true, opacity: .7, clearcoat: 1 }));
          bubble.position.set(Math.cos(angle) * r, .017, Math.sin(angle) * r); bubble.scale.y = .35; group.add(bubble);
        }
      }
    } else if (hazard.kind === 'electric') {
      disc(radius, new THREE.MeshStandardMaterial({ color: '#253438', metalness: .7, roughness: .4 }));
      ring(radius - .03, radius, copper); ring(radius * .7, radius * .73, '#77dbe3', .6);
      for (let i = 0; i < 6; i++) {
        const angle = i / 6 * Math.PI * 2;
        const contact = new THREE.Mesh(new THREE.CylinderGeometry(.035, .04, .045, 12), new THREE.MeshStandardMaterial({ color: copper, metalness: .85, roughness: .25 })); contact.position.set(Math.cos(angle) * radius * .84, .039, Math.sin(angle) * radius * .84); group.add(contact);
      }
      const arcGeometry = new THREE.BufferGeometry();
      arcGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage));
      arcGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .062, 0), radius * .8 + .07);
      const arcs = new THREE.LineSegments(arcGeometry, new THREE.LineBasicMaterial({ color: '#9feaff', transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })); group.add(arcs); visual.arcs = arcs;
    } else {
      disc(radius, new THREE.MeshBasicMaterial({ color: '#becac1', transparent: true, opacity: .11, depthWrite: false })); ring(radius - .016, radius, '#b3c0b9', .4);
      this.smokeTexture ||= this.textures.smoke();
      for (let i = 0; i < 5; i++) {
        const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTexture, color: '#e1e8e5', transparent: true, opacity: .14, depthWrite: false })); cloud.scale.setScalar(radius * 1.15); group.add(cloud); visual.clouds.push(cloud);
      }
    }
    return visual;
  }

  private buildObstacle(obstacle: Obstacle): ObstacleVisual {
    const group = new THREE.Group(); group.position.set(obstacle.x, 0, obstacle.z); this.scene.add(group);
    const color = obstacle.material === 'steel' ? '#586975' : obstacle.material === 'hex' ? '#594664' : '#b17b42';
    const material = new THREE.MeshPhysicalMaterial({ color, map: obstacle.material === 'wood' ? this.textures.wood() : null, emissive: obstacle.material === 'hex' ? '#ab70df' : '#edbe77', metalness: obstacle.material === 'steel' ? .8 : .2, roughness: obstacle.material === 'steel' ? .32 : .5, clearcoat: .25 });
    // The footprint matches the collider; decorative edges stay inside that footprint.
    const body = new THREE.Mesh(new RoundedBoxGeometry(obstacle.width - .012, .46, obstacle.depth - .012, 2, .012), material);
    body.position.y = .23; body.castShadow = true; body.receiveShadow = true; group.add(body);
    for(const y of [.065,.34]) {
      const band=new THREE.Mesh(new RoundedBoxGeometry(obstacle.width,.032,obstacle.depth,2,.008),new THREE.MeshStandardMaterial({color:obstacle.material==='wood'?'#3a3e38':obstacle.material==='hex'?'#ad91bd':'#9faeb4',metalness:.78,roughness:.34}));
      band.position.y=y;band.castShadow=true;group.add(band);
    }
    for(const x of [-1,1])for(const z of [-1,1]) {
      const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.014,6),new THREE.MeshStandardMaterial({color:obstacle.material==='wood'?'#bbaa77':'#d4d7cb',metalness:.85,roughness:.3}));
      bolt.position.set(x*(obstacle.width/2-.037),.467,z*(obstacle.depth/2-.037));group.add(bolt);
    }
    const isWide = obstacle.width >= obstacle.depth, longSide = Math.max(obstacle.width, obstacle.depth), shortSide = Math.min(obstacle.width, obstacle.depth);
    if(obstacle.material==='wood') {
      const seams:THREE.Vector3[]=[];
      for(const fraction of [-.3,0,.3]) {
        const along=longSide*fraction;
        if(isWide)seams.push(new THREE.Vector3(along,.462,-obstacle.depth/2+.02),new THREE.Vector3(along,.462,obstacle.depth/2-.02));
        else seams.push(new THREE.Vector3(-obstacle.width/2+.02,.462,along),new THREE.Vector3(obstacle.width/2-.02,.462,along));
      }
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seams),new THREE.LineBasicMaterial({color:'#473a26',transparent:true,opacity:.6})));
    }
    const panelShort = obstacle.material === 'wood' ? Math.min(.13,shortSide-.09) : shortSide-.09;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(isWide ? longSide - .09 : panelShort, .008, isWide ? panelShort : longSide - .09), new THREE.MeshStandardMaterial({ color: '#1f2526', metalness: .65, roughness: .48 }));
    plate.position.y = .464; group.add(plate);
    const pips: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
    const span = longSide - .17, step = span / obstacle.maxHp, pipLength = Math.min(.14, step * .65);
    for (let i = 0; i < obstacle.maxHp; i++) {
      const pip = new THREE.Mesh(new THREE.BoxGeometry(isWide ? pipLength : .037, .009, isWide ? .037 : pipLength), new THREE.MeshBasicMaterial({ color: PIP_COLORS[obstacle.material] }));
      const position = (i - (obstacle.maxHp - 1) / 2) * step;
      pip.position.set(isWide ? position : 0, .473, isWide ? 0 : position); group.add(pip); pips.push(pip);
    }
    const crackPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const along = (i - 1) * longSide * .21;
      const point = (a: number, b: number) => new THREE.Vector3(isWide ? a : b, .478, isWide ? b : a);
      crackPoints.push(point(along - .04, -.08), point(along, 0), point(along, 0), point(along + .065, .07));
    }
    const cracks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(crackPoints), new THREE.LineBasicMaterial({ color: '#0c1416', transparent: true, opacity: .65 }));
    cracks.visible = false; group.add(cracks);
    return { source: { ...obstacle }, group, body, pips, cracks, flash: 0, material: obstacle.material, hp: -1 };
  }

  private animateHazard(visual: HazardVisual, clock: number) {
    const { id, kind, radius } = visual.source;
    if (visual.spinner) visual.spinner.rotation.y = clock * .8;
    for (let i = 0; i < visual.ripples.length; i++) {
      const ripple = visual.ripples[i];
      if (kind === 'portal') { ripple.material.opacity = .45 + Math.sin(clock * 2.8 + id) * .14; continue; }
      const phase = (clock * (kind === 'water' ? .25 : .11) + i / 3) % 1;
      ripple.scale.setScalar(.3 + phase * 2.75); ripple.material.opacity = Math.sin(phase * Math.PI) * .3;
    }
    if (visual.arcs) {
      // Lightning jumps 12 times a second; the buffer is rewritten only then.
      const step = Math.floor(clock * 12);
      if (step !== visual.arcStep) {
        visual.arcStep = step;
        const position = visual.arcs.geometry.getAttribute('position') as THREE.BufferAttribute;
        let vertex = 0;
        for (let branch = 0; branch < 3; branch++) {
          const angle = branch * Math.PI / 3 + .25, cos = Math.cos(angle), sin = Math.sin(angle);
          let x = -cos * radius * .8, y = .062, z = -sin * radius * .8;
          for (let segment = 1; segment <= 8; segment++) {
            const distance = (segment / 4 - 1) * radius * .8;
            const bend = Math.sin(segment * 7.8 + step * 2.6 + branch) * .05;
            position.setXYZ(vertex++, x, y, z);
            x = cos * distance - sin * bend; y = .062 + Math.abs(bend) * .25; z = sin * distance + cos * bend;
            position.setXYZ(vertex++, x, y, z);
          }
        }
        position.needsUpdate = true;
      }
      visual.arcs.material.opacity = .5 + Math.sin(clock * 9 + id) * .18;
    }
    for (let i = 0; i < visual.clouds.length; i++) {
      const cloud = visual.clouds[i], angle = i * 2.4 + clock * .16;
      cloud.position.set(Math.cos(angle) * radius * .24, .14 + (i % 2) * .08, Math.sin(angle) * radius * .24);
      cloud.material.rotation = -angle * .3; cloud.material.opacity = .11 + Math.sin(clock * .6 + i) * .025;
    }
  }
}
