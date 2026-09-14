import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { GameState } from '../simulation/types';
import { canvasTexture } from './materials';

/** `balls` are indexed by ball id and shared with the playing balls. */
export interface TableDetailTextures { brushedSteel: THREE.Texture; coinFace: THREE.Texture; balls: readonly THREE.Texture[] }
/** Canvas-drawn, so browser only. */
export function drawTableDetailTextures(balls: readonly THREE.Texture[]): TableDetailTextures {
  const brushedSteel=canvasTexture(512,512,ctx=>{
    ctx.fillStyle='#a7ada9';ctx.fillRect(0,0,512,512);
    for(let i=0;i<1700;i++){const value=130+Math.floor(Math.random()*70);ctx.strokeStyle=`rgba(${value},${value},${value},.16)`;ctx.beginPath();const y=Math.random()*512;ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke();}
    ctx.fillStyle='#313934';ctx.textAlign='center';ctx.font='bold 26px Arial';ctx.fillText('PUSH TO RELEASE',256,462);ctx.font='16px Arial';ctx.fillText('CORNER POCKET  •  TOKEN PLAY',256,35);
  });
  const coinFace=canvasTexture(256,256,ctx=>{ctx.fillStyle='#c4a456';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#806634';ctx.lineWidth=8;ctx.beginPath();ctx.arc(128,128,110,0,Math.PI*2);ctx.stroke();ctx.textAlign='center';ctx.fillStyle='#775c2d';ctx.font='bold 111px Georgia';ctx.fillText('8',128,166);ctx.font='17px Arial';ctx.fillText('CORNER POCKET',128,62);});
  return { brushedSteel, coinFace, balls };
}
const TOKEN_FROM=new THREE.Vector3(3.31,.28,3.34),TOKEN_TO=new THREE.Vector3(3.84,-.87,3.445);
/** The visible machinery beneath the playing surface; never part of ball collision simulation. */
export class TableDetails {
  readonly group = new THREE.Group();
  readonly coinControl = new THREE.Group();
  private lever = new THREE.Group();
  private token: THREE.Mesh;
  private returns = new Map<number, THREE.Mesh>();
  private order: number[] = [];
  private potted = new Set<number>();
  private arrivalAge = new Map<number,number>();
  private releaseOrder: number[] = [];
  private resetAge = Infinity;
  private seed = '';
  private indicator: THREE.MeshStandardMaterial;
  private sharedBallMaps: readonly THREE.Texture[];
  constructor(scene: THREE.Scene, textures: TableDetailTextures) {
    scene.add(this.group);this.sharedBallMaps=textures.balls;
    const steel=new THREE.MeshPhysicalMaterial({map:textures.brushedSteel,color:'#d0d6ce',metalness:.87,roughness:.28,clearcoat:.18});
    const darkSteel=new THREE.MeshStandardMaterial({color:'#232b29',metalness:.7,roughness:.4});
    const brass=new THREE.MeshStandardMaterial({color:'#c2a25e',metalness:.82,roughness:.28});
    const box=(w:number,h:number,d:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Group=this.group)=>{const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,.014),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
    // All wood in front of this recess is omitted by TableModel.
    box(6.1,.54,.04,darkSteel,-.75,-.955,2.76);
    box(6.1,.04,.61,darkSteel,-.75,-1.205,3.04);
    for(const x of [-3.82,2.32])box(.055,.62,.11,brass,x,-.955,3.37);
    for(const y of [-.645,-1.265])box(6.19,.055,.11,brass,-.75,y,3.37);
    for(const z of [2.99,3.19]){const track=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,5.86,24),steel);track.rotation.z=Math.PI/2;track.position.set(-.76,-1.175,z);this.group.add(track);}
    const glass=new THREE.Mesh(new THREE.BoxGeometry(6.08,.53,.014),new THREE.MeshPhysicalMaterial({color:'#b5d6d0',transparent:true,opacity:.14,metalness:.08,roughness:.04,clearcoat:1,clearcoatRoughness:.05,depthWrite:false}));glass.position.set(-.75,-.955,3.397);this.group.add(glass);
    const strip=new THREE.Mesh(new THREE.BoxGeometry(5.85,.018,.02),new THREE.MeshStandardMaterial({color:'#f4dcaa',emissive:'#f4dcaa',emissiveIntensity:1.2}));strip.position.set(-.75,-.679,3.11);this.group.add(strip);
    const returnLight=new THREE.PointLight('#f7d9a5',1.2,2.5,2);returnLight.position.set(-.6,-.82,3.27);this.group.add(returnLight);
    for(let id=1;id<=15;id++){
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(.157,32,24),new THREE.MeshPhysicalMaterial({map:textures.balls[id],roughness:.18,clearcoat:1,clearcoatRoughness:.12}));
      mesh.visible=false;mesh.position.set(2,-1.005,3.08);mesh.rotation.x=.1;this.group.add(mesh);this.returns.set(id,mesh);
    }
    this.coinControl.position.set(4.13,-.96,3.38);this.coinControl.userData.tableControl='coin';this.group.add(this.coinControl);
    box(1.12,.76,.065,steel,0,0,0,this.coinControl);
    for(const x of [-.47,.47])for(const y of [-.3,.3]){const screw=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.012,8),brass);screw.rotation.x=Math.PI/2;screw.position.set(x,y,.045);this.coinControl.add(screw);}
    box(.047,.255,.015,new THREE.MeshBasicMaterial({color:'#080d0b'}),-.29,.075,.042,this.coinControl);
    box(.095,.012,.035,brass,-.29,.208,.052,this.coinControl);
    this.coinControl.add(this.lever);this.lever.position.set(.13,-.04,.07);
    box(.51,.095,.26,darkSteel,0,0,.07,this.lever);
    box(.63,.125,.08,steel,0,0,.24,this.lever);
    box(.4,.035,.015,brass,0,.017,.286,this.lever);
    this.indicator=new THREE.MeshStandardMaterial({color:'#d8a654',emissive:'#e9bd67',emissiveIntensity:1.5,roughness:.2});
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(.035,16,12),this.indicator);lamp.position.set(.32,.235,.05);this.coinControl.add(lamp);
    const coinMaterial=new THREE.MeshStandardMaterial({map:textures.coinFace,color:'#e5c779',metalness:.85,roughness:.3});
    const coinGeometry=new THREE.CylinderGeometry(.09,.09,.018,48);
    for(const [x,z,count] of [[3.09,3.28,4],[3.31,3.34,2],[2.9,3.36,1],[3.55,3.27,1]])for(let i=0;i<count;i++){const coin=new THREE.Mesh(coinGeometry,coinMaterial);coin.position.set(x,.232+i*.019,z);coin.rotation.y=x+i*.7;coin.castShadow=true;this.group.add(coin);}
    this.token=new THREE.Mesh(coinGeometry,coinMaterial);this.token.visible=false;this.token.castShadow=true;this.group.add(this.token);
  }
  animateReset() { this.resetAge=0;this.releaseOrder=[...this.order];return 1200; }
  /** Balls in `onTable` (such as those still fading out) have not reached the return yet. */
  update(state:GameState,dt:number,onTable:ReadonlyMap<number,unknown>) {
    if(state.seed!==this.seed){this.seed=state.seed;this.order.length=0;this.arrivalAge.clear();}
    const potted=this.potted;potted.clear();
    for(const ball of state.balls)if(ball.id>0&&ball.pocketed&&!onTable.has(ball.id))potted.add(ball.id);
    let kept=0;for(const id of this.order)if(potted.has(id))this.order[kept++]=id;this.order.length=kept;
    for(const id of potted)if(!this.order.includes(id)){this.order.push(id);this.arrivalAge.set(id,0);this.returns.get(id)!.position.x=2.08;}
    for(const id of this.order)this.arrivalAge.set(id,(this.arrivalAge.get(id)||0)+dt);
    this.resetAge+=dt;const resetting=this.resetAge<1.2;
    const shown=resetting?this.releaseOrder:this.order;
    this.indicator.emissiveIntensity=resetting?2.1:1.25;
    const press=Math.max(0,1-Math.abs(this.resetAge-.6)/.19);this.lever.position.z=.07-press*.16;
    this.token.visible=this.resetAge<.45;
    if(this.token.visible){const t=Math.min(1,this.resetAge/.45);this.token.position.lerpVectors(TOKEN_FROM,TOKEN_TO,t*t);this.token.rotation.x=t*Math.PI/2;}
    for(const [id,mesh]of this.returns){
      const index=shown.indexOf(id);mesh.visible=index>=0&&(resetting||(this.arrivalAge.get(id)||0)>=.4);if(!mesh.visible)continue;
      const oldX=mesh.position.x,target=-3.52+index*.351;
      if(resetting&&this.resetAge>.6){const release=Math.max(0,(this.resetAge-.6-index*.021)/.28);mesh.position.set(target+release*2.5,-1.005-release*release*.65,3.08);mesh.visible=release<1;}
      else{mesh.position.x=THREE.MathUtils.damp(mesh.position.x,target,6,dt);mesh.position.y=-1.005;}
      mesh.rotateZ(-(mesh.position.x-oldX)/.157);
    }
  }
  dispose(){this.group.removeFromParent();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();this.group.traverse(object=>{if(!(object instanceof THREE.Mesh))return;geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material]){materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}});for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures)if(!this.sharedBallMaps.includes(texture))texture.dispose();}
}
