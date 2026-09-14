import type { Shot } from '../simulation/types';

export class ShotSetup {
  stage: 'aim' | 'power' = 'aim';
  adjustment: 'spin' | 'elevation' | null = null;
  angle = 0;
  elevation = 0;
  tipX = 0;
  tipY = 0;
  power = .65;
  private anchor = { x: 0, y: 0, dx: 1, dy: 0, power: .05 };
  private adjustmentAnchor = { x:0, y:0, tipX:0, tipY:0, elevation:0 };

  lockAim(angle: number, x: number, y: number, dx: number, dy: number) {
    if(![angle,x,y,dx,dy].every(Number.isFinite))return;
    this.angle = angle; this.stage = 'power'; this.power = .05;
    const length = Math.hypot(dx, dy) || 1;
    this.anchor = { x, y, dx:dx/length, dy:dy/length, power:this.power };
  }
  beginAdjustment(mode:'spin'|'elevation',x:number,y:number) {
    this.adjustment=mode;
    this.adjustmentAnchor={x,y,tipX:this.tipX,tipY:this.tipY,elevation:this.elevation};
  }
  moveAdjustment(x:number,y:number,fine=false) {
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const anchor=this.adjustmentAnchor,scale=fine?.25:1;
    if(this.adjustment==='spin')this.setTip(this.tipX+(x-anchor.x)*.006*scale,this.tipY-(y-anchor.y)*.006*scale);
    else if(this.adjustment==='elevation')this.setElevation(this.elevation+(anchor.y-y)*.004*scale);
    anchor.x=x;anchor.y=y;
  }
  endAdjustment(x:number,y:number) { this.adjustment=null; this.reanchorPower(x,y); }
  reanchorPower(x:number,y:number) { if(Number.isFinite(x)&&Number.isFinite(y)){this.anchor.x=x;this.anchor.y=y;this.anchor.power=this.power;} }
  setElevation(value:number) { if(Number.isFinite(value))this.elevation=Math.max(0,Math.min(Math.PI/3,value)); }
  setTip(x: number, y: number) {
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const scale = Math.min(1, .8 / (Math.hypot(x, y) || 1));
    this.tipX = x * scale; this.tipY = y * scale;
  }
  pull(x: number, y: number, fullDistance: number) {
    if(this.stage!=='power'||this.adjustment||![x,y,fullDistance].every(Number.isFinite))return;
    const distance = -(x - this.anchor.x) * this.anchor.dx - (y - this.anchor.y) * this.anchor.dy;
    this.power = Math.max(.05, Math.min(1, this.anchor.power + distance / Math.max(40, fullDistance)));
  }
  shot(): Shot { return { angle: this.angle, power: this.power, elevation: this.elevation, tipX: this.tipX, tipY: this.tipY }; }
  resetStrike() { this.elevation = 0; this.tipX = this.tipY = 0; }
  reset() { this.stage = 'aim'; this.adjustment=null; this.resetStrike(); }
}
