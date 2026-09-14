"""Carved walnut photographic frame; runtime atlas fills the UV-mapped print."""
import bpy,math
from pathlib import Path
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
exec((ROOT/'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0])
paper=mat('Cotton mount board',(.71,.66,.55),0,.95)
artwork=mat('Gallery artwork',(.6,.55,.45),0,.87)
nt=artwork.node_tree;bsdf=nt.nodes.get('Principled BSDF');tex=nt.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'art/blender/textures/gallery-atlas.png'),check_existing=True)
uv=nt.nodes.new('ShaderNodeTexCoord');mapping=nt.nodes.new('ShaderNodeMapping');mapping.inputs['Location'].default_value=(.01,.51,0);mapping.inputs['Scale'].default_value=(.48,.48,1);nt.links.new(uv.outputs['UV'],mapping.inputs['Vector']);nt.links.new(mapping.outputs['Vector'],tex.inputs['Vector']);nt.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])

# Deep walnut profiles, brushed gilding and a recessed cream conservation mat.
box('Backboard',(0,.007,.365),(.97,.054,.73),wood,.009)
box('Cotton mount',(0,-.025,.365),(.856,.016,.628),paper,.002)
for x in [-.453,.453]:
 box('Routed walnut upright',(x,-.024,.365),(.064,.086,.73),wood,.012)
 box('Gilt inner moulding',(x+(-.030 if x>0 else .030),-.063,.365),(.012,.014,.665),brass,.003)
for z in [.032,.698]:
 box('Routed walnut cross rail',(0,-.024,z),(.906,.086,.064),wood,.012)
 box('Gilt inner cross moulding',(0,-.063,z+(.030 if z<.4 else -.030)),(.85,.014,.012),brass,.003)
for x in [-.458,.458]:
 for z in [.034,.696]:cyl('Recessed corner fastener',(x,-.071,z),.006,.004,brass,'Y')
# Front plane (+Z after glTF conversion), UVs preserve photographic proportions.
verts=[(-.376,-.037,.083),(.376,-.037,.083),(.376,-.037,.647),(-.376,-.037,.647)]
mesh=bpy.data.meshes.new('Archival print');mesh.from_pydata(verts,[],[(0,1,2,3)]);mesh.update();mesh.uv_layers.new()
for li,uv in enumerate([(0,0),(1,0),(1,1),(0,1)]):mesh.uv_layers.active.data[li].uv=uv
obj=bpy.data.objects.new('Original photographic print',mesh);bpy.context.collection.objects.link(obj);finish(obj,obj.name,artwork)
export('pub-photo-frame')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-photo-frame.blend'))
result={'file':str(OUT/'pub-photo-frame.glb')}
