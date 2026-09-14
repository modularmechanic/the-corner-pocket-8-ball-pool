"""Bake fine, matte wool baize in Blender; no live procedural noise in the browser."""
import bpy, math, json
from pathlib import Path
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
# Only color/normal/surface are loaded at runtime; if re-run, move baize-height.png and
# baize-roughness.png to art/textures/table/ afterward (unused by the game, kept for provenance).
OUT=ROOT/'public/textures/table';OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes.new('Corner Pocket Fine Baize Bake')
previous_scene=bpy.context.window.scene
bpy.context.window.scene=scene
scene.render.engine='CYCLES';scene.cycles.samples=1
scene.render.bake.margin=8
mesh=bpy.data.meshes.new('Baize bake UV sheet');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);mesh.update();mesh.uv_layers.new()
for loop,uv in zip(mesh.uv_layers.active.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=uv
sheet=bpy.data.objects.new('Baize material authoring sheet',mesh);scene.collection.objects.link(sheet);bpy.context.view_layer.objects.active=sheet;sheet.select_set(True)
material=bpy.data.materials.new('Fine tournament wool baize');material.use_nodes=True;sheet.data.materials.append(material)
n=material.node_tree.nodes;l=material.node_tree.links;n.clear()
out=n.new('ShaderNodeOutputMaterial');bsdf=n.new('ShaderNodeBsdfPrincipled');emission=n.new('ShaderNodeEmission');uv=n.new('ShaderNodeTexCoord');image_node=n.new('ShaderNodeTexImage')
# Fine isotropic wool structure. No low-frequency height field, visible weave
# grid, exaggerated ridges or repeated large mottling across the playing bed.
# Map UVs onto a 4D torus, so opposite edges match exactly when tiled.
separate=n.new('ShaderNodeSeparateXYZ');l.new(uv.outputs['UV'],separate.inputs[0])
def phase(component,operation):
    multiply=n.new('ShaderNodeMath');multiply.operation='MULTIPLY';multiply.inputs[1].default_value=math.tau;l.new(separate.outputs[component],multiply.inputs[0])
    trig=n.new('ShaderNodeMath');trig.operation=operation;l.new(multiply.outputs[0],trig.inputs[0]);return trig.outputs[0]
vector=n.new('ShaderNodeCombineXYZ');l.new(phase('X','COSINE'),vector.inputs['X']);l.new(phase('X','SINE'),vector.inputs['Y']);l.new(phase('Y','COSINE'),vector.inputs['Z']);fourth=phase('Y','SINE')
fiber=n.new('ShaderNodeTexNoise');fiber.noise_dimensions='4D';fiber.inputs['Scale'].default_value=70;fiber.inputs['Detail'].default_value=1.5;fiber.inputs['Roughness'].default_value=.62;l.new(vector.outputs[0],fiber.inputs['Vector']);l.new(fourth,fiber.inputs['W'])
nap=n.new('ShaderNodeTexNoise');nap.noise_dimensions='4D';nap.inputs['Scale'].default_value=20;nap.inputs['Detail'].default_value=1;l.new(vector.outputs[0],nap.inputs['Vector']);l.new(fourth,nap.inputs['W'])
mix=n.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[0].default_value=.15;l.new(fiber.outputs['Fac'],mix.inputs[1]);l.new(nap.outputs['Fac'],mix.inputs[2])
color=n.new('ShaderNodeValToRGB');color.color_ramp.elements[0].position=.08;color.color_ramp.elements[0].color=(.014,.099,.025,1);color.color_ramp.elements[1].position=.92;color.color_ramp.elements[1].color=(.024,.131,.034,1);l.new(mix.outputs[0],color.inputs[0]);l.new(color.outputs['Color'],bsdf.inputs['Base Color'])
rough=n.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=0;rough.inputs['From Max'].default_value=1;rough.inputs['To Min'].default_value=.88;rough.inputs['To Max'].default_value=.96;l.new(fiber.outputs['Fac'],rough.inputs['Value']);l.new(rough.outputs['Result'],bsdf.inputs['Roughness'])
height=n.new('ShaderNodeMapRange');height.inputs['To Min'].default_value=.46;height.inputs['To Max'].default_value=.54;l.new(mix.outputs[0],height.inputs['Value'])
bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.4;bump.inputs['Distance'].default_value=.006;l.new(height.outputs['Result'],bump.inputs['Height']);l.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
bsdf.inputs['Specular IOR Level'].default_value=.18;bsdf.inputs['Roughness'].default_value=.93
report=[]
def bake(name,size,socket,normal=False):
    image=bpy.data.images.new('Baize '+name,width=size,height=size,alpha=False,float_buffer=False)
    image.colorspace_settings.name='sRGB' if name=='color' else 'Non-Color'
    image_node.image=image;n.active=image_node
    for link in list(out.inputs['Surface'].links):l.remove(link)
    if normal:l.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    else:
        for link in list(emission.inputs['Color'].links):l.remove(link)
        l.new(socket,emission.inputs['Color']);l.new(emission.outputs['Emission'],out.inputs['Surface'])
    bpy.ops.object.bake(type='NORMAL' if normal else 'EMIT',use_clear=True)
    image.filepath_raw=str(OUT/('baize-'+name+'.png'));image.file_format='PNG';image.save()
    report.append({'file':image.filepath_raw,'width':size,'height':size})
bake('color',2048,color.outputs['Color'])
bake('normal',1024,None,True)
bake('height',1024,height.outputs['Result'])
bake('roughness',1024,rough.outputs['Result'])
# Shared height (R) / roughness (G) texture: one browser allocation and no
# per-frame procedural evaluation. Blue is deliberately unused.
surface=n.new('ShaderNodeCombineColor');surface.mode='RGB';surface.inputs['Blue'].default_value=0
l.new(height.outputs['Result'],surface.inputs['Red']);l.new(rough.outputs['Result'],surface.inputs['Green'])
bake('surface',1024,surface.outputs[0])
for link in list(out.inputs['Surface'].links):l.remove(link)
l.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/fine-baize.blend'))
(ROOT/'art/blender/fine-baize-report.json').write_text(json.dumps({'authoring':'Blender MCP','textures':report},indent=2))
result={'textures':report,'blend':str(ROOT/'art/blender/fine-baize.blend')}
bpy.context.window.scene=previous_scene
