"""Compress the pub GLBs with pinned gltf-transform meshopt (quantize + EXT_meshopt_compression).

Run from anywhere: python3 scripts/meshopt-pub-assets.py [name.glb ...]
Every file under public/models/pub is loaded by the game (tests/asset-paths.test.ts). Each output
must pass the glTF validator with 0 errors and keep its node, mesh and material names, primitive,
vertex and triangle counts, or the original stays. Files already carrying EXT_meshopt_compression
are skipped. Geometry is never simplified and textures are untouched. Afterwards run
`npm test`: tests/pub-placement.test.ts proves every surface is still drawn in place.
Results go to art/blender/meshopt-report.json.
"""
from pathlib import Path
import csv, io, json, struct, subprocess, sys

root = Path(__file__).resolve().parents[1]
cli = ['npx', '--yes', '--package', '@gltf-transform/cli@4.5.0', 'gltf-transform']
report_path = root / 'art/blender/meshopt-report.json'


def gltf_json(path):
    data = path.read_bytes()
    length, = struct.unpack_from('<I', data, 12)
    return json.loads(data[20:20 + length])


def structure(gltf):
    """Names and counts that must survive compression."""
    accessors = gltf.get('accessors', [])
    def primitive(p):
        count = accessors[p['indices']]['count'] if 'indices' in p else accessors[p['attributes']['POSITION']]['count']
        return {'material': p.get('material'), 'mode': p.get('mode', 4), 'attributes': sorted(p['attributes']),
                'vertices': accessors[p['attributes']['POSITION']]['count'], 'triangles': count // 3}
    return {'nodes': [n.get('name') for n in gltf.get('nodes', [])], 'materials': [m.get('name') for m in gltf.get('materials', [])],
            'meshes': [{'name': m.get('name'), 'primitives': [primitive(p) for p in m['primitives']]} for m in gltf.get('meshes', [])]}


def validator_errors(path):
    result = subprocess.run(cli + ['validate', str(path), '--format', 'csv'], check=True, capture_output=True, text=True)
    return [row for row in csv.DictReader(io.StringIO(result.stdout)) if row.get('severity') == '0']


report = json.loads(report_path.read_text()) if report_path.exists() else {}
names = set(sys.argv[1:])
failed = False
for path in sorted((root / 'public/models/pub').glob('*.glb')):
    if names and path.name not in names: continue
    before = gltf_json(path)
    if 'EXT_meshopt_compression' in before.get('extensionsUsed', []):
        print(f'{path.name}: already compressed, skipped'); continue
    output = path.with_suffix('.meshopt.glb')
    subprocess.run(cli + ['meshopt', str(path), str(output)], check=True, capture_output=True)
    errors, same = validator_errors(output), structure(gltf_json(output)) == structure(before)
    if errors or not same:
        output.unlink(); failed = True
        print(f'{path.name}: kept original ({len(errors)} validator errors, structure unchanged: {same})'); continue
    entry = {'originalBytes': path.stat().st_size, 'meshoptBytes': output.stat().st_size, 'validatorErrors': 0,
             'primitives': sum(len(m['primitives']) for m in before.get('meshes', [])),
             'triangles': sum(p['triangles'] for m in structure(before)['meshes'] for p in m['primitives'])}
    output.replace(path)
    report[path.name] = entry
    print(f"{path.name}: {entry['originalBytes']} -> {entry['meshoptBytes']} bytes")
report_path.write_text(json.dumps(dict(sorted(report.items())), indent=2) + '\n')
sys.exit(1 if failed else 0)
