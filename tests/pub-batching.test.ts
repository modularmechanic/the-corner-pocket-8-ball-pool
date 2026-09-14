import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {batchPubStatic,countPubDraws,pubBatchDiagnostics} from '../src/render/pub-batching';
import {disposePubObject} from '../src/render/pub-models';

function triangles(root:THREE.Object3D) {
  let count=0;root.traverseVisible(object=>{if(object instanceof THREE.Mesh)count+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object instanceof THREE.InstancedMesh?object.count:1);});return count;
}
function closeMatrix(actual:THREE.Matrix4,expected:THREE.Matrix4) {
  for(let i=0;i<16;i++)assert.ok(Math.abs(actual.elements[i]-expected.elements[i])<1e-5,`matrix element ${i}`);
}

test('repeated authored geometry retains nested world transforms and instance counts',()=>{
  const room=new THREE.Group(),section=new THREE.Group(),geometry=new THREE.BoxGeometry(1,2,3),material=new THREE.MeshStandardMaterial();
  room.position.set(4,-2,7);room.rotation.y=.35;room.add(section);section.position.set(-2,1,3);section.rotation.y=-.7;
  const first=new THREE.Mesh(geometry,material);first.position.set(2,3,4);first.rotation.y=.2;section.add(first);
  const anchor=new THREE.Group();anchor.position.set(-5,2,-3);anchor.scale.setScalar(1.4);section.add(anchor);
  const second=new THREE.InstancedMesh(geometry,material,2);anchor.add(second);
  second.setMatrixAt(0,new THREE.Matrix4().makeTranslation(2,0,1));second.setMatrixAt(1,new THREE.Matrix4().makeTranslation(0,2,-2));
  room.updateWorldMatrix(true,true);
  const expected=[first.matrixWorld.clone()];
  for(let i=0;i<2;i++){const local=new THREE.Matrix4();second.getMatrixAt(i,local);expected.push(new THREE.Matrix4().multiplyMatrices(second.matrixWorld,local));}
  const before=triangles(room),result=batchPubStatic(section,'subtree');
  assert.deepEqual(result,{before:2,after:1,saved:1});assert.equal(triangles(room),before);
  const batched=section.children.find(child=>child instanceof THREE.InstancedMesh)as THREE.InstancedMesh;
  assert.equal(batched.count,3);assert.equal(batched.geometry,geometry);assert.equal(batched.material,material);
  room.updateWorldMatrix(true,true);
  for(let i=0;i<3;i++){const local=new THREE.Matrix4();batched.getMatrixAt(i,local);closeMatrix(new THREE.Matrix4().multiplyMatrices(batched.matrixWorld,local),expected[i]);}
  assert.ok(batched.boundingSphere&&batched.boundingBox);disposePubObject(room);
});

test('static trim merges indexed and nonindexed parts without losing triangles or bounds',()=>{
  const room=new THREE.Group(),material=new THREE.MeshStandardMaterial();room.position.set(5,2,-7);room.rotation.y=.4;
  const box=new THREE.Mesh(new THREE.BoxGeometry(1,2,3),material),cylinder=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,2,12).toNonIndexed(),material);
  box.position.set(2,1,0);cylinder.position.set(-3,.5,2);cylinder.rotation.z=.6;room.add(box,cylinder);
  const before=triangles(room),bounds=new THREE.Box3().setFromObject(room,true);
  assert.deepEqual(batchPubStatic(room),{before:2,after:1,saved:1});assert.equal(triangles(room),before);
  const after=new THREE.Box3().setFromObject(room,true);assert.ok(after.min.distanceTo(bounds.min)<1e-5);assert.ok(after.max.distanceTo(bounds.max)<1e-5);
  assert.equal(room.children[0].matrixAutoUpdate,false);disposePubObject(room);
});

test('cutaway groups, live screens and transparent sorting remain independent',()=>{
  const root=new THREE.Group(),left=new THREE.Group(),right=new THREE.Group(),material=new THREE.MeshStandardMaterial();root.add(left,right);
  const geometry=new THREE.BoxGeometry();left.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));right.add(new THREE.Mesh(geometry,material));
  const texture=new THREE.Texture(),screen=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture}));screen.userData.pubDynamic=true;left.add(screen);
  const glass=new THREE.MeshStandardMaterial({transparent:true,opacity:.2,side:THREE.DoubleSide});
  const frontGlass=new THREE.Mesh(geometry,glass),backGlass=new THREE.Mesh(geometry,glass);left.add(frontGlass,backGlass);
  assert.equal(batchPubStatic(root).saved,0,'default scope never flattens child groups');
  assert.equal(batchPubStatic(left,'subtree').saved,1);assert.equal(screen.parent,left);assert.equal(frontGlass.parent,left);assert.equal(backGlass.parent,left);
  assert.equal(countPubDraws(root),7);left.visible=false;assert.equal(countPubDraws(root),1);
  left.visible=true;const version=texture.version;texture.needsUpdate=true;assert.equal(texture.version,version+1);assert.equal(screen.material.map,texture);
  assert.equal(pubBatchDiagnostics(root).constructionSubmissionsRemoved,1);disposePubObject(root);
});

test('opaque render flags and nonstandard draws are not conflated',()=>{
  const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  for(let i=0;i<4;i++){const mesh=new THREE.Mesh(geometry,material);if(i===1)mesh.castShadow=true;if(i===2)mesh.renderOrder=4;if(i===3)mesh.layers.set(2);root.add(mesh);}
  const custom=new THREE.Mesh(geometry,material);custom.onBeforeRender=()=>{};root.add(custom);
  const mirrored=new THREE.Mesh(geometry,material);mirrored.scale.x=-1;root.add(mirrored);
  const ranged=new THREE.Mesh(geometry.clone(),material);ranged.geometry.setDrawRange(0,6);root.add(ranged);
  assert.deepEqual(batchPubStatic(root),{before:7,after:7,saved:0});assert.equal(root.children.length,7);disposePubObject(root);
});

test('interleaved GLTF geometry can be instanced without copying its attributes',()=>{
  const data=new THREE.InterleavedBuffer(new Float32Array([0,0,0,0,0, 1,0,0,1,0, 0,1,0,0,1]),5),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(data,3,0));geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(data,2,3));
  const root=new THREE.Group(),material=new THREE.MeshBasicMaterial();root.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));
  assert.equal(batchPubStatic(root).saved,1);const mesh=root.children[0]as THREE.InstancedMesh;assert.equal(mesh.count,2);assert.equal(mesh.geometry.getAttribute('position'),geometry.getAttribute('position'));disposePubObject(root);
});

test('batch disposal releases retired shared geometry once and every instance allocation',()=>{
  const root=new THREE.Group(),section=new THREE.Group(),geometry=new THREE.BoxGeometry(),other=new THREE.SphereGeometry(.5,8,6),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture});root.add(section);
  section.add(new THREE.Mesh(geometry,material),new THREE.Mesh(other,material));root.add(new THREE.Mesh(geometry,material));
  let original=0,second=0,materials=0,textures=0;geometry.addEventListener('dispose',()=>original++);other.addEventListener('dispose',()=>second++);material.addEventListener('dispose',()=>materials++);texture.addEventListener('dispose',()=>textures++);
  batchPubStatic(section);assert.equal(original,0,'shared buffers stay valid outside the batch');assert.equal(second,0);
  let merged=0;(section.children[0]as THREE.Mesh).geometry.addEventListener('dispose',()=>merged++);
  disposePubObject(root);assert.equal(original,1);assert.equal(second,1);assert.equal(merged,1);assert.equal(materials,1);assert.equal(textures,1);
});
