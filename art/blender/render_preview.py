import bpy
bpy.ops.render.render(write_still=True)
result={'preview':bpy.context.scene.render.filepath}
