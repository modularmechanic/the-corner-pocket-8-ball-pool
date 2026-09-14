/** CPU scene census using real geometry/GLTF parsing and inert image/canvas data.
 * Reports potential draw submissions with every wall visible; not GPU timings,
 * shader cost or a claim of hardware FPS. Run: node --import tsx scripts/benchmark-pub-batching.ts [--baseline] */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const project=process.cwd(),baseline=process.argv.includes('--baseline');
const root=baseline?'/tmp/coolpool-render-baseline':project;
const errors:string[]=[];
const gradient={addColorStop(){}};
function canvas() {
  const result={width:1,height:1,getContext:(_type:string)=>context,toDataURL:()=>''};
  const context=new Proxy<Record<string,unknown>>({canvas:result,
    getImageData:(_x:number,_y:number,width:number,height:number)=>({data:new Uint8ClampedArray(width*height*4),width,height}),
    createImageData:(width:number,height:number)=>({data:new Uint8ClampedArray(width*height*4),width,height}),
    createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,createPattern:()=>({}),measureText:(text:string)=>({width:text.length*8}),
  },{get(target,key){return Reflect.get(target,key)??(()=>{});}});
  return result;
}
Object.defineProperty(globalThis,'document',{value:{createElement:()=>canvas()},configurable:true});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string,public init?:unknown){}},configurable:true});
THREE.TextureLoader.prototype.load=function(url,onLoad){const texture=new THREE.Texture();texture.name=url;texture.image={width:1024,height:1024};if(onLoad)queueMicrotask(()=>onLoad(texture));return texture;};
GLTFLoader.prototype.load=function(url,onLoad,_onProgress,onError) {
  void (async()=>{
    const file=path.join(project,'public',url),bytes=await fs.readFile(file);
    let data:string|ArrayBuffer;
    if(url.endsWith('.gltf')) {
      const json=JSON.parse(bytes.toString());
      for(const buffer of json.buffers??[])if(buffer.uri&&!buffer.uri.startsWith('data:'))buffer.uri=`data:application/octet-stream;base64,${(await fs.readFile(path.join(path.dirname(file),buffer.uri))).toString('base64')}`;
      data=JSON.stringify(json);
    }else data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    // Override WebP's image decoder while retaining the authored material graph.
    this.register(parser=>({name:'EXT_texture_webp',loadTexture(index:number){const texture=new THREE.Texture();texture.image={width:1024,height:1024};texture.name=parser.json.textures[index].name??`image-${index}`;return Promise.resolve(texture);}}));
    onLoad(await this.parseAsync(data,''));
  })().catch(error=>{errors.push(`${url}: ${error.message}`);onError?.(error);});
};

const {buildPub}=await import(pathToFileURL(path.join(root,'src/render/pub.ts')).href);
const {createPropInstaller}=await import(pathToFileURL(path.join(root,'src/render/asset-installer.ts')).href);
const scene=new THREE.Scene(),installer=createPropInstaller();
const started=performance.now(),pub=buildPub(scene,installer);
const settled=await installer.settled();
let meshes=0,drawCalls=0,transparentDrawCalls=0,triangles=0;
const materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>();
const contributors:{name:string;triangles:number;instances:number}[]=[];
scene.traverseVisible(object=>{
  if(!(object instanceof THREE.Mesh)||(object instanceof THREE.InstancedMesh&&object.count===0))return;
  meshes++;geometries.add(object.geometry);
  const list=Array.isArray(object.material)?object.material:[object.material];
  const groups:{start:number;count:number;materialIndex?:number}[]=Array.isArray(object.material)?object.geometry.groups:[{start:0,count:object.geometry.index?.count??object.geometry.attributes.position.count,materialIndex:0}];
  const instances=object instanceof THREE.InstancedMesh?object.count:1;
  const owner=object.parent?.name||object.parent?.parent?.name||'pub';
  contributors.push({name:`${owner}/${object.name||list[0].name||object.geometry.type}`,triangles:Math.round(groups.reduce((sum,group)=>sum+group.count/3,0)*instances),instances});
  for(const group of groups){const material=list[group.materialIndex??0];if(!material?.visible)continue;materials.add(material);const passes=material.transparent&&material.side===THREE.DoubleSide&&!material.forceSinglePass?2:1;drawCalls+=passes;if(material.transparent)transparentDrawCalls+=passes;triangles+=group.count/3*(object instanceof THREE.InstancedMesh?object.count:1);}
});
console.log(JSON.stringify({fixture:baseline?'baseline':'current',loadedProps:settled.loaded.length,failedProps:settled.failed,meshes,drawCalls,transparentDrawCalls,triangles:Math.round(triangles),materials:materials.size,geometries:geometries.size,constructionMs:Math.round(performance.now()-started),errors,topTriangleContributors:contributors.sort((a,b)=>b.triangles-a.triangles).slice(0,8),diagnostics:pub.diagnostics?.()},null,2));
installer.dispose();pub.dispose();
if(errors.length||settled.failed.length)process.exitCode=1;
