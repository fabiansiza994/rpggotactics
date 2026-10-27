import type { CardDefinition } from '../domain/cards/card';
import type { GameContent } from '../domain/content';
import { encounterOrder } from '../run/encounter';
import type { RunState } from '../run/run';
import type { WorldHistory } from '../run/worlds';
import { masteryFor } from '../mastery/mastery';
import { FREE_CATALOG, FREE_CATALOG_EXPANSION, type CatalogEntry, type CatalogTier, type CatalogUnlock } from '../data/free-catalog';
import { WORLDS, WORLD_CAMPAIGNS } from '../data/worlds';
import { grantCard, heroProfile, type PlayerProfile } from './profile';

/**
 * Free catalog milestones (data/free-catalog.ts) → card grants. Pure and shared: the Worker runs
 * it on every state read (retroactive catch-up included), guests run it on their local save.
 *
 * Idempotent by ownership: a milestone grants its card only while the champion owns 0 copies, so
 * a retry, a reload, a reconnect or a replayed victory never grants it twice, and a Rare already
 * owned from a drop is never duplicated. It grants the card ONLY: no crystals, badges, titles or
 * world rewards are ever paid again.
 */

/** What a champion has durably achieved. Built from server rows or from a guest save. */
export interface CatalogFacts {
  /** Encounters this champion has won at least once (any run, any time). */
  cleared(heroId: string): ReadonlySet<string>;
  /** Worlds whose boss this champion has defeated. */
  completedWorlds(heroId: string): ReadonlySet<string>;
  /** Champion Mastery level, or null when mastery is not available (guests, mastery off). */
  masteryLevel(heroId: string): number | null;
}

export interface CatalogGrant {
  heroId: string;
  cardId: string;
  tier: CatalogTier;
  unlock: CatalogUnlock;
}

/** Grants run only once the set is released (server FREE_CATALOG_ENABLED / guest build flag). */
export const freeCatalogReleased = (content: Pick<GameContent, 'releasedExpansions'>): boolean =>
  content.releasedExpansions?.includes(FREE_CATALOG_EXPANSION) ?? false;

export function milestoneMet(unlock: CatalogUnlock, heroId: string, facts: CatalogFacts): boolean {
  switch (unlock.type) {
    case 'STARTER':
      return true;
    case 'ENCOUNTER_CLEAR':
      return facts.cleared(heroId).has(unlock.encounterId);
    case 'MASTERY_LEVEL':
      return (facts.masteryLevel(heroId) ?? 0) >= unlock.level;
    case 'WORLD_COMPLETED':
      return facts.completedWorlds(heroId).has(unlock.worldId);
  }
}

/** Catalog rows of the champions and cards present in this content (QA champions only when merged). */
export function catalogEntries(content: GameContent, heroId: string): readonly CatalogEntry[] {
  if (!content.heroes[heroId]) return [];
  return (FREE_CATALOG[heroId] ?? []).filter((e) => content.cards[e.cardId]?.heroId === heroId);
}

/** Cards whose milestone is met but that the champion does not own yet (Commons are starter cards). */
export function dueCatalogGrants(content: GameContent, owned: (heroId: string, cardId: string) => number, facts: CatalogFacts): CatalogGrant[] {
  if (!freeCatalogReleased(content)) return [];
  const out: CatalogGrant[] = [];
  for (const heroId of Object.keys(FREE_CATALOG))
    for (const e of catalogEntries(content, heroId))
      if (e.unlock.type !== 'STARTER' && owned(heroId, e.cardId) <= 0 && milestoneMet(e.unlock, heroId, facts))
        out.push({ heroId, cardId: e.cardId, tier: e.tier, unlock: e.unlock });
  return out;
}

const ownedIn = (profile: PlayerProfile, content: GameContent) => (heroId: string, cardId: string) =>
  heroProfile(profile, heroId, content).collection[cardId]?.copies ?? 0;

/** Guest / local application: grants every due card (1 copy each). Returns the profile unchanged when none is due. */
export function applyCatalogGrants(profile: PlayerProfile, content: GameContent, facts: CatalogFacts): { profile: PlayerProfile; granted: CatalogGrant[] } {
  let out = profile;
  const granted: CatalogGrant[] = [];
  for (const g of dueCatalogGrants(content, ownedIn(profile, content), facts)) {
    const r = grantCard(out, g.heroId, g.cardId, content);
    if (r.ok) {
      out = r.profile;
      granted.push(g);
    }
  }
  return { profile: out, granted };
}

/** Facts from champion runs + durable world history (+ optional extra evidence and mastery XP). */
export function catalogFactsFrom(input: {
  runs: (heroId: string) => readonly (RunState | null | undefined)[];
  worldHistory: Readonly<Record<string, WorldHistory>>;
  /** Extra durable clears (server: replay-verified victories in the reward log). */
  clearedEvidence?: (heroId: string) => Iterable<string>;
  /** Mastery XP per champion; absent = mastery unavailable (level null). */
  masteryXp?: (heroId: string) => number;
}): CatalogFacts {
  const completedWorlds = (heroId: string): Set<string> => {
    const done = new Set<string>();
    for (const [worldId, record] of Object.entries(input.worldHistory[heroId] ?? {})) if (record.completedAt != null) done.add(worldId);
    for (const world of WORLDS)
      if (input.runs(heroId).some((r) => r?.campaignId === world.campaignId && r.completedEncounterIds.includes(world.bossEncounterId))) done.add(world.id);
    return done;
  };
  return {
    completedWorlds,
    cleared: (heroId) => {
      const out = new Set<string>(input.clearedEvidence ? input.clearedEvidence(heroId) : []);
      for (const run of input.runs(heroId)) for (const id of run?.completedEncounterIds ?? []) out.add(id);
      // A completed world implies every one of its encounters was won.
      for (const worldId of completedWorlds(heroId)) for (const id of WORLDS.find((w) => w.id === worldId)?.encounterIds ?? []) out.add(id);
      return out;
    },
    masteryLevel: (heroId) => (input.masteryXp ? masteryFor(input.masteryXp(heroId)).level : null),
  };
}

// ── «Descubre las rarezas» (data contract; the UI is the art/UI pass) ─────────────────────

export interface DiscoverUnlockView {
  type: CatalogUnlock['type'];
  /** Player-facing method, e.g. «Gana «El Ascenso» IV · Muro de escudos». */
  label: string;
  /** Progress toward it (null = no meaningful counter, e.g. a starter card). */
  progress: { current: number; target: number } | null;
  met: boolean;
}

export interface DiscoverRarityView {
  tier: CatalogTier;
  cardId: string;
  name: string;
  rarity: NonNullable<CardDefinition['rarity']>;
  cost: number;
  category: CardDefinition['category'];
  /** Full rules text, shown even while locked (stats are never hidden). */
  rulesText: string;
  unique: boolean;
  owned: boolean;
  copies: number;
  reused: boolean;
  unlock: DiscoverUnlockView;
}

const TIER_ORDER: Readonly<Record<CatalogTier, number>> = { COMMON: 0, RARE: 1, LEGENDARY: 2, ULTRA: 3 };

function unlockView(unlock: CatalogUnlock, heroId: string, facts: CatalogFacts): DiscoverUnlockView {
  const met = milestoneMet(unlock, heroId, facts);
  switch (unlock.type) {
    case 'STARTER':
      return { type: unlock.type, label: 'Mazo inicial', progress: null, met };
    case 'ENCOUNTER_CLEAR': {
      const campaign = WORLD_CAMPAIGNS[unlock.campaignId];
      const route = campaign ? encounterOrder(campaign).map((e) => e.id) : [];
      const upTo = route.indexOf(unlock.encounterId) + 1;
      const cleared = facts.cleared(heroId);
      const name = campaign?.encounters.find((e) => e.id === unlock.encounterId)?.name ?? unlock.encounterId;
      const world = WORLDS.find((w) => w.campaignId === unlock.campaignId);
      return {
        type: unlock.type,
        label: `Gana «${world?.name ?? unlock.campaignId}» ${name}`,
        progress: upTo > 0 ? { current: met ? upTo : route.slice(0, upTo).filter((id) => cleared.has(id)).length, target: upTo } : null,
        met,
      };
    }
    case 'MASTERY_LEVEL': {
      const level = facts.masteryLevel(heroId);
      return { type: unlock.type, label: `Maestría ${unlock.level}`, progress: { current: Math.min(level ?? 1, unlock.level), target: unlock.level }, met };
    }
    case 'WORLD_COMPLETED': {
      const world = WORLDS.find((w) => w.id === unlock.worldId);
      const total = world?.encounterIds.length ?? 0;
      const cleared = facts.cleared(heroId);
      return {
        type: unlock.type,
        label: `Completa «${world?.name ?? unlock.worldId}»`,
        progress: total ? { current: met ? total : (world?.encounterIds.filter((id) => cleared.has(id)).length ?? 0), target: total } : null,
        met,
      };
    }
  }
}

/** One row per rarity (Común → Ultra) for the champion, owned or locked, never hiding stats. */
export function discoverRarities(content: GameContent, profile: PlayerProfile, heroId: string, facts: CatalogFacts): DiscoverRarityView[] {
  const owned = ownedIn(profile, content);
  return [...catalogEntries(content, heroId)]
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
    .map((e) => {
      const card = content.cards[e.cardId]!;
      const copies = owned(heroId, e.cardId);
      return {
        tier: e.tier,
        cardId: card.id,
        name: card.name,
        rarity: card.rarity ?? 'COMMON',
        cost: card.cost,
        category: card.category,
        rulesText: card.rulesText,
        unique: card.unique === true,
        owned: copies > 0,
        copies,
        reused: e.reused,
        unlock: unlockView(e.unlock, heroId, facts),
      };
    });
}
