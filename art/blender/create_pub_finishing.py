import bpy,math,json
from pathlib import Path
ROOT=Path('/Users/clemensvanderwalt/Documents/ChatGPT/coolpool')
helpers=(ROOT/'art/blender/create_pub_props.py').read_text().split('# Jukebox:')[0]
helpers=helpers.replace("curve.body=words;", "curve.resolution_u=3;curve.body=words;")
exec(helpers)
agedpaper=mat('Aged poster paper',(.66,.55,.36),0,.95)
patina=mat('Brass recess patina',(.10,.065,.024),.7,.63)
source=(ROOT/'art/blender/create_pub_architecture.py').read_text()
frame=source.split('# FRAMED MEMORABILIA:')[1].split('# CASKS:')[0]
frame=frame[frame.index("box('Walnut frame backing'"):]
# A dart league broadside with a raised dartboard engraving.
a=frame.index('# Original architectural etching');b=frame.index("text('Print footer'",a)
darts="""
for ring,r,m in [('Bakelite surround',.117,agedpaper),('Board field',.103,ink),('Double ring',.092,agedpaper),('Inner field',.079,ink),('Triple ring',.055,agedpaper),('Bull field',.047,ink),('Bull',.01,agedpaper)]:
 cyl(ring,(0,-.045,.343),r,.004,m,'Y')
for i in range(20):
 t=i*math.tau/20;tube('Radial engraving',[(math.cos(t)*.015,-.066,.343+math.sin(t)*.015),(math.cos(t)*.105,-.066,.343+math.sin(t)*.105)],.0012,agedpaper)
text('League date','FRIDAY  /  8 PM',(0,-.046,.195),.022,agedpaper)
"""
variant=frame[:a]+darts+frame[b:]
variant=variant.replace('THE CORNER POCKET','THE DARTS LEAGUE').replace('FINE ALES  &  BILLIARDS','FRIENDS  /  RIVALS  /  REGULARS').replace('ESTABLISHED 1928','ALL SKILL LEVELS WELCOME').replace("export('memorabilia-frame')","export('memorabilia-darts')")
exec(variant)
# Brewery advertisement with dimensional pint silhouette and hop-branch engraving.
ale="""
box('Vintage pint silhouette',(0,-.044,.342),(.13,.004,.15),agedpaper,.009)
box('Stout ink body',(0,-.049,.328),(.111,.004,.113),ruby,.004)
for i in range(9):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.012,location=(-.054+i*.013,-.052,.414));finish(bpy.context.object,'Foam engraving',agedpaper)
for sign in [-1,1]:
 tube('Hop branch',[(sign*.10,-.05,.27),(sign*.16,-.05,.34),(sign*.18,-.05,.41)],.002,agedpaper)
 for j in range(4):
  o=cyl('Hop cone',(sign*(.12+j*.016),-.05,.29+j*.03),.014,.003,agedpaper,'Y');o.scale.x=.65
text('Stout caption','RICH  /  ROASTED  /  LOCAL',(0,-.046,.21),.022,agedpaper)
"""
variant=frame[:a]+ale+frame[b:]
variant=variant.replace('THE CORNER POCKET','MIDNIGHT STOUT').replace('FINE ALES  &  BILLIARDS','BREWED FOR GOOD COMPANY').replace('ESTABLISHED 1928','ON CASK SINCE 1928').replace("export('memorabilia-frame')","export('memorabilia-stout')")
exec(variant)
# Traditional beer engine with turned handle, oval pump clip and swan-neck spout.
box('Beer engine oak plinth',(0,0,.039),(.35,.40,.078),wood,.012)
box('Engine polished brass collar',(0,.035,.089),(.22,.23,.03),brass,.008)
box('Engine undercounter cover',(0,.072,.172),(.16,.16,.145),dark,.012)
cyl('Pivot axle',(0,.035,.21),.044,.225,brass,'X')
tube('Hand pull lever',[(0,.03,.20),(0,.01,.36),(0,-.005,.46)],.018,brass)
for z,r,h in [(.445,.04,.025),(.49,.051,.07),(.548,.044,.047),(.584,.029,.025)]:cyl('Turned ebony handle',(0,-.005,z),r,h,dark)
cyl('Handle brass top',(0,-.005,.605),.031,.025,brass)
tube('Polished swan neck',[(0,-.03,.18),(0,-.07,.28),(0,-.14,.31),(0,-.21,.29),(0,-.235,.235),(0,-.235,.145)],.011,chrome)
cyl('Pouring nozzle',(0,-.235,.139),.016,.025,chrome)
box('Drain tray',(0,-.12,.014),(.28,.24,.028),brass,.007)
for i in range(11):box('Drip grid',(-.115+i*.023,-.16,.032),(.008,.145,.004),dark,.001)
clip=cyl('Oval ceramic pump clip',(0,-.041,.35),.076,.022,cream,'Y');clip.scale.x=.79;clip.scale.z=1.12
face=cyl('Pump clip printed face',(0,-.055,.35),.065,.005,ruby,'Y');face.scale.x=.79;face.scale.z=1.12
text('Pump clip brewery','CORNER',(0,-.061,.365),.018,cream);text('Pump clip ale','PALE ALE',(0,-.061,.333),.014,cream)
for x in [-.13,.13]:
 for y in [-.14,.14]:cyl('Plinth brass screw',(x,y,.081),.006,.004,brass)
export('ale-handpump')
for i,(name,o)in enumerate(assets.items()):o.location.x=i*1.15
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/pub-finishing.blend'))
result={name:(OUT/(name+'.glb')).stat().st_size for name in assets}
