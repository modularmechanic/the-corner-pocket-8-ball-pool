import bpy, math, json
from pathlib import Path
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
# Reuse reproducible modeling helpers; retain previously authored props in this isolated scene.
helpers=(ROOT/'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0]
helpers=helpers.replace("bpy.ops.object.select_all(action='SELECT')\nbpy.ops.object.delete(use_global=False)", '')
exec(helpers)
leather=mat('Oxblood leather',(.17,.018,.027),0,.47)
leather.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.2
olive=mat('Forest leather',(.031,.068,.044),0,.48)
plaster=mat('Warm plaster',(.31,.30,.24),0,.94)
# Actual textured leather color/roughness maps, shared by all upholstered props.
import random
rng=random.Random(1258)
image=bpy.data.images.new('Leather fine grain',width=256,height=256)
pixels=[]
for y in range(256):
    for x in range(256):
        grain=.60+rng.random()*.27+.04*math.sin(x*.37+math.sin(y*.2))
        pixels.extend([grain,grain,grain,1])
image.pixels.foreach_set(pixels);image.filepath_raw=str(ROOT/'art/blender/leather-grain.png');image.file_format='PNG';image.save()
for m in [leather,olive]:
    nt=m.node_tree;p=nt.nodes.get('Principled BSDF');tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image
    tex.image.colorspace_settings.name='Non-Color';nt.links.new(tex.outputs['Color'],p.inputs['Roughness'])
def lathe(name,profile,m,segments=48):
    vertices=[(r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z) for r,z in profile for i in range(segments)]
    faces=[]
    for j in range(len(profile)-1):
        for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update();uv=mesh.uv_layers.new()
    for poly in mesh.polygons:
        for k,idx in enumerate(poly.loop_indices):
            v=poly.vertices[k];uv.data[idx].uv=((v%segments)/segments,(v//segments)/(len(profile)-1))
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);return finish(o,name,m)
# Four recognizable liquor silhouettes; printed labels, neck foil and cap ridges.
for name,color,shape,label in [('liquor-amber',(.21,.08,.019),'round','OLD OAK'),('liquor-green',(.025,.12,.055),'tall','EMERALD'),('liquor-square',(.19,.055,.016),'square','RESERVE'),('liquor-decanter',(.19,.25,.23),'decanter','1928')]:
    tint=mat(name+' glass',color,.08,.12);p=tint.node_tree.nodes.get('Principled BSDF');p.inputs['Coat Weight'].default_value=.75
    if shape in ['square','decanter']:
        box('Heavy square glass body',(0,0,.29),(.31,.25,.49),tint,.045)
        box('Moulded shoulder',(0,0,.53),(.245,.20,.10),tint,.045)
        neck=cyl('Glass neck',(0,0,.66),.056,.22,tint)
    else:
        lathe('Formed bottle',[(0,.02),(.115,.02),(.135,.04),(.14,.12),(.14,.42),(.13,.48),(.09,.53),(.049,.58),(.045,.77),(.037,.78),(0,.78)],tint)
    cyl('Raised base lip',(0,0,.045),.14,.025,tint)
    cyl('Neck foil',(0,0,.735),.05,.10,brass if shape!='tall' else ruby)
    cyl('Screw closure',(0,0,.793),.052,.028,dark)
    for i in range(32):
        a=i*math.tau/32;tube('Cap knurl',[(.052*math.cos(a),.052*math.sin(a),.785),(.052*math.cos(a),.052*math.sin(a),.806)],.0014,brass)
    box('Paper label',(0,-.143,.31),(.235,.01,.205),cream,.009)
    box('Label inset',(0,-.150,.31),(.207,.005,.176),ruby if shape=='decanter' else ink,.005)
    text('Distillery',label,(0,-.156,.35),.037,cream)
    text('Bottle edition','SMALL BATCH',(0,-.156,.30),.018,cream)
    text('Bottle vintage','EST. 1928',(0,-.156,.265),.023,brass)
    if shape=='decanter':
        cyl('Glass stopper',(0,0,.845),.075,.07,tint)
        for x in [-.10,-.05,0,.05,.10]:box('Cut glass flute',(x,-.131,.31),(.012,.018,.4),tint,.005)
    export(name)
# Traditional pub chair: turned legs, stretchers, rounded cushion, curved upholstered back.
for x in [-.43,.43]:
    for y in [-.42,.42]:
        cyl('Turned walnut leg',(x,y,.57),.065,1.08,wood,r2=.048)
        cyl('Brass foot',(x,y,.085),.068,.11,brass)
for x in [-.43,.43]:tube('Side stretcher',[(x,-.42,.48),(x,.42,.48)],.033,wood)
for y in [-.42,.42]:tube('Cross stretcher',[(-.43,y,.48),(.43,y,.48)],.033,wood)
box('Chair seat frame',(0,0,1.14),(1.06,1.02,.16),wood,.07)
box('Leather seat cushion',(0,-.015,1.29),(.99,.96,.20),olive,.085)
for x in [-.43,.43]:box('Back upright',(x,.40,1.91),(.095,.10,1.59),wood,.032)
box('Upholstered back',(0,.405,2.20),(.79,.13,.87),olive,.12)
box('Curved top rail',(0,.41,2.69),(1.0,.15,.13),wood,.06)
for x in [-.33,0,.33]:
    for z in [1.94,2.22,2.47]:cyl('Back upholstery tack',(x,.322,z),.014,.018,brass,'Y')
export('pub-chair')
# Tufted booth with broad leather pads, buttons, piping and solid timber base.
box('Booth timber plinth',(0,0,.44),(3.12,1.08,.77),wood,.055)
box('Brass kick plate',(0,-.56,.20),(2.92,.028,.13),brass,.016)
box('Booth back shell',(0,.39,1.84),(3.16,.34,1.82),wood,.10)
for i in range(3):
    x=(i-1)*1.0;box('Seat cushion',(x,-.04,1.02),(.97,1.09,.32),leather,.13)
    tube('Seat piping',[(x-.43,-.53,1.10),(x+.43,-.53,1.10)],.009,brass)
# Each quilted back pad has an actual depressed button centre, not painted dots.
for row in range(3):
    for col in range(6):
        cx=-1.25+col*.5;cz=1.44+row*.48
        verts=[];n=10
        for j in range(n+1):
            for i in range(n+1):
                u=i/n;v=j/n;bulge=math.sin(math.pi*u)*math.sin(math.pi*v)*.085
                dent=math.exp(-((u-.5)**2+(v-.5)**2)/.011)*.08
                verts.append((cx+(u-.5)*.485,.19-bulge+dent,cz+(v-.5)*.46))
        faces=[(j*(n+1)+i,j*(n+1)+i+1,(j+1)*(n+1)+i+1,(j+1)*(n+1)+i) for j in range(n) for i in range(n)]
        mesh=bpy.data.meshes.new('Tufted leather');mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new()
        for poly in mesh.polygons:
            for loop in poly.loop_indices:
                v=mesh.loops[loop].vertex_index;uv.data[loop].uv=((v%(n+1))/n,(v//(n+1))/n)
        o=bpy.data.objects.new('Sculpted leather quilt',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,leather)
        cyl('Upholstered button',(cx,.19,cz),.028,.019,leather,'Y')
for x in [-1.55,1.55]:box('Rolled leather arm',(x,-.01,1.33),(.24,1.14,.43),leather,.115)
export('booth-bench')
# Beveled solid oak pedestal table with metal footrest, routed edge and corner fittings.
box('Solid oak table top',(0,0,2.31),(2.62,1.48,.16),wood,.06)
box('Routed underside',(0,0,2.21),(2.40,1.28,.10),wood,.04)
cyl('Cast iron pedestal',(0,0,1.14),.145,2.18,dark,r2=.11)
for angle in [0,math.pi/2]:
    o=box('Cross base',(0,0,.095),(1.46,.29,.15),dark,.08);o.rotation_euler.z=angle
cyl('Pedestal collar',(0,0,.27),.22,.21,brass)
tube('Brass foot rail',[(.48*math.cos(i*math.tau/64),.48*math.sin(i*math.tau/64),.55) for i in range(65)],.028,brass)
export('oak-pub-table')
# Wainscot module: inset wood panels, skirting, cap rail and textured plaster above.
box('Plaster wall',(0,.04,2.25),(3.0,.16,4.5),plaster,.005)
box('Walnut dado',(0,-.067,.92),(3.0,.13,1.84),wood,.014)
for x in [-1,0,1]:
    box('Inset panel',(x,-.145,.90),(.80,.028,1.40),wood,.025)
    for dx in [-.43,.43]:box('Panel vertical moulding',(x+dx,-.173,.90),(.047,.045,1.49),brass,.012)
    for z in [.17,1.63]:box('Panel horizontal moulding',(x,-.173,z),(.89,.045,.045),brass,.012)
box('Skirting',(0,-.18,.08),(3.0,.14,.16),wood,.025)
box('Dado cap',(0,-.17,1.83),(3.0,.20,.10),wood,.025)
export('wall-panel')
# Save models and their editable scene alongside the first prop set.
for i,(name,obj) in enumerate(assets.items()):obj.location=(4+(i%4)*3,3+(i//4)*4,0)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-props.blend'))
report=json.loads((ROOT/'art/blender/asset-report.json').read_text())
for name,obj in assets.items():report[name]={'vertices':len(obj.data.vertices),'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'bytes':(OUT/(name+'.glb')).stat().st_size}
(ROOT/'art/blender/asset-report.json').write_text(json.dumps(report,indent=2))
result={'added':list(assets),'assets':report}
