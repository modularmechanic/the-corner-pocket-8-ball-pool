import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { installHeadlessPubAssets } from './headless-pub-assets';
import { createPropInstaller } from '../src/render/asset-installer';
import { buildPub } from '../src/render/pub';
import { createTableSurfaces } from '../src/render/table-surfaces';
import { TableModel } from '../src/render/table-model';

/** Where every drawn surface lands once the pub has settled: re-encoded assets (quantization moves mesh
 * offsets onto node transforms) must not move a single piece. Regenerate deliberately with
 * WRITE_PUB_PLACEMENT=1 npm test, only after checking the new placement in a browser. */
const FIXTURE = new URL('./pub-placement-snapshot.json', import.meta.url);
const TOLERANCE = 1e-3;
/** Material name(s), world box min/max xyz, then UV min/max uv when the geometry has UVs. */
type Placement = [string, ...number[]];

const round = (value: number) => Math.round(value * 1e4) / 1e4 || 0;

async function placements(): Promise<Placement[]> {
  const errors = installHeadlessPubAssets();
  const scene = new THREE.Scene(), installer = createPropInstaller();
  const surfaces = createTableSurfaces(installer), pub = buildPub(scene, installer);
  new TableModel(scene, surfaces, { plaque: new THREE.Texture(), brushedSteel: new THREE.Texture(), coinFace: new THREE.Texture(), balls: Array.from({ length: 16 }, () => new THREE.Texture()) });
  try {
    const settled = await installer.settled();
    assert.deepEqual([settled.failed, errors], [[], []]);
    scene.updateMatrixWorld(true);
    const records: Placement[] = [], world = new THREE.Matrix4(), instance = new THREE.Matrix4(), box = new THREE.Box3();
    scene.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const label = (Array.isArray(object.material) ? object.material : [object.material]).map(material => material.name || material.type).join('+');
      const geometry = object.geometry as THREE.BufferGeometry, uv = geometry.getAttribute('uv');
      geometry.computeBoundingBox();
      const uvRange: number[] = [];
      if (uv) {
        const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
        for (let i = 0; i < uv.count; i++) for (const axis of [0, 1]) {
          const value = axis ? uv.getY(i) : uv.getX(i);
          min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
        }
        uvRange.push(...min, ...max);
      }
      const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
      for (let i = 0; i < instances; i++) {
        world.copy(object.matrixWorld);
        if (object instanceof THREE.InstancedMesh) { object.getMatrixAt(i, instance); world.multiply(instance); }
        box.copy(geometry.boundingBox!).applyMatrix4(world);
        records.push([label, ...[...box.min.toArray(), ...box.max.toArray(), ...uvRange].map(round)]);
      }
    });
    return records;
  } finally { installer.dispose(); pub.dispose(); surfaces.dispose(); }
}

test('every pub and table surface keeps its world placement and UV range', async () => {
  const actual = await placements();
  if (process.env.WRITE_PUB_PLACEMENT) writeFileSync(FIXTURE, `[\n${actual.map(record => JSON.stringify(record)).sort().join(',\n')}\n]\n`);
  const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Placement[];
  const unmatched = new Map<string, number[][]>();
  for (const [label, ...values] of actual) unmatched.set(label, [...unmatched.get(label) ?? [], values]);
  // Matched as a multiset: load order decides scene order, never placement.
  const moved: string[] = [];
  for (const [label, ...values] of expected) {
    const candidates = unmatched.get(label) ?? [];
    let best = -1, error = Infinity;
    candidates.forEach((candidate, index) => {
      const distance = candidate.length === values.length ? Math.max(...candidate.map((value, axis) => Math.abs(value - values[axis]))) : Infinity;
      if (distance < error) { best = index; error = distance; }
    });
    if (error <= TOLERANCE) candidates.splice(best, 1);
    else moved.push(`"${label}" is no longer drawn at box/UV [${values}]; nearest [${candidates[best] ?? 'none'}]`);
  }
  assert.equal(moved.length, 0, `${moved.length} surfaces moved:\n${moved.slice(0, 12).join('\n')}`);
  const extra = [...unmatched].filter(([, left]) => left.length).map(([label, left]) => `${label} ×${left.length}`);
  assert.deepEqual(extra, [], 'no surface is drawn beyond the snapshot');
});
