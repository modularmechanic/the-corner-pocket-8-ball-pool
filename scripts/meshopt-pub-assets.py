"""Compress pub GLB geometry with pinned gltf-transform meshopt (quantize + EXT_meshopt_compression).

Skips the four unused non-LOD liquor bottles (deleted/moved separately, never loaded by the
game) and validates every output. Does not simplify geometry or touch textures.
"""
from pathlib import Path
import subprocess, json
root=Path(__file__).resolve().parents[1]
skip={'liquor-amber.glb','liquor-green.glb','liquor-square.glb','liquor-decanter.glb'}
reports={}
for path in sorted((root/'public/models/pub').glob('*.glb')):
    if path.name in skip:continue
    output=path.with_suffix('.meshopt.glb')
    before=path.stat().st_size
    subprocess.run(['npx','--yes','--package','@gltf-transform/cli@4.5.0','gltf-transform','meshopt',str(path),str(output)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['npx','--yes','--package','@gltf-transform/cli@4.5.0','gltf-transform','validate',str(output)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    output.replace(path)
    reports[path.name]={'originalBytes':before,'meshoptBytes':path.stat().st_size}
(root/'art/blender/meshopt-report.json').write_text(json.dumps(reports,indent=2))
print(json.dumps(reports,indent=2))
