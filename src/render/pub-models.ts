import * as THREE from 'three';
import { collectRetiredPubGeometry } from './pub-batching';

export interface PubPlacement {
  x:number;y:number;z:number;
  rotation?:number;
  height?:number;
  scale?:number;
}

/** Places static props using one draw per material, even for a shelf full of bottles. */
export function instancePubModel(source:THREE.Object3D,placements:readonly PubPlacement[]):THREE.Group {
  const result=new THREE.Group();
  source.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(source);
  const height=Math.max(.001,bounds.max.y-bounds.min.y);
  const transforms=placements.map(placement=>{
    const scale=placement.height===undefined?(placement.scale??1):placement.height/height;
    const matrix=new THREE.Matrix4().compose(
      new THREE.Vector3(placement.x,placement.y-bounds.min.y*scale,placement.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),placement.rotation??0),
      new THREE.Vector3(scale,scale,scale),
    );
    return matrix;
  });
  source.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const mesh=new THREE.InstancedMesh(object.geometry,object.material,placements.length);
    mesh.name=object.name;
    mesh.castShadow=true;mesh.receiveShadow=true;
    for(let i=0;i<transforms.length;i++)mesh.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(transforms[i],object.matrixWorld));
    mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();
    result.add(mesh);
  });
  return result;
}

/** Shared geometry, materials and textures are released exactly once per room. */
export function disposePubObject(object:THREE.Object3D):void {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  collectRetiredPubGeometry(object,geometries);
  object.traverse(item=>{
    if(!(item instanceof THREE.Mesh))return;
    geometries.add(item.geometry);
    for(const material of Array.isArray(item.material)?item.material:[item.material]){
      materials.add(material);
      for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
    }
    if(item instanceof THREE.InstancedMesh)item.dispose();
  });
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
  for(const texture of textures)texture.dispose();
}
