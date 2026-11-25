import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { CardDefinition,EffectDef } from './card';
import type { ResolvedTarget } from './targeting';
import { createTerrain } from '../terrain/terrain-rules';

/** Product-approved default; explicit ICE terrain effects retain their own duration. */
export const SPELL_ICE_ROUNDS = 3;
export const ICE_NO_GROUND = new Set(['winter_onset','shatter_ice','frost_mantle','arcane_skating','winter_call','snow_war','absolute_zero','glacial_reflection']);
/** The resolver, never selectable range, is the source of a spell's ground footprint. */
export function iceSpellGround(card: CardDefinition, resolved: ResolvedTarget,effects:readonly EffectDef[]=card.effects): readonly Pos[] {
  if(card.presentation.element !== 'ICE' || ICE_NO_GROUND.has(card.id) || effects.some(e=>e.type==='PLACE_WINTER_HEART')) return [];
  // These effects already paint the *executed* walk/trace/area, with explicit contracts.
  if(effects.some(e=>e.type==='ICE_WALK'||e.type==='ICE_LINE'||e.type==='CREATE_TERRAIN'&&e.terrain==='ICE'))return [];
  return resolved.affectedTiles;
}
export function freezeSpellGround(ctx:RuleContext,tiles:readonly Pos[],sourceId:string,duration=SPELL_ICE_ROUNDS):void{
  const seen=new Set<string>();
  for(const p of tiles){const key=`${p.x}:${p.y}`;if(seen.has(key))continue;seen.add(key);createTerrain(ctx,p,'ICE',duration,sourceId);}
}
