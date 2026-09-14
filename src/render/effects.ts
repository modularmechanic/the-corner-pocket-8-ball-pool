import * as THREE from 'three';
import { effectDefinition } from '../presentation/effects';
import type { Ball, TableEvent } from '../simulation/types';

interface Pooled { age: number; life: number }
interface Spark extends Pooled { position: THREE.Vector3; velocity: THREE.Vector3; color: THREE.Color }
interface Debris extends Pooled { position: THREE.Vector3; velocity: THREE.Vector3; rotation: THREE.Euler; spin: THREE.Vector3; scale: THREE.Vector3; color: THREE.Color; steel: boolean }
interface Ripple extends Pooled { x: number; z: number; color: THREE.Color; size: number }
interface TrailParticle { position:THREE.Vector3;velocity:THREE.Vector3;age:number;life:number;ice:boolean }
interface Flash { light:THREE.PointLight;mesh:THREE.Mesh<THREE.SphereGeometry,THREE.MeshBasicMaterial>;age:number;life:number;strength:number }
interface Arc {line:THREE.LineSegments<THREE.BufferGeometry,THREE.LineBasicMaterial>;age:number;life:number;radius:number;x:number;z:number}
interface Ribbon {mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;age:number;life:number;x:number;z:number}

const pool = <T extends Pooled>(length: number, create: () => Omit<T, keyof Pooled>) => Array.from({ length }, () => ({ ...create(), age: 1, life: 0 }) as T);
function nextFree(items: readonly Pooled[], from: number) { while (from < items.length && items[from].age < items[from].life) from++; return from; }
/** One draw call per effect kind: per-instance RGBA rides in an instanced `color` attribute (vertexColors with alpha). */
function instanced<M extends THREE.Material>(name: string, geometry: THREE.BufferGeometry, material: M, capacity: number) {
  geometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.InstancedMesh(geometry, material, capacity); mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

/** Cosmetic only: none of these transient objects participate in the simulation. */
export class TableEffects {
  private group = new THREE.Group();
  private sparks = pool<Spark>(120, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color() }));
  private debris = pool<Debris>(70, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), rotation: new THREE.Euler(), spin: new THREE.Vector3(), scale: new THREE.Vector3(), color: new THREE.Color(), steel: false }));
  private ripples = pool<Ripple>(16, () => ({ x: 0, z: 0, color: new THREE.Color(), size: 0 }));
  private sparkMesh = instanced('effect-sparks', new THREE.SphereGeometry(.012, 5, 4), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 120);
  private debrisMeshes = [.1, .6].map((metalness, steel) => instanced(steel ? 'effect-debris-steel' : 'effect-debris', new THREE.BoxGeometry(.075, .04, .045), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .65, metalness, transparent: true }), 70));
  private rippleMesh = instanced('effect-ripples', new THREE.RingGeometry(.94, 1, 64), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), 16);
  private trails:TrailParticle[]=Array.from({length:80},()=>({position:new THREE.Vector3(),velocity:new THREE.Vector3(),age:1,life:0,ice:false}));
  private nextTrail=0;
  private trailClock=0;
  private fire=new THREE.InstancedMesh(new THREE.ConeGeometry(.055,.19,6),new THREE.MeshBasicMaterial({color:'#fff5df',transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false}),80);
  private ice=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.065,0),new THREE.MeshPhysicalMaterial({color:'#c1edff',metalness:.12,roughness:.12,clearcoat:1,transparent:true,opacity:.85}),80);
  private flashes:Flash[]=[];
  private arcs:Arc[]=[];
  private ribbons:Ribbon[]=[];
  private dummy=new THREE.Object3D();
  private color=new THREE.Color();
  constructor(scene: THREE.Scene) {
    for (const mesh of this.debrisMeshes) mesh.castShadow = true;
    this.group.add(this.sparkMesh, ...this.debrisMeshes, this.rippleMesh);
    scene.add(this.group);this.fire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.ice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.fire.frustumCulled=false;this.ice.frustumCulled=false;this.fire.count=0;this.ice.count=0;this.group.add(this.fire,this.ice);
    for(let i=0;i<3;i++){
      const light=new THREE.PointLight('#ffb76a',0,3.3,2),mesh=new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),new THREE.MeshBasicMaterial({color:'#ffe8c1',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));light.userData.performanceFlash=true;mesh.visible=false;this.group.add(light,mesh);this.flashes.push({light,mesh,age:1,life:0,strength:0});
    }
    for(let i=0;i<4;i++){
      const arcGeometry=new THREE.BufferGeometry();arcGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(56*3),3).setUsage(THREE.DynamicDrawUsage));
      const line=new THREE.LineSegments(arcGeometry,new THREE.LineBasicMaterial({color:'#aeeaff',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));line.visible=false;line.frustumCulled=false;this.group.add(line);this.arcs.push({line,age:1,life:0,radius:.7,x:0,z:0});
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(49*6),3));const indices=[];for(let j=0;j<48;j++)indices.push(j*2,j*2+1,j*2+2,j*2+1,j*2+3,j*2+2);geometry.setIndex(indices);
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#caa9ff',transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));mesh.visible=false;mesh.frustumCulled=false;this.group.add(mesh);this.ribbons.push({mesh,age:1,life:0,x:0,z:0});
    }
  }

  emit(event: TableEvent, material: 'wood' | 'steel' | 'hex' = 'wood') {
    if(event.kind==='chalk') { this.burst(event.x,event.z,'#94c2da',8,.08);return; }
    if(event.kind==='spawn'){this.ripple(event.x,event.z,'#d8eddb',.5,.42);this.burst(event.x,event.z,'#e8dfbc',5,.25);return;}
    if(event.kind==='expire'){this.ripple(event.x,event.z,'#7f968d',.32,.23);return;}
    if (event.kind === 'hazard') {
      const color = event.hazard === 'electric' ? '#a2ebff' : event.hazard === 'slime' ? '#d0e480' : event.hazard === 'portal' ? '#bbd6ff' : event.hazard === 'ramp' ? '#eac185' : '#b4d5df';
      this.ripple(event.x, event.z, color, event.hazard === 'portal' ? .9 : .45, .38);
      if (event.hazard === 'portal' && event.fromX !== undefined && event.fromZ !== undefined) this.ripple(event.fromX, event.fromZ, color, .9, .38);
      if (event.hazard === 'electric' || event.hazard === 'portal') {this.burst(event.x,event.z,color,12,.75);this.flash(event.x,event.z,color,8,.19);}
      if(event.hazard==='electric')this.lightning(event.x,event.z);
      if(event.hazard==='portal'){this.portalRibbon(event.x,event.z);if(event.fromX!==undefined&&event.fromZ!==undefined)this.portalRibbon(event.fromX,event.fromZ);}
    } else if (event.kind === 'power' || event.kind === 'pickup' || event.kind === 'status') {
      const effect = event.status || event.power;
      const color = effectDefinition(effect||'overdrive').color;
      this.ripple(event.x, event.z, color, event.kind==='pickup' ? .85 : 1.2, .75);
      this.burst(event.x, event.z, color, event.kind==='pickup' ? 22 : 14, .5);
      if(event.kind==='pickup')this.flash(event.x,event.z,color,7,.2);
      if(effect==='portal')this.portalRibbon(event.x,event.z);
      if(effect==='frost'||effect==='frozen')for(let i=0;i<14;i++)this.emitTrail(event.x,.22,event.z,Math.cos(i)*.7,Math.sin(i)*.7,true);
    } else if (event.kind === 'obstacle') {
      const color = material === 'hex' ? '#c6a3ff' : material === 'steel' ? '#c5e1ed' : '#efb167';
      this.burst(event.x, event.z, color, event.destroyed ? 40 : 8, .7 + event.strength * 1.15);
      this.ripple(event.x, event.z, color, event.destroyed ? 1.85 : .5, event.destroyed ? .62 : .28);
      if (event.destroyed) {this.fragments(event.x,event.z,material);this.flash(event.x,event.z,color,16,.2);this.ripple(event.x,event.z,'#ffecc4',1.25,.38);}
    } else if (event.kind === 'pocket' && event.ball !== 0) {
      this.ripple(event.x, event.z, '#d6b96e', .65, .45);
    }
  }

  private flash(x:number,z:number,color:string,strength:number,life:number){const flash=this.flashes.reduce((oldest,item)=>item.age/item.life>oldest.age/oldest.life?item:oldest);flash.age=0;flash.life=life;flash.strength=strength;flash.light.position.set(x,.5,z);flash.light.color.set(color);flash.mesh.position.set(x,.25,z);flash.mesh.material.color.set(color).multiplyScalar(1.8);flash.mesh.visible=true;}
  private lightning(x:number,z:number){const arc=this.arcs.find(item=>item.age>=item.life)||this.arcs[0];arc.age=0;arc.life=.26;arc.x=x;arc.z=z;arc.line.visible=true;}
  private portalRibbon(x:number,z:number){const ribbon=this.ribbons.find(item=>item.age>=item.life)||this.ribbons[0];ribbon.age=0;ribbon.life=.65;ribbon.x=x;ribbon.z=z;ribbon.mesh.visible=true;}
  private emitTrail(x:number,y:number,z:number,vx:number,vz:number,ice:boolean){const particle=this.trails[this.nextTrail++%this.trails.length];particle.position.set(x,y,z);particle.velocity.set(vx,.25+Math.random()*(ice ? .55 : 1.1),vz);particle.age=0;particle.life=ice ? .4+Math.random()*.2 : .18+Math.random()*.18;particle.ice=ice;}
  updateTrail(ball:Ball,overdrive:boolean,frozen:boolean,dt:number){
    if(ball.pocketed||(!overdrive&&!frozen)||Math.hypot(ball.vx,ball.vz)<.5){this.trailClock=0;return;}
    this.trailClock+=dt*(frozen?30:50);let emitted=0;
    while(this.trailClock>=1&&emitted++<3){this.trailClock--;const side=(this.nextTrail%2?1:-1)*.06;this.emitTrail(ball.x+side,.18+(ball.elevation||0),ball.z-side,-ball.vx*.045+side,-ball.vz*.045-side,frozen);}
  }

  private burst(x: number, z: number, color: string, count: number, speed: number) {
    for (let i = 0, slot = 0; i < count && (slot = nextFree(this.sparks, slot)) < this.sparks.length; i++) {
      const spark = this.sparks[slot], angle = Math.random() * Math.PI * 2;
      spark.position.set(x, .22, z); spark.color.set(color);
      spark.velocity.set(Math.cos(angle) * speed, .4 + Math.random() * 1.2, Math.sin(angle) * speed); spark.age = 0; spark.life = .22 + Math.random() * .35;
    }
  }

  private fragments(x: number, z: number, material: 'wood' | 'steel' | 'hex') {
    const color = material === 'hex' ? '#80609d' : material === 'steel' ? '#778991' : '#ac7847';
    for (let i = 0, slot = 0; i < 14 && (slot = nextFree(this.debris, slot)) < this.debris.length; i++) {
      const piece = this.debris[slot], angle = Math.random() * Math.PI * 2, speed = .7 + Math.random() * 1.5;
      piece.scale.set(.5 + Math.random() * 1.5, .5 + Math.random(), .5 + Math.random() * 1.5);
      piece.position.set(x, .22, z); piece.rotation.set(0, 0, 0); piece.color.set(color); piece.steel = material === 'steel';
      piece.velocity.set(Math.cos(angle) * speed, 1 + Math.random() * 1.8, Math.sin(angle) * speed); piece.spin.set(Math.random() * 7, Math.random() * 5, Math.random() * 7); piece.age = 0; piece.life = .7 + Math.random() * .45;
    }
  }

  private ripple(x: number, z: number, color: string, size: number, life: number) {
    const ripple = this.ripples[nextFree(this.ripples, 0)];
    if (!ripple) return;
    ripple.x = x; ripple.z = z; ripple.color.set(color); ripple.size = size; ripple.age = 0; ripple.life = life;
  }

  private write(mesh: THREE.InstancedMesh, index: number, color: THREE.Color, alpha: number) {
    mesh.setMatrixAt(index, this.dummy.matrix); mesh.geometry.getAttribute('color').setXYZW(index, color.r, color.g, color.b, alpha);
  }
  private commit(mesh: THREE.InstancedMesh, count: number) {
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true; mesh.geometry.getAttribute('color').needsUpdate = true;
  }

  update(dt: number) {
    let fireCount=0,iceCount=0;
    for(const particle of this.trails){
      if(particle.age>=particle.life)continue;particle.age+=dt;if(particle.age>=particle.life)continue;
      const progress=particle.age/particle.life;particle.velocity.y-=dt*(particle.ice?4.5:.4);particle.position.addScaledVector(particle.velocity,dt);particle.position.y=Math.max(.025,particle.position.y);
      const scale=(1-progress)*(particle.ice ? .85 : 1.35);this.dummy.position.copy(particle.position);this.dummy.rotation.set(particle.ice?particle.age*8:.2,particle.age*5,particle.ice?particle.age*4:0);this.dummy.scale.set(scale*(particle.ice ? .55 : 1),scale*(particle.ice?1.8:1),scale*(particle.ice ? .55 : 1));this.dummy.updateMatrix();
      if(particle.ice){this.ice.setMatrixAt(iceCount,this.dummy.matrix);this.color.set('#a9e3ff').multiplyScalar(.8+progress*.2);this.ice.setColorAt(iceCount++,this.color);}
      else{this.fire.setMatrixAt(fireCount,this.dummy.matrix);this.color.setHSL(.12-progress*.1,1,.58-progress*.25).multiplyScalar(1.9);this.fire.setColorAt(fireCount++,this.color);}
    }
    this.fire.count=fireCount;this.ice.count=iceCount;this.fire.instanceMatrix.needsUpdate=true;this.ice.instanceMatrix.needsUpdate=true;if(this.fire.instanceColor)this.fire.instanceColor.needsUpdate=true;if(this.ice.instanceColor)this.ice.instanceColor.needsUpdate=true;
    for(const flash of this.flashes){flash.age+=dt;const progress=Math.min(1,flash.age/flash.life);flash.light.intensity=flash.strength*(1-progress)**2;flash.mesh.material.opacity=(1-progress)*.75;flash.mesh.scale.setScalar(.6+progress*2.2);flash.mesh.visible=progress<1;}
    for(const arc of this.arcs){
      arc.age+=dt;if(arc.age>=arc.life){arc.line.visible=false;continue;}
      const positions=arc.line.geometry.getAttribute('position') as THREE.BufferAttribute;let vertex=0;
      for(let branch=0;branch<4;branch++){
        const angle=branch*Math.PI/2+.35;let px=arc.x,py=.22,pz=arc.z;
        for(let segment=1;segment<=6;segment++){
          const distance=segment/6*arc.radius,bend=Math.sin(segment*9.2+branch*3+Math.floor(arc.age*60))*.055;
          const nx=arc.x+Math.cos(angle)*distance-Math.sin(angle)*bend,ny=.16+Math.abs(bend)*2,nz=arc.z+Math.sin(angle)*distance+Math.cos(angle)*bend;
          positions.setXYZ(vertex++,px,py,pz);positions.setXYZ(vertex++,nx,ny,nz);
          if(segment===3){positions.setXYZ(vertex++,nx,ny,nz);positions.setXYZ(vertex++,nx+Math.cos(angle+.7)*.22,.23,nz+Math.sin(angle+.7)*.22);}
          px=nx;py=ny;pz=nz;
        }
      }
      positions.needsUpdate=true;arc.line.material.opacity=(1-arc.age/arc.life)*(.6+Math.sin(arc.age*100)*.25);
    }
    for(const ribbon of this.ribbons){
      ribbon.age+=dt;if(ribbon.age>=ribbon.life){ribbon.mesh.visible=false;continue;}
      const progress=ribbon.age/ribbon.life,positions=ribbon.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for(let i=0;i<=48;i++){
        const u=i/48,angle=u*Math.PI*4.5+progress*9,radius=.11+u*.28+progress*.12,width=.013*(1-u*.55);
        for(let side=0;side<2;side++){const r=radius+(side?width:-width);positions.setXYZ(i*2+side,ribbon.x+Math.cos(angle)*r,.04+u*.73*(1-progress*.35),ribbon.z+Math.sin(angle)*r);}
      }
      positions.needsUpdate=true;ribbon.mesh.material.opacity=Math.sin(Math.min(1,progress*2)*Math.PI/2)*(1-progress)*.85;
    }
    let sparkCount = 0;
    this.dummy.rotation.set(0, 0, 0); this.dummy.scale.setScalar(1);
    for (const s of this.sparks) {
      if (s.age >= s.life) continue; s.age += dt; if (s.age >= s.life) continue;
      s.velocity.y -= dt * 4; s.position.addScaledVector(s.velocity, dt); s.position.y = Math.max(.02, s.position.y);
      this.dummy.position.copy(s.position); this.dummy.updateMatrix(); this.write(this.sparkMesh, sparkCount++, s.color, (1 - s.age / s.life) * .9);
    }
    this.commit(this.sparkMesh, sparkCount);
    const debrisCounts = [0, 0];
    for (const d of this.debris) {
      if (d.age >= d.life) continue; d.age += dt; if (d.age >= d.life) continue;
      d.velocity.y -= dt * 7; d.position.addScaledVector(d.velocity, dt);
      if (d.position.y < .025) { d.position.y = .025; d.velocity.y = Math.abs(d.velocity.y) * .22; d.velocity.x *= .92; d.velocity.z *= .92; }
      d.rotation.x += d.spin.x * dt; d.rotation.y += d.spin.y * dt; d.rotation.z += d.spin.z * dt;
      this.dummy.position.copy(d.position); this.dummy.rotation.copy(d.rotation); this.dummy.scale.copy(d.scale); this.dummy.updateMatrix();
      const kind = +d.steel; this.write(this.debrisMeshes[kind], debrisCounts[kind]++, d.color, Math.min(1, (d.life - d.age) * 4));
    }
    this.debrisMeshes.forEach((mesh, kind) => this.commit(mesh, debrisCounts[kind]));
    let rippleCount = 0;
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    for (const r of this.ripples) {
      if (r.age >= r.life) continue; r.age += dt; if (r.age >= r.life) continue;
      const progress = r.age / r.life; this.dummy.position.set(r.x, .025, r.z); this.dummy.scale.setScalar(.15 + progress * r.size); this.dummy.updateMatrix();
      this.write(this.rippleMesh, rippleCount++, r.color, .4 * (1 - progress) ** 2);
    }
    this.commit(this.rippleMesh, rippleCount);
  }

  clear() {
    for (const items of [this.sparks, this.debris, this.ripples]) for (const item of items) item.age = item.life;
    this.sparkMesh.count = 0; this.rippleMesh.count = 0; for (const mesh of this.debrisMeshes) mesh.count = 0;
    for(const particle of this.trails)particle.age=particle.life;this.fire.count=0;this.ice.count=0;this.trailClock=0;
    for(const flash of this.flashes){flash.age=1;flash.life=0;flash.light.intensity=0;flash.mesh.visible=false;}
    for(const arc of this.arcs){arc.age=1;arc.life=0;arc.line.visible=false;}
    for(const ribbon of this.ribbons){ribbon.age=1;ribbon.life=0;ribbon.mesh.visible=false;}
  }

  dispose() { this.clear(); for (const mesh of [this.sparkMesh, ...this.debrisMeshes, this.rippleMesh]) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }this.fire.geometry.dispose();this.fire.material.dispose();this.ice.geometry.dispose();this.ice.material.dispose();for(const flash of this.flashes){flash.mesh.geometry.dispose();flash.mesh.material.dispose();}for(const arc of this.arcs){arc.line.geometry.dispose();arc.line.material.dispose();}for(const ribbon of this.ribbons){ribbon.mesh.geometry.dispose();ribbon.mesh.material.dispose();} this.group.removeFromParent(); }
}
