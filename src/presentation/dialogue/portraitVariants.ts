import type {DialoguePortraitVariant} from '../../game/dialogue/dialogue';
export const CHAMPION_DIALOGUE_IDS = ['mage','summoner','warrior','shapeshifter','archer'] as const;
export const CHAMPION_DIALOGUE_VARIANTS = ['neutral','serious','confident','amused','angry','wounded'] as const;
export const BOSS_DIALOGUE_IDS = ['stone_colossus','forge_king','veil_stalker','veil_guardian','veil_beast'] as const;
export const BOSS_DIALOGUE_VARIANTS = ['neutral','threatening','angry','wounded','defeated'] as const;
export type DialoguePortraitSet = Partial<Record<DialoguePortraitVariant,string>>;
/** Dialogue-only art: no champion selection, cards or battle sprite registry dependency. */
export const DIALOGUE_PORTRAITS: Readonly<Record<string,DialoguePortraitSet>> = Object.fromEntries([
 ...CHAMPION_DIALOGUE_IDS.map(id=>[id,Object.fromEntries(CHAMPION_DIALOGUE_VARIANTS.map(variant=>[variant,`/art/dialogue-portraits/${id}/${variant}.webp`]))]),
 ...BOSS_DIALOGUE_IDS.map(id=>[id,Object.fromEntries(BOSS_DIALOGUE_VARIANTS.map(variant=>[variant,`/art/dialogue-portraits/bosses/${id}/${variant}.webp`]))]),
]);
const BOSS_FALLBACK:Readonly<Record<DialoguePortraitVariant,readonly DialoguePortraitVariant[]>> = {
 neutral:['neutral'], threatening:['threatening','neutral'], angry:['angry','threatening','neutral'],
 wounded:['wounded','neutral'], defeated:['defeated','wounded','neutral'],
 serious:['threatening','neutral'], confident:['threatening','neutral'], amused:['neutral'],
};
export function portraitVariantFor(id:string,requested:DialoguePortraitVariant='neutral',registry:Readonly<Record<string,DialoguePortraitSet>>=DIALOGUE_PORTRAITS):{src:string;variant:DialoguePortraitVariant}|null {
 const set=registry[id]; if(!set)return null;
 const variants=(BOSS_DIALOGUE_IDS as readonly string[]).includes(id)?BOSS_FALLBACK[requested]:[requested,'serious','neutral'] as const;
 for(const variant of variants)if(set[variant])return {src:set[variant],variant};
 return null;
}
