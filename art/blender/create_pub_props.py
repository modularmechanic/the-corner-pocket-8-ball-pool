"""Authored through Blender MCP; replay in a fresh Blender scene. Units match the game."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT = Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
OUT = ROOT / 'public/models/pub'
# This process was launched with factory startup, separate from the user's scene.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials = {}
def mat(name, color, metal=0, rough=.4, emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    materials[name]=m;return m
wood=mat('Walnut lacquer',(.38,.21,.095),0,.33)
nt=wood.node_tree;p=nt.nodes.get('Principled BSDF');p.inputs['Coat Weight'].default_value=.32
for file, socket, noncolor in [('wood-color.jpg','Base Color',False),('wood-roughness.jpg','Roughness',True),('wood-normal.jpg','Normal',True)]:
    n=nt.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(str(ROOT/'public'/file),check_existing=True)
    if noncolor:n.image.colorspace_settings.name='Non-Color'
    if socket=='Normal':
        normal=nt.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.2;nt.links.new(n.outputs['Color'],normal.inputs['Color']);nt.links.new(normal.outputs['Normal'],p.inputs[socket])
    else:nt.links.new(n.outputs['Color'],p.inputs[socket])
brass=mat('Brushed warm brass',(.55,.32,.095),.83,.26)
chrome=mat('Polished nickel',(.59,.66,.65),.95,.16)
dark=mat('Black enamel',(.017,.022,.019),.45,.3)
cloth=mat('Woven speaker textile',(.09,.078,.054),0,.93)
cream=mat('Ivory keys',(.86,.79,.59),0,.26)
ink=mat('Printed dark ink',(.045,.054,.048),0,.7)
ruby=mat('Burgundy enamel',(.29,.028,.021),.2,.27)
amber=mat('Amber neon',(.95,.39,.055),0,.25,2.7)
teal=mat('Sea green neon',(.085,.65,.48),0,.25,2.1)
glass=mat('Optical glass',(.68,.84,.8),.05,.1)
p=glass.node_tree.nodes.get('Principled BSDF');p.inputs['Alpha'].default_value=.16;glass.diffuse_color=(.68,.84,.8,.16);glass.surface_render_method='DITHERED'
beer=mat('Amber ale',(.61,.23,.025),.04,.2)
foam=mat('Cream foam',(.92,.86,.67),0,.7)
coaster=mat('Cork coaster',(.3,.17,.075),0,.95)
current=[]
def finish(o,name,m):
    o.name=name;o.data.materials.append(m);current.append(o)
    if o.type=='MESH':
        for face in o.data.polygons:face.use_smooth=True
    return o
def box(name,loc,size,m,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Machined rounded edges','BEVEL');mod.width=bevel;mod.segments=3
        o.modifiers.new('Weighted face normals','WEIGHTED_NORMAL')
    return finish(o,name,m)
def cyl(name,loc,radius,depth,m,axis='Z',r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=48,radius1=radius,radius2=radius if r2 is None else r2,depth=depth,location=loc);o=bpy.context.object
    if axis=='Y':o.rotation_euler.x=math.pi/2
    if axis=='X':o.rotation_euler.y=math.pi/2
    mod=o.modifiers.new('Edge glints','BEVEL');mod.width=min(.009,depth*.12);mod.segments=2
    return finish(o,name,m)
def tube(name,points,radius,m):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=2;curve.bevel_depth=radius;curve.bevel_resolution=3
    s=curve.splines.new('POLY');s.points.add(len(points)-1)
    for p,co in zip(s.points,points):p.co=(*co,1)
    o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o);return finish(o,name,m)
def text(name,words,loc,size,m):
    curve=bpy.data.curves.new(name,'FONT');curve.body=words;curve.align_x='CENTER';curve.size=size;curve.extrude=.0008;curve.bevel_depth=.0003
    o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler.x=math.pi/2;return finish(o,name,m)
def arch(name,radius,base,depth,m):
    outline=[(-radius,0),(radius,0),(radius,base)]
    outline += [(math.cos(i*math.pi/48)*radius,base+math.sin(i*math.pi/48)*radius) for i in range(1,49)]
    n=len(outline);verts=[(x,y,z) for y in [-depth/2,depth/2] for x,z in outline]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);finish(o,name,m)
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    # UVs for the scanned wood maps, including the visible end grain.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.025);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)
    mod=o.modifiers.new('Rounded cabinet shell','BEVEL');mod.width=.04;mod.segments=4;o.modifiers.new('Cabinet normals','WEIGHTED_NORMAL');return o
assets={}
def export(name):
    global current
    bpy.ops.object.select_all(action='DESELECT')
    for o in current:o.select_set(True)
    bpy.context.view_layer.objects.active=current[0]
    # Apply bevels and merge by material for few draw calls per prop.
    for o in list(current):
        bpy.context.view_layer.objects.active=o
        if o.type!='MESH':bpy.ops.object.convert(target='MESH')
        else:
            for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active=current[0];bpy.ops.object.join();joined=bpy.context.object;joined.name=name
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_cameras=False,export_lights=False)
    assets[name]=joined;current=[]
# Jukebox: detailed art-deco cabinet, inset speaker grille, real record mechanism and selection bank.
arch('Solid walnut arch',1.08,2.57,.85,wood)
box('Cast brass plinth',(0,0,.1),(2.28,1.03,.2),brass,.055)
box('Rubber plinth',(0,0,.025),(2.17,.98,.05),dark,.025)
for side in [-1,1]:
    box('Fluted brass pilaster',(side*.925,-.49,1.36),(.12,.17,2.48),brass,.045)
    for offset in [-.033,0,.033]:box('Pilaster fluting',(side*.925+offset,-.585,1.36),(.008,.014,2.18),dark,.003)
for layer,m in enumerate([amber,brass,teal,brass]):
    r=.84-layer*.06
    pts=[(-r,-.51,.23),(-r,-.51,2.57)]+[(math.cos(math.pi-i*math.pi/64)*r,-.51,2.57+math.sin(i*math.pi/64)*r) for i in range(65)]+[(r,-.51,.23)]
    tube('Arch light and metal trim',pts,.022 if layer%2==0 else .016,m)
box('Recessed speaker frame',(0,-.46,.76),(1.45,.11,1.03),brass,.06)
box('Speaker cloth',(0,-.525,.76),(1.33,.014,.92),cloth,.035)
for i in range(17):
    x=-.62+i*.0775;tube('Curved grille bar',[(x,-.552,.34),(x*.89,-.575,.76),(x,-.552,1.17)],.012,chrome)
for z in [.43,.64,.87,1.07]:box('Horizontal grille weave',(0,-.551,z),(1.26,.012,.009),dark,.002)
box('Record chamber',(0,-.46,2.30),(1.44,.1,1.67),dark,.07)
for i in range(6):
    cyl('Visible record magazine',(0,-.545-i*.008,2.37-i*.018),.52,.013,dark,'Y')
cyl('Record label',(0,-.603,2.37),.15,.01,ruby,'Y');text('Record label lettering','45',(0,-.615,2.325),.1,cream)
for r in [.25,.32,.39,.47]:
    tube('Record groove',[(r*math.cos(i*math.tau/96),-.613,2.37+r*math.sin(i*math.tau/96)) for i in range(97)],.0018,chrome)
tube('Tonearm',[(.53,-.65,2.64),(.5,-.67,2.25),(.2,-.67,2.1)],.015,chrome);box('Needle pickup',(.18,-.675,2.09),(.1,.06,.05),cream,.01)
box('Record glass',(0,-.70,2.31),(1.34,.014,1.55),glass,.035)
box('Selection panel',(0,-.61,1.42),(1.51,.18,.32),brass,.035)
for i in range(10):
    x=-.63+i*.14;box('Ivory song key',(x,-.719,1.4),(.11,.075,.135),cream,.016);text('Key number',str(i+1),(x,-.764,1.395),.037,ink)
text('Jukebox maker','CORNER POCKET',(0,-.59,3.03),.112,cream)
text('Cabinet badge','HI-FI  •  STEREO',(0,-.58,.19),.066,ink)
for side in [-1,1]:
    for z in [.24,1.3,2.61]:cyl('Fixing screw',(side*.94,-.59,z),.022,.012,chrome,'Y')
box('Coin plate',(.5,-.56,1.96),(.24,.035,.35),brass,.025);box('Coin slit',(.5,-.587,2.02),(.021,.013,.13),dark,.005)
export('heritage-jukebox')
# Three-spout beer tower, ceramic badges, sculpted handles, drain tray and plumbing collars.
box('Drip tray',(0,0,.032),(1.30,.61,.064),chrome,.045)
box('Drain inset',(0,-.04,.07),(1.17,.46,.014),dark,.025)
for i in range(19):box('Drain slots',(-.54+i*.06,-.04,.08),(.018,.40,.012),chrome,.004)
for x in [-.4,.4]:
    cyl('Foot collar',(x,.12,.09),.12,.055,brass)
    cyl('Tower upright',(x,.12,.43),.075,.67,brass)
tube('Rounded tower bridge',[(-.4,.12,.73),(-.38,.12,.82),(-.28,.12,.86),(.28,.12,.86),(.38,.12,.82),(.4,.12,.73)],.077,brass)
for i,x in enumerate([-.35,0,.35]):
    cyl('Tap flange',(x,-.003,.68),.072,.065,chrome,'Y')
    tube('Gooseneck spout',[(x,-.005,.68),(x,-.18,.68),(x,-.24,.6),(x,-.24,.48)],.029,chrome)
    cyl('Handle spindle',(x,-.08,.8),.024,.25,chrome)
    cyl('Ceramic handle',(x,-.08,1.025),.048,.26,[ruby,cream,teal][i],r2=.071)
    cyl('Handle cap',(x,-.08,1.16),.075,.024,brass)
    cyl('Pump badge',(x,-.03,.955),.125,.032,brass,'Y')
    cyl('Enamel badge',(x,-.05,.955),.106,.013,cream,'Y')
    text('Beer name',['ALE','LAGER','STOUT'][i],(x,-.06,.94),.034,ink)
export('brass-beer-taps')
# Pint: glass outer wall, rim, heavy base, amber fill, textured foam crown and coaster.
cyl('Cork beer mat',(0,0,.012),.23,.024,coaster)
cyl('Glazed coaster top',(0,0,.027),.214,.008,ruby)
cyl('Heavy pint base',(0,0,.052),.126,.042,glass)
cyl('Pint vessel',(0,0,.254),.125,.38,glass,r2=.173)
cyl('Amber liquid',(0,0,.233),.116,.342,beer,r2=.158)
cyl('Foam crown',(0,0,.414),.159,.036,foam)
tube('Rolled glass rim',[(.173*math.cos(i*math.tau/64),.173*math.sin(i*math.tau/64),.446) for i in range(65)],.007,glass)
for i in range(40):
    a=i*2.399;r=.146*math.sqrt((i+.5)/40)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.011+(i%3)*.003,location=(math.cos(a)*r,math.sin(a)*r,.433));o=bpy.context.object;o.scale.z=.32;finish(o,'Foam bubbles',foam)
text('Glass etching','CP',(0,-.161,.28),.068,cream)
export('pub-pint')
# Review scene and editable source. Exported prop origins remain at ground level.
assets['heritage-jukebox'].location.x=-1.8
assets['brass-beer-taps'].location=(1.15,0,0)
assets['pub-pint'].location=(2.5,-.25,0)
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;ground.name='Review floor';ground.data.materials.append(mat('Review backdrop',(.035,.048,.043),0,.55))
for name,loc,power,size in [('Key',(-3,-5,7),1800,5),('Fill',(4,-2,4),1000,4),('Rim',(0,3,6),1600,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.3))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(6,-11,6));cam=bpy.context.object;cam.rotation_euler=(Vector((-.25,0,1.65))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=8;bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.2,.2,.2);scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'art/blender/pub-props-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-props.blend'))
report={name:{'vertices':len(obj.data.vertices),'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'bytes':(OUT/(name+'.glb')).stat().st_size} for name,obj in assets.items()}
(ROOT/'art/blender/asset-report.json').write_text(json.dumps(report,indent=2))
result={'assets':report,'blend':str(ROOT/'art/blender/pub-props.blend')}
