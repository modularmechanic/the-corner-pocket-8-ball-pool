"""Original fictional pub drinks. Execute through the root agent's isolated Blender session."""
import bpy, math, json
from pathlib import Path
ROOT = Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
helpers = (ROOT/'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0]
helpers = helpers.replace('curve.body=words;', 'curve.resolution_u=3;curve.body=words;')
helpers = helpers.replace('vertices=48,', 'vertices=32,')
exec(helpers)
OUT.mkdir(parents=True, exist_ok=True)

def translucent(name, color, alpha):
    material=mat(name,color,0,.09)
    material.diffuse_color=(*color,alpha)
    p=material.node_tree.nodes.get('Principled BSDF')
    p.inputs['Alpha'].default_value=alpha
    p.inputs['Coat Weight'].default_value=.35
    material.surface_render_method='DITHERED'
    return material

clear=translucent('Drink Glass Clear',(.73,.86,.83),.22)
green=translucent('Drink Glass Green',(.18,.42,.27),.24)
amberglass=translucent('Drink Glass Amber',(.52,.30,.11),.24)
ice=translucent('Drink Ice',(.82,.91,.94),.56)
label=mat('Drink Label Parchment',(.84,.76,.57),0,.76)
labelred=mat('Drink Label Claret',(.28,.035,.045),0,.66)
labelblue=mat('Drink Label Navy',(.025,.095,.15),0,.61)
labelgreen=mat('Drink Label Botanical',(.07,.18,.09),0,.71)
gold=mat('Drink Foil Gold',(.69,.43,.13),.67,.3)
silver=mat('Drink Foil Silver',(.65,.72,.76),.8,.27)
amberliquid=mat('Drink Liquid Aged Rum',(.43,.12,.015),0,.15)
vodka=mat('Drink Liquid Clear Spirit',(.43,.58,.54),0,.18)
gin=mat('Drink Liquid Botanical Gin',(.12,.30,.13),0,.17)
whisky=mat('Drink Liquid Whisky',(.57,.22,.025),0,.13)
wine=mat('Drink Liquid Red Wine',(.16,.011,.025),0,.16)
vermouth=mat('Drink Liquid Martini',(.62,.66,.34),0,.13)
orange=mat('Drink Liquid Citrus',(.94,.43,.035),0,.22)
cola=mat('Drink Liquid Cola',(.063,.016,.008),0,.16)
lime=mat('Drink Olive',(.25,.36,.055),0,.46)
pimento=mat('Drink Pimento',(.58,.045,.013),0,.46)
rind=mat('Drink Orange Peel',(.99,.39,.016),0,.76)
pulp=mat('Drink Citrus Pulp',(.98,.67,.13),0,.43)
lemon=mat('Drink Lemon Peel',(.99,.81,.035),0,.74)
pith=mat('Drink Citrus Pith',(.93,.89,.66),0,.7)
pickwood=mat('Drink Cocktail Pick',(.49,.31,.12),0,.6)

def lathe(name, profile, material, segments=32):
    vertices=[]
    for radius,height in profile:
        vertices.extend([(math.sin(i*math.tau/segments)*radius,-math.cos(i*math.tau/segments)*radius,height) for i in range(segments)])
    faces=[]
    for row in range(len(profile)-1):
        for i in range(segments):
            a=row*segments+i;b=row*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    return finish(obj,name,material)

def ring(name,radius,height,material,thickness=.004):
    return tube(name,[(math.sin(i*math.tau/48)*radius,-math.cos(i*math.tau/48)*radius,height) for i in range(49)],thickness,material)

def sphere(name,location,scale,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1,location=location)
    obj=bpy.context.object;obj.scale=scale;return finish(obj,name,material)

def wrap_label(radius,bottom,top,material,span=1.05):
    vertices=[]
    for height in [bottom,top]:
        for i in range(25):
            angle=-span+2*span*i/24;vertices.append((radius*math.sin(angle),-radius*math.cos(angle),height))
    faces=[(i,i+1,i+26,i+25) for i in range(24)]
    mesh=bpy.data.meshes.new('Curved paper label');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('Curved paper label',mesh);bpy.context.collection.objects.link(obj);finish(obj,'Curved paper label',material)

def curved_type(words,radius,height,size,material):
    # Each embossed letter follows the label's cylinder instead of floating flat.
    advance=size*.64
    for i,char in enumerate(words):
        if char==' ':continue
        angle=(i-(len(words)-1)/2)*advance/radius
        obj=text('Fictional brand '+char,char,(radius*math.sin(angle),-radius*math.cos(angle),height),size,material)
        obj.rotation_euler.z=angle

def cap(radius,height,material):
    cyl('Sealed bottle cap',(0,0,height-.024),radius,.048,material)
    ring('Cap embossed lip',radius+.002,height-.048,material,.0025)
    for i in range(16):
        a=i*math.tau/16
        tube('Cap grip',[(math.sin(a)*radius,-math.cos(a)*radius,height-.04),(math.sin(a)*radius,-math.cos(a)*radius,height-.008)],.0013,material)

def coaster_base():
    cyl('Cork drinks coaster',(0,0,.009),.16,.018,coaster)
    ring('Coaster printed border',.148,.019,cream,.0015)

def cube_ice(location,size,angle=0):
    obj=box('Rounded clear ice',location,(size,size,size),ice,.011)
    obj.rotation_euler=(.13,-.17,angle)

def citrus_wheel(location,radius=.07,is_lemon=False):
    x,y,z=location
    cyl('Citrus peel',location,radius,.022,lemon if is_lemon else rind,'Y')
    cyl('White citrus pith',(x,y-.013,z),radius*.90,.006,pith,'Y')
    cyl('Juicy citrus flesh',(x,y-.017,z),radius*.78,.006,pulp,'Y')
    for i in range(8):
        a=i*math.tau/8
        tube('Citrus segment membrane',[(x,y-.021,z),(x+math.cos(a)*radius*.78,y-.021,z+math.sin(a)*radius*.78)],.0018,pith)

# Copperfin: broad, copper-foiled Caribbean rum bottle and aged amber fill.
lathe('Copperfin rounded bottle',[(0,0),(.12,0),(.146,.035),(.146,.51),(.136,.57),(.064,.65),(.047,.69),(.047,.826),(0,.826)],amberglass)
lathe('Copperfin rum fill',[(0,.035),(.133,.035),(.135,.505),(.125,.55),(0,.55)],amberliquid)
wrap_label(.147,.19,.43,label)
curved_type('COPPERFIN',.149,.327,.038,ink);curved_type('AGED RUM',.149,.263,.026,labelred)
curved_type('EST. 1928',.149,.215,.017,ink)
ring('Copperfin shoulder seal',.143,.515,gold,.003);cap(.053,.875,gold)
export('bottle-copperfin')

# Northstar: tall, faceted frost-clear vodka with a navy label and silver closure.
box('Northstar faceted glass',(0,0,.345),(.215,.215,.69),clear,.038)
box('Northstar clear spirit',(0,0,.335),(.181,.181,.60),vodka,.031)
lathe('Northstar shoulder and long neck',[(.107,.645),(.105,.693),(.046,.754),(.035,.786),(.035,.991),(0,.991)],clear,24)
box('Northstar navy front label',(0,-.111,.348),(.165,.004,.312),labelblue,.006)
text('Northstar brand','NORTHSTAR',(0,-.115,.402),.027,cream)
text('Northstar spirit','VODKA',(0,-.115,.317),.035,silver)
text('Northstar proof','TRIPLE DISTILLED',(0,-.115,.251),.0105,cream)
for angle in [0,math.pi/2]:
    obj=box('Northstar compass star',(0,-.117,.475),(.014,.003,.082),silver,.001);obj.rotation_euler.y=angle
cap(.040,1.04,silver)
export('bottle-northstar')

# Juniper & Co: a squat botanical apothecary bottle with a cork stopper.
lathe('Juniper apothecary glass',[(0,0),(.135,0),(.16,.044),(.16,.47),(.145,.54),(.073,.595),(.056,.625),(.056,.74),(0,.74)],green)
lathe('Juniper botanical fill',[(0,.032),(.146,.032),(.148,.468),(.135,.51),(0,.51)],gin)
wrap_label(.161,.17,.415,labelgreen)
curved_type('JUNIPER',.163,.314,.042,cream);curved_type('& CO',.163,.260,.026,gold)
curved_type('BOTANICAL GIN',.163,.208,.019,cream)
cyl('Juniper natural cork',(0,0,.77),.050,.085,coaster)
cyl('Juniper brass stopper',(0,0,.819),.074,.04,gold)
for a in [-.68,.68]:
    x,y=math.sin(a)*.164,-math.cos(a)*.164
    tube('Juniper botanical sprig',[(x,y,.19),(x*.95,y,.31),(x*.88,y,.40)],.002,gold)
export('bottle-juniper')

# Red Harbor: square whisky decanter, heavy glass heel and a claret label.
box('Red Harbor decanter glass',(0,0,.325),(.30,.25,.65),amberglass,.039)
box('Red Harbor whisky fill',(0,0,.309),(.264,.214,.548),whisky,.032)
lathe('Red Harbor neck',[(.125,.602),(.12,.662),(.056,.71),(.042,.745),(.042,.807),(0,.807)],amberglass,24)
box('Red Harbor foil border',(0,-.128,.315),(.241,.004,.335),gold,.010)
box('Red Harbor claret label',(0,-.132,.315),(.222,.004,.315),labelred,.008)
text('Red Harbor brand line one','RED',(0,-.137,.389),.056,cream)
text('Red Harbor brand line two','HARBOR',(0,-.137,.320),.043,cream)
text('Red Harbor whisky label','SMALL BATCH',(0,-.137,.256),.018,gold)
text('Red Harbor whisky proof','WHISKY',(0,-.137,.206),.029,cream)
cyl('Red Harbor cork',(0,0,.822),.038,.045,coaster)
box('Red Harbor glass stopper',(0,0,.866),(.105,.093,.066),gold,.012)
export('bottle-redharbor')

# Orchard House: dark wine bottle, long neck, foil capsule and cream vineyard label.
lathe('Orchard wine bottle',[(0,0),(.089,0),(.11,.03),(.11,.587),(.106,.639),(.071,.70),(.036,.766),(.035,.978),(0,.978)],green)
lathe('Orchard red wine fill',[(0,.03),(.097,.03),(.099,.573),(.089,.617),(0,.617)],wine)
wrap_label(.112,.205,.475,label)
curved_type('ORCHARD',.114,.384,.031,labelred);curved_type('HOUSE',.114,.336,.031,labelred)
curved_type('RED RESERVE',.114,.267,.017,ink)
curved_type('2021',.114,.223,.019,labelred)
cyl('Orchard claret foil capsule',(0,0,.93),.039,.154,labelred)
ring('Orchard gold capsule trim',.04,.856,gold,.003)
export('bottle-orchard')

# Martini: a hollow conical bowl, stem, foot, pale fill and a skewered olive.
coaster_base();cyl('Martini foot',(0,0,.034),.127,.024,clear)
cyl('Martini stem',(0,0,.149),.014,.216,clear)
lathe('Hollow martini bowl',[(0,.239),(.026,.25),(.193,.407),(.194,.419),(.186,.419),(.02,.262),(0,.257)],clear,40)
lathe('Martini liquid',[(0,.260),(.025,.271),(.158,.393),(0,.393)],vermouth,40)
ring('Martini rolled rim',.19,.419,clear,.004)
tube('Olive cocktail pick',[(-.15,-.035,.45),(.22,.03,.41)],.0028,pickwood)
sphere('Green olive',(.099,.009,.423),(.032,.024,.029),lime)
sphere('Olive red pimento',(.097,-.014,.426),(.012,.005,.011),pimento)
export('drink-martini')

# Citrus highball: hollow straight glass, visible ice and a segmented orange wheel.
coaster_base()
lathe('Highball hollow glass',[(0,.022),(.094,.022),(.107,.051),(.107,.482),(.103,.49),(.097,.482),(.097,.063),(0,.052)],clear)
lathe('Citrus drink fill',[(0,.055),(.095,.055),(.095,.397),(0,.397)],orange)
ring('Highball lip',.103,.489,clear,.004)
for loc,size,a in [((-.024,-.011,.383),.083,.18),((.037,.013,.418),.079,-.26),((-.027,.021,.454),.072,.48)]:cube_ice(loc,size,a)
citrus_wheel((.091,-.025,.475),.076)
export('drink-citrus')

# Whisky on rocks: short heavy-base tumbler with angular ice breaking the surface.
coaster_base()
lathe('Whisky tumbler hollow glass',[(0,.02),(.109,.02),(.12,.04),(.12,.272),(.113,.277),(.108,.271),(.108,.065),(0,.06)],clear,32)
lathe('Whisky measure',[(0,.063),(.106,.063),(.106,.173),(0,.173)],whisky)
ring('Whisky polished rim',.116,.275,clear,.004)
cube_ice((-.035,-.014,.181),.099,.35);cube_ice((.038,.025,.185),.101,-.3)
for i in range(12):
    a=i*math.tau/12
    tube('Cut tumbler heel',[(math.sin(a)*.119,-math.cos(a)*.119,.04),(math.sin(a)*.119,-math.cos(a)*.119,.088)],.002,clear)
export('drink-whisky')

# Red wine: curved bowl, thin stem, foot, rim and an opaque burgundy meniscus.
coaster_base();cyl('Wine foot',(0,0,.031),.125,.022,clear)
cyl('Wine stem',(0,0,.142),.012,.217,clear)
lathe('Wine hollow bowl',[(0,.232),(.073,.255),(.13,.318),(.142,.379),(.133,.449),(.105,.522),(.101,.525),(.099,.516),(.128,.446),(.134,.378),(.121,.321),(.065,.265),(0,.245)],clear,40)
lathe('Wine pour',[(0,.256),(.067,.274),(.12,.327),(.13,.379),(.126,.411),(0,.411)],wine,40)
ring('Wine fine rim',.103,.523,clear,.0033)
export('drink-redwine')

# Cola: curved highball, dark liquid, visible ice, striped bent straw and lemon.
coaster_base()
lathe('Cola hollow highball',[(0,.021),(.083,.021),(.095,.046),(.102,.187),(.11,.408),(.107,.432),(.10,.432),(.103,.404),(.095,.19),(.087,.055),(0,.05)],clear)
lathe('Cola liquid',[(0,.055),(.084,.055),(.092,.19),(.101,.363),(0,.363)],cola)
ring('Cola glass lip',.104,.431,clear,.004)
cube_ice((-.027,-.016,.367),.085,.2);cube_ice((.03,.024,.377),.074,-.4)
tube('Cola bent striped straw',[(.049,.013,.13),(.049,.013,.529),(.119,.027,.579)],.007,cream)
for i in range(7):
    z=.27+i*.035;tube('Red straw stripe',[(.049,.013,z),(.049,.013,z+.012)],.0075,labelred)
citrus_wheel((-.089,-.018,.405),.062,True)
curved_type('FIZZ',.104,.239,.029,cream)
export('drink-cola')

# Individual exports stay origin-at-foot. Arrange only the editable review scene.
report={}
for i,(name,obj) in enumerate(assets.items()):
    bpy.context.view_layer.update()
    bounds=[obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    lo=[min(v[axis] for v in bounds) for axis in range(3)]
    hi=[max(v[axis] for v in bounds) for axis in range(3)]
    report[name]={'boundsBlenderZUp':{'min':lo,'max':hi},'nativeHeight':hi[2]-lo[2],
                  'vertices':len(obj.data.vertices),'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),
                  'bytes':(OUT/(name+'.glb')).stat().st_size}
    obj.location=(i%5*.65,i//5*.95,0)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-drinks.blend'))
(ROOT/'art/blender/drinks-report.json').write_text(json.dumps(report,indent=2))
result={'assets':report,'blend':str(ROOT/'art/blender/pub-drinks.blend')}
