import type { GameContent } from '../domain/content';
import type { ChampionProgress, ChampionUnlock, UnlockMilestoneId } from './champion-unlocks';
import { isCardForHero, type DeckEntry } from './deck-rules';
import {
  defaultChampionId,
  isNeutral,
  starterHeroProfile,
  starterShared,
  type HeroProfile,
  type OwnedCard,
  type PlayerProfile,
  type SavedDeck,
  type SharedCollection,
} from './profile';

/**
 * Versioned save of the player profile (collections + decks). Bump the version when the
 * shape changes and add a step in `migrate`.
 */
export const PROFILE_SAVE_VERSION = 1;

export type ProfileLoad =
  | { status: 'EMPTY' }
  /** `notes` lists what was dropped because the content no longer has it. */
  | { status: 'OK'; profile: PlayerProfile; notes: string[] }
  | { status: 'INVALID'; reason: string };

export function serializeProfile(profile: PlayerProfile): string {
  return JSON.stringify({ version: PROFILE_SAVE_VERSION, profile });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function migrate(save: Record<string, unknown>): Record<string, unknown> | string {
  if (save.version === 1) return save;
  return `unsupported profile version ${String(save.version)}`;
}

/**
 * Reads one hero's progress. Structure errors make the whole save INVALID; data that only
 * went stale (a card or hero removed from the content) is dropped and reported in `notes`.
 * Starter copies are always owned. Deck legality is NOT enforced here: the Deck Builder shows
 * the issues and battles fall back to the starter deck (see `battleDeck`).
 */
function parseHero(
  raw: unknown,
  heroId: string,
  content: GameContent,
  notes: string[],
  /** Neutral copies found in this hero's collection (saved before the card became neutral). */
  neutral: Map<string, OwnedCard>,
): HeroProfile | string {
  const hero = content.heroes[heroId]!;
  if (!isRecord(raw) || !isRecord(raw.collection) || !Array.isArray(raw.decks) || !isCount(raw.acquisitions))
    return `malformed progress for hero "${heroId}"`;
  const base = starterHeroProfile(hero, content);
  const collection: Record<string, OwnedCard> = { ...base.collection };
  for (const [cardId, owned] of Object.entries(raw.collection)) {
    if (!isRecord(owned) || !isCount(owned.copies) || !isCount(owned.acquired)) return `malformed card "${cardId}"`;
    const card = content.cards[cardId];
    if (!card || !isCardForHero(card, heroId)) {
      notes.push(`${heroId}: dropped unknown card "${cardId}" from the collection`);
      continue;
    }
    if (isNeutral(card)) {
      const prev = neutral.get(cardId);
      neutral.set(cardId, { copies: (prev?.copies ?? 0) + owned.copies, acquired: Math.max(prev?.acquired ?? 0, owned.acquired) });
      continue;
    }
    const starter = collection[cardId];
    collection[cardId] = { copies: Math.max(owned.copies, starter?.copies ?? 0), acquired: owned.acquired };
  }

  const decks: SavedDeck[] = [];
  for (const d of raw.decks) {
    if (!isRecord(d) || typeof d.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.cards))
      return `malformed deck for hero "${heroId}"`;
    const cards: DeckEntry[] = [];
    for (const e of d.cards) {
      if (!isRecord(e) || typeof e.cardId !== 'string' || !isCount(e.count)) return `malformed deck entry in "${d.id}"`;
      if (!content.cards[e.cardId]) {
        notes.push(`${heroId}: dropped unknown card "${e.cardId}" from deck "${d.id}"`);
        continue;
      }
      if (e.count > 0) cards.push({ cardId: e.cardId, count: e.count });
    }
    decks.push({
      id: d.id,
      name: d.name,
      cards,
      ...(isCount(d.createdAt) ? { createdAt: d.createdAt } : {}),
      ...(isCount(d.updatedAt) ? { updatedAt: d.updatedAt } : {}),
    });
  }
  if (decks.length === 0) decks.push(...base.decks);
  const activeDeckId =
    typeof raw.activeDeckId === 'string' && decks.some((d) => d.id === raw.activeDeckId) ? raw.activeDeckId : decks[0]!.id;
  // Saves from before pity existed start at 0. (A server never trusts an imported value.)
  const rewardPity = isCount(raw.rewardPity) ? raw.rewardPity : 0;
  return { heroId, collection, acquisitions: raw.acquisitions, decks, activeDeckId, rewardPity };
}

/**
 * The shared neutral pool: saved copies (never below the starter neutrals) plus copies of
 * now-neutral cards that older saves kept in a hero collection, which are moved, not lost.
 */
function parseShared(raw: unknown, content: GameContent, notes: string[], moved: Map<string, OwnedCard>): SharedCollection | string {
  const base = starterShared(content);
  const collection: Record<string, OwnedCard> = { ...base.collection };
  let acquisitions = 0;
  if (raw !== undefined) {
    if (!isRecord(raw) || !isRecord(raw.collection) || !isCount(raw.acquisitions)) return 'malformed shared collection';
    acquisitions = raw.acquisitions;
    for (const [cardId, owned] of Object.entries(raw.collection)) {
      if (!isRecord(owned) || !isCount(owned.copies) || !isCount(owned.acquired)) return `malformed card "${cardId}"`;
      const card = content.cards[cardId];
      if (!card || !isNeutral(card)) {
        notes.push(`shared: dropped non-neutral card "${cardId}"`);
        continue;
      }
      collection[cardId] = { copies: Math.max(owned.copies, collection[cardId]?.copies ?? 0), acquired: owned.acquired };
    }
  }
  for (const [cardId, owned] of moved) {
    acquisitions += 1;
    collection[cardId] = { copies: (collection[cardId]?.copies ?? 0) + owned.copies, acquired: acquisitions };
    notes.push(`moved ${owned.copies} neutral "${cardId}" to the shared collection`);
  }
  return { collection, acquisitions };
}

const MILESTONES: readonly UnlockMilestoneId[] = ['START', 'ASCENT_3', 'ASCENT_6'];

/**
 * Champion ownership. Missing = a save from before unlocks (LEGACY, kept as `undefined`).
 * A malformed value makes the save INVALID (backed up), never "everything unlocked".
 * Champions no longer in the content are dropped.
 */
function parseChampions(raw: unknown, content: GameContent, notes: string[]): ChampionProgress | undefined | string {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || (raw.mode !== 'LEGACY' && raw.mode !== 'PROGRESSION') || !Array.isArray(raw.unlocks) || !isCount(raw.campaignBest))
    return 'malformed champion unlocks';
  const start = raw.startingChampionId;
  if (start !== null && typeof start !== 'string') return 'malformed starting champion';
  const unlocks: ChampionUnlock[] = [];
  for (const u of raw.unlocks) {
    if (!isRecord(u) || typeof u.heroId !== 'string' || !MILESTONES.includes(u.milestone as UnlockMilestoneId)) return 'malformed champion unlock';
    if (!content.heroes[u.heroId]) {
      notes.push(`champions: dropped unknown champion "${u.heroId}"`);
      continue;
    }
    if (!unlocks.some((o) => o.heroId === u.heroId)) unlocks.push({ heroId: u.heroId, milestone: u.milestone as UnlockMilestoneId, ...(u.source === 'FREE' && u.heroId === 'shapeshifter' ? { source: 'FREE' as const } : {}) });
  }
  return {
    mode: raw.mode,
    startingChampionId: start !== null && content.heroes[start] ? start : null,
    unlocks,
    campaignBest: raw.campaignBest,
  };
}

export function parseProfileSave(raw: string | null, content: GameContent): ProfileLoad {
  if (raw === null || raw === '') return { status: 'EMPTY' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'INVALID', reason: 'not JSON' };
  }
  if (!isRecord(data)) return { status: 'INVALID', reason: 'not a save object' };
  const migrated = migrate(data);
  if (typeof migrated === 'string') return { status: 'INVALID', reason: migrated };
  const saved = migrated.profile;
  if (!isRecord(saved) || !isRecord(saved.heroes)) return { status: 'INVALID', reason: 'missing heroes' };

  const notes: string[] = [];
  const heroes: Record<string, HeroProfile> = {};
  const neutral = new Map<string, OwnedCard>();
  for (const hero of Object.values(content.heroes)) {
    const rawHero = saved.heroes[hero.id];
    if (rawHero === undefined) {
      heroes[hero.id] = starterHeroProfile(hero, content);
      continue;
    }
    const parsed = parseHero(rawHero, hero.id, content, notes, neutral);
    if (typeof parsed === 'string') return { status: 'INVALID', reason: parsed };
    heroes[hero.id] = parsed;
  }
  for (const id of Object.keys(saved.heroes)) if (!content.heroes[id]) notes.push(`dropped unknown hero "${id}"`);
  // Saves from before champion selection have no choice yet; an unknown champion falls back too.
  const chosen = saved.selectedChampionId;
  const selectedChampionId = typeof chosen === 'string' && content.heroes[chosen] ? chosen : defaultChampionId(content);
  if (chosen !== undefined && chosen !== selectedChampionId) notes.push(`unknown champion "${String(chosen)}"`);
  const shared = parseShared(saved.shared, content, notes, neutral);
  if (typeof shared === 'string') return { status: 'INVALID', reason: shared };
  const champions = parseChampions(saved.champions, content, notes);
  if (typeof champions === 'string') return { status: 'INVALID', reason: champions };
  return { status: 'OK', profile: { heroes, shared, selectedChampionId, ...(champions ? { champions } : {}) }, notes };
}
