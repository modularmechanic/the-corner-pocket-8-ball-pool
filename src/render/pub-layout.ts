/** Expands floor area by 50% while preserving the scale of every table and prop. */
const expansion=Math.sqrt(1.5);
export const PUB_LAYOUT = {
  expansion,
  floor:-3.6,
  bounds:{left:-14.8*expansion,right:14.8*expansion,back:-11.4*expansion,front:12*expansion,ceiling:6.4},
  sideShift:14.8*(expansion-1),
  backShift:-11.4*(expansion-1),
  frontShift:12*(expansion-1),
  bar:{counterY:.325,counterZ:-8.1-11.4*(expansion-1),backZ:-10.56-11.4*(expansion-1)},
  jukebox:{x:-14.8*expansion+.78,y:-3.6,z:-2,rotation:Math.PI/2,height:3.78},
} as const;
export const pubBackZ=(z:number)=>z+PUB_LAYOUT.backShift;
export const pubFrontZ=(z:number)=>z+PUB_LAYOUT.frontShift;
export const pubSideX=(x:number)=>x+Math.sign(x)*PUB_LAYOUT.sideShift;
