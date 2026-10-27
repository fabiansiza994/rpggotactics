import type { EventOfType } from '../../game';
import { fireballPilotAllowed } from './fireballRecipe';
export type HitReaction = 'physical' | 'fire' | 'ice' | 'arcane' | 'force' | 'block' | 'heal' | 'none';
/** Local rollout switch: never persisted or sent with a command. */
export const hitReactionPilot = { enabled: true };
export const universalReactionsEnabled = () => fireballPilotAllowed() && hitReactionPilot.enabled;
export const REACTION_COLOR: Record<HitReaction, number> = {
 physical:0xffd6b8, fire:0xff6045, ice:0x9cddff, arcane:0xc29aff,
 force:0xdbe9f4, block:0xf3d38a, heal:0x88dfbc, none:0xffffff,
};
/** hpLost/mitigations and damageType only. No critical field exists in this contract. */
export function damageReaction(e:EventOfType<'UNIT_DAMAGED'>):HitReaction {
 if(e.hpLost<=0)return e.shieldAbsorbed>0||e.armorMitigated>0||(e.coverMitigated??0)>0?'block':'none';
 return ({PHYSICAL:'physical',FIRE:'fire',ICE:'ice',ARCANE:'arcane',FORCE:'force'} as const)[e.damageType] ?? 'none';
}
