"""Pub entertainment props. Run serially in the isolated Blender MCP factory scene."""
from pathlib import Path
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
exec((ROOT/'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0])
bpy.context.scene.cursor.location=(0,0,0)
# Repeated runs share the isolated Blender database; remove only stale screen
# materials so the exported runtime contract does not gain numeric suffixes.
for stale in list(bpy.data.materials):
    if any(stale.name==name or stale.name.startswith(name+'.') for name in ['Slot screen','TV screen']):
        bpy.data.materials.remove(stale)

def screen_plane(name, center, width, height, material):
    # Native Blender front is -Y; glTF exports it as +Z. Explicit upright UVs.
    x,y,z=center
    vertices=[(x-width/2,y,z-height/2),(x+width/2,y,z-height/2),
              (x+width/2,y,z+height/2),(x-width/2,y,z+height/2)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(0,1,2,3)]);mesh.update()
    # Match the cube meshes' UV layer name before the exporter joins the prop.
    # A separate layer becomes UV1 while the first UV layer is filled with zeros.
    uv=mesh.uv_layers.new(name='UVMap');uv.active_render=True
    for loop,point in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=point
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    return finish(obj,name,material)

slot_screen=mat('Slot screen',(.035,.12,.095),0,.65,.5)
tv_screen=mat('TV screen',(.03,.12,.06),0,.8,.5)
# Referenced preview images retain TEXCOORD_0 through glTF pruning/optimization.
for material in [slot_screen,tv_screen]:
    image=bpy.data.images.new(material.name+' preview',width=16,height=16)
    pixels=[]
    for y in range(16):
        for x in range(16):
            color=(.04,.12,.14,1) if y>12 else ((.30,.55,.25,1) if x%4 else (.8,.85,.67,1))
            pixels.extend(color)
    image.pixels.foreach_set(pixels);image.pack()
    node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    uv_node=material.node_tree.nodes.new('ShaderNodeUVMap');uv_node.uv_map='UVMap'
    material.node_tree.links.new(uv_node.outputs['UV'],node.inputs['Vector'])
    material.node_tree.links.new(node.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
cabinet=mat('Slot midnight lacquer',(.022,.036,.052),.28,.31)
blue=mat('Slot ice neon',(.12,.53,.8),0,.32,1.15)
slot_gold=mat('Slot amber trim',(.9,.38,.06),0,.33,1.2)
tv_shell=mat('TV graphite',(.012,.015,.018),.16,.63)

# Tall pub fruit machine: machined door, angled player deck and coin return.
box('Rubber pedestal',(0,0,.055),(.86,.68,.11),dark,.025)
box('Cabinet shell',(0,.025,.88),(.80,.60,1.63),cabinet,.055)
box('Brushed front door',(0,-.288,.47),(.71,.045,.73),brass,.026)
box('Lower enamel inset',(0,-.316,.46),(.64,.02,.61),cabinet,.025)
box('Reel chamber',(0,-.305,1.36),(.75,.08,.64),chrome,.027)
box('Reel black gasket',(0,-.351,1.36),(.677,.025,.552),dark,.018)
screen_plane('Upright animated reel display',(0,-.367,1.36),.632,.498,slot_screen)
for x in [-.112,.112]:box('Reel separator',(x,-.373,1.364),(.012,.017,.310),brass,.003)
for side in [-1,1]:
    tube('Cabinet luminous edge',[(side*.385,-.297,.16),(side*.385,-.318,.94),(side*.375,-.319,1.69)],.009,blue)
    box('Side cheek',(side*.385,-.28,.92),(.09,.45,.20),cabinet,.025)
deck=box('Angled control deck',(0,-.342,.922),(.81,.42,.115),brass,.024);deck.rotation_euler.x=math.radians(24)
for i,x in enumerate([-.24,-.08,.08,.25]):
    cap=cyl('Illuminated player button',(x,-.428,.966),.049 if i==3 else .034,.033,slot_gold if i==3 else cream)
    cap.rotation_euler.x=math.radians(24)
    ring=cyl('Button collar',(x,-.421,.949),.057 if i==3 else .041,.015,chrome);ring.rotation_euler.x=math.radians(24)
text('Player button label','HOLD    HOLD    HOLD     SPIN',(0,-.546,.865),.026,ink)
box('Coin acceptor housing',(.224,-.342,.72),(.18,.055,.20),chrome,.014)
box('Coin acceptor slit',(.224,-.374,.75),(.014,.009,.091),dark,.002)
cyl('Coin return button',(.224,-.378,.669),.025,.015,ruby,'Y')
box('Recessed coin return',(0,-.351,.28),(.39,.095,.14),dark,.021)
box('Coin tray lip',(0,-.408,.225),(.42,.08,.045),chrome,.012)
for x in [-.15,-.05,.05,.15]:box('Coin tray ridges',(x,-.385,.25),(.012,.074,.012),chrome,.003)
box('Marquee chrome frame',(0,-.255,1.813),(.875,.20,.294),chrome,.037)
box('Marquee enamel',(0,-.36,1.814),(.804,.025,.229),cabinet,.022)
text('Machine marquee','LUCKY BREAK',(0,-.38,1.803),.081,slot_gold)
text('Machine model','CORNER CLUB',(0,-.336,.453),.057,cream)
for side in [-1,1]:
    for z in [.15,.77,1.055,1.657]:cyl('Door screws',(side*.336,-.357,z),.011,.010,chrome,'Y')
for i in range(9):box('Cabinet rear vent',(-.23+i*.058,.334,1.28),(.027,.012,.23),dark,.003)
export('slot-cabinet')

# Thin 16:9 sports display with separate screen UVs, rear vents and hinged VESA mount.
box('Television main shell',(0,0,.53),(1.79,.092,1.06),tv_shell,.022)
box('Display bezel',(0,-.049,.536),(1.778,.026,1.037),dark,.017)
screen_plane('Broadcast screen',(0,-.064,.548),1.694,.953,tv_screen)
box('Lower receiver bar',(0,-.069,.023),(.30,.019,.027),tv_shell,.006)
cyl('Status LED',(.72,-.069,.025),.006,.008,teal,'Y')
text('Display maker','CORNER VISION',(0,-.079,.014),.014,cream)
box('Rear control module',(0,.065,.50),(.85,.12,.62),tv_shell,.027)
for i in range(17):box('TV ventilation slot',(-.34+i*.042,.134,.70),(.018,.007,.12),dark,.001)
box('VESA mounting plate',(0,.17,.50),(.53,.065,.39),chrome,.012)
for x in [-.21,.21]:
    for z in [.35,.65]:cyl('VESA bolt',(x,.211,z),.016,.018,dark,'Y')
box('Articulated wall arm',(0,.34,.50),(.13,.35,.14),dark,.019)
box('Wall attachment',(0,.51,.50),(.32,.05,.53),dark,.011)
export('sports-tv')

assets['slot-cabinet'].location.x=-1.15;assets['sports-tv'].location=(1.12,0,.35)
bpy.ops.object.camera_add(location=(4,-7,3.5));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,1.0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=4.4;bpy.context.scene.camera=camera
for position,power,size in [((-3,-4,6),900,4),((4,-1,4),700,3)]:
    bpy.ops.object.light_add(type='AREA',location=position);light=bpy.context.object;light.data.energy=power;light.data.size=size
    light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'art/blender/pub-entertainment-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-entertainment.blend'))
report={name:{'vertices':len(obj.data.vertices),'triangles':sum(len(face.vertices)-2 for face in obj.data.polygons),'bytes':(OUT/(name+'.glb')).stat().st_size} for name,obj in assets.items()}
(ROOT/'art/blender/entertainment-report.json').write_text(json.dumps(report,indent=2))
result={'assets':report,'blend':str(ROOT/'art/blender/pub-entertainment.blend')}
