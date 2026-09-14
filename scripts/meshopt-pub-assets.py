"""Compress the pub GLBs with pinned gltf-transform meshopt (quantize + EXT_meshopt_compression).

Run from anywhere: python3 scripts/meshopt-pub-assets.py [name.glb ...]
Every file under public/models/pub is loaded by the game (tests/asset-paths.test.ts). The source is
the file on disk when it is uncompressed, otherwise its uncompressed revision in git (SOURCE_REF,
default 4de7823), so a rerun re-encodes rather than compressing twice.

Level "high" hard-codes 8-bit octahedral normals (worst 1.14 degrees, visible as wobbling highlights on
glass, brass and chrome). Level "medium" quantizes normals to QUANTIZE_NORMAL bits instead: 9 is the
smallest setting within 0.25 degrees on these models (8 bits reached 0.38).

Each output must pass the glTF validator with 0 errors, keep its node, mesh and material names and
primitive, vertex and triangle counts, and stay within 1 mm, 0.25 degrees and 5e-4 UV of the source
per vertex (scripts/compare-glb-fidelity.ts). Otherwise the uncompressed source is written instead.
Geometry is never simplified and textures are untouched. Afterwards run `npm test`:
tests/pub-placement.test.ts proves every surface is still drawn in place.
Results go to art/blender/meshopt-report.json.
"""
from pathlib import Path
import csv, io, json, os, struct, subprocess, sys, tempfile

root = Path(__file__).resolve().parents[1]
cli = ['npx', '--yes', '--package', '@gltf-transform/cli@4.5.0', 'gltf-transform']
QUANTIZE_NORMAL = '9'
LIMITS = {'positionMm': 1, 'normalDegrees': .25, 'uv': 5e-4}
source_ref = os.environ.get('SOURCE_REF', '4de7823')
report_path = root / 'art/blender/meshopt-report.json'


def gltf_json(data):
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
    data = path.read_bytes()
    if 'EXT_meshopt_compression' in gltf_json(data).get('extensionsUsed', []):
        data = subprocess.run(['git', 'show', f'{source_ref}:public/models/pub/{path.name}'], cwd=root, check=True, capture_output=True).stdout
    before = gltf_json(data)
    with tempfile.TemporaryDirectory() as directory:
        source, output = Path(directory) / 'source.glb', Path(directory) / 'meshopt.glb'
        source.write_bytes(data)
        subprocess.run(cli + ['meshopt', str(source), str(output), '--level', 'medium', '--quantize-normal', QUANTIZE_NORMAL], check=True, capture_output=True)
        errors, same = validator_errors(output), structure(gltf_json(output.read_bytes())) == structure(before)
        fidelity = json.loads(subprocess.run(['node', '--import', 'tsx', 'scripts/compare-glb-fidelity.ts', str(source), str(output)],
                                             cwd=root, check=True, capture_output=True, text=True).stdout)
        within = all(fidelity[key] is not None and fidelity[key] <= limit for key, limit in LIMITS.items())
        entry = {'originalBytes': len(data), 'validatorErrors': len(errors), 'structureUnchanged': same,
                 'primitives': sum(len(m['primitives']) for m in before.get('meshes', [])),
                 'triangles': sum(p['triangles'] for m in structure(before)['meshes'] for p in m['primitives']),
                 **{f'max{key[0].upper()}{key[1:]}': None if value is None else round(value, 6) for key, value in fidelity.items()}}
        if errors or not same or not within:
            path.write_bytes(data); failed = True
            report[path.name] = {**entry, 'kept': 'uncompressed'}
            print(f'{path.name}: kept uncompressed ({len(errors)} validator errors, structure unchanged: {same}, fidelity {fidelity})'); continue
        path.write_bytes(output.read_bytes())
    report[path.name] = {**entry, 'meshoptBytes': path.stat().st_size}
    print(f"{path.name}: {entry['originalBytes']} -> {path.stat().st_size} bytes, {fidelity}")
report_path.write_text(json.dumps(dict(sorted(report.items())), indent=2) + '\n')
sys.exit(1 if failed else 0)
