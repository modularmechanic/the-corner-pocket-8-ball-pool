import * as THREE from 'three';
import { TABLE, type GameState, type Shot } from '../simulation/types';
import { fitTableCamera } from './camera';

export interface ShotCameraPose {
  position:THREE.Vector3; target:THREE.Vector3; fov:number; near:number; far:number;
  mode:'shoot'|'watch';
}
type CameraState=Pick<GameState,'phase'|'balls'|'seed'|'shotCount'|'lastShot'>;
const normalizeAngle=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
export const SHOT_WATCH_TRANSITION=.58;
export const SHOT_RETURN_TRANSITION=.65;

/** Screen deltas change aim; camera movement alone never feeds back into yaw. */
export class ShotCameraAim {
  private previousX:number|null=null;
  reset():void {this.previousX=null;}
  angleAt(clientX:number,width:number,currentAngle:number):number {
    if(!Number.isFinite(clientX)||!Number.isFinite(width)||width<=0||!Number.isFinite(currentAngle))return currentAngle;
    const previous=this.previousX;this.previousX=clientX;
    if(previous===null||previous===clientX)return currentAngle;
    return normalizeAngle(currentAngle+(clientX-previous)/width*Math.PI*2);
  }
}

/** Low shooter framing puts the cue ball in the lower center, with cloth ahead. */
export function shotCameraPose(state:CameraState,shot:Pick<Shot,'angle'|'elevation'>,aspect:number):ShotCameraPose {
  aspect=Number.isFinite(aspect)&&aspect>0?aspect:16/9;
  const cue=state.balls[0];
  const shooting=state.phase==='ready'&&!cue.pocketed;
  const angle=Number.isFinite(shot.angle)?shot.angle:0;
  if(!shooting) {
    return watchCameraPose(state.lastShot?.angle??angle,aspect);
  }
  const dx=Math.cos(angle),dz=Math.sin(angle),fov=aspect<.8?58:47;
  const distance=1.92*Math.max(1,.62/aspect),cueY=TABLE.radius+Math.max(0,cue.elevation??0);
  let height=cueY+Math.max(.50,distance*.35)+Math.sin(shot.elevation??0)*.16;
  // Near a cushion the camera may sit outside the table. Raise the eye just
  // enough for its ray to clear the rail instead of obscuring the white ball.
  const backX=-dx,backZ=-dz;
  const exitX=Math.abs(backX)>1e-8?(Math.sign(backX)*TABLE.halfWidth-cue.x)/backX:Infinity;
  const exitZ=Math.abs(backZ)>1e-8?(Math.sign(backZ)*TABLE.halfDepth-cue.z)/backZ:Infinity;
  const railDistance=Math.min(exitX,exitZ);
  if(railDistance<distance+.3)height=Math.max(height,cueY+.25*distance/Math.max(.2,railDistance));
  const position=new THREE.Vector3(cue.x-dx*distance,height,cue.z-dz*distance);
  // Derive pitch from a screen-space ball anchor rather than guessing a look-at
  // point. This keeps the entire ball on screen at rails and in portrait view.
  const downToCue=Math.atan2(height-cueY,distance);
  const pitch=downToCue-Math.atan(Math.tan(THREE.MathUtils.degToRad(fov/2))*.47);
  const lookDistance=distance+2.35;
  const target=new THREE.Vector3(position.x+dx*lookDistance,position.y-Math.tan(pitch)*lookDistance,position.z+dz*lookDistance);
  return {position,target,fov,near:.035,far:120,mode:'shoot'};
}

/** A centered fallback for initial spectator views; live shots retain their
 * current sightline's lateral anchor instead of orbiting toward table center. */
export function watchCameraPose(heading:number,aspect:number,target=new THREE.Vector3(0,-.12,0)):ShotCameraPose {
  const pitch=35*Math.PI/180;
  const direction=new THREE.Vector3(-Math.cos(heading)*Math.cos(pitch),Math.sin(pitch),-Math.sin(heading)*Math.cos(pitch));
  const camera=new THREE.PerspectiveCamera(aspect<.8?58:52,aspect,.08,120);
  fitTableCamera(camera,target,direction,aspect);
  return {position:camera.position.clone(),target:target.clone(),fov:camera.fov,near:.08,far:camera.far,mode:'watch'};
}

/** Phase moves stay in the shooting heading's vertical plane. AI opponents
 * retain that spectator pose, so their changing aim never swings the camera. */
export class ShotCameraRig {
  private initialized=false;
  private mode:ShotCameraPose['mode']='shoot';
  private seed='';
  private cuePosition=new THREE.Vector3();
  private teleport=0;
  private target=new THREE.Vector3();
  private watchHeading=0;
  private watchTarget=new THREE.Vector3();
  private watchAnchored=false;
  private settled=false;
  private transition:{position:THREE.Vector3;quaternion:THREE.Quaternion;lookDistance:number;fov:number;age:number;duration:number}|null=null;
  get isSettled():boolean {return this.initialized&&this.settled;}
  reset(preserveWatch=false):void {this.initialized=false;this.transition=null;this.settled=false;if(!preserveWatch)this.watchAnchored=false;}
  update(camera:THREE.PerspectiveCamera,state:CameraState,shot:Pick<Shot,'angle'|'elevation'>,aspect:number,dt:number,spectatingAI=false):THREE.Vector3 {
    const cue=state.balls[0],watch=spectatingAI||state.phase!=='ready'||cue.pocketed;
    if(watch&&(!this.initialized||this.mode!=='watch')){
      if(this.initialized){
        const forward=camera.getWorldDirection(new THREE.Vector3());
        this.watchHeading=Math.atan2(forward.z,forward.x);
        this.watchTarget.copy(this.target);this.watchTarget.y=-.12;
      }else if(!this.watchAnchored){
        this.watchHeading=state.lastShot?.angle??shot.angle;
        this.watchTarget.set(0,-.12,0);
      }
      this.watchAnchored=true;
    }
    const pose=watch?watchCameraPose(this.watchHeading,aspect,this.watchTarget):shotCameraPose(state,shot,aspect);
    const relocation=pose.mode==='shoot'&&((cue.teleport??0)!==this.teleport||Math.hypot(cue.x-this.cuePosition.x,cue.z-this.cuePosition.z)>2);
    const snap=!this.initialized;
    if(!snap&&(this.mode!==pose.mode||state.seed!==this.seed||relocation))this.transition={position:camera.position.clone(),quaternion:camera.quaternion.clone(),lookDistance:camera.position.distanceTo(this.target),fov:camera.fov,age:0,duration:watch?SHOT_WATCH_TRANSITION:SHOT_RETURN_TRANSITION};
    if(snap)this.transition=null;
    this.initialized=true;this.seed=state.seed;this.mode=pose.mode;this.teleport=cue.teleport??0;this.cuePosition.set(cue.x,0,cue.z);
    camera.aspect=aspect;camera.near=pose.near;camera.far=pose.far;camera.up.set(0,1,0);
    const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pose.position,pose.target,camera.up));
    let lookDistance=pose.position.distanceTo(pose.target);
    if(this.transition) {
      this.transition.age+=Math.min(.1,Math.max(0,dt));
      const t=THREE.MathUtils.smootherstep(this.transition.age,0,this.transition.duration);
      camera.position.lerpVectors(this.transition.position,pose.position,t);
      camera.quaternion.copy(this.transition.quaternion).slerp(rotation,t);camera.fov=THREE.MathUtils.lerp(this.transition.fov,pose.fov,t);
      lookDistance=THREE.MathUtils.lerp(this.transition.lookDistance,lookDistance,t);
      if(t===1)this.transition=null;
    } else {
      const blend=snap?1:1-Math.exp(-Math.max(0,dt)*15);
      camera.position.lerp(pose.position,blend);camera.quaternion.slerp(rotation,blend);camera.fov=THREE.MathUtils.lerp(camera.fov,pose.fov,blend);
    }
    camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    this.settled=!this.transition&&camera.position.distanceTo(pose.position)<.025&&camera.quaternion.angleTo(rotation)<.01&&Math.abs(camera.fov-pose.fov)<.05;
    this.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),lookDistance);
    return this.target;
  }
}
