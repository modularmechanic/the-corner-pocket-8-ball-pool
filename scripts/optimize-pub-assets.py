"""Optimize Blender exports with a pinned glTF Transform CLI; retain editable .blend source."""
from pathlib import Path
import subprocess, json
root=Path(__file__).resolve().parents[1]
reports={}
for path in sorted((root/'public/models/pub').glob('*.glb')):
    if path.stem.endswith('.optimized'):continue
    output=path.with_suffix('.optimized.glb')
    before=path.stat().st_size
    subprocess.run(['npx','--yes','--package','@gltf-transform/cli@4.5.0','gltf-transform','optimize',str(path),str(output),'--compress','false','--texture-compress','webp','--texture-size','1024','--simplify-ratio','.45','--simplify-error','.0008','--palette','false'],check=True,stdout=subprocess.DEVNULL)
    output.replace(path)
    reports[path.name]={'originalBytes':before,'optimizedBytes':path.stat().st_size}
(root/'art/blender/optimization-report.json').write_text(json.dumps(reports,indent=2))
print(json.dumps(reports,indent=2))
