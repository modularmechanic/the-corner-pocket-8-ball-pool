import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TABLE, POCKETS, initialState, type GameState, type Obstacle, type TableEvent, type Shot, type PowerUp } from '../simulation/types';
import { TABLE_RAILS, TABLE_NOSES } from '../simulation/table-geometry';
import { EFFECTS, effectDefinition } from '../presentation/effects';
import { deriveTableEffects } from '../presentation/table-presentation';
import { ballTexture, canvasTexture, woodTexture, clubLightingTexture } from './materials';
import { createTableSurfaces, type TableSurfaces } from './table-surfaces';
import { buildPocketDetails, createPocketedSlabGeometry, createPocketedPanelGeometry, createPocketedClothGeometry } from './pocket-details';
import { RoomReflections } from './room-reflections';
import { ShotPaths } from './shot-paths';
import { CueAppearance } from './cue-appearance';
import { equippedCue } from '../simulation/cues';
import { TableEffects } from './effects';
import { buildPub } from './pub';
import { PoolPostprocessing } from './postprocessing';
import { AdaptiveRenderBudget, RenderFrameHistory, GpuFrameTimer, ShadowRevision, budgetDpr, type RenderQuality } from './performance';
import { PracticalLightBudget } from './light-budget';
import { TableDetails } from './table-details';
import { advanceOrbit,clampOrbit,fitTableCamera,fitOverheadCamera,orbitDirection,orbitFromDirection,CameraTransition,TemporaryCameraView,rayFromViewport,type OrbitAngles } from './camera';
import { ShotCameraAim, ShotCameraRig } from './shot-camera';
import { BuffTrail } from './buff-trail';
export type Quality = RenderQuality;
// Table-only shadow casters keep the three practical lights from redrawing the entire pub.
const TABLE_SHADOW_LAYER = 1;
const X_AXIS=new THREE.Vector3(1,0,0),Z_AXIS=new THREE.Vector3(0,0,1),DROP_AXIS=new THREE.Vector3(.7,0,.3).normalize();
const INSPECT_TARGET=new THREE.Vector3(.35,-.75,2.6),INSPECT_DIRECTION=new THREE.Vector3(.015,.32,.947).normalize();
// Per-frame scratch vectors; never retained between calls.
const cueDirection=new THREE.Vector3(),cueRight=new THREE.Vector3(),cueUp=new THREE.Vector3(),cueTip=new THREE.Vector3(),cueNormal=new THREE.Vector3(),rollAxis=new THREE.Vector3();
interface ObstacleVisual { group: THREE.Group; body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>; pips: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[]; cracks: THREE.LineSegments; flash: number; material: Obstacle['material']; hp: number }
interface PocketDrop { age: number; from: THREE.Vector3; target: THREE.Vector3 }
interface OutFade {age:number;position:THREE.Vector3;seenPocketed:boolean}
interface VisibleHazard { id: number; kind: 'ramp' | 'portal' | 'electric' | 'water' | 'slime' | 'smoke'; x: number; z: number; radius: number; angle?: number; link?: number }
interface HazardVisual { group: THREE.Group; kind: VisibleHazard['kind']; radius: number; spinner?: THREE.Group; arcs?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; ripples: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[]; clouds: THREE.Sprite[] }
interface VisiblePickup { id: number; x: number; z: number; radius: number; available: boolean; power?:PowerUp }
interface PickupVisual { group: THREE.Group; capsule: THREE.Group; halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> }
export class PoolScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private perspectiveCamera = new THREE.PerspectiveCamera(47, 1, .035, 120);
  private overheadCamera = new THREE.OrthographicCamera(-8, 8, 4, -4, .1, 100);
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.cameraTransition.active?this.cameraTransition.camera:this.selectedCamera; }
  private get selectedCamera():THREE.PerspectiveCamera|THREE.OrthographicCamera {return this.overhead&&!this.inspection&&!this.orbit?this.overheadCamera:this.perspectiveCamera;}
  private balls: THREE.Mesh[] = [];
  // Canvas ball maps are large; the coin-return balls reuse them.
  private ballMaps = Array.from({ length: 16 }, (_, id) => ballTexture(id));
  private ballPositions: THREE.Vector3[] = [];
  private ballContactMap?: THREE.Texture;
  private cue = new THREE.Group();
  private cueAppearance!: CueAppearance;
  private cueContact = new THREE.Mesh(new THREE.RingGeometry(.011,.016,24),new THREE.MeshBasicMaterial({color:0x70e8ff,depthWrite:false,side:THREE.DoubleSide}));
  contactEditing=false;
  private shotPaths: ShotPaths;
  private placement: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE.radius);
  private tableLights: THREE.SpotLight[] = [];
  private resizeObserver: ResizeObserver;
  private quality: Quality = 'auto';
  private performanceBudget: AdaptiveRenderBudget;
  private frameHistory = new RenderFrameHistory();
  private gpuTimer: GpuFrameTimer;
  private lastFrameAt = 0;
  private lastGpuMs: number | null = null;
  private gpuSampleAge = Infinity;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private maintenanceFrames = 3;
  private shadowRevision = new ShadowRevision();
  private decorativeShadowRevision = new ShadowRevision();
  private shadowValues: number[] = [];
  private decorativeShadowValues: number[] = [];
  private decorativeShadowsDirty = false;
  private decorativeShadowAge = 0;
  private practicalLights: PracticalLightBudget;
  private overhead = false;
  private inspection = false;
  private inspectionPose?: {position:THREE.Vector3;target:THREE.Vector3};
  private orbit:OrbitAngles|null=null;
  private orbitReturn=new TemporaryCameraView();
  private cameraTransition=new CameraTransition();
  private orbitTarget=new THREE.Vector3();
  private perspectiveTarget=new THREE.Vector3();
  private shotCamera=new ShotCameraRig();
  private shotCameraAim=new ShotCameraAim();
  private aiControlled=false;
  private aiFPS=false;
  private cameraState:GameState=initialState('camera-preview');
  private cameraInputKey='';
  private tableDetails?: TableDetails;
  private chalkControls: THREE.Object3D[] = [];
  private tableOccluders: THREE.Object3D[] = [];
  private lost = false;
  private width = 0;
  private height = 0;
  private renderedSeed = '';
  private renderedShotCount = 0;
  private obstacles = new Map<number, ObstacleVisual>();
  private hazards = new Map<number, HazardVisual>();
  private hazardSignature = '';
  private smokeTexture?: THREE.CanvasTexture;
  private pickups = new Map<number, PickupVisual>();
  private pickupSignature = '';
  private pocketDrops = new Map<number, PocketDrop>();
  private outFades = new Map<number,OutFade>();
  private effects: TableEffects;
  private surfaces: TableSurfaces;
  private pocketDetails?: ReturnType<typeof buildPocketDetails>;
  private roomReflections?: RoomReflections;
  private fallbackEnvironment: THREE.WebGLRenderTarget;
  private pub?: ReturnType<typeof buildPub>;
  private postprocessing?: PoolPostprocessing;
  private buffHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private buffTrail = new BuffTrail();
  private buffColor = '';
  private cueStroke: { x: number; z: number; angle: number; age: number; elevation:number;tipX:number;tipY:number;height:number } | null = null;
  private chalkAge = Infinity;
  private clock = 0;
  aim = { angle: 0, power: .65, visible: true, elevation:0, tipX:0, tipY:0, pullback:.02 };
  aiPreview: Shot | null = null;
  constructor(private container: HTMLElement, private onContext: (lost: boolean) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.performanceBudget = new AdaptiveRenderBudget(window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
    this.gpuTimer = new GpuFrameTimer(this.renderer.getContext() as WebGL2RenderingContext);
    // Count the whole frame: scene, shadow passes, bloom and occasional reflections.
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor('#100e0c'); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    // PCF exposes a real filter radius; PCFSoft uses a fixed kernel and ignores it.
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const renderShadows=this.renderer.shadowMap.render.bind(this.renderer.shadowMap);
    this.renderer.shadowMap.render=(lights,scene,camera)=>{
      const tableLights=lights.filter(light=>this.tableLights.includes(light as THREE.SpotLight));
      const roomLights=lights.filter(light=>!this.tableLights.includes(light as THREE.SpotLight));
      if(roomLights.length)renderShadows(roomLights,scene,camera);
      if(!tableLights.length)return;
      // Three filters shadow casters with the viewing camera's layers. Restore
      // that mask before its color pass so room geometry and aiming stay intact.
      const mask=camera.layers.mask;
      try{camera.layers.set(TABLE_SHADOW_LAYER);renderShadows(tableLights,scene,camera);}
      finally{camera.layers.mask=mask;}
    };
    this.renderer.domElement.setAttribute('aria-label', '3D pool table. Click to lock aim, pull back, then click to shoot. Hold S for tip contact, E for elevation, and the right mouse button or R to look around. F returns to shooting view.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true;this.gpuTimer.dispose();onContext(true); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.lost = false;this.gpuTimer=new GpuFrameTimer(this.renderer.getContext() as WebGL2RenderingContext);this.lastGpuMs=null;this.gpuSampleAge=Infinity;this.shadowRevision.invalidate();this.roomReflections?.invalidate();this.applyGraphicsBudget();onContext(false); });
    this.scene.fog = new THREE.FogExp2('#17130f', .009);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = clubLightingTexture(); this.fallbackEnvironment = pmrem.fromEquirectangular(environment); this.scene.environment = this.fallbackEnvironment.texture;
    environment.dispose(); pmrem.dispose(); this.scene.environmentIntensity = .18;
    // Just enough room bounce to retain silhouettes; practical lamps carry the light.
    const ambient = new THREE.HemisphereLight('#d3cec0', '#211912', .12); this.scene.add(ambient);
    const windowBounce = new THREE.DirectionalLight('#bdced2', .14);windowBounce.position.set(-15,4,1);this.scene.add(windowBounce);
    // Match the Blender pendant's actual diffuser centers, just below the glass.
    // Wide, feathered cones overlap across the cloth without flooding the room.
    for (const x of [-2.1, 0, 2.1]) {
      const lamp = new THREE.SpotLight('#fff0d8', x === 0 ? 25 : 36, 11, 1.13, .27, 2);
      lamp.position.set(x, 3.72, 0); lamp.target.position.set(x * 1.08, 0, 0);
      lamp.castShadow=true;lamp.shadow.mapSize.set(1024,1024);lamp.shadow.autoUpdate=false;lamp.shadow.needsUpdate=true;
      lamp.shadow.camera.near=.1;lamp.shadow.camera.far=11;
      lamp.shadow.normalBias=.0025;lamp.shadow.bias=-.000025;lamp.shadow.radius=3.75;lamp.shadow.intensity=.8;
      this.tableLights.push(lamp);this.scene.add(lamp, lamp.target);
    }
    // Gentle bounce reveals the brass crown while remaining confined to the fixture.
    const pendantBounce=new THREE.PointLight('#ffd4a0',6,5,2);pendantBounce.position.set(-2,5.4,2);this.scene.add(pendantBounce);
    // Broad, low-energy bounce from the lamp canopy keeps cushion ends and
    // pocket facings readable without lifting the pub's ambient exposure.
    const clothBounce=new THREE.RectAreaLight('#e1e7da',.38,10.4,4.8);
    clothBounce.position.set(0,3.15,0);clothBounce.lookAt(0,0,0);this.scene.add(clothBounce);
    this.surfaces = createTableSurfaces(this.renderer);
    this.buildEnvironment(); this.buildTable(); this.buildBalls(); this.buildCue();
    this.effects = new TableEffects(this.scene);
    this.buffHalo = new THREE.Mesh(new THREE.RingGeometry(TABLE.radius * 1.19, TABLE.radius * 1.32, 64), new THREE.MeshBasicMaterial({ color: '#ffbc63', transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.buffHalo.rotation.x = -Math.PI / 2; this.buffHalo.visible = false; this.scene.add(this.buffHalo);
    this.scene.add(this.buffTrail.line);
    this.shotPaths = new ShotPaths(this.scene);
    this.placement = new THREE.Mesh(new THREE.SphereGeometry(TABLE.radius, 32, 24), new THREE.MeshStandardMaterial({ color: '#f4ebd3', transparent: true, opacity: .6 })); this.placement.visible = false; this.scene.add(this.placement);
    this.practicalLights=new PracticalLightBudget(this.scene);
    this.roomReflections = new RoomReflections(this.renderer,this.scene,
      ()=>[...(this.pub?[this.pub.group]:[]),...this.tableOccluders],
      capture=>this.practicalLights.withFullLighting(()=>this.pub?this.pub.withEnclosedRoom(capture):capture()));
    for(const ball of this.balls)this.roomReflections.add(ball.material as THREE.MeshPhysicalMaterial);
    for(const material of [this.cueAppearance.shaft,this.cueAppearance.butt,this.surfaces.brass])this.roomReflections.add(material);
    if (this.renderer.extensions.has('EXT_color_buffer_float')) this.postprocessing = new PoolPostprocessing(this.renderer, this.scene, this.camera);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.applyGraphicsBudget();
  }
  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, round = .04) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, round), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
  }
  private enableTableShadows(object:THREE.Object3D) {
    object.traverse(child=>{if(child instanceof THREE.Mesh)child.layers.enable(TABLE_SHADOW_LAYER);});
  }
  private buildEnvironment() {
    this.pub = buildPub(this.scene, this.renderer);
  }
  private buildTable() {
    const firstTableObject=this.scene.children.length;
    const {walnut,sideWood,darkWood,brass,cloth,cushion}=this.surfaces;
    const slab=(width:number,thickness:number,depth:number,material:THREE.Material,y:number,round:number)=>{
      const mesh=new THREE.Mesh(createPocketedSlabGeometry(width,depth,thickness,round),material);
      mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);
    };
    const notchedPanel=(width:number,height:number,depth:number,material:THREE.Material,x:number,y:number,z:number,round:number)=>{
      const mesh=new THREE.Mesh(createPocketedPanelGeometry(width,depth,height,x,z,round,y+height/2<0?'throat':'mouth'),material);
      mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);return mesh;
    };
    slab(12.98,.5,7.23,darkWood,-.42,.22);
    slab(12.9,.055,7.16,brass,-.22,.2);
    slab(12.84,.27,7.1,walnut,-.18,.18);
    // Separate shell panels leave a real opening into the return mechanism.
    notchedPanel(12.42, 1.04, .32, sideWood, 0, -.88, -3.165, .06);
    for(const x of [-6.05,6.05])notchedPanel(.32,1.04,6.33,sideWood,x,-.88,0,.06);
    notchedPanel(12.42,.3,.32,sideWood,0,-.51,3.165,.04);
    this.box(12.42,.2,.32,sideWood,0,-1.30,3.165,.04);
    notchedPanel(2.39,.54,.32,sideWood,-5.015,-.94,3.165,.025);
    notchedPanel(3.89,.54,.32,sideWood,4.265,-.94,3.165,.025);
    slab(12.46,.055,6.69,brass,-1.3,.07);
    for (const sign of [-1, 1]) {
      for (const x of sign>0?[-4.8,4.8]:[-4.8,-2.4,0,2.4,4.8]) this.box(sign>0&&x<0?1.94:2.16, .61, .04, darkWood, x, -.91, sign * 3.337, .055);
      this.box(11.94, .025, .03, brass, 0, -.55, sign * 3.364, .008);
    }
    const legProfile = [[.43,0],[.43,.11],[.32,.2],[.27,.55],[.25,.86],[.29,1.39],[.36,1.91],[.46,2.16],[.46,2.28]].map(([radius,y])=>new THREE.Vector2(radius,y));
    const legGeometry = new THREE.LatheGeometry(legProfile, 48);
    for (const x of [-4.68, 4.68]) for (const z of [-2.35, 2.35]) {
      const leg = new THREE.Mesh(legGeometry, walnut); leg.position.set(x,-3.5,z); leg.castShadow = true; leg.receiveShadow = true; this.scene.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(.43,.47,.1,40),brass); foot.position.set(x,-3.55,z); foot.castShadow = true; this.scene.add(foot);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(.355,.022,8,40),brass); collar.rotation.x = -Math.PI / 2; collar.position.set(x,-1.68,z); this.scene.add(collar);
    }
    for (const z of [-2.35,2.35]) this.box(9.3,.18,.23,walnut,0,-2.55,z,.04);
    for (const x of [-4.68,4.68]) this.box(.23,.18,4.7,walnut,x,-2.55,0,.04);
    // A shaped cloth surface leaves actual openings at the pockets.
    const bedGeo = createPocketedClothGeometry(11.76,6.06);
    const uv = bedGeo.attributes.uv, pos = bedGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 5.88) / 11.76, (pos.getZ(i) + 3.03) / 6.06);
    const bed = new THREE.Mesh(bedGeo, cloth); bed.position.y = 0; bed.receiveShadow = true; this.scene.add(bed);
    for (const sign of [-1, 1]) {
      notchedPanel(11.8, .23, .4, walnut, 0, .1, sign * 3.29, .065);
      notchedPanel(.42, .23, 6.12, walnut, sign * 6.11, .1, 0, .065);
      this.box(11.72, .012, .016, brass, 0, .222, sign * 3.43, .005);
      this.box(.016, .012, 5.86, brass, sign * 6.26, .222, 0, .005);
      for (const x of [-4.28, -2.85, -1.42, 1.42, 2.85, 4.28]) this.diamond(x, sign * 3.31, brass);
      for (const z of [-1.45, 0, 1.45]) this.diamond(sign * 6.1, z, brass);
    }
    for(const rail of TABLE_RAILS)this.box(rail.halfWidth*2,.16,rail.halfDepth*2,cushion,rail.x,.073,rail.z,.075);
    for(const jaw of TABLE_NOSES){const geometry=new THREE.SphereGeometry(jaw.radius,24,16);geometry.scale(1,.7,1);const nose=new THREE.Mesh(geometry,cushion);nose.position.set(jaw.x,jaw.y-.03,jaw.z);nose.castShadow=true;nose.receiveShadow=true;this.scene.add(nose);}
    this.pocketDetails=buildPocketDetails(this.scene,this.surfaces);
    // A subtle head string and the traditional baulk semicircle.
    const lineMat = new THREE.LineBasicMaterial({ color: '#c1d3ab', transparent: true, opacity: .2 });
    const head = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.85, .008, -2.82), new THREE.Vector3(-2.85, .008, 2.82)]), lineMat); this.scene.add(head);
    const arc: THREE.Vector3[] = []; for (let i = 0; i <= 60; i++) { const a = Math.PI / 2 + i / 60 * Math.PI; arc.push(new THREE.Vector3(-2.85 + Math.cos(a) * .93, .008, Math.sin(a) * .93)); }
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), lineMat));
    for (const x of [-2.85, 2.55]) { const spot = new THREE.Mesh(new THREE.CircleGeometry(.023, 16), new THREE.MeshBasicMaterial({ color: '#c9cdb2', transparent: true, opacity: .4 })); spot.rotation.x = -Math.PI / 2; spot.position.set(x, .01, 0); this.scene.add(spot); }
    const plaqueTexture = canvasTexture(1024, 128, ctx => { ctx.fillStyle = '#bd9d5f'; ctx.fillRect(0, 0, 1024, 128); ctx.fillStyle = '#392e1c'; ctx.textAlign = 'center'; ctx.font = '42px Georgia'; ctx.fillText('T H E   C O R N E R   P O C K E T', 512, 80); });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.28, .16), new THREE.MeshStandardMaterial({ map: plaqueTexture, metalness: .45, roughness: .4 })); plaque.rotation.x = -Math.PI / 2; plaque.position.set(2.17, .23, 3.32); this.scene.add(plaque);
    // Chalk rests on the rail, away from the shot surface.
    const chalk=this.box(.23,.18,.23,new THREE.MeshStandardMaterial({color:'#bfa975',roughness:.9}),-4.78,.32,3.27,.012);
    const chalkTop=this.box(.19,.014,.19,new THREE.MeshStandardMaterial({color:'#457e88',roughness:1}),-4.78,.417,3.27,.006);
    chalk.userData.tableControl='chalk';chalkTop.userData.tableControl='chalk';this.chalkControls=[chalk,chalkTop];
    this.tableDetails=new TableDetails(this.scene,this.ballMaps);
    this.tableOccluders=this.scene.children.slice(firstTableObject);
    for(const object of this.tableOccluders)this.enableTableShadows(object);
  }
  private diamond(x: number, z: number, mat: THREE.Material) {
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(.046), mat); diamond.scale.set(.8, .18, 1.5); diamond.position.set(x, .232, z); this.scene.add(diamond);
  }
  private buildBalls() {
    const geo = new THREE.SphereGeometry(TABLE.radius, 64, 48);
    const contactMap=canvasTexture(128,128,ctx=>{const g=ctx.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'#000000ef');g.addColorStop(.26,'#000000ac');g.addColorStop(.6,'#00000034');g.addColorStop(1,'#00000000');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);});
    this.ballContactMap=contactMap;
    const contactGeometry=new THREE.PlaneGeometry(TABLE.radius*2.8,TABLE.radius*2.8);
    for (let id = 0; id <= 15; id++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: this.ballMaps[id], roughness: .16, metalness: 0, clearcoat: 1, clearcoatRoughness: .075, envMapIntensity: .9, ior:1.56 });
      const ball = new THREE.Mesh(geo, mat); ball.castShadow = true; ball.receiveShadow = true;
      ball.layers.enable(TABLE_SHADOW_LAYER);
      ball.rotation.set(-Math.PI / 2, 0, 0); this.balls.push(ball); this.ballPositions.push(new THREE.Vector3()); this.scene.add(ball);
      const shadow=new THREE.Mesh(contactGeometry,new THREE.MeshBasicMaterial({map:contactMap,transparent:true,opacity:.72,depthWrite:false}));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = .012; ball.userData.shadow = shadow; this.scene.add(shadow);
    }
  }
  private buildCue() {
    this.cueAppearance=new CueAppearance(this.surfaces);
    const addSection = (length: number, radiusA: number, radiusB: number, material: THREE.Material, position: number) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusA, radiusB, length, 32), material);
      mesh.rotation.z = -Math.PI / 2; mesh.position.x = position; mesh.castShadow = true; this.cue.add(mesh);
    };
    const {cueFerrule,cueTip,brass,rubber}=this.surfaces;
    addSection(1.65, .021, .036, this.cueAppearance.shaft, -1.13);
    addSection(1.3, .036, .055, this.cueAppearance.butt, -2.60);
    addSection(.1, .024, .024, cueFerrule, -.255);
    addSection(.018, .026, .026, brass, -.317);
    addSection(.045, .024, .024, cueTip, -.184);
    addSection(.035, .038, .038, brass, -1.96);
    addSection(.035, .055, .055, brass, -3.22);
    addSection(.09, .056, .056, rubber, -3.29);
    this.enableTableShadows(this.cue);
    this.cueContact.visible=false;this.scene.add(this.cue,this.cueContact);
  }
  private poseCue(x:number,z:number,preview:Pick<Shot,'angle'|'elevation'|'tipX'|'tipY'>,pullback:number,height=0) {
    const elevation=THREE.MathUtils.clamp(preview.elevation||0,0,Math.PI/3),dx=Math.cos(preview.angle),dz=Math.sin(preview.angle);
    cueDirection.set(dx*Math.cos(elevation),-Math.sin(elevation),dz*Math.cos(elevation));
    cueRight.set(-dz,0,dx);cueUp.set(dx*Math.sin(elevation),Math.cos(elevation),dz*Math.sin(elevation));
    let tipX=THREE.MathUtils.clamp(preview.tipX||0,-.8,.8),tipY=THREE.MathUtils.clamp(preview.tipY||0,-.8,.8);
    const radius=Math.hypot(tipX,tipY);if(radius>.8){tipX*=.8/radius;tipY*=.8/radius;}
    const depth=TABLE.radius*Math.sqrt(1-tipX*tipX-tipY*tipY);
    cueTip.set(x,TABLE.radius+height,z).addScaledVector(cueDirection,-depth).addScaledVector(cueRight,tipX*TABLE.radius).addScaledVector(cueUp,tipY*TABLE.radius);
    this.cue.quaternion.setFromUnitVectors(X_AXIS,cueDirection);
    // The cue's front face is local x=-.1615; preserve contact when the butt is raised.
    this.cue.position.copy(cueTip).addScaledVector(cueDirection,.1615-pullback);
    cueNormal.set(cueTip.x-x,cueTip.y-TABLE.radius-height,cueTip.z-z).normalize();
    this.cueContact.position.copy(cueTip).addScaledVector(cueNormal,.001);this.cueContact.quaternion.setFromUnitVectors(Z_AXIS,cueNormal);
  }
  private clearObstacles() {
    for (const visual of this.obstacles.values()) {
      visual.body.material.map?.dispose();
      visual.group.removeFromParent();
      visual.group.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose(); });
    }
    this.obstacles.clear();
  }
  private clearHazards() {
    for (const visual of this.hazards.values()) {
      visual.group.removeFromParent();
      visual.group.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose(); });
    }
    this.hazards.clear();
  }
  private buildPickups(pickups: VisiblePickup[]) {
    for (const visual of this.pickups.values()) {
      visual.group.removeFromParent();
      visual.group.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose(); });
    }
    this.pickups.clear();
    for (const pickup of pickups) {
      const power=pickup.power||'focus',color=effectDefinition(power).color,radius=pickup.radius;
      const group=new THREE.Group();group.position.set(pickup.x,0,pickup.z);this.scene.add(group);
      const plinth=new THREE.Mesh(new THREE.CylinderGeometry(radius*.71,radius*.79,.04,40),new THREE.MeshStandardMaterial({color:'#4c554a',metalness:.8,roughness:.3}));plinth.position.y=.02;plinth.castShadow=true;group.add(plinth);
      const capsule=new THREE.Group();capsule.position.y=.17;group.add(capsule);
      const material=new THREE.MeshPhysicalMaterial({color,emissive:color,emissiveIntensity:.55,metalness:.32,roughness:.2,clearcoat:.8});
      const add=(geometry:THREE.BufferGeometry,x=0,y=0,z=0,mat:THREE.Material=material)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;capsule.add(mesh);return mesh;};
      if(power==='overdrive'){
        const flame=new THREE.Shape();flame.moveTo(0,-.13);flame.bezierCurveTo(-.2,-.1,-.17,.075,-.07,.12);flame.bezierCurveTo(-.055,.035,.025,.03,.015,.26);flame.bezierCurveTo(.22,.09,.2,-.07,0,-.13);
        const body=add(new THREE.ExtrudeGeometry(flame,{depth:.07,bevelEnabled:true,bevelSize:.012,bevelThickness:.014,bevelSegments:2,steps:1}),0,0,-.035);body.rotation.x=-.38;
        const core=add(new THREE.ConeGeometry(.06,.2,7),.015,-.005,.06,new THREE.MeshStandardMaterial({color:'#ffe49a',emissive:'#ffd473',emissiveIntensity:1.4}));core.rotation.z=-.16;
      }else if(power==='frost'){
        add(new THREE.IcosahedronGeometry(.125,0));
        for(let i=0;i<5;i++){const angle=i/5*Math.PI*2,crystal=add(new THREE.OctahedronGeometry(.085,0),Math.cos(angle)*.075,.015,Math.sin(angle)*.075);crystal.scale.set(.48,2.1,.48);crystal.rotation.z=Math.cos(angle)*.38;crystal.rotation.x=Math.sin(angle)*.38;}
      }else if(power==='ward'){
        const shield=new THREE.Shape();shield.moveTo(-.16,.13);shield.lineTo(.16,.13);shield.lineTo(.145,-.035);shield.quadraticCurveTo(.11,-.14,0,-.23);shield.quadraticCurveTo(-.11,-.14,-.145,-.035);shield.closePath();
        const body=add(new THREE.ExtrudeGeometry(shield,{depth:.065,bevelEnabled:true,bevelSize:.012,bevelThickness:.014,bevelSegments:2,steps:1}),0,.05,-.03);body.rotation.x=-.36;
        const crest=add(new THREE.BoxGeometry(.16,.028,.02),0,.015,.059,new THREE.MeshStandardMaterial({color:'#e0ffe8',emissive:'#c8efcb',emissiveIntensity:.35}));crest.rotation.x=-.36;
        add(new THREE.BoxGeometry(.028,.16,.02),0,.01,.07,new THREE.MeshStandardMaterial({color:'#e0ffe8',emissive:'#c8efcb',emissiveIntensity:.35}));
      }else if(power==='focus'){
        const ring=add(new THREE.TorusGeometry(.13,.018,8,40));ring.rotation.x=Math.PI/2;
        for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const mark=add(new THREE.BoxGeometry(.095,.035,.025),Math.cos(angle)*.16,0,Math.sin(angle)*.16);mark.rotation.y=-angle;}
        add(new THREE.SphereGeometry(.035,16,12));
      }else{
        const ring=add(new THREE.TorusGeometry(.14,.025,10,48));ring.rotation.x=.35;
        const second=add(new THREE.TorusGeometry(.1,.013,8,36));second.rotation.y=Math.PI/2;second.rotation.z=.4;
        add(new THREE.IcosahedronGeometry(.067,1),0,0,0,new THREE.MeshPhysicalMaterial({color:'#e0c4ff',emissive:'#b684ff',emissiveIntensity:1.2,transparent:true,opacity:.65,roughness:.08}));
      }
      const halo=new THREE.Mesh(new THREE.RingGeometry(radius*.93,radius,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));halo.rotation.x=-Math.PI/2;halo.position.y=.025;group.add(halo);
      this.enableTableShadows(group);group.visible=pickup.available;this.pickups.set(pickup.id,{group,capsule,halo});
    }
  }
  private buildHazards(hazards: VisibleHazard[]) {
    this.clearHazards();
    const copper = '#bd8652';
    for (const hazard of hazards) {
      const group = new THREE.Group(); group.position.set(hazard.x, 0, hazard.z); group.rotation.y = -(hazard.angle || 0); this.scene.add(group);
      const visual: HazardVisual = { group, kind: hazard.kind, radius: hazard.radius, ripples: [], clouds: [] };
      const radius = hazard.radius;
      const disc = (r: number, material: THREE.Material, y = .017) => { const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 80), material); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; group.add(mesh); return mesh; };
      const ring = (inner: number, outer: number, color: string, opacity = .8, y = .021) => {
        const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; group.add(mesh); return mesh;
      };
      if (hazard.kind === 'ramp') {
        disc(radius, new THREE.MeshStandardMaterial({ color: '#473d28', transparent: true, opacity: .38, roughness: .8, depthWrite: false }));
        ring(radius - .015, radius, copper, .7);
        // A shallow copper launch plate rises in the same direction as the simulation's ramp angle.
        const halfLength = radius * .72, halfWidth = radius * .54;
        const ramp = new THREE.BufferGeometry();
        const low = .11 * (1 - halfLength / radius), high = .11 * (1 + halfLength / radius);
        const vertices = [ -halfLength,low,-halfWidth, halfLength,high,-halfWidth, halfLength,high,halfWidth, -halfLength,low,halfWidth, -halfLength,.005,-halfWidth, halfLength,.005,-halfWidth, halfLength,.005,halfWidth, -halfLength,.005,halfWidth ];
        ramp.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); ramp.setIndex([0,2,1,0,3,2,1,2,6,1,6,5,0,1,5,0,5,4,3,7,6,3,6,2]); ramp.computeVertexNormals();
        ramp.addGroup(0,6,0); ramp.addGroup(6,18,1);
        const mesh = new THREE.Mesh(ramp, [new THREE.MeshPhysicalMaterial({ color: copper, metalness: .72, roughness: .32, clearcoat: .2, side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({color:'#344045',metalness:.8,roughness:.43,side:THREE.DoubleSide})]); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
        for (const sign of [-1,1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(halfLength * 2,.018,.024),new THREE.MeshStandardMaterial({color:'#e2b977',metalness:.8,roughness:.24}));
          rail.position.set(0,(low+high)/2 + .012,sign*(halfWidth-.017)); rail.rotation.z = Math.atan2(high-low,halfLength*2); rail.castShadow=true; group.add(rail);
          for (const along of [-.6,.6]) {
            const x=along*halfLength,y=low+(x+halfLength)/(halfLength*2)*(high-low);
            const screw = new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,.012,8),new THREE.MeshStandardMaterial({color:'#d7d1bf',metalness:.9,roughness:.24}));
            screw.position.set(x,y+.013,sign*(halfWidth-.04)); group.add(screw);
          }
        }
        const chevrons: THREE.Vector3[] = [];
        for (const x of [-.28, .05, .38]) { const a = x * radius, y = .11 * (a / radius + 1) + .005, previousY = .11 * ((a - .1) / radius + 1) + .005; chevrons.push(new THREE.Vector3(a - .1, previousY, -.13), new THREE.Vector3(a, y, 0), new THREE.Vector3(a, y, 0), new THREE.Vector3(a - .1, previousY, .13)); }
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(chevrons), new THREE.LineBasicMaterial({ color: '#ffdd93' })));
      } else if (hazard.kind === 'portal') {
        const color = Math.min(hazard.id, hazard.link ?? hazard.id) % 2 ? '#cb95ff' : '#7bdfeb';
        disc(radius * .89, new THREE.MeshPhysicalMaterial({ color: '#091a20', metalness: .55, roughness: .12, clearcoat: 1 }),.023);
        const well = new THREE.Mesh(new THREE.CylinderGeometry(radius*.84,radius*.78,.1,64,1,true),new THREE.MeshStandardMaterial({color:'#26363e',metalness:.8,roughness:.27,side:THREE.DoubleSide})); well.position.y=.075; group.add(well);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(radius*.885,radius*.105,12,72),new THREE.MeshPhysicalMaterial({color:copper,metalness:.85,roughness:.25,clearcoat:.25})); rim.rotation.x=-Math.PI/2;rim.position.y=.108;rim.castShadow=true;group.add(rim);
        for(let i=0;i<8;i++) {
          const angle=i/8*Math.PI*2;
          const lug=new THREE.Mesh(new RoundedBoxGeometry(radius*.18,.055,radius*.2,2,.008),new THREE.MeshStandardMaterial({color:'#3a4649',metalness:.8,roughness:.33}));
          lug.position.set(Math.cos(angle)*radius*.885,.144,Math.sin(angle)*radius*.885);lug.rotation.y=Math.PI/2-angle;lug.castShadow=true;group.add(lug);
          const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.008,6),new THREE.MeshStandardMaterial({color:'#e8cb85',metalness:.9,roughness:.25}));bolt.position.set(lug.position.x,.175,lug.position.z);group.add(bolt);
        }
        ring(radius * .77, radius * .8, color, .85,.12);
        const spinner = new THREE.Group(); group.add(spinner); visual.spinner = spinner;
        for (let i = 0; i < 5; i++) {
          const segment = new THREE.Mesh(new THREE.RingGeometry(radius * (.34 + i * .08), radius * (.35 + i * .08), 40, 1, i * 1.4, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
          segment.rotation.x = -Math.PI / 2; segment.position.y = .024 + i * .001; spinner.add(segment);
        }
        const halo = ring(radius * .83, radius * .855, color, .65, .15); visual.ripples.push(halo);
      } else if (hazard.kind === 'water' || hazard.kind === 'slime') {
        const color = hazard.kind === 'water' ? '#528f9a' : '#749334';
        disc(radius, new THREE.MeshPhysicalMaterial({ color, metalness: .15, roughness: hazard.kind === 'water' ? .07 : .19, clearcoat: 1, clearcoatRoughness: .07, transparent: true, opacity: .75, envMapIntensity: 1.3, depthWrite: false }));
        ring(radius - .017, radius, hazard.kind === 'water' ? '#a7d4df' : '#c3d878', .55);
        for (let i = 0; i < 3; i++) { const ripple = ring(radius * .3, radius * .3 + .009, hazard.kind === 'water' ? '#c6e5e9' : '#d2e27e', .3, .022 + i * .001); visual.ripples.push(ripple); }
        if (hazard.kind === 'slime') {
          for (let i = 0; i < 6; i++) {
            const angle = i * 2.4, r = radius * (.2 + (i % 3) * .19);
            const bubble = new THREE.Mesh(new THREE.SphereGeometry(.027 + (i % 3) * .009, 12, 8), new THREE.MeshPhysicalMaterial({ color: '#a4b952', roughness: .12, transparent: true, opacity: .7, clearcoat: 1 }));
            bubble.position.set(Math.cos(angle) * r, .017, Math.sin(angle) * r); bubble.scale.y = .35; group.add(bubble);
          }
        }
      } else if (hazard.kind === 'electric') {
        disc(radius, new THREE.MeshStandardMaterial({ color: '#253438', metalness: .7, roughness: .4 }));
        ring(radius - .03, radius, copper); ring(radius * .7, radius * .73, '#77dbe3', .6);
        for (let i = 0; i < 6; i++) {
          const angle = i / 6 * Math.PI * 2;
          const contact = new THREE.Mesh(new THREE.CylinderGeometry(.035, .04, .045, 12), new THREE.MeshStandardMaterial({ color: copper, metalness: .85, roughness: .25 })); contact.position.set(Math.cos(angle) * radius * .84, .039, Math.sin(angle) * radius * .84); group.add(contact);
        }
        const arcs = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#9feaff', transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })); group.add(arcs); visual.arcs = arcs;
      } else {
        disc(radius, new THREE.MeshBasicMaterial({ color: '#becac1', transparent: true, opacity: .11, depthWrite: false })); ring(radius - .016, radius, '#b3c0b9', .4);
        this.smokeTexture ||= canvasTexture(128, 128, ctx => { const gradient = ctx.createRadialGradient(64,64,0,64,64,62); gradient.addColorStop(0, '#e7efedb0'); gradient.addColorStop(.4, '#d7e2e977'); gradient.addColorStop(1, '#c4d4df00'); ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128); });
        for (let i = 0; i < 5; i++) {
          const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTexture, color: '#e1e8e5', transparent: true, opacity: .14, depthWrite: false })); cloud.scale.setScalar(radius * 1.15); group.add(cloud); visual.clouds.push(cloud);
        }
      }
      this.enableTableShadows(group);this.hazards.set(hazard.id, visual);
    }
  }
  private buildObstacles(state: GameState) {
    this.clearObstacles();
    for (const obstacle of state.arcade?.obstacles || []) {
      const group = new THREE.Group(); group.position.set(obstacle.x, 0, obstacle.z); this.scene.add(group);
      const color = obstacle.material === 'steel' ? '#586975' : obstacle.material === 'hex' ? '#594664' : '#b17b42';
      const material = new THREE.MeshPhysicalMaterial({ color, map: obstacle.material === 'wood' ? woodTexture() : null, metalness: obstacle.material === 'steel' ? .8 : .2, roughness: obstacle.material === 'steel' ? .32 : .5, clearcoat: .25 });
      // The footprint matches the collider; decorative edges stay inside that footprint.
      const body = new THREE.Mesh(new RoundedBoxGeometry(obstacle.width - .012, .46, obstacle.depth - .012, 2, .012), material);
      body.position.y = .23; body.castShadow = true; body.receiveShadow = true; group.add(body);
      for(const y of [.065,.34]) {
        const band=new THREE.Mesh(new RoundedBoxGeometry(obstacle.width,.032,obstacle.depth,2,.008),new THREE.MeshStandardMaterial({color:obstacle.material==='wood'?'#3a3e38':obstacle.material==='hex'?'#ad91bd':'#9faeb4',metalness:.78,roughness:.34}));
        band.position.y=y;band.castShadow=true;group.add(band);
      }
      for(const x of [-1,1])for(const z of [-1,1]) {
        const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.014,6),new THREE.MeshStandardMaterial({color:obstacle.material==='wood'?'#bbaa77':'#d4d7cb',metalness:.85,roughness:.3}));
        bolt.position.set(x*(obstacle.width/2-.037),.467,z*(obstacle.depth/2-.037));group.add(bolt);
      }
      const isWide = obstacle.width >= obstacle.depth, longSide = Math.max(obstacle.width, obstacle.depth), shortSide = Math.min(obstacle.width, obstacle.depth);
      if(obstacle.material==='wood') {
        const seams:THREE.Vector3[]=[];
        for(const fraction of [-.3,0,.3]) {
          const along=longSide*fraction;
          if(isWide)seams.push(new THREE.Vector3(along,.462,-obstacle.depth/2+.02),new THREE.Vector3(along,.462,obstacle.depth/2-.02));
          else seams.push(new THREE.Vector3(-obstacle.width/2+.02,.462,along),new THREE.Vector3(obstacle.width/2-.02,.462,along));
        }
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seams),new THREE.LineBasicMaterial({color:'#473a26',transparent:true,opacity:.6})));
      }
      const panelShort = obstacle.material === 'wood' ? Math.min(.13,shortSide-.09) : shortSide-.09;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(isWide ? longSide - .09 : panelShort, .008, isWide ? panelShort : longSide - .09), new THREE.MeshStandardMaterial({ color: '#1f2526', metalness: .65, roughness: .48 }));
      plate.position.y = .464; group.add(plate);
      const pips: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
      const span = longSide - .17, step = span / obstacle.maxHp, pipLength = Math.min(.14, step * .65);
      for (let i = 0; i < obstacle.maxHp; i++) {
        const pip = new THREE.Mesh(new THREE.BoxGeometry(isWide ? pipLength : .037, .009, isWide ? .037 : pipLength), new THREE.MeshBasicMaterial({ color: obstacle.material === 'hex' ? '#c5a3ef' : obstacle.material === 'steel' ? '#b3d8e3' : '#edbf6a' }));
        const position = (i - (obstacle.maxHp - 1) / 2) * step;
        pip.position.set(isWide ? position : 0, .473, isWide ? 0 : position); group.add(pip); pips.push(pip);
      }
      const crackPoints: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const along = (i - 1) * longSide * .21;
        const point = (a: number, b: number) => new THREE.Vector3(isWide ? a : b, .478, isWide ? b : a);
        crackPoints.push(point(along - .04, -.08), point(along, 0), point(along, 0), point(along + .065, .07));
      }
      const cracks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(crackPoints), new THREE.LineBasicMaterial({ color: '#0c1416', transparent: true, opacity: .65 }));
      cracks.visible = false; group.add(cracks);
      this.enableTableShadows(group);this.obstacles.set(obstacle.id, { group, body, pips, cracks, flash: 0, material: obstacle.material, hp: obstacle.hp });
    }
  }
  private animateHazards() {
    for (const [id, visual] of this.hazards) {
      if (visual.spinner) visual.spinner.rotation.y = this.clock * .8;
      for (let i = 0; i < visual.ripples.length; i++) {
        const ripple = visual.ripples[i];
        if (visual.kind === 'portal') { ripple.material.opacity = .45 + Math.sin(this.clock * 2.8 + id) * .14; continue; }
        const phase = (this.clock * (visual.kind === 'water' ? .25 : .11) + i / 3) % 1;
        ripple.scale.setScalar(.3 + phase * 2.75); ripple.material.opacity = Math.sin(phase * Math.PI) * .3;
      }
      if (visual.arcs) {
        const points: THREE.Vector3[] = [];
        for (let branch = 0; branch < 3; branch++) {
          const angle = branch * Math.PI / 3 + .25;
          let previous = new THREE.Vector3(-Math.cos(angle) * visual.radius * .8, .062, -Math.sin(angle) * visual.radius * .8);
          for (let segment = 1; segment <= 8; segment++) {
            const distance = (segment / 4 - 1) * visual.radius * .8;
            const bend = Math.sin(segment * 7.8 + Math.floor(this.clock * 12) * 2.6 + branch) * .05;
            const next = new THREE.Vector3(Math.cos(angle) * distance - Math.sin(angle) * bend, .062 + Math.abs(bend) * .25, Math.sin(angle) * distance + Math.cos(angle) * bend);
            points.push(previous, next); previous = next;
          }
        }
        visual.arcs.geometry.setFromPoints(points); visual.arcs.material.opacity = .5 + Math.sin(this.clock * 9 + id) * .18;
      }
      for (let i = 0; i < visual.clouds.length; i++) {
        const cloud = visual.clouds[i], angle = i * 2.4 + this.clock * .16;
        cloud.position.set(Math.cos(angle) * visual.radius * .24, .14 + (i % 2) * .08, Math.sin(angle) * visual.radius * .24);
        cloud.material.rotation = -angle * .3; cloud.material.opacity = .11 + Math.sin(this.clock * .6 + i) * .025;
      }
    }
  }
  handleEvent(event: TableEvent) {
    const obstacle = event.obstacle !== undefined ? this.obstacles.get(event.obstacle) : undefined;
    if (obstacle) obstacle.flash = 1;
    this.effects.emit(event, obstacle?.material);
    if (event.kind === 'pocket' && event.ball !== undefined) this.startPocketDrop(event.ball,event.x,event.z,event.elevation);
    if(event.kind==='out'&&event.ball!==undefined){this.pocketDrops.delete(event.ball);this.outFades.set(event.ball,{age:0,position:new THREE.Vector3(event.x,TABLE.radius+Math.max(0,event.elevation||0),event.z),seenPocketed:false});}
    if(event.kind==='chalk')this.chalkAge=0;
    if (event.kind === 'cue') this.cueStroke = { x: event.x, z: event.z, angle: (this.aiPreview || this.aim).angle, age: 0,elevation:event.elevation||0,tipX:event.tipX||0,tipY:event.tipY||0,height:Math.max(0,(this.balls[0]?.position.y||TABLE.radius)-TABLE.radius) };
  }
  private startPocketDrop(id: number, x: number, z: number, elevation?:number) {
    if (this.pocketDrops.has(id)) return;
    const mesh = this.balls[id]; if (!mesh) return;
    const pocket = POCKETS.reduce((nearest, candidate) => Math.hypot(candidate.x - x, candidate.z - z) < Math.hypot(nearest.x - x, nearest.z - z) ? candidate : nearest);
    const height=elevation===undefined?Math.max(TABLE.radius,mesh.position.y):TABLE.radius+Math.max(0,elevation);
    this.pocketDrops.set(id, { age: 0, from: new THREE.Vector3(x,height,z), target: new THREE.Vector3(pocket.x, -.34, pocket.z) });
  }
  private updateCameras(dt=0) {
    if(!this.width||!this.height)return;
    const ratio = this.width / this.height;
    const portrait = this.height > this.width * 1.05;
    fitOverheadCamera(this.overheadCamera,ratio);
    const perspectiveCamera = this.perspectiveCamera;
    perspectiveCamera.aspect=ratio;perspectiveCamera.up.set(0,1,0);
    if(this.orbit){
      perspectiveCamera.fov=portrait?38:39;perspectiveCamera.near=.08;
      fitTableCamera(perspectiveCamera,this.orbitTarget,orbitDirection(this.orbit),ratio);this.perspectiveTarget.copy(this.orbitTarget);
    } else if(!this.inspection){
      this.perspectiveTarget.copy(this.shotCamera.update(perspectiveCamera,this.cameraState,this.aiPreview||this.aim,ratio,dt,this.aiControlled&&!this.aiFPS));
    }
    if(this.inspection){
      perspectiveCamera.fov=34;perspectiveCamera.updateProjectionMatrix();
      const inspectTarget=this.inspectionPose?.target??INSPECT_TARGET,distance=Math.max(10.5,5.0/(Math.tan(17*Math.PI/180)*ratio*.9));
      if(this.inspectionPose)perspectiveCamera.position.copy(this.inspectionPose.position);
      else perspectiveCamera.position.copy(inspectTarget).addScaledVector(INSPECT_DIRECTION,distance);
      perspectiveCamera.lookAt(inspectTarget);perspectiveCamera.updateMatrixWorld(true);
      this.perspectiveTarget.copy(inspectTarget);
    }
    this.cameraTransition.update(this.selectedCamera,dt);
  }
  resize() {
    this.width = this.container.clientWidth; this.height = this.container.clientHeight;
    if (!this.width || !this.height || this.lost) return;
    this.updateCameras();
    const budget = this.performanceBudget.budget;
    const gl = this.renderer.getContext();
    const viewportLimits = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const bufferLimit = Math.min(this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
    const dpr = budgetDpr(budget,this.width,this.height,devicePixelRatio,Math.min(bufferLimit,viewportLimits[0]),Math.min(bufferLimit,viewportLimits[1]));
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(this.width, this.height); this.postprocessing?.resize(this.width,this.height,budget);
    this.maintenanceFrames=3;
  }
  setQuality(quality: Quality) {
    this.quality=quality;this.performanceBudget.setQuality(quality);this.applyGraphicsBudget();
  }
  private applyGraphicsBudget() {
    const budget=this.performanceBudget.budget;
    this.practicalLights.configure(this.quality,budget.tier);
    this.roomReflections?.setResolution(budget.reflectionSize);
    for(const [index,lamp]of this.tableLights.entries()){
      lamp.castShadow=budget.shadowLights===3||index===1;
      const size=Math.min(this.renderer.capabilities.maxTextureSize,budget.shadowSize);
      if(lamp.shadow.mapSize.x!==size){lamp.shadow.map?.dispose();lamp.shadow.map=null;lamp.shadow.mapSize.setScalar(size);}
      lamp.shadow.radius=3.75*lamp.shadow.mapSize.x/1024;
      lamp.shadow.needsUpdate=true;
    }
    this.shadowRevision.invalidate();
    this.resize();
  }
  private updateShadowBudget(dt:number) {
    const gather=(root:THREE.Object3D,values:number[])=>root.traverse(object=>{
      if(!(object instanceof THREE.Mesh&&object.castShadow)&&!object.children.length)return;
      const p=object.position,q=object.quaternion,s=object.scale;
      values.push(object.id,object.visible?1:0,p.x,p.y,p.z,q.x,q.y,q.z,q.w,s.x,s.y,s.z);
    });
    const values=this.shadowValues;values.length=0;
    for(const object of this.tableOccluders)gather(object,values);
    for(const ball of this.balls)gather(ball,values);
    gather(this.cue,values);
    for(const obstacle of this.obstacles.values())gather(obstacle.group,values);
    const changed=this.shadowRevision.changed(values);
    const decorative=this.decorativeShadowValues;decorative.length=0;
    for(const pickup of this.pickups.values())gather(pickup.group,decorative);
    for(const hazard of this.hazards.values())gather(hazard.group,decorative);
    this.decorativeShadowsDirty=this.decorativeShadowRevision.changed(decorative)||this.decorativeShadowsDirty;
    this.decorativeShadowAge+=dt;
    // Gameplay motion always gets fresh shadows. Tiny spinning pickup details
    // may update at 30 Hz while the balls, cue and coin return are stationary.
    if(changed||(this.decorativeShadowsDirty&&this.decorativeShadowAge>=1/30)){
      for(const lamp of this.tableLights)if(lamp.castShadow)lamp.shadow.needsUpdate=true;
      this.decorativeShadowsDirty=false;this.decorativeShadowAge=0;
    }
  }
  setOverhead(value: boolean) { this.cameraTransition.begin(this.camera);this.overhead = value;if(this.aiControlled&&!value)this.aiFPS=true;this.orbit=null;this.orbitReturn.clear();this.inspection=false;this.inspectionPose=undefined;this.shotCamera.reset();this.resetAimPointer();this.updateCameras(); }
  setCamera(overhead: boolean) { this.setOverhead(overhead); }
  setInspection(value:boolean,pose?:{position:THREE.Vector3;target:THREE.Vector3}) {this.cameraTransition.begin(this.camera);this.orbitReturn.clear();this.inspection=value;this.inspectionPose=pose?{position:pose.position.clone(),target:pose.target.clone()}:undefined;if(value)this.orbit=null;else this.shotCamera.reset(true);this.resetAimPointer();this.updateCameras();}
  beginOrbit():void {
    if(this.orbitReturn.active)return;
    const from=this.camera;
    this.orbitReturn.begin({overhead:this.overhead,inspection:this.inspection,inspectionPose:this.inspectionPose,orbit:this.orbit,target:this.orbitTarget});
    this.cameraTransition.begin(from,.35);
    this.orbitTarget.set(0,-.35,0);this.orbit=orbitFromDirection(from.position.clone().sub(this.orbitTarget));
    this.overhead=false;this.inspection=false;this.resetAimPointer();this.updateCameras();
  }
  endOrbit():void {
    const prior=this.orbitReturn.release();if(!prior)return;
    this.cameraTransition.begin(this.camera);
    this.overhead=prior.overhead;this.inspection=prior.inspection;this.inspectionPose=prior.inspectionPose;
    this.orbit=prior.orbit;this.orbitTarget.copy(prior.target);
    this.shotCamera.reset(true);this.resetAimPointer();this.updateCameras();
  }
  orbitBy(dx:number,dy:number):void {
    if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
    this.beginOrbit();this.orbit=advanceOrbit(this.orbit!,dx,dy);this.resetAimPointer();this.updateCameras();
  }
  rotateView(yawRadians:number,pitchRadians=0):void {
    if(!Number.isFinite(yawRadians)||!Number.isFinite(pitchRadians))return;
    this.beginOrbit();this.orbit=clampOrbit({yaw:this.orbit!.yaw+yawRadians,pitch:this.orbit!.pitch+pitchRadians});this.resetAimPointer();this.updateCameras();
  }
  setFPSView():void {this.setOverhead(false);}
  resetView():void {this.setFPSView();}
  setAIControlled(value:boolean):void {if(value!==this.aiControlled){this.aiControlled=value;this.aiFPS=false;}}
  isAIViewReady():boolean {
    if(this.lost||this.cameraTransition.active||this.orbit||!this.aiPreview||this.cameraState.phase!=='ready')return false;
    return this.overhead||this.inspection||this.shotCamera.isSettled;
  }
  resetAimPointer():void {this.shotCameraAim.reset();}
  aimAtScreen(clientX:number,clientY:number,cue:{x:number;z:number}):number|null {
    if(!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;
    if(!this.overhead&&!this.inspection&&!this.orbit)return this.shotCameraAim.angleAt(clientX,this.width,this.aim.angle);
    this.resetAimPointer();
    const point=this.screenToTable(clientX,clientY);
    return point&&Math.hypot(point.x-cue.x,point.z-cue.z)>.04?Math.atan2(point.z-cue.z,point.x-cue.x):null;
  }
  animateCoinReset(){return this.tableDetails?.animateReset()||1200;}
  hitTableControl(clientX:number,clientY:number):'coin'|'chalk'|null{
    this.scene.updateMatrixWorld(true);
    const rect=this.container.getBoundingClientRect();
    this.raycaster.ray.copy(rayFromViewport(this.camera,(clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1));
    const controls=[...this.chalkControls,...(this.tableDetails?[this.tableDetails.coinControl]:[])];
    const visible=(item:THREE.Object3D)=>{let object:THREE.Object3D|null=item;while(object){if(!object.visible)return false;object=object.parent;}return true;};
    const blockers=this.raycaster.intersectObjects(this.tableOccluders,true).filter(hit=>visible(hit.object)&&hit.object instanceof THREE.Mesh&&(Array.isArray(hit.object.material)?hit.object.material:[hit.object.material]).some(material=>!material.transparent||material.opacity>.8));
    for(const hit of this.raycaster.intersectObjects(controls,true)){
      if(!visible(hit.object))continue;
      if(blockers[0]&&blockers[0].distance<hit.distance-.005)return null;
      let object:THREE.Object3D|null=hit.object;
      while(object){const kind=object.userData.tableControl;if(kind==='coin'||kind==='chalk')return kind;object=object.parent;}
    }
    return null;
  }
  getResolution() { return { width: this.renderer.domElement.width, height: this.renderer.domElement.height }; }
  getPerformance() {
    return Object.freeze({...this.frameHistory.snapshot(),...this.practicalLights.getCounts(),drawCalls:this.lastDrawCalls,triangles:this.lastTriangles,
      ...this.getResolution(),dpr:this.renderer.getPixelRatio(),quality:this.quality,tier:this.performanceBudget.budget.tier,
      targetMs:this.performanceBudget.targetMs,timingSource:this.gpuTimer.supported?'cpu+gpu' as const:'cpu' as const});
  }
  screenToTable(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.container.getBoundingClientRect();
    this.raycaster.ray.copy(rayFromViewport(this.camera,(clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1));
    const point = new THREE.Vector3(); if (!this.raycaster.ray.intersectPlane(this.plane, point)) return null; return { x: point.x, z: point.z };
  }
  tableToScreen(x: number, z: number, elevation=0) {
    const rect = this.container.getBoundingClientRect(); const p = new THREE.Vector3(x, TABLE.radius+elevation, z).project(this.camera);
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }
  showPlacement(point: { x: number; z: number } | null) { this.placement.visible = !!point; if (point) this.placement.position.set(point.x, TABLE.radius, point.z); }
  update(state: GameState, dt: number, canAim: boolean, _interpolate = false) {
    const frameStart=performance.now(),frameMs=this.lastFrameAt?frameStart-this.lastFrameAt:0;this.lastFrameAt=frameStart;
    const frameDt = Math.min(.05, Math.max(0, dt)); this.clock += frameDt;this.chalkAge+=frameDt;
    this.cameraState=state;
    const cameraInputKey=`${state.seed}:${state.shotCount}:${state.phase}`;
    if(cameraInputKey!==this.cameraInputKey){this.cameraInputKey=cameraInputKey;this.resetAimPointer();}
    this.updateCameras(frameDt);
    const renderKey = `${state.seed}:${state.arcade?.layout || 'table'}`;
    if (this.renderedSeed !== renderKey || state.shotCount < this.renderedShotCount) {
      this.renderedSeed = renderKey; this.pocketDrops.clear();this.outFades.clear(); this.effects.clear(); this.buffTrail.clear(); this.cueStroke = null;
      this.buildObstacles(state);
      for (const ball of state.balls) {
        this.balls[ball.id].rotation.set(-Math.PI / 2, 0, 0);
        this.balls[ball.id].userData.wasPocketed = ball.pocketed;
        this.balls[ball.id].userData.teleport = ball.teleport || 0;
        const material=this.balls[ball.id].material as THREE.MeshPhysicalMaterial;material.transparent=false;material.opacity=1;
        this.ballPositions[ball.id].set(ball.x, TABLE.radius+(ball.elevation||0), ball.z);
      }
    }
    const hazards = state.arcade?.hazards || [], hazardSignature = JSON.stringify(hazards);
    if (hazardSignature !== this.hazardSignature) { this.hazardSignature = hazardSignature; this.buildHazards(hazards); }
    const pickups = state.arcade?.pickups || [], pickupSignature = JSON.stringify(pickups.map(({id,x,z,radius,power})=>({id,x,z,radius,power})));
    if(pickupSignature!==this.pickupSignature) {this.pickupSignature=pickupSignature;this.buildPickups(pickups);}
    for(const pickup of pickups) {
      const visual=this.pickups.get(pickup.id);if(!visual)continue;
      visual.group.visible=pickup.available;visual.capsule.rotation.y=this.clock*.55+pickup.id*.7;
      visual.halo.material.opacity=.5+Math.sin(this.clock*2+pickup.id)*.15;
    }
    this.animateHazards();
    this.renderedShotCount = state.shotCount;
    for (const obstacle of state.arcade?.obstacles || []) {
      const visual = this.obstacles.get(obstacle.id); if (!visual) continue;
      visual.group.visible = obstacle.hp > 0;
      visual.flash = Math.max(0, visual.flash - frameDt * 5);
      visual.body.material.emissive.set(obstacle.material === 'hex' ? '#ab70df' : '#edbe77');
      visual.body.material.emissiveIntensity = visual.flash * .55;
      visual.cracks.visible = obstacle.hp < obstacle.maxHp;
      for (let i = 0; i < visual.pips.length; i++) visual.pips[i].material.color.set(i < obstacle.hp ? obstacle.material === 'hex' ? '#c5a3ef' : obstacle.material === 'steel' ? '#b3d8e3' : '#edbf6a' : '#354044');
      visual.hp = obstacle.hp;
    }
    for (const ball of state.balls) {
      const mesh = this.balls[ball.id], shadow = mesh.userData.shadow as THREE.Mesh;
      const out=this.outFades.get(ball.id),material=mesh.material as THREE.MeshPhysicalMaterial;
      if(out&&ball.pocketed){
        out.seenPocketed=true;out.age+=frameDt;mesh.position.copy(out.position);material.transparent=true;material.opacity=Math.max(0,1-out.age/.2);mesh.visible=out.age<.2;shadow.visible=false;mesh.userData.wasPocketed=true;continue;
      }
      if(out?.seenPocketed){this.outFades.delete(ball.id);material.transparent=false;material.opacity=1;}
      if (ball.pocketed) {
        if (!mesh.userData.wasPocketed) this.startPocketDrop(ball.id,ball.x,ball.z,ball.elevation);
        mesh.userData.wasPocketed = true; shadow.visible = false;
        const drop = this.pocketDrops.get(ball.id);
        if (!drop) { mesh.visible = false; continue; }
        drop.age += frameDt;
        const progress = Math.min(1, drop.age / .36);
        mesh.position.lerpVectors(drop.from, drop.target, 1 - (1 - progress) ** 2);
        mesh.position.y = drop.from.y - (drop.from.y+.37) * progress * progress;
        mesh.rotateOnWorldAxis(DROP_AXIS, frameDt * 3);
        mesh.visible = progress < 1;
        if (progress >= 1) this.pocketDrops.delete(ball.id);
        continue;
      }
      this.pocketDrops.delete(ball.id);
      const previous = this.ballPositions[ball.id];
      const teleported = (ball.teleport || 0) !== mesh.userData.teleport;
      mesh.userData.teleport = ball.teleport || 0;
      if (teleported && ball.id === 0) this.buffTrail.clear();
      // One coherent presentation snapshot owns every position. Per-ball easing creates false separations at impacts.
      const elevation = Math.max(0, ball.elevation || 0);
      mesh.position.set(ball.x, TABLE.radius + elevation, ball.z);
      const dx = mesh.position.x - previous.x, dz = mesh.position.z - previous.z, distance = Math.hypot(dx, dz);
      if (mesh.visible && !teleported && !mesh.userData.wasPocketed && distance > 1e-7 && (state.phase==='rolling'||distance<.8)) mesh.rotateOnWorldAxis(rollAxis.set(dz,0,-dx).normalize(),distance/TABLE.radius);
      mesh.userData.wasPocketed = false; mesh.visible = true; shadow.visible = true;
      shadow.position.x = mesh.position.x; shadow.position.z = mesh.position.z; previous.copy(mesh.position);
      shadow.scale.setScalar(1+Math.min(elevation,3)*.65);(shadow.material as THREE.MeshBasicMaterial).opacity=.72*Math.exp(-2.7*elevation);
    }
    const cueBall = state.balls[0];
    const effects=deriveTableEffects(state),{overdrive,frozen,focus}=effects.cue;
    const buffColor=effects.halo?.color||EFFECTS.ward.color;
    this.buffHalo.visible = !cueBall.pocketed && !!effects.halo;
    this.buffHalo.position.set(cueBall.x,.026+(cueBall.elevation||0),cueBall.z); if(buffColor!==this.buffColor){this.buffColor=buffColor;this.buffHalo.material.color.set(buffColor);this.buffTrail.line.material.color.set(buffColor);}
    this.buffHalo.material.opacity = .35 + Math.sin(this.clock * 3) * .08;
    if (!cueBall.pocketed && state.phase === 'rolling' && (overdrive || frozen) && Math.hypot(cueBall.vx, cueBall.vz) > .6) {
      this.buffTrail.push(cueBall.x,.027+(cueBall.elevation||0),cueBall.z);
    } else this.buffTrail.clear();
    const preview = this.aiPreview || this.aim;
    const aiming = (canAim || !!this.aiPreview) && state.phase === 'ready';
    this.cue.visible = aiming;
    const equipment=equippedCue(state);
    if(this.cueAppearance.equip(equipment))this.cue.children[1].scale.set(1+(equipment.weightOz-18)*.025,1,1+(equipment.weightOz-18)*.025);
    this.cueContact.visible=aiming&&this.contactEditing&&!this.aiPreview;
    this.shotPaths.update(state,preview,aiming&&canAim&&this.aim.visible&&effects.guideVisible,focus,frameDt);
    if (aiming) {
      const breathing = this.aiPreview ? .045 * Math.sin(this.clock * 6) : 0;
      const chalkNudge=this.chalkAge<.7?Math.sin(this.chalkAge/.7*Math.PI)*.12:0;
      const pullback = (this.aiPreview?preview.power:this.aim.pullback) * .8 + breathing + chalkNudge;
      this.poseCue(cueBall.x,cueBall.z,preview,pullback,cueBall.elevation||0);
    } else if (this.cueStroke && state.phase === 'rolling') {
      const stroke = this.cueStroke;
      if (stroke.age === 0 && Math.hypot(cueBall.vx, cueBall.vz) > .1) stroke.angle = state.lastShot?.angle ?? Math.atan2(cueBall.vz, cueBall.vx);
      stroke.age += frameDt;
      const progress = Math.min(1, stroke.age / .22), forward = .16 * Math.sin(progress * Math.PI);
      this.cue.visible = progress < 1;
      this.poseCue(stroke.x,stroke.z,stroke,-forward,stroke.height);
      if (progress >= 1) this.cueStroke = null;
    } else this.cueStroke = null;
    if (state.phase !== 'ball-in-hand') this.placement.visible = false;
    this.effects.updateTrail(cueBall,state.phase==='rolling'&&overdrive,state.phase==='rolling'&&frozen,frameDt);
    this.effects.update(frameDt); this.pub?.update(this.clock,this.camera);
    this.tableDetails?.update(state,frameDt,this.outFades);
    if (!this.lost) {
      this.renderer.info.reset();
      const gpuMs=this.gpuTimer.begin();this.gpuSampleAge+=frameDt;
      if(gpuMs!==null){this.lastGpuMs=gpuMs;this.gpuSampleAge=0;}
      this.updateShadowBudget(frameDt);
      this.practicalLights.update(this.camera,frameDt);
      const captured=this.roomReflections?.update(frameDt,state.phase!=='rolling')||false;
      const maintenance=captured||this.maintenanceFrames>0;this.maintenanceFrames=Math.max(0,this.maintenanceFrames-1);
      if(this.postprocessing)this.postprocessing.render(this.scene,this.camera,frameDt);else this.renderer.render(this.scene,this.camera);
      this.gpuTimer.end(maintenance);
      this.lastDrawCalls=this.renderer.info.render.calls;this.lastTriangles=this.renderer.info.render.triangles;
      const sample={frameMs,cpuMs:performance.now()-frameStart,gpuMs:this.gpuSampleAge<.5?this.lastGpuMs:null,maintenance};
      this.frameHistory.record(sample);
      if(this.performanceBudget.observe(sample))this.applyGraphicsBudget();
    }
  }
  dispose() { this.practicalLights.dispose();this.gpuTimer.dispose();this.cueAppearance.dispose();this.resizeObserver.disconnect(); this.roomReflections?.dispose();this.shotPaths.dispose(); this.effects.dispose();this.tableDetails?.dispose();this.pocketDetails?.dispose(); this.pub?.dispose();this.postprocessing?.dispose();this.surfaces.dispose();for(const lamp of this.tableLights)lamp.shadow.dispose();this.fallbackEnvironment.dispose();this.renderer.dispose();this.scene.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose(); }); }
}
