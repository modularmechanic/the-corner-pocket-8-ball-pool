"""Native Blender authoring for club awards, poster boards and neon glass.
Run via scripts/blender_mcp_client.py; creates a dedicated scene, never clears
the current scene. Game coordinates are converted to Blender's Z-up space.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
OUT=ROOT/'public/models/pub'
previous=bpy.context.window.scene
scene=bpy.data.scenes.new('Corner Pocket - Club display authoring')
bpy.context.window.scene=scene
expansion=math.sqrt(1.5);left=-14.8*expansion;right=-left;front=12*expansion
assets={};parts=[];anchor=None

def mat(name,color,metal=0,rough=.4,image=False,emission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    if image:
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.new(name+' UV placeholder',4,4)
        node.image.generated_color=(*color,1);m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
    return m
wood=mat('Club display walnut',(.18,.095,.048),0,.48)
brass=mat('Club engraved brass',(.55,.37,.16),.94,.27)
silver=mat('Club polished silver',(.56,.6,.58),1,.24)
paper=mat('Club archival print',(.72,.66,.53),0,.9,True)
halo=mat('Baked club neon glow',(1,1,1),0,.6,True)
amber=mat('Club amber neon glass',(1,.66,.22),0,.25,False,2)
cyan=mat('Club cyan neon glass',(.3,.9,.78),0,.25,False,2)

def game(v):return (v[0],-v[2],v[1])
def mount(x,y,z,rotation):
    global anchor
    anchor=bpy.data.objects.new('Wall mounting transform',None);scene.collection.objects.link(anchor)
    anchor.location=game((x,y,z));anchor.rotation_euler.z=rotation
def finish(o,name,material):
    o.name=name;o.data.materials.append(material);o.parent=anchor;parts.append(o);return o
def box(name,w,h,d,material,x,y,z,bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1,location=game((x,y,z)));o=bpy.context.object;o.dimensions=(w,d,h)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Fine eased edges','BEVEL');b.width=min(bevel,w*.15,h*.15,d*.15);b.segments=1
        o.modifiers.new('Weighted crafted faces','WEIGHTED_NORMAL')
    return finish(o,name,material)
def plane(name,w,h,material,x,y,z,region,atlas):
    vertices=[game((x-w/2,y-h/2,z)),game((x+w/2,y-h/2,z)),game((x+w/2,y+h/2,z)),game((x-w/2,y+h/2,z))]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(0,1,2,3)]);mesh.update()
    uv=mesh.uv_layers.new(name='UVMap');rx,ry,rw,rh=region;aw,ah=atlas
    corners=[(0,0),(1,0),(1,1),(0,1)]
    for loop in mesh.loops:
        u,v=corners[loop.vertex_index];uv.data[loop.index].uv=((rx+u*rw)/aw,1-(ry+(1-v)*rh)/ah)
    o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);return finish(o,name,material)
def tube(name,points,radius,material):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=1;curve.bevel_depth=radius;curve.bevel_resolution=1
    spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points):p.co=(*game(co),1)
    o=bpy.data.objects.new(name,curve);scene.collection.objects.link(o);return finish(o,name,material)
def cup(name,x,scale,material):
    profile=[(.10,0),(.095,.14),(.11,.21),(.25,.34),(.34,.53),(.36,.69),(.34,.70),(.32,.54),(.22,.37),(.075,.25),(0,.24)]
    vertices=[];faces=[];segments=20
    for radius,height in profile:
        for i in range(segments):
            a=i*math.tau/segments;vertices.append(game((x+math.cos(a)*radius*scale,.27+height*scale,.22+math.sin(a)*radius*scale)))
    for ring in range(len(profile)-1):
        for i in range(segments):a=ring*segments+i;b=ring*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    for face in mesh.polygons:face.use_smooth=True
    o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);finish(o,name,material)
    for sign in [-1,1]:
        points=[]
        for i in range(24):
            a=math.pi*1.42*i/23+(-math.pi*.71 if sign>0 else math.pi*.29)
            points.append((x+(sign*.31+math.cos(a)*.2)*scale,.72*scale+.13+math.sin(a)*.2*scale,.22))
        tube('Cast cup handle',points,.025*scale,material)
def sign(w,h,color,region):
    box('Solid neon mounting board',w*.99,h*.91,.075,wood,0,0,0)
    plane('Lettering and glow diffuser',w,h,halo,0,0,.053,region,(1536,512))
    for side in [-1,1]:
        points=[((i/18-.5)*w*.9,side*(h*.3+math.sin(i/18*math.pi)*.045),.077)for i in range(19)]
        tube('Bent neon glass rail',points,.009,color)
    for x in [-w*.41,w*.41]:box('Neon stand-off clip',.025,.055,.11,brass,x,-h*.3,.025,.003)
def export(name):
    global parts
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    for o in list(parts):
        bpy.context.view_layer.objects.active=o
        if o.type!='MESH':bpy.ops.object.convert(target='MESH')
        else:
            for modifier in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    # Keep evaluated world transforms while removing the temporary mounting parent.
    matrix=o.matrix_world.copy();o.parent=None;o.matrix_world=matrix
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.data.calc_loop_triangles();tris=len(o.data.loop_triangles)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,export_cameras=False,export_lights=False)
    assets[name]={'triangles':tris,'materials':len(o.data.materials),'bytes':(OUT/(name+'.glb')).stat().st_size};parts=[]

try:
    # Existing window piers provide space without covering glazing or machines.
    for index,(z,y) in enumerate([(-6.72,.65),(7.4,1.25)]):
        mount(left+.19,y,z,math.pi/2);box('Aged poster board',1.55,2.22,.075,wood,0,1.11,0)
        plane('Archive poster paper',1.45,2.12,paper,0,1.11,.044,(index*512+8,8,496,752),(1024,1024))
        for x in [-.67,.67]:
            for yy in [.1,2.12]:box('Poster brass pin',.021,.021,.015,brass,x,yy,.052,.002)
    mount(left+.22,4.55,-6.72,math.pi/2);sign(2.15,.8,cyan,(1024,100,512,312));export('club-decor-left')
    mount(right-.22,.22,.62,-math.pi/2)
    box('Trophy walnut shelf',2.8,.13,.62,wood,0,0,.2);box('Shelf brass lip',2.8,.035,.04,brass,0,.025,.52)
    for x in [-1.05,1.05]:box('Shelf wall bracket',.075,.52,.08,brass,x,-.23,.025);box('Shelf support',.075,.065,.47,brass,x,-.03,.25)
    for i,scale in enumerate([.77,1,.72]):
        x=(i-1)*.95;metal=silver if i==1 else brass
        box('Trophy plinth',.61,.15,.45,wood,x,.14,.22);box('Polished trophy foot',.51,.055,.36,metal,x,.242,.22)
        cup('Turned cup bowl',x,scale,metal);plane('Engraved award plate',.49,.105,paper,x,.145,.452,(i*340+8,816,324,150),(1024,1024))
    export('club-decor-right')
    mount(5.66,5.38,front-.22,math.pi);sign(3.7,.73,amber,(0,112,1024,288));export('club-decor-front')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-club-decor.blend'),copy=True)
    (ROOT/'art/blender/pub-club-decor-report.json').write_text(json.dumps({'scene':scene.name,'assets':assets},indent=2))
    print(json.dumps({'scene':scene.name,'assets':assets}))
finally:
    bpy.context.window.scene=previous
