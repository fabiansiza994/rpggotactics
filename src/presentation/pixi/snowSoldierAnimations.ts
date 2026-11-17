import type {CharacterAnimationLayout} from './characterAnimations';
import {snowSoldierLayout} from './snowSoldierAtlas';
/** Approved by the user; rejected drafts are not registered. */
export const SNOW_SOLDIER_ANIMATION_STATUS='APPROVED' as const;
export const SNOW_SOLDIER_MASTER='/art/animations/snow-soldier-v2/master.png';
export const SNOW_SOLDIER_ATLAS_CONTRACT:CharacterAnimationLayout=snowSoldierLayout(5);
export type SnowMeltState=0|1|2|3|4|5;
/** Read-only snapshot mapping; no HP/duration reset, no replay of prior transitions.
 * World restores appearance only. The remaining duration continues to live on the server. */
export function snowVisualAge(remaining:number,world:boolean):SnowMeltState{
 return (world?5:Math.max(0,Math.min(5,Math.trunc(Number.isFinite(remaining)?remaining:0)))) as SnowMeltState;
}
