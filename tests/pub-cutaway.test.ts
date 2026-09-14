import test from 'node:test';
import assert from 'node:assert/strict';
import { pubCutaway } from '../src/render/pub-interior';

test('interior view retains all four walls and ceiling',()=>{
  assert.deepEqual(pubCutaway({x:0,y:3,z:0}),{left:true,right:true,back:true,front:true,ceiling:true});
});
test('outside orbit removes only the near walls and roof',()=>{
  assert.deepEqual(pubCutaway({x:-19,y:11,z:17}),{left:false,right:true,back:true,front:false,ceiling:false});
  assert.deepEqual(pubCutaway({x:19,y:3,z:-17}),{left:true,right:false,back:false,front:true,ceiling:true});
});
test('overhead view opens the ceiling while retaining the entire room perimeter',()=>{
  assert.deepEqual(pubCutaway({x:0,y:23,z:-1.8}),{left:true,right:true,back:true,front:true,ceiling:false});
});
