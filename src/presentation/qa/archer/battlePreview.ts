import type { GameState } from '../../../game';
import { localShapeshifterQa } from '../shapeshifter/access';
import { ARCHER_VISUAL_ID } from './visuals';

/** Gameplay phase 1: `?archer-qa=1` adds the playable QA Archer (data/archer.ts) to local QA content. */
export function archerGameplayQaAllowed(dev: boolean, mode: string, hostname: string, search: string) {
  return localShapeshifterQa(dev,mode,hostname) && new URLSearchParams(search).get('archer-qa')==='1';
}
export function archerBattlePreviewAllowed(dev: boolean, mode: string, hostname: string, search: string) {
  return localShapeshifterQa(dev,mode,hostname) && (new URLSearchParams(search).get('archer-visual-qa')==='1'
    || archerGameplayQaAllowed(dev,mode,hostname,search));
}
const env = [import.meta.env.DEV,import.meta.env.MODE,
  typeof location==='undefined'?'':location.hostname, typeof location==='undefined'?'':location.search] as const;
export const archerGameplayQaEnabled = archerGameplayQaAllowed(...env);
export const archerBattlePreviewEnabled = archerBattlePreviewAllowed(...env);

/**
 * Copy for Pixi only. Never returned to the engine, storage, cloud or replay recorder. A real
 * Archer (defId 'archer', either seat) always wears the frozen archer atlas; the visual-only
 * preview (`?archer-visual-qa=1` without `archer-qa`) still dresses the player's hero instead.
 */
export function archerPresentationState(state: Readonly<GameState>, dressHero = !archerGameplayQaEnabled): Readonly<GameState> {
  return {...state, units:state.units.map(unit=>unit.defId==='archer' || (dressHero && unit.id===state.player.heroId)
    ? {...unit,defId:ARCHER_VISUAL_ID,activeForm:undefined}:unit)};
}
