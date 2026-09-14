"""English pub architecture, authored through the isolated Blender MCP session.
Coordinates: metres, Z up, visible fronts toward -Y (glTF +Z).
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
exec((ROOT/'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0])
rng=random.Random(9827)
# Reuse photographed materials, with restrained clearcoat on aged furniture.
wood.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.14
wood.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.48
brass.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.34
brick=mat('Weathered English red brick',(.74,.60,.49),0,.91)
nt=brick.node_tree;p=nt.nodes.get('Principled BSDF')
for suffix,socket in [('color','Base Color'),('normal','Normal'),('roughness','Roughness')]:
 n=nt.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(str(ROOT/'art/blender/textures'/('brick-'+suffix+'.jpg')),check_existing=True)
 if suffix!='color':n.image.colorspace_settings.name='Non-Color'
 if socket=='Normal':
  normal=nt.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65;nt.links.new(n.outputs['Color'],normal.inputs['Color']);nt.links.new(normal.outputs['Normal'],p.inputs[socket])
 else:nt.links.new(n.outputs['Color'],p.inputs[socket])
soot=mat('Soot black firebox',(.008,.006,.004),0,.99)
hearth=mat('Worn limestone hearth',(.19,.155,.12),0,.86)
iron=mat('Forged fire iron',(.025,.022,.018),.76,.56)
patina=mat('Brass recess patina',(.10,.065,.024),.7,.63)
ember=mat('Glowing charcoal fissures',(.9,.095,.006),0,.85,2.4)
agedpaper=mat('Aged poster paper',(.66,.55,.36),0,.95)
velvet=mat('Oxblood fabric',(.13,.012,.018),0,.9)

def world_uv(o,scale=2.0):
 """Project physical brick dimensions coherently over all chimney surfaces."""
 o.data.uv_layers.active or o.data.uv_layers.new()
 for face in o.data.polygons:
  axis=max(range(3),key=lambda a:abs(face.normal[a]))
  for li in face.loop_indices:
   v=o.matrix_world @ o.data.vertices[o.data.loops[li].vertex_index].co
   a,b=(v.y,v.z) if axis==0 else (v.x,v.z) if axis==1 else (v.x,v.y)
   o.data.uv_layers.active.data[li].uv=(a/scale,b/scale)
 return o

def lathe(name,profile,m,segments=64):
 verts=[(r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z) for r,z in profile for i in range(segments)]
 faces=[(j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i) for j in range(len(profile)-1) for i in range(segments)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();mesh.uv_layers.new()
 for f in mesh.polygons:
  for li in f.loop_indices:
   k=mesh.loops[li].vertex_index;mesh.uv_layers.active.data[li].uv=((k%segments)/segments,(k//segments)/(len(profile)-1))
 o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);return finish(o,name,m)

def torus(name,loc,major,minor,m,vertical=False):
 bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=32,minor_segments=8,location=loc)
 o=bpy.context.object
 if vertical:o.rotation_euler.x=math.pi/2
 return finish(o,name,m)

# FIREPLACE: genuine open arched firebox, voussoirs, raised hearth and chimney breast.
box('Rounded stone hearth',(0,-.08,.09),(2.8,.96,.18),hearth,.035)
box('Hearth dressed edge',(0,-.13,.20),(2.72,.83,.065),hearth,.012)
box('Recessed black fireback',(0,.28,.84),(1.3,.05,1.34),soot,.01)
for side in [-1,1]:
 world_uv(box('Brick pier',(side*.995,.10,.82),(.67,.59,1.31),brick,.012))
 world_uv(box('Pier base',(side*1.0,-.03,.285),(.75,.72,.12),brick,.015))
# Individually mortared tapered bricks around the arch, opening rises to1.48m.
for i in range(15):
 a=i*math.pi/15+.009;b=(i+1)*math.pi/15-.009
 verts=[(r*math.cos(t),y,.86+r*math.sin(t)) for y in [-.218,.395] for r in [.65,.91] for t in [a,b]]
 faces=[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
 mesh=bpy.data.meshes.new('Arch brick');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('Tapered voussoir',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,brick);world_uv(o)
 bevel=o.modifiers.new('Chipped brick edges','BEVEL');bevel.width=.008;bevel.segments=2
# Overmantel brick breast and supporting stone courses.
world_uv(box('Chimney breast',(0,.15,2.34),(2.50,.48,1.42),brick,.018))
box('Mantel lower moulding',(0,-.03,1.69),(2.62,.69,.10),wood,.021)
box('Heavy oak mantel',(0,-.075,1.80),(2.78,.85,.13),wood,.027)
for x in [-.95,.95]:
 box('Mantel corbel',(x,-.17,1.55),(.18,.27,.34),wood,.035)
# Log basket and sculpted charred logs behind curved iron bars.
for x,y,z,length in [(-.22,.02,.35,.78),(.19,-.03,.40,.72),(0,.10,.50,.82)]:
 o=cyl('Charred oak log',(x,y,z),.115,length,soot,'X');o.rotation_euler.z=.13 if x>0 else -.12
 for j in range(4):tube('Ember seam',[(x-length*.4,-.11-j*.008,z-.06+j*.04),(x+length*.35,-.12-j*.008,z-.04+j*.03)],.006,ember)
for x in [-.49,.49]:
 cyl('Basket foot',(x,-.20,.32),.019,.26,iron)
 torus('Andiron brass ring',(x,-.22,.58),.047,.009,brass,True)
for z in [.30,.43,.56]:tube('Bowed grate rail',[(-.57,-.26,z),(0,-.35,z),(.57,-.26,z)],.014,iron)
for i in range(9):tube('Forged upright',[(-.54+i*.135,-.27,.27),(-.54+i*.135,-.32,.61)],.009,iron)
# Mantel clock, two real candleholders, framed brewery badge.
clock=arch('Mantel clock walnut case',.17,.20,.095,wood);clock.location=(0,-.12,1.88)
cyl('Clock brass bezel',(0,-.182,2.10),.137,.027,brass,'Y');cyl('Clock ivory face',(0,-.201,2.10),.121,.008,cream,'Y')
for i in range(12):
 a=i*math.tau/12;tube('Clock hour mark',[(.100*math.sin(a),-.208,2.1+.100*math.cos(a)),(.11*math.sin(a),-.208,2.1+.11*math.cos(a))],.003,ink)
tube('Clock hands',[(.067,-.21,2.16),(0,-.21,2.1),(-.02,-.21,2.185)],.004,ink)
for x in [-1.04,1.04]:
 c=lathe('Turned brass candlestick',[(0,0),(.09,0),(.09,.025),(.045,.05),(.027,.18),(.044,.23),(.044,.27),(0,.27)],brass,40);c.location=(x,-.11,1.87)
 cyl('Wax candle',(x,-.11,2.20),.021,.18,cream)
export('hearth-fireplace')

# THREE BRASS SHADES: rolled double rims, ivory interiors, knurled fittings and hanging chains.
# Native dimensions1.95mwide, .78mhigh; underside/source z.02.
for x in [-.65,0,.65]:
 profile=[(.018,.30),(.044,.29),(.085,.265),(.14,.23),(.19,.17),(.235,.09),(.258,.026),(.258,.010),(.246,.010),(.236,.032),(.213,.094),(.17,.17),(.12,.22),(.070,.25),(.025,.265)]
 shade=lathe('Spun brass billiard shade',profile,brass,80);shade.location.x=x
 inside=lathe('Ivory enamel reflector',[(.236,.026),(.209,.09),(.163,.168),(.11,.218),(.065,.245),(.025,.255)],cream,64);inside.location.x=x
 torus('Rolled shade edge',(x,0,.020),.253,.009,brass)
 torus('Raised rim band',(x,0,.035),.25,.0035,patina)
 cyl('Neck collar',(x,0,.314),.033,.05,brass)
 cyl('Opal lamp globe',(x,0,.082),.046,.079,mat('Opal bulb '+str(x),(.95,.80,.53),0,.28,1.4))
 # Fine radial seams on cap and aged screw fasteners.
 for a in [0,math.pi/2,math.pi,math.pi*1.5]:
  cyl('Shade cap screw',(x+.038*math.cos(a),.038*math.sin(a),.286),.005,.008,patina)
tube('Brass horizontal suspension rail',[(-.88,0,.373),(.88,0,.373)],.018,brass)
for x in [-.76,.76]:
 for i in range(12):
  ring=torus('Interlocking suspension chain',(x,0,.412+i*.029),.020,.004,brass,True)
  if i%2:ring.rotation_euler.z=math.pi/2
 cyl('Ceiling rose',(x,0,.767),.07,.026,brass)
export('heritage-lamp')

# SNUG DIVIDER: solid paneled oak with bevelled pilasters and leaded amber upper glazing.
box('Divider plinth',(0,0,.08),(1.9,.26,.16),wood,.022)
box('Timber panel body',(0,0,.50),(1.78,.145,.77),wood,.018)
for x in [-.64,0,.64]:
 box('Recessed panel field',(x,-.079,.48),(.54,.035,.59),wood,.018)
 for dx in [-.265,.265]:box('Panel bolection upright',(x+dx,-.11,.48),(.028,.035,.60),wood,.006)
 for z in [.18,.78]:box('Panel bolection rail',(x,-.11,z),(.55,.035,.026),wood,.006)
# Textured amber glass avoids the toy-like neon treatment.
amberglass=mat('Amber patterned glazing',(.24,.135,.049),.10,.3)
box('Leaded upper glazing',(0,.005,1.08),(1.67,.036,.45),amberglass,.008)
for i in range(-5,6):
 x=i*.19
 for sign in [-1,1]:
  x1=max(-.81,x-.22);x2=min(.81,x+.22)
  if x1<x2:tube('Diamond lead caming',[(x1,-.022,1.08+sign*(x1-x)),(x2,-.022,1.08+sign*(x2-x))],.0037,patina)
for x in [-.9,.9]:
 box('Carved end upright',(x,0,.72),(.13,.18,1.30),wood,.025)
 cyl('Turned post collar',(x,0,1.38),.084,.053,brass)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.066,location=(x,0,1.443));finish(bpy.context.object,'Polished post finial',wood)
for z in [.845,1.335]:box('Glazing timber rail',(0,0,z),(1.86,.13,.078),wood,.016)
export('snug-divider')

# FRAMED MEMORABILIA: layered carved frame with a raised printed ale-house engraving.
box('Walnut frame backing',(0,.008,.35),(.90,.04,.70),wood,.007)
box('Conservation mat',(0,-.018,.35),(.807,.016,.606),agedpaper,.002)
box('Ink poster field',(0,-.031,.35),(.70,.012,.50),ink,.001)
for x in [-.424,.424]:
 for y,w,d,m in [(-.025,.052,.048,wood),(-.052,.016,.02,brass),(-.038,.005,.006,patina)]:box('Carved vertical moulding',(x,y,.35),(w,d,.69),m,.006)
for z in [.026,.674]:
 for y,h,d,m in [(-.025,.052,.048,wood),(-.052,.016,.02,brass),(-.038,.005,.006,patina)]:box('Carved horizontal moulding',(0,y,z),(.84,d,h),m,.006)
for x in [-.421,.421]:
 for i in range(21):cyl('Beaded frame edging',(x,-.06,.055+i*.029),.004,.005,brass,'Y')
text('Print title','THE CORNER POCKET',(0,-.044,.531),.044,agedpaper)
text('Print subline','FINE ALES  &  BILLIARDS',(0,-.044,.475),.023,agedpaper)
# Original architectural etching of a Victorian street pub.
for x,w,h in [(-.24,.10,.13),(-.11,.14,.18),(.065,.15,.22),(.23,.11,.15)]:
 box('Engraved building',(x,-.042,.255+h/2),(w,.004,h),agedpaper,.001)
 for z in [.29,.35,.41]:
  if z<.255+h-.018:
   for xx in [x-w*.23,x+w*.23]:box('Engraved sash window',(xx,-.047,z),(.018,.003,.028),ink,0)
 tube('Roof engraving',[(x-w*.57,-.047,.255+h),(x,-.047,.295+h),(x+w*.57,-.047,.255+h)],.003,agedpaper)
for i in range(6):tube('Etched pavement',[(-.3,-.048,.247-i*.008),(.3,-.048,.247-i*.008)],.0008,agedpaper)
text('Print footer','ESTABLISHED 1928',(0,-.045,.156),.023,agedpaper)
export('memorabilia-frame')

# CASKS: individually formed staves, riveted hoops, branded barrel ends, wooden stillage.
for x in [-.41,.41]:
 box('Oak stillage foot',(x,0,.07),(.15,.75,.14),wood,.018)
 box('Oak stillage saddle',(x,0,.23),(.69,.56,.16),wood,.021)
for index,(x,z) in enumerate([(-.37,.60),(.37,.60)]):
 # Barrel horizontalaxisY, stave end rings and bulging body silhouette.
 profile=[(.26,-.37),(.274,-.33),(.30,-.22),(.316,0),(.30,.22),(.274,.33),(.26,.37)]
 for i in range(24):
  a=(i+.025)*math.tau/24;b=(i+.975)*math.tau/24
  verts=[(x+r*math.cos(t),y,z+r*math.sin(t)) for r,y in profile for t in [a,b]]
  faces=[(j*2,j*2+1,(j+1)*2+1,(j+1)*2) for j in range(len(profile)-1)]
  mesh=bpy.data.meshes.new('Curved oak stave');mesh.from_pydata(verts,[],faces);mesh.update();mesh.uv_layers.new()
  for face in mesh.polygons:
   for li in face.loop_indices:
    v=mesh.vertices[mesh.loops[li].vertex_index].co;mesh.uv_layers.active.data[li].uv=((v.x-x)*3,v.y*1.8)
  o=bpy.data.objects.new('Coopered oak stave',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,wood)
 for y in [-.34,-.21,.21,.34]:
  hoop=torus('Riveted iron hoop',(x,y,z),.28 if abs(y)>.3 else .309,.013,iron,True)
  for i in range(8):
   a=i*math.tau/8;cyl('Hoop rivet',(x+.284*math.cos(a),y-.008,z+.284*math.sin(a)),.005,.009,brass,'Y')
 cyl('Branded cask end',(x,-.373,z),.258,.025,wood,'Y')
 text('Cask brewery','CORNER',(x,-.392,z+.045),.064,ink);text('Cask beer','PALE ALE',(x,-.392,z-.025),.040,ink)
 cyl('Cask bung',(x,-.399,z-.13),.028,.035,cream,'Y')
# A small ale crate makes the silhouette less perfectly symmetric.
box('Bottle crate',(0,.06,1.05),(.63,.43,.27),wood,.014)
for x in [-.22,-.07,.08,.23]:cyl('Crated green bottle',(x,.04,1.23),.043,.24,mat('Cask bottles'+str(x),(.025,.07,.029),.05,.24))
export('cask-stack')

# Editable authoring scene and a physically lit Cycles review render.
for i,(name,o) in enumerate(assets.items()):o.location.x=(i%3)*3.7;o.location.y=(i//3)*3.0
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=24
bpy.context.scene.cycles.use_denoising=True
bpy.context.scene.world.color=(.12,.12,.12)
# Neutral studio floor, kept outside every runtime export.
bpy.ops.mesh.primitive_plane_add(size=200,location=(2,1,-.035));floor=bpy.context.object;floor.name='Preview floor';floor.data.materials.append(mat('Preview charcoal',(.045,.05,.053),0,.83))
for loc,power,size in [((0,-4,7),1600,5),((6,1,8),1900,5),((-3,2,4),900,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((3,1,1))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(10,-14,10));camera=bpy.context.object;camera.rotation_euler=(Vector((3.4,1.0,1.3))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=13;bpy.context.scene.camera=camera
bpy.context.scene.render.resolution_x=1600;bpy.context.scene.render.resolution_y=1100;bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.filepath=str(ROOT/'art/blender/pub-architecture-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-architecture.blend'))
report={name:{'vertices':len(o.data.vertices),'faces':len(o.data.polygons),'materials':len(o.data.materials),'bytes':(OUT/(name+'.glb')).stat().st_size} for name,o in assets.items()}
(ROOT/'art/blender/architecture-report.json').write_text(json.dumps(report,indent=2))
result=report
