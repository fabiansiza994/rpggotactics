import { requireDef, type GameContent } from '../domain/content';
import type { DeckRules } from './deck-rules';
import { activeDeck, battleDeck, heroProfile, type BattleDeck, type PlayerProfile } from './profile';

/**
 * What a player brings to a battle: WHO (champion) + HOW they built it (one of that
 * champion's decks). Skirmish uses it today; PvP will send the same pair. The deck always
 * comes from the champion's own profile, so a champion can never fight with another's deck.
 */
export interface BattleLoadout {
  championId: string;
  deckId: string;
}

export type SelectResult = { ok: true; profile: PlayerProfile } | { ok: false; error: string };

export function selectChampion(profile: PlayerProfile, championId: string, content: GameContent): SelectResult {
  if (!content.heroes[championId]) return { ok: false, error: `unknown champion "${championId}"` };
  return { ok: true, profile: { ...profile, selectedChampionId: championId } };
}

/**
 * Loadout for a given champion: `deckId` (one of its own decks) or its default deck. Fixed-hero
 * modes ask for their hero explicitly; campaign always uses the default deck.
 */
export function loadoutFor(profile: PlayerProfile, championId: string, content: GameContent, deckId?: string): BattleLoadout {
  requireDef(content.heroes, championId, 'hero');
  const hero = heroProfile(profile, championId, content);
  if (deckId !== undefined && !hero.decks.some((d) => d.id === deckId))
    throw new Error(`deck "${deckId}" does not belong to champion "${championId}"`);
  return { championId, deckId: deckId ?? activeDeck(hero).id };
}

/** The player's chosen champion with its active deck (selectable modes). */
export const selectedLoadout = (profile: PlayerProfile, content: GameContent): BattleLoadout =>
  loadoutFor(profile, profile.selectedChampionId, content);

/**
 * The validated cards a loadout fights with: that deck of that champion. A `deckId` the
 * champion does not own is refused rather than silently swapped.
 */
export function loadoutDeck(profile: PlayerProfile, loadout: BattleLoadout, content: GameContent, rules: DeckRules): BattleDeck {
  const hero = heroProfile(profile, loadout.championId, content);
  if (!hero.decks.some((d) => d.id === loadout.deckId))
    throw new Error(`deck "${loadout.deckId}" does not belong to champion "${loadout.championId}"`);
  return battleDeck(profile, loadout.championId, content, rules, loadout.deckId);
}
