import { COSMETICS } from '../data/store-catalog';
import type { CosmeticDef } from '../store/store';
import { RANKED_COSMETICS } from './rewardTrack';
import { RANKED_PREMIUM_COSMETICS, RANKED_PREMIUM_SHOWCASES } from './premiumCosmetics';

/**
 * The six Ranked Reward Track cosmetics as equippable definitions (same ids, same kinds = slots).
 * They are deliberately NOT in the store registry (COSMETICS): the store, gifts and promo codes
 * read that one, so a Ranked cosmetic can only ever be owned through the track grant (0025).
 */
export const RANKED_EQUIPPABLE: Readonly<Record<string, CosmeticDef>> = Object.fromEntries([
  ...Object.values(RANKED_COSMETICS).map((c) => [c.id, { id: c.id, kind: c.kind, name: c.name, description: c.intent }]),
  // Ranked Premium Track (pass) cosmetics: only the 0027 grant owns them. Equip still checks the
  // kind (PROFILE_FRAME today; the card back waits for its renderer).
  ...Object.values({...RANKED_PREMIUM_COSMETICS,...RANKED_PREMIUM_SHOWCASES}).map((c) => [c.id, { id: c.id, kind: c.kind, name: c.name, description: c.description }]),
]);

/** What a player may equip: a store registry (injectable in tests) plus the Ranked cosmetics. */
export const equippableCosmetics = (store: Readonly<Record<string, CosmeticDef>> = COSMETICS): Readonly<Record<string, CosmeticDef>> => ({
  ...store,
  ...RANKED_EQUIPPABLE,
});
