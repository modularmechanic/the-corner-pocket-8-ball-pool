/** CPU scene census using real geometry/GLTF parsing and inert image/canvas data.
 * Reports potential draw submissions with every wall visible; not GPU timings,
 * shader cost or a claim of hardware FPS. Run: node --import tsx scripts/benchmark-pub-batching.ts */
import * as THREE from 'three';
import { installHeadlessPubAssets } from '../tests/headless-pub-assets';

const errors=installHeadlessPubAssets();
const {buildPub}=await import('../src/render/pub');
const {createPropInstaller}=await import('../src/render/asset-installer');
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
console.log(JSON.stringify({fixture:'current',loadedProps:settled.loaded.length,failedProps:settled.failed,meshes,drawCalls,transparentDrawCalls,triangles:Math.round(triangles),materials:materials.size,geometries:geometries.size,constructionMs:Math.round(performance.now()-started),errors,topTriangleContributors:contributors.sort((a,b)=>b.triangles-a.triangles).slice(0,8),diagnostics:pub.diagnostics?.()},null,2));
installer.dispose();pub.dispose();
if(errors.length||settled.failed.length)process.exitCode=1;
