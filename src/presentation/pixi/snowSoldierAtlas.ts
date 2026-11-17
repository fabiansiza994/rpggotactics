import {SNOW_ATLAS} from '../assets/snowSoldierAtlas.generated';
import type {CharacterAnimationLayout} from './characterAnimations';
/** Artist-approved atlas, shared by the normal candidate renderer. */
function clip(id:string){const c=SNOW_ATLAS.clips.find(c=>c.id===id);if(!c)throw Error('Missing authored snow clip '+id);return {start:c.start,count:c.count,frameMs:c.frameMs};}
export function snowSoldierLayout(age:number):CharacterAnimationLayout{
 const suffix=age===5?'':'_'+age;
 return {url:'/art/animations/snow-soldier-v2/atlas.png',columns:SNOW_ATLAS.columns,cellSize:SNOW_ATLAS.cellSize,runtimeScale:.5,
  clips:{idle:{...clip('idle'+suffix),loop:true,animatedIdle:true},walk:{...clip('walk_'+age),loop:true},attack:{...clip('melee_attack'+suffix),loop:false,contactFrame:3},cast:{...clip('snowball_attack'),loop:false,contactFrame:3},hit:{...clip('hit'+suffix),loop:false},death:{...clip('death_clean'),loop:false,terminal:true},melt:{...clip('melt'),loop:false,terminal:true},fire_death:{...clip('fire_death'),loop:false,terminal:true},ability:{...clip('refreeze'),loop:false}}};
}
export const snowSoldierVariant=(age:number)=>age>=5?'snow_soldier':'snow_soldier:age'+age;
