import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
for i,name in enumerate(['drink-martini','drink-citrus','drink-whisky','drink-redwine','drink-cola']):bpy.data.objects[name].location=(i*.65,-.70,0)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.005));floor=bpy.context.object
m=bpy.data.materials.new('Preview slate');m.diffuse_color=(.033,.03,.029,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.033,.03,.029,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.4;floor.data.materials.append(m)
for pos,power,size in [((0,-2,4),350,3),((3,1,3),500,2),((-2,0,2),200,2)]:
 bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object;light.data.energy=power;light.data.size=size;light.rotation_euler=(Vector((1.3,0,.4))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3.3,-5,2.6));camera=bpy.context.object;camera.rotation_euler=(Vector((1.3,-.15,.42))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.9
s=bpy.context.scene;s.camera=camera;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True;s.world.color=(.1,.1,.1);s.render.resolution_x=1700;s.render.resolution_y=1050;s.render.resolution_percentage=100;s.render.filepath=str(ROOT/'art/blender/pub-drinks-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-drinks.blend'))
bpy.ops.render.render(write_still=True)
result={'preview':s.render.filepath}
