import * as THREE from 'three';
import { effectDefinition } from '../presentation/effects';
import type { Ball, TableEvent } from '../simulation/types';

interface Spark { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; velocity: THREE.Vector3; age: number; life: number }
interface Debris { mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>; velocity: THREE.Vector3; spin: THREE.Vector3; age: number; life: number }
interface Ripple { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number; life: number; size: number }
interface TrailParticle { position:THREE.Vector3;velocity:THREE.Vector3;age:number;life:number;ice:boolean }
interface Flash { light:THREE.PointLight;mesh:THREE.Mesh<THREE.SphereGeometry,THREE.MeshBasicMaterial>;age:number;life:number;strength:number }
interface Arc {line:THREE.LineSegments<THREE.BufferGeometry,THREE.LineBasicMaterial>;age:number;life:number;radius:number;x:number;z:number}
interface Ribbon {mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;age:number;life:number;x:number;z:number}

/** Cosmetic only: none of these transient objects participate in the simulation. */
export class TableEffects {
  private group = new THREE.Group();
  private sparks: Spark[] = [];
  private debris: Debris[] = [];
  private ripples: Ripple[] = [];
  private sparkGeometry = new THREE.SphereGeometry(.012, 5, 4);
  private debrisGeometry = new THREE.BoxGeometry(.075, .04, .045);
  private rippleGeometry = new THREE.RingGeometry(.94, 1, 64);
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
    scene.add(this.group);this.fire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.ice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.fire.frustumCulled=false;this.ice.frustumCulled=false;this.fire.count=0;this.ice.count=0;this.group.add(this.fire,this.ice);
    for(let i=0;i<3;i++){
      const light=new THREE.PointLight('#ffb76a',0,3.3,2),mesh=new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),new THREE.MeshBasicMaterial({color:'#ffe8c1',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));light.userData.performanceFlash=true;mesh.visible=false;this.group.add(light,mesh);this.flashes.push({light,mesh,age:1,life:0,strength:0});
    }
    for(let i=0;i<4;i++){
      const line=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#aeeaff',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));line.visible=false;this.group.add(line);this.arcs.push({line,age:1,life:0,radius:.7,x:0,z:0});
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
    for (let i = 0; i < count && this.sparks.length < 120; i++) {
      const mesh = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.position.set(x, .22, z); this.group.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      this.sparks.push({ mesh, velocity: new THREE.Vector3(Math.cos(angle) * speed, .4 + Math.random() * 1.2, Math.sin(angle) * speed), age: 0, life: .22 + Math.random() * .35 });
    }
  }

  private fragments(x: number, z: number, material: 'wood' | 'steel' | 'hex') {
    const color = material === 'hex' ? '#80609d' : material === 'steel' ? '#778991' : '#ac7847';
    for (let i = 0; i < 14 && this.debris.length < 70; i++) {
      const mesh = new THREE.Mesh(this.debrisGeometry, new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: material === 'steel' ? .6 : .1, transparent: true }));
      mesh.scale.set(.5 + Math.random() * 1.5, .5 + Math.random(), .5 + Math.random() * 1.5);
      mesh.position.set(x, .22, z); mesh.castShadow = true; this.group.add(mesh);
      const angle = Math.random() * Math.PI * 2, speed = .7 + Math.random() * 1.5;
      this.debris.push({ mesh, velocity: new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 1.8, Math.sin(angle) * speed), spin: new THREE.Vector3(Math.random() * 7, Math.random() * 5, Math.random() * 7), age: 0, life: .7 + Math.random() * .45 });
    }
  }

  private ripple(x: number, z: number, color: string, size: number, life: number) {
    if (this.ripples.length >= 16) return;
    const mesh = new THREE.Mesh(this.rippleGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .025, z); mesh.scale.setScalar(.18); this.group.add(mesh);
    this.ripples.push({ mesh, age: 0, life, size });
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
      const points:THREE.Vector3[]=[];
      for(let branch=0;branch<4;branch++){
        const angle=branch*Math.PI/2+.35;let previous=new THREE.Vector3(arc.x,.22,arc.z);
        for(let segment=1;segment<=6;segment++){
          const distance=segment/6*arc.radius,bend=Math.sin(segment*9.2+branch*3+Math.floor(arc.age*60))*.055;
          const next=new THREE.Vector3(arc.x+Math.cos(angle)*distance-Math.sin(angle)*bend,.16+Math.abs(bend)*2,arc.z+Math.sin(angle)*distance+Math.cos(angle)*bend);points.push(previous,next);
          if(segment===3){const fork=new THREE.Vector3(next.x+Math.cos(angle+.7)*.22,.23,next.z+Math.sin(angle+.7)*.22);points.push(next,fork);}
          previous=next;
        }
      }
      arc.line.geometry.setFromPoints(points);arc.line.material.opacity=(1-arc.age/arc.life)*(.6+Math.sin(arc.age*100)*.25);
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
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.age += dt;
      if (s.age >= s.life) { this.group.remove(s.mesh); s.mesh.material.dispose(); this.sparks.splice(i, 1); continue; }
      s.velocity.y -= dt * 4; s.mesh.position.addScaledVector(s.velocity, dt); s.mesh.position.y = Math.max(.02, s.mesh.position.y);
      s.mesh.material.opacity = (1 - s.age / s.life) * .9;
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.age += dt;
      if (d.age >= d.life) { this.group.remove(d.mesh); d.mesh.material.dispose(); this.debris.splice(i, 1); continue; }
      d.velocity.y -= dt * 7; d.mesh.position.addScaledVector(d.velocity, dt);
      if (d.mesh.position.y < .025) { d.mesh.position.y = .025; d.velocity.y = Math.abs(d.velocity.y) * .22; d.velocity.x *= .92; d.velocity.z *= .92; }
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      d.mesh.material.opacity = Math.min(1, (d.life - d.age) * 4);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]; r.age += dt;
      if (r.age >= r.life) { this.group.remove(r.mesh); r.mesh.material.dispose(); this.ripples.splice(i, 1); continue; }
      const progress = r.age / r.life; r.mesh.scale.setScalar(.15 + progress * r.size); r.mesh.material.opacity = .4 * (1 - progress) ** 2;
    }
  }

  clear() {
    for (const item of [...this.sparks, ...this.debris, ...this.ripples]) { this.group.remove(item.mesh); item.mesh.material.dispose(); }
    this.sparks = []; this.debris = []; this.ripples = [];
    for(const particle of this.trails)particle.age=particle.life;this.fire.count=0;this.ice.count=0;this.trailClock=0;
    for(const flash of this.flashes){flash.age=1;flash.life=0;flash.light.intensity=0;flash.mesh.visible=false;}
    for(const arc of this.arcs){arc.age=1;arc.life=0;arc.line.visible=false;}
    for(const ribbon of this.ribbons){ribbon.age=1;ribbon.life=0;ribbon.mesh.visible=false;}
  }

  dispose() { this.clear(); this.sparkGeometry.dispose(); this.debrisGeometry.dispose(); this.rippleGeometry.dispose();this.fire.geometry.dispose();this.fire.material.dispose();this.ice.geometry.dispose();this.ice.material.dispose();for(const flash of this.flashes){flash.mesh.geometry.dispose();flash.mesh.material.dispose();}for(const arc of this.arcs){arc.line.geometry.dispose();arc.line.material.dispose();}for(const ribbon of this.ribbons){ribbon.mesh.geometry.dispose();ribbon.mesh.material.dispose();} this.group.removeFromParent(); }
}
