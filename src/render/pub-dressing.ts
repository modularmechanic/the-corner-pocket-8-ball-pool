import * as THREE from 'three';
import type { PubPlacement } from './pub-models';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from './pub-layout';
import type { PropInstaller } from './asset-installer';

const FLOOR = -3.6;
/** Prop paths relative to public/. */
export const PUB_DRESSING_PROPS = {
  hearth:'models/pub/hearth-fireplace.glb',handpump:'models/pub/ale-handpump.glb',divider:'models/pub/snug-divider.glb',casks:'models/pub/cask-stack.glb',
  memorabilia:{frame:'models/pub/memorabilia-frame.glb',darts:'models/pub/memorabilia-darts.glb',stout:'models/pub/memorabilia-stout.glb'},
} as const;
/** Human-scale snug furnishings stay outside the pool table's cueing aisle. */
const original = {
  hearth: [{x:9,y:FLOOR,z:11.4,rotation:Math.PI,height:9.15}],
  gallery: [
    {x:-12.15,y:3.08,z:11.57,rotation:Math.PI,height:2.32},
    {x:-8.65,y:3.44,z:11.57,rotation:Math.PI,height:1.88},
    {x:-6.27,y:3.6,z:11.57,rotation:Math.PI,height:1.46},
    {x:-12.1,y:-.36,z:11.57,rotation:Math.PI,height:2.51},
    {x:-8.58,y:.09,z:11.57,rotation:Math.PI,height:2.20},
  ],
  rightGallery: [
    {x:14.54,y:1.57,z:-3.8,rotation:-Math.PI/2,height:1.52},
    {x:14.54,y:.82,z:-1.37,rotation:-Math.PI/2,height:1.58},
    {x:14.54,y:.48,z:3.2,rotation:-Math.PI/2,height:2.28},
  ],
  dividers: [
    {x:10.55,y:FLOOR,z:-.05,rotation:0,height:3.3},
    {x:7.4,y:FLOOR,z:7.4,rotation:Math.PI/2,height:3.3},
  ],
  casks: [{x:-12.25,y:FLOOR,z:-7.3,rotation:.1,height:3.15}],
  handpumps: [{x:-2.6,y:.325,z:-8.2,height:1.3},{x:2.6,y:.325,z:-8.2,height:1.3}],
} satisfies Record<string,PubPlacement[]>;

export const PUB_DRESSING = {
  hearth:original.hearth.map(p=>({...p,x:pubSideX(p.x),z:pubFrontZ(p.z)})),
  gallery:original.gallery.map(p=>({...p,x:pubSideX(p.x),z:pubFrontZ(p.z)})),
  rightGallery:original.rightGallery.map((p,i)=>({...p,x:pubSideX(p.x),z:p.z+(i<2?-2.6:3.2)*(PUB_LAYOUT.expansion-1)})),
  dividers:original.dividers.map((p,i)=>({...p,x:pubSideX(p.x),z:i?pubFrontZ(p.z):p.z})),
  casks:original.casks.map(p=>({...p,x:pubSideX(p.x),z:pubBackZ(p.z)})),
  handpumps:original.handpumps.map(p=>({...p,z:pubBackZ(p.z)})),
};

/** Requests Blender-authored fixtures, each with a complete placeholder, under room-owned GPU disposal. */
export function buildPubDressing(room:THREE.Group,installer:PropInstaller,walls:{front:THREE.Group;right:THREE.Group}) {
  const assets=new THREE.Group();assets.name='pub-blender-dressing';room.add(assets);
  const wallAssets=new THREE.Group();wallAssets.name='pub-snug-wall-dressing';walls.front.add(wallAssets);
  const rightWallAssets=new THREE.Group();rightWallAssets.name='pub-brick-gallery';walls.right.add(rightWallAssets);
  const stone=new THREE.MeshStandardMaterial({color:'#8a7460',roughness:.92});
  const wood=new THREE.MeshStandardMaterial({color:'#3f261b',roughness:.49});
  const brass=new THREE.MeshStandardMaterial({color:'#a18450',metalness:.76,roughness:.37});
  const iron=new THREE.MeshStandardMaterial({color:'#171816',metalness:.35,roughness:.68});
  const meshBox=(parent:THREE.Group,w:number,h:number,d:number,mat:THREE.Material,x:number,y:number,z:number)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const positioned=(name:string,placement:PubPlacement,parent:THREE.Group)=>{
    const group=new THREE.Group();group.name=name;group.position.set(placement.x,placement.y,placement.z);group.rotation.y=placement.rotation||0;parent.add(group);return group;
  };
  const hearth=positioned('hearth-fallback',PUB_DRESSING.hearth[0],wallAssets);
  meshBox(hearth,8.2,.21,1.75,stone,0,.105,.36);
  meshBox(hearth,1.13,4.7,1.33,stone,-3.47,2.52,.30);meshBox(hearth,1.13,4.7,1.33,stone,3.47,2.52,.30);
  meshBox(hearth,8.2,4.04,.92,stone,0,7.13,0);meshBox(hearth,8.5,.34,1.75,wood,0,5.03,.4);
  meshBox(hearth,5.7,4.45,.08,iron,0,2.48,-.22);
  const coalMaterial=new THREE.MeshStandardMaterial({color:'#632915',emissive:'#d85318',emissiveIntensity:.85,roughness:1});
  for(let i=0;i<7;i++){const log=meshBox(hearth,.72,.23,.55,coalMaterial,-2.07+i*.68,.5,.67);log.rotation.y=(i%2-.5)*.45;}
  const dividerFallback=new THREE.Group();assets.add(dividerFallback);
  for(const placement of PUB_DRESSING.dividers){
    const group=positioned('divider-fallback',placement,dividerFallback);
    meshBox(group,4.31,1.8,.29,wood,0,.9,0);meshBox(group,4.45,.15,.41,wood,0,3.22,0);
    for(const x of [-2.1,0,2.1])meshBox(group,.12,3.15,.35,wood,x,1.58,0);
    const glass=new THREE.MeshPhysicalMaterial({color:'#ac9e73',transparent:true,opacity:.22,roughness:.3,metalness:0,depthWrite:false});meshBox(group,4.06,1.14,.035,glass,0,2.48,0);
  }
  const galleryVariants=[
    {path:PUB_DRESSING_PROPS.memorabilia.frame,front:[] as PubPlacement[],right:[PUB_DRESSING.rightGallery[1]]},
    {path:PUB_DRESSING_PROPS.memorabilia.darts,front:[] as PubPlacement[],right:[PUB_DRESSING.rightGallery[2]]},
    {path:PUB_DRESSING_PROPS.memorabilia.stout,front:[PUB_DRESSING.gallery[2]],right:[PUB_DRESSING.rightGallery[0]]},
  ].map(variant=>{
    const frontFallback=new THREE.Group(),rightFallback=new THREE.Group();wallAssets.add(frontFallback);rightWallAssets.add(rightFallback);
    for(const [placements,parent]of [[variant.front,frontFallback],[variant.right,rightFallback]] as const)for(const placement of placements){
      const group=positioned('gallery-fallback',placement,parent),h=placement.height!,w=h*.9/.7;
      meshBox(group,w,h,.15,wood,0,h/2,0);meshBox(group,w-.17,h-.17,.022,brass,0,h/2,.091);meshBox(group,w-.3,h-.3,.018,new THREE.MeshStandardMaterial({color:'#a09277',roughness:.98}),0,h/2,.108);
    }
    return {...variant,frontFallback,rightFallback};
  });
  const pumpFallback=new THREE.Group();assets.add(pumpFallback);
  for(const placement of PUB_DRESSING.handpumps){
    const group=positioned('ale-handpump-fallback',placement,pumpFallback);
    meshBox(group,.6,.13,.65,wood,0,.065,0);meshBox(group,.18,.75,.2,brass,0,.49,0);
    meshBox(group,.105,.51,.12,wood,0,1.04,-.055);meshBox(group,.22,.3,.08,brass,0,.76,.2);
    const spout=meshBox(group,.055,.055,.35,brass,0,.66,.22);spout.rotation.x=.13;
  }
  const caskFallback=positioned('casks-fallback',PUB_DRESSING.casks[0],assets);
  for(const [x,y]of [[-.86,1.01],[.86,1.01],[0,2.28]]){
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.60,.60,1.65,16),wood);barrel.rotation.z=Math.PI/2;barrel.position.set(x,y,0);barrel.castShadow=true;caskFallback.add(barrel);
    for(const dx of [-.66,.66]){const hoop=new THREE.Mesh(new THREE.TorusGeometry(.61,.027,6,24),iron);hoop.rotation.y=Math.PI/2;hoop.position.set(x+dx,y,0);caskFallback.add(hoop);}
  }
  const install=(path:string,placements:PubPlacement[],parent:THREE.Group,placeholder:THREE.Object3D)=>{
    if(placements.length)installer.model(path,{parent,placements,placeholder});
  };
  install(PUB_DRESSING_PROPS.hearth,PUB_DRESSING.hearth,wallAssets,hearth);
  for(const variant of galleryVariants){install(variant.path,variant.front,wallAssets,variant.frontFallback);install(variant.path,variant.right,rightWallAssets,variant.rightFallback);}
  install(PUB_DRESSING_PROPS.handpump,PUB_DRESSING.handpumps,assets,pumpFallback);
  install(PUB_DRESSING_PROPS.divider,PUB_DRESSING.dividers,assets,dividerFallback);
  install(PUB_DRESSING_PROPS.casks,PUB_DRESSING.casks,assets,caskFallback);
  // Local firelight lights the snug; it never floods the felt or requires another shadow pass.
  const hearthLight=new THREE.PointLight('#ffad68',9,5,2);hearthLight.position.set(PUB_DRESSING.hearth[0].x,-.32,PUB_DRESSING.hearth[0].z-1.5);room.add(hearthLight);
  return {
    update(time:number){hearthLight.intensity=9+Math.sin(time*3.1)*.55+Math.sin(time*7.3)*.24;},
  };
}
