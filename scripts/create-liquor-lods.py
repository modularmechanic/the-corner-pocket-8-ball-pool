"""Rebuild shelf bottle LODs from the original Blender modeling recipe.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup
     --python scripts/create-liquor-lods.py

The original GLBs are never written. Labels keep the original lettering and
materials, but use flat vector text instead of microscopic embossed bevels.
"""
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/pub'

# Use the same silhouettes, dimensions, material colors and label layout as the
# hero assets. Reduce only detail that is subpixel on the back-bar shelves.
helpers = (ROOT / 'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0]
helpers = helpers.replace("ROOT = Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')", f'ROOT = Path({str(ROOT)!r})')
helpers = helpers.replace('vertices=48', 'vertices=16')
helpers = helpers.replace('mod.segments=3', 'mod.segments=1').replace('mod.segments=2', 'mod.segments=1')
helpers = helpers.replace('curve.bevel_resolution=3', 'curve.bevel_resolution=0')
helpers = helpers.replace("curve.extrude=.0008;curve.bevel_depth=.0003", 'curve.extrude=0;curve.bevel_depth=0;curve.resolution_u=2')
exec(compile(helpers, 'original_prop_helpers', 'exec'))

original_export = export
def export(name):
    original_export(name + '-lod')

source = (ROOT / 'art/blender/create_pub_furniture.py').read_text()
lathe = source[source.index('def lathe('):source.index('# Traditional pub chair:')]
lathe = lathe.replace('segments=48', 'segments=24')
lathe = lathe.replace('for i in range(32):', 'for i in range(8):').replace('a=i*math.tau/32', 'a=i*math.tau/8')
exec(compile(lathe, 'original_bottle_recipe_lod', 'exec'))

# Newer drinks use the same low-detail helpers and preserve their named glass /
# liquid materials, which the runtime uses for its transparent-material policy.
drinks = (ROOT / 'art/blender/create_pub_drinks.py').read_text()
drinks = drinks[drinks.index('def translucent('):drinks.index('# Martini:')]
drinks = drinks.replace('segments=32', 'segments=16').replace('clear,24)', 'clear,16)').replace('amberglass,24)', 'amberglass,16)')
drinks = drinks.replace('math.tau/48', 'math.tau/24').replace('range(49)', 'range(25)')
drinks = drinks.replace('for i in range(16):', 'for i in range(8):').replace('a=i*math.tau/16', 'a=i*math.tau/8')
exec(compile(drinks, 'original_drinks_recipe_lod', 'exec'))

def glb_stats(path):
    data = path.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    primitives = [p for mesh in doc['meshes'] for p in mesh['primitives']]
    return {
        'bytes': len(data),
        'triangles': sum(doc['accessors'][p['indices']]['count'] // 3 for p in primitives),
        'vertices': sum(doc['accessors'][p['attributes']['POSITION']]['count'] for p in primitives),
        'primitives': len(primitives),
    }

def glb_bounds(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner)
              for obj in bpy.context.scene.objects if obj.type == 'MESH'
              for corner in obj.bound_box]
    return [[min(p[axis] for p in points) for axis in range(3)],
            [max(p[axis] for p in points) for axis in range(3)]]

report = {}
# The four non-LOD liquor-* hero bottles are unused at runtime and live in art/models/pub/,
# not public/models/pub/ (see ASSET_CREDITS.md); bottle-* heroes are still loaded in-game.
liquor_heroes = {'liquor-amber', 'liquor-green', 'liquor-square', 'liquor-decanter'}
for name in ['liquor-amber', 'liquor-green', 'liquor-square', 'liquor-decanter',
             'bottle-copperfin', 'bottle-northstar', 'bottle-juniper', 'bottle-redharbor', 'bottle-orchard']:
    hero_dir = (ROOT / 'art/models/pub') if name in liquor_heroes else OUT
    original = glb_stats(hero_dir / f'{name}.glb')
    lod = glb_stats(OUT / f'{name}-lod.glb')
    original['boundsBlenderXYZ'] = glb_bounds(hero_dir / f'{name}.glb')
    lod['boundsBlenderXYZ'] = glb_bounds(OUT / f'{name}-lod.glb')
    bound_error = max(abs(a - b) for left, right in zip(original['boundsBlenderXYZ'], lod['boundsBlenderXYZ'])
                      for a, b in zip(left, right))
    report[name] = {'original': original, 'lod': lod,
                    'maxBoundsDifferenceMeters': round(bound_error, 7),
                    'triangleReductionPercent': round(100 * (1 - lod['triangles'] / original['triangles']), 2)}
    assert lod['triangles'] < 2000, (name, lod)
    assert bound_error < .002, (name, bound_error)
print('LIQUOR_LOD_REPORT=' + json.dumps(report, sort_keys=True))
(ROOT / 'scripts/liquor-lod-report.json').write_text(json.dumps(report, indent=2) + '\n')
