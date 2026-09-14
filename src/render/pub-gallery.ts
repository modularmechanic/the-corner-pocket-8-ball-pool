import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PUB_DRESSING } from './pub-dressing';
import { disposePubObject, instancePubModel } from './pub-models';
import { batchPubStatic } from './pub-batching';
import { canvasTexture } from './materials';
import { deinterleaveGeometry } from 'three/addons/utils/BufferGeometryUtils.js';
import { PUB_LAYOUT } from './pub-layout';

export const POOL_DECADE_GALLERIES=[
  {decade:'1980s',wall:'front',centre:-5.15,bottom:3.3,size:1.02,rowStep:1.45,years:[1982,1985,1987,1989]},
  {decade:'1990s',wall:'front',centre:5.66,bottom:.08,size:.89,rowStep:1.19,years:[1991,1994,1996,1999]},
  {decade:'2000s',wall:'front',centre:5.66,bottom:2.54,size:.89,rowStep:1.19,years:[2001,2004,2007,2009]},
  {decade:'2010s',wall:'right',centre:3.75,bottom:3.13,size:1.02,rowStep:1.33,years:[2011,2014,2017,2019]},
  {decade:'2020s',wall:'right',centre:-2.75,bottom:3.31,size:1.02,rowStep:1.33,years:[2020,2022,2024,2026]},
] as const;

/** Normalized UV window for a top-to-bottom, left-to-right 2×2 photo atlas.
 * The tiny inset prevents mipmap bleed from the neighbouring photograph. */
export function poolPhotoRegion(index:number) {
  const cell=Math.max(0,Math.min(3,Math.trunc(index)));
  return {x:(cell%2)*.5+.003,y:Math.floor(cell/2)*.5+.003,width:.494,height:.494};
}

/** Material UV binding on the imported Blender print plane, never new geometry. */
export function applyPoolPhotoRegion(imported:THREE.BufferGeometry,index:number) {
  const geometry=imported.clone();deinterleaveGeometry(geometry);
  const region=poolPhotoRegion(index),uv=geometry.getAttribute('uv');
  let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
  for(let i=0;i<uv.count;i++){minU=Math.min(minU,uv.getX(i));maxU=Math.max(maxU,uv.getX(i));minV=Math.min(minV,uv.getY(i));maxV=Math.max(maxV,uv.getY(i));}
  for(let i=0;i<uv.count;i++)uv.setXY(i,region.x+(uv.getX(i)-minU)/Math.max(.0001,maxU-minU)*region.width,region.y+(uv.getY(i)-minV)/Math.max(.0001,maxV-minV)*region.height);
  return geometry;
}

function addPoolClubGallery(walls:{front:THREE.Group;right:THREE.Group;back:THREE.Group},renderer:THREE.WebGLRenderer,source:THREE.Object3D,isDisposed:()=>boolean) {
  const sections={front:new THREE.Group(),right:new THREE.Group(),back:new THREE.Group()};
  for(const [name,section]of Object.entries(sections)){section.name=`pub-pool-history-${name}`;walls[name as keyof typeof sections].add(section);}
  const isPrint=(material:THREE.Material)=>material.name.replace(/\.\d+$/,'')==='Gallery artwork';
  let printAspect=1;
  source.traverse(object=>{if(object instanceof THREE.Mesh&&!Array.isArray(object.material)&&isPrint(object.material)){object.geometry.computeBoundingBox();const size=object.geometry.boundingBox!.getSize(new THREE.Vector3());printAspect=size.x/Math.max(.001,size.y);}});
  const loader=new THREE.TextureLoader();
  const place=(print:THREE.Material,placement:{x:number;y:number;z:number;height:number;rotation?:number},section:THREE.Group,aspect:number,index?:number)=>{
    const variant=source.clone(true);variant.scale.x*=aspect/printAspect;
    variant.traverse(object=>{if(object instanceof THREE.Mesh&&!Array.isArray(object.material)&&isPrint(object.material))object.material=print;});
    const framed=instancePubModel(variant,[placement]);section.add(framed);
    // The frame stays instanced from its original Blender mesh. Only its print
    // plane gets per-photo UVs, then the four planes merge into one atlas draw.
    if(index!==undefined)for(const object of [...framed.children])if(object instanceof THREE.InstancedMesh&&object.material===print){
      const mesh=new THREE.Mesh(applyPoolPhotoRegion(object.geometry,index),print),matrix=new THREE.Matrix4();object.getMatrixAt(0,matrix);mesh.matrix.copy(matrix);mesh.matrixAutoUpdate=false;mesh.receiveShadow=true;framed.add(mesh);object.removeFromParent();object.dispose();
    }
  };
  for(const era of POOL_DECADE_GALLERIES){
    const texture=canvasTexture(1024,1024,ctx=>{ctx.fillStyle='#ddd1b3';ctx.fillRect(0,0,1024,1024);});
    texture.flipY=false;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const canvas=texture.image as HTMLCanvasElement,ctx=canvas.getContext('2d')!;
    loader.load(`/textures/pub/pool-${era.decade}-atlas.webp`,loaded=>{
      if(isDisposed()){loaded.dispose();return;}
      const image=loaded.image as HTMLImageElement,cell=image.width/2;
      for(let index=0;index<4;index++){
        const x=(index%2)*512,y=Math.floor(index/2)*512;
        ctx.drawImage(image,(index%2)*cell+2,Math.floor(index/2)*cell+2,cell-4,cell-4,x+30,y+12,452,452);
        ctx.fillStyle='#4b4130';ctx.textAlign='center';ctx.font='22px Georgia';ctx.fillText(`${era.years[index]}  ·  THE CORNER POCKET`,x+256,y+493);
      }
      texture.needsUpdate=true;loaded.dispose();
    });
    const print=new THREE.MeshStandardMaterial({name:`Pool club photographs ${era.decade}`,map:texture,roughness:.76,metalness:0,envMapIntensity:.12});
    for(let index=0;index<4;index++){
      const horizontal=era.centre+(index%2?1:-1)*.68,y=era.bottom+Math.floor(index/2)*era.rowStep;
      const placement=era.wall==='front'?{x:horizontal,y,z:PUB_LAYOUT.bounds.front-.23,rotation:Math.PI,height:era.size+.14}:{x:PUB_LAYOUT.bounds.right-.23,y,z:horizontal,rotation:-Math.PI/2,height:era.size+.14};
      place(print,placement,sections[era.wall],1,index);
    }
  }
  // Keep the original six photographs in one Blender-framed club-album collage.
  const albumMap=loader.load('/textures/pub/pool-events-atlas.webp');albumMap.colorSpace=THREE.SRGBColorSpace;albumMap.flipY=false;albumMap.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const albumPrint=new THREE.MeshStandardMaterial({name:'Pool champions club album',map:albumMap,roughness:.76,envMapIntensity:.12});
  place(albumPrint,{x:12.3,y:3.62,z:PUB_LAYOUT.bounds.back+.29,height:2.2},sections.back,1.5);
  for(const section of Object.values(sections))batchPubStatic(section,'subtree');
}

/** Original fictional team photographs and a painting, printed inside carved Blender frames. */
export function buildPubGallery(room:THREE.Group,renderer:THREE.WebGLRenderer,walls:{front:THREE.Group;right:THREE.Group;back:THREE.Group}) {
  let disposed=false;
  const gallery=new THREE.Group();gallery.name='pub-team-photographs';walls.front.add(gallery);
  const atlas=new THREE.TextureLoader().load('/textures/pub/gallery-atlas.webp');
  atlas.colorSpace=THREE.SRGBColorSpace;atlas.flipY=false;atlas.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const entries=[
    {placement:PUB_DRESSING.gallery[0],tile:[0,0],name:'Village football club'},
    {placement:PUB_DRESSING.gallery[1],tile:[1,0],name:'Local darts society'},
    {placement:PUB_DRESSING.gallery[3],tile:[0,1],name:'Rugby clubhouse team'},
    {placement:PUB_DRESSING.gallery[4],tile:[1,1],name:'The village pub at dusk'},
  ];
  new GLTFLoader().load('/models/pub/pub-photo-frame.glb',gltf=>{
    if(disposed){disposePubObject(gltf.scene);return;}
    addPoolClubGallery(walls,renderer,gltf.scene,()=>disposed);
    const unused=new Set<THREE.Material>();
    for(const entry of entries){
      const variant=gltf.scene.clone(true),texture=atlas.clone();
      texture.repeat.set(.48,.48);texture.offset.set(entry.tile[0]*.5+.01,entry.tile[1]*.5+.01);texture.needsUpdate=true;
      const print=new THREE.MeshStandardMaterial({name:entry.name,map:texture,color:'#ffffff',roughness:.9,metalness:0,envMapIntensity:.1});
      variant.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        const replace=(material:THREE.Material)=>{if(material.name.replace(/\.\d+$/,'')==='Gallery artwork'){unused.add(material);return print;}return material;};
        object.material=Array.isArray(object.material)?object.material.map(replace):replace(object.material);
      });
      const framed=instancePubModel(variant,[entry.placement]);framed.name=entry.name;gallery.add(framed);
    }
    batchPubStatic(gallery,'subtree');
    // The exported atlas is replaced by one shared runtime source with four UV windows.
    for(const material of unused){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.dispose();material.dispose();}
  });
  return {dispose(){disposed=true;atlas.dispose();}};
}
