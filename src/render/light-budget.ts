import * as THREE from 'three';
import type { RenderBudget, RenderQuality } from './performance';

type Practical=THREE.PointLight|THREE.RectAreaLight;
interface Source {light:Practical;visible:boolean;position:THREE.Vector3;rotation:THREE.Quaternion;score:number}
interface Slot {light:Practical;source:Source|null;target:Source|null;fade:number}

export function practicalLightLimits(quality:RenderQuality,tier:RenderBudget['tier']):Readonly<{points:number;areas:number}> {
  if(quality==='high'||quality==='ultra')return {points:Infinity,areas:Infinity};
  if(quality==='performance'||tier==='minimum'||tier==='light')return {points:3,areas:1};
  if(tier==='fast')return {points:4,areas:2};
  return {points:6,areas:2};
}

/** Fixed-size light pools bound fragment shader loops. Sources retain their
 * positions/colors/intensities for pub animation and full reflection captures. */
export class PracticalLightBudget {
  private sources=new Map<Practical,Source>();
  private group=new THREE.Group();
  private points:Slot[]=[];
  private areas:Slot[]=[];
  private ambient=new THREE.AmbientLight('#eadfcf',.025);
  private limits={points:6,areas:2};
  private elapsed=Infinity;
  private discovery=Infinity;
  private flash=false;
  private limited=true;
  private frustum=new THREE.Frustum();
  private projection=new THREE.Matrix4();
  private sphere=new THREE.Sphere();
  constructor(private scene:THREE.Scene) {
    this.group.name='adaptive-practical-lights';this.group.add(this.ambient);scene.add(this.group);
    for(let i=0;i<6;i++){
      const light=new THREE.PointLight(0xffffff,0,1,2);this.group.add(light);this.points.push({light,source:null,target:null,fade:0});
    }
    for(let i=0;i<2;i++){
      const light=new THREE.RectAreaLight(0xffffff,0,1,1);this.group.add(light);this.areas.push({light,source:null,target:null,fade:0});
    }
    this.discover();
  }
  configure(quality:RenderQuality,tier:RenderBudget['tier']):void {
    this.limits=practicalLightLimits(quality,tier);this.elapsed=Infinity;
    this.limited=Number.isFinite(this.limits.points);this.group.visible=this.limited;
    for(const source of this.sources.values())source.light.visible=this.limited?false:source.visible;
    for(const [index,slot]of this.points.entries())slot.light.visible=index<this.limits.points;
    for(const [index,slot]of this.areas.entries())slot.light.visible=index<this.limits.areas;
    this.ambient.intensity=this.limits.points===3?.035:this.limits.points===4?.025:.015;
  }
  private discover():void {
    this.scene.traverse(object=>{
      if(!(object instanceof THREE.PointLight||object instanceof THREE.RectAreaLight)||object.parent===this.group||this.sources.has(object))return;
      this.sources.set(object,{light:object,visible:object.visible,position:new THREE.Vector3(),rotation:new THREE.Quaternion(),score:0});
      if(this.limited)object.visible=false;
    });
    this.discovery=0;
  }
  update(camera:THREE.Camera,dt:number):void {
    this.discovery+=dt;if(this.discovery>=2)this.discover();
    if(!this.limited)return;
    this.elapsed+=dt;
    this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection);
    let flash=false;
    for(const source of this.sources.values()){
      const light=source.light;light.getWorldPosition(source.position);light.getWorldQuaternion(source.rotation);
      let visible=source.visible;for(let parent=light.parent;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}
      const radius=light instanceof THREE.PointLight?(light.distance||35):Math.max(light.width,light.height)*.65+7;
      this.sphere.set(source.position,radius);
      const distance=source.position.distanceTo(camera.position);
      const area=light instanceof THREE.RectAreaLight?Math.sqrt(light.width*light.height):1;
      const transient=!!light.userData.performanceFlash&&light.intensity>.02;
      source.score=visible&&light.intensity>.001&&this.frustum.intersectsSphere(this.sphere)
        ?light.intensity*area/(3+distance*distance)*(transient?8:1):0;
      if(transient&&source.score>0)flash=true;
    }
    if(this.elapsed>=.18||flash!==this.flash){
      this.select(this.points,this.limits.points,false);this.select(this.areas,this.limits.areas,true);this.elapsed=0;this.flash=flash;
    }
    for(const slot of [...this.points,...this.areas]){
      if(!slot.light.visible)continue;
      if(slot.target!==slot.source){
        if(!slot.source||slot.target?.light.userData.performanceFlash){slot.source=slot.target;slot.fade=slot.target?.light.userData.performanceFlash?1:0;}
        else {slot.fade=Math.max(0,slot.fade-dt*9);if(slot.fade===0)slot.source=slot.target;}
      }else slot.fade=Math.min(1,slot.fade+dt*7);
      const source=slot.source;
      if(!source){slot.light.intensity=0;continue;}
      slot.light.position.copy(source.position);slot.light.quaternion.copy(source.rotation);slot.light.color.copy(source.light.color);
      slot.light.intensity=source.light.intensity*slot.fade;
      if(slot.light instanceof THREE.PointLight&&source.light instanceof THREE.PointLight){slot.light.distance=source.light.distance;slot.light.decay=source.light.decay;}
      if(slot.light instanceof THREE.RectAreaLight&&source.light instanceof THREE.RectAreaLight){slot.light.width=source.light.width;slot.light.height=source.light.height;}
    }
  }
  private select(slots:Slot[],count:number,areas:boolean):void {
    const active=new Set(slots.slice(0,count).map(slot=>slot.target));
    const selected=[...this.sources.values()].filter(source=>(source.light instanceof THREE.RectAreaLight)===areas&&source.score>0)
      .sort((a,b)=>b.score*(active.has(b)?1.3:1)-a.score*(active.has(a)?1.3:1)||a.light.id-b.light.id).slice(0,count);
    const retained=new Set<Source>();
    for(const slot of slots.slice(0,count))if(slot.target&&selected.includes(slot.target))retained.add(slot.target);
    const available=selected.filter(source=>!retained.has(source));
    for(const slot of slots.slice(0,count))if(!slot.target||!retained.has(slot.target))slot.target=available.shift()??null;
  }
  withFullLighting(capture:()=>void):void {
    const pooled=this.group.visible;
    try {this.group.visible=false;for(const source of this.sources.values())source.light.visible=source.visible;capture();}
    finally {this.group.visible=pooled;for(const source of this.sources.values())source.light.visible=this.limited?false:source.visible;}
  }
  getCounts():Readonly<{pointLights:number;areaLights:number}> {
    return Object.freeze({pointLights:this.limited?this.limits.points:[...this.sources.keys()].filter(light=>light instanceof THREE.PointLight).length,
      areaLights:this.limited?this.limits.areas:[...this.sources.keys()].filter(light=>light instanceof THREE.RectAreaLight).length});
  }
  dispose():void {
    for(const source of this.sources.values())source.light.visible=source.visible;
    this.sources.clear();this.group.removeFromParent();
  }
}
