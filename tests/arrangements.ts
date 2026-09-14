import { PoolGame } from '../src/simulation/game';
import type { Ball, GameState, Hazard } from '../src/simulation/types';

export function edit(game:PoolGame,change:(state:GameState)=>void):void {
  const state=game.snapshot();change(state);game.arrange(state);
}
export function arrangeBalls(game:PoolGame,positions:Record<number,Pick<Ball,'x'|'z'>&Partial<Ball>>,options:{hazards?:Hazard[];keepObstacle?:number;arcade?:boolean}={}):void {
  const state=game.snapshot();delete state.simulation;
  if(options.arcade===false)delete state.arcade;
  if(state.arcade){state.arcade.hazards=options.hazards??[];state.arcade.pickups=[];state.arcade.obstacles.forEach(o=>{if(o.id!==options.keepObstacle)o.hp=0;});}
  for(const ball of state.balls){
    const position=positions[ball.id];
    Object.assign(ball,{vx:0,vz:0,vy:0,elevation:0,airborne:false,pocketed:!position});
    if(position){Object.assign(ball,position);ball.airborne=!!ball.elevation||!!ball.vy;}
  }
  game.arrange(state);
}
