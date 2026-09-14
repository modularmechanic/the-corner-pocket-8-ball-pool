import * as THREE from 'three';
import { TABLE, POCKETS, initialState, type GameState, type TableEvent, type Shot } from '../simulation/types';
import { EFFECTS } from '../presentation/effects';
import { deriveTableEffects } from '../presentation/table-presentation';
import { ballTexture, canvasTexture, clubLightingTexture } from './materials';
import { createTableSurfaces, type TableSurfaces } from './table-surfaces';
import { createPropInstaller } from './asset-installer';
import { RoomReflections } from './room-reflections';
import { ShotPaths } from './shot-paths';
import { CueAppearance } from './cue-appearance';
import { equippedCue } from '../simulation/cues';
import { TableEffects } from './effects';
import { buildPub } from './pub';
import { PoolPostprocessing } from './postprocessing';
import { AdaptiveRenderBudget, RenderFrameHistory, GpuFrameTimer, ShadowRevision, budgetDpr, type RenderQuality } from './performance';
import { PracticalLightBudget } from './light-budget';
import { TableModel, drawTableTextures, enableTableShadows, TABLE_SHADOW_LAYER } from './table-model';
import { advanceOrbit,clampOrbit,fitTableCamera,fitOverheadCamera,orbitDirection,orbitFromDirection,CameraTransition,TemporaryCameraView,rayFromViewport,type OrbitAngles } from './camera';
import { ShotCameraAim, ShotCameraRig } from './shot-camera';
import { ArenaVisuals } from './arena-visuals';
import { BuffTrail } from './buff-trail';
export type Quality = RenderQuality;
const X_AXIS=new THREE.Vector3(1,0,0),Z_AXIS=new THREE.Vector3(0,0,1),DROP_AXIS=new THREE.Vector3(.7,0,.3).normalize();
const INSPECT_TARGET=new THREE.Vector3(.35,-.75,2.6),INSPECT_DIRECTION=new THREE.Vector3(.015,.32,.947).normalize();
// Per-frame scratch vectors; never retained between calls.
const cueDirection=new THREE.Vector3(),cueRight=new THREE.Vector3(),cueUp=new THREE.Vector3(),cueContactPoint=new THREE.Vector3(),cueNormal=new THREE.Vector3(),rollAxis=new THREE.Vector3();
interface PocketDrop { age: number; from: THREE.Vector3; target: THREE.Vector3 }
interface OutFade {age:number;position:THREE.Vector3;seenPocketed:boolean}
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
  private table!: TableModel;
  private lost = false;
  private width = 0;
  private height = 0;
  private renderedSeed = '';
  private renderedShotCount = 0;
  private arena = new ArenaVisuals(this.scene);
  // The shadow budget watches these groups.
  private tableOccluders: THREE.Object3D[] = [];
  private obstacles = this.arena.obstacles;
  private hazards = this.arena.hazards;
  private pickups = this.arena.pickups;
  private pocketDrops = new Map<number, PocketDrop>();
  private outFades = new Map<number,OutFade>();
  private effects: TableEffects;
  private surfaces: TableSurfaces;
  private propInstaller = createPropInstaller();
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
    this.surfaces = createTableSurfaces(this.propInstaller);
    this.buildEnvironment(); this.buildTable(); this.buildBalls(); this.buildCue();
    this.effects = new TableEffects(this.scene);
    this.buffHalo = new THREE.Mesh(new THREE.RingGeometry(TABLE.radius * 1.19, TABLE.radius * 1.32, 64), new THREE.MeshBasicMaterial({ color: '#ffbc63', transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.buffHalo.rotation.x = -Math.PI / 2; this.buffHalo.visible = false; this.scene.add(this.buffHalo);
    this.scene.add(this.buffTrail.line);
    this.shotPaths = new ShotPaths(this.scene);
    this.placement = new THREE.Mesh(new THREE.SphereGeometry(TABLE.radius, 32, 24), new THREE.MeshStandardMaterial({ color: '#f4ebd3', transparent: true, opacity: .6 })); this.placement.visible = false; this.scene.add(this.placement);
    this.practicalLights=new PracticalLightBudget(this.scene);
    this.roomReflections = new RoomReflections(this.renderer,this.scene,
      ()=>[...(this.pub?[this.pub.group]:[]),...this.table.occluders],
      capture=>this.practicalLights.withFullLighting(()=>this.pub?this.pub.withEnclosedRoom(capture):capture()),this.propInstaller);
    for(const ball of this.balls)this.roomReflections.add(ball.material as THREE.MeshPhysicalMaterial);
    for(const material of [this.cueAppearance.shaft,this.cueAppearance.butt,this.surfaces.brass])this.roomReflections.add(material);
    if (this.renderer.extensions.has('EXT_color_buffer_float')) this.postprocessing = new PoolPostprocessing(this.renderer, this.scene, this.camera);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.applyGraphicsBudget();
  }
  private buildEnvironment() {
    this.pub = buildPub(this.scene, this.propInstaller);
  }
  private buildTable() {
    this.table=new TableModel(this.scene,this.surfaces,drawTableTextures(this.ballMaps));this.tableOccluders=this.table.occluders;
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
    enableTableShadows(this.cue);
    this.cueContact.visible=false;this.scene.add(this.cue,this.cueContact);
  }
  private poseCue(x:number,z:number,preview:Pick<Shot,'angle'|'elevation'|'tipX'|'tipY'>,pullback:number,height=0) {
    const elevation=THREE.MathUtils.clamp(preview.elevation||0,0,Math.PI/3),dx=Math.cos(preview.angle),dz=Math.sin(preview.angle);
    cueDirection.set(dx*Math.cos(elevation),-Math.sin(elevation),dz*Math.cos(elevation));
    cueRight.set(-dz,0,dx);cueUp.set(dx*Math.sin(elevation),Math.cos(elevation),dz*Math.sin(elevation));
    let tipX=THREE.MathUtils.clamp(preview.tipX||0,-.8,.8),tipY=THREE.MathUtils.clamp(preview.tipY||0,-.8,.8);
    const radius=Math.hypot(tipX,tipY);if(radius>.8){tipX*=.8/radius;tipY*=.8/radius;}
    const depth=TABLE.radius*Math.sqrt(1-tipX*tipX-tipY*tipY);
    cueContactPoint.set(x,TABLE.radius+height,z).addScaledVector(cueDirection,-depth).addScaledVector(cueRight,tipX*TABLE.radius).addScaledVector(cueUp,tipY*TABLE.radius);
    this.cue.quaternion.setFromUnitVectors(X_AXIS,cueDirection);
    // The cue's front face is local x=-.1615; preserve contact when the butt is raised.
    this.cue.position.copy(cueContactPoint).addScaledVector(cueDirection,.1615-pullback);
    cueNormal.set(cueContactPoint.x-x,cueContactPoint.y-TABLE.radius-height,cueContactPoint.z-z).normalize();
    this.cueContact.position.copy(cueContactPoint).addScaledVector(cueNormal,.001);this.cueContact.quaternion.setFromUnitVectors(Z_AXIS,cueNormal);
  }
  handleEvent(event: TableEvent) {
    const obstacle = event.obstacle !== undefined ? this.arena.strikeObstacle(event.obstacle) : undefined;
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
  animateCoinReset(){return this.table.details.animateReset();}
  hitTableControl(clientX:number,clientY:number):'coin'|'chalk'|null{
    this.scene.updateMatrixWorld(true);
    const rect=this.container.getBoundingClientRect();
    this.raycaster.ray.copy(rayFromViewport(this.camera,(clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1));
    const controls=[...this.table.chalkControls,this.table.details.coinControl];
    const visible=(item:THREE.Object3D)=>{let object:THREE.Object3D|null=item;while(object){if(!object.visible)return false;object=object.parent;}return true;};
    const blockers=this.raycaster.intersectObjects(this.table.occluders,true).filter(hit=>visible(hit.object)&&hit.object instanceof THREE.Mesh&&(Array.isArray(hit.object.material)?hit.object.material:[hit.object.material]).some(material=>!material.transparent||material.opacity>.8));
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
  update(state: GameState, dt: number, canAim: boolean) {
    const frameStart=performance.now(),frameMs=this.lastFrameAt?frameStart-this.lastFrameAt:0;this.lastFrameAt=frameStart;
    const frameDt = Math.min(.05, Math.max(0, dt)); this.clock += frameDt;this.chalkAge+=frameDt;
    this.cameraState=state;
    const cameraInputKey=`${state.seed}:${state.shotCount}:${state.phase}`;
    if(cameraInputKey!==this.cameraInputKey){this.cameraInputKey=cameraInputKey;this.resetAimPointer();}
    this.updateCameras(frameDt);
    const renderKey = `${state.seed}:${state.arcade?.layout || 'table'}`;
    if (this.renderedSeed !== renderKey || state.shotCount < this.renderedShotCount) {
      this.renderedSeed = renderKey; this.pocketDrops.clear();this.outFades.clear(); this.effects.clear(); this.arena.clearFlashes(); this.buffTrail.clear(); this.cueStroke = null;
      for (const ball of state.balls) {
        this.balls[ball.id].rotation.set(-Math.PI / 2, 0, 0);
        this.balls[ball.id].userData.wasPocketed = ball.pocketed;
        this.balls[ball.id].userData.teleport = ball.teleport || 0;
        const material=this.balls[ball.id].material as THREE.MeshPhysicalMaterial;material.transparent=false;material.opacity=1;
        this.ballPositions[ball.id].set(ball.x, TABLE.radius+(ball.elevation||0), ball.z);
      }
    }
    this.arena.update(state.arcade, this.clock, frameDt);
    this.renderedShotCount = state.shotCount;
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
    this.table.details.update(state,frameDt,this.outFades);
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
  dispose() { this.propInstaller.dispose();this.practicalLights.dispose();this.gpuTimer.dispose();this.cueAppearance.dispose();this.resizeObserver.disconnect(); this.roomReflections?.dispose();this.shotPaths.dispose(); this.effects.dispose();this.arena.dispose();this.table.details.dispose();this.table.pocketDetails.dispose();for(const texture of this.ballMaps)texture.dispose(); this.pub?.dispose();this.postprocessing?.dispose();this.surfaces.dispose();for(const lamp of this.tableLights)lamp.shadow.dispose();this.fallbackEnvironment.dispose();this.renderer.dispose();this.scene.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose(); }); }
}
