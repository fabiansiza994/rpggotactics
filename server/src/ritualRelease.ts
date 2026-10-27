import { withArcher } from '../../src/game/data/archer';
import { withShapeshifterRelease } from '../../src/game/data/shapeshifter-release';
import { ARSENAL_EXPANSION, TACTICAL_EXPANSION, RITUAL_EXPANSION, PRIMORDIAL_EXPANSION, SHOWCASE_STORE_EXPANSION, type GameContent } from '../../src/game';
import { FREE_CATALOG_EXPANSION } from '../../src/game/data/free-catalog';
import type { Env } from './db';

/**
 * Summoner rituals + advanced summons are QA-only until their visual/balance pass:
 * SUMMONER_RITUALS_ENABLED="1" adds the set to reward drops. Battles, replays and deck rules never
 * depend on the switch (a player who owns the cards can always use them), so turning it off
 * later cannot invalidate a saved deck or a pending replay.
 */
export const ritualsReleased = (env: Env): boolean => env.SUMMONER_RITUALS_ENABLED === '1';

/**
 * «Vitrina I» (qa/store-appeal): STORE_SHOWCASE_ENABLED="1" releases its three Showcase Rares, so
 * their premium offers are listed (the store never sells an unreleased card) and they drop in play.
 * Off by default; the production configuration explicitly releases the approved set.
 */
export const showcaseReleased = (env: Env): boolean => env.STORE_SHOWCASE_ENABLED === '1';

/**
 * Dragón Primordial (4 seals, qa/primordial-dragon): PRIMORDIAL_DRAGON_ENABLED="1" adds its seals
 * to reward drops (and so to promo codes / gifts / future packs). Off: no account can obtain them.
 * Like every set, battles, replays and deck legality never read the switch.
 */
export const primordialReleased = (env: Env): boolean => env.PRIMORDIAL_DRAGON_ENABLED === '1';

export function releasedContent(content: GameContent, env: Env): GameContent {
  if (env.ARCHER_ENABLED === '1' || env.ARCHER_QA === '1') content = withArcher(content);
  if (env.SHAPESHIFTER_ENABLED === '1' || env.SHAPESHIFTER_QA === '1') content = withShapeshifterRelease(content);
  const add = [
    ...(ritualsReleased(env) ? [RITUAL_EXPANSION] : []),
    ...(primordialReleased(env) ? [PRIMORDIAL_EXPANSION] : []),
    ...(showcaseReleased(env) ? [SHOWCASE_STORE_EXPANSION] : []),
    ...(env.ARSENAL_CARDS_ENABLED === '1' ? [ARSENAL_EXPANSION] : []),
    ...(env.TACTICAL_CARDS_ENABLED === '1' ? [TACTICAL_EXPANSION] : []),
    ...(env.FREE_CATALOG_ENABLED === '1' ? [FREE_CATALOG_EXPANSION] : []),
  ].filter((id) => !content.releasedExpansions?.includes(id));
  if (!add.length) return content;
  return { ...content, releasedExpansions: [...(content.releasedExpansions ?? []), ...add] };
}
