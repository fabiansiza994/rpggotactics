import type { GameContent } from '../../src/game';
import { heroProfile } from '../../src/game/collection/profile';
import {
  catalogFactsFrom,
  discoverRarities,
  dueCatalogGrants,
  freeCatalogReleased,
  type CatalogFacts,
} from '../../src/game/collection/free-catalog';
import { FREE_CATALOG } from '../../src/game/data/free-catalog';
import type { D1Database } from './db';
import type { PlayerRecord } from './repo';

/**
 * Free card catalog on the Worker (data/free-catalog.ts, released by FREE_CATALOG_ENABLED).
 *
 * `reconcileFreeCatalog` runs before every state the client reads (GET /state and every
 * campaign/store response): from durable rows only — the reward log's replay-verified victories,
 * the world history, the champion runs and the mastery XP — it inserts each catalog card whose
 * milestone is met and that the champion does not own. That one path covers the live unlock, the
 * retroactive catch-up of existing accounts, reloads, retries and reconnects.
 *
 * Idempotency: the grant only ever makes the count AT LEAST 1 (insert, or MAX(copies, 1) on an
 * existing row), so two concurrent reads, a retry or an already-owned card never add a copy. Only the card: no wallet, badge, title, world
 * progress or mastery row is ever written here. No migration is needed (tactics_player_cards).
 */

const clearMilestones = (): string[] => [
  ...new Set(Object.values(FREE_CATALOG).flatMap((rows) => rows.flatMap((r) => (r.unlock.type === 'ENCOUNTER_CLEAR' ? [r.unlock.encounterId] : [])))),
];

/** Durable facts for one account. `masteryOn` = mastery is live for it (else Legendaries wait). */
export async function catalogFactsFor(db: D1Database, userId: number, record: PlayerRecord, masteryOn: boolean): Promise<CatalogFacts> {
  const encounters = clearMilestones();
  // Every verified victory writes an OFFERED or NO_DROP row (rows from before champions = the Mage).
  const evidence = encounters.length
    ? await db
        .prepare(
          `SELECT DISTINCT COALESCE(hero_id, 'mage') AS hero_id, encounter_id FROM tactics_reward_log
           WHERE user_id = ? AND event IN ('OFFERED', 'NO_DROP') AND encounter_id IN (${encounters.map(() => '?').join(', ')})`,
        )
        .bind(userId, ...encounters)
        .all<{ hero_id: string; encounter_id: string }>()
    : { results: [] };
  let xp: Record<string, number> = {};
  if (masteryOn)
    try {
      const rows = await db.prepare('SELECT hero_id, xp FROM tactics_champion_mastery WHERE user_id = ?').bind(userId).all<{ hero_id: string; xp: number }>();
      xp = Object.fromEntries(rows.results.map((r) => [r.hero_id, r.xp]));
    } catch {
      // Migration 0024 not applied: mastery is not live, Legendaries wait.
      masteryOn = false;
    }
  return catalogFactsFrom({
    runs: (heroId) => [record.runs[heroId], ...Object.values(record.worldRuns).map((byHero) => byHero[heroId])],
    worldHistory: record.worldHistory,
    clearedEvidence: (heroId) => evidence.results.filter((r) => r.hero_id === heroId).map((r) => r.encounter_id),
    masteryXp: masteryOn ? (heroId) => xp[heroId] ?? 0 : undefined,
  });
}

/** Grants every due catalog card (1 copy, collection only). Returns how many rows were written. */
export async function reconcileFreeCatalog(
  db: D1Database,
  userId: number,
  content: GameContent,
  record: PlayerRecord | null,
  now: number,
  masteryOn: boolean,
): Promise<number> {
  if (!record || !freeCatalogReleased(content)) return 0;
  const facts = await catalogFactsFor(db, userId, record, masteryOn);
  const due = dueCatalogGrants(content, (heroId, cardId) => heroProfile(record.profile, heroId, content).collection[cardId]?.copies ?? 0, facts);
  if (!due.length) return 0;
  const next: Record<string, number> = {};
  await db.batch(
    due.map((g) => {
      // "Recently unlocked" order, after the champion's latest acquisition.
      next[g.heroId] = (next[g.heroId] ?? heroProfile(record.profile, g.heroId, content).acquisitions) + 1;
      return db
        .prepare(
          `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at)
           VALUES (?, ?, ?, 1, ?, 'FREE_CATALOG', ?)
           ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = MAX(copies, 1)`,
        )
        .bind(userId, g.heroId, g.cardId, next[g.heroId], now);
    }),
  );
  return due.length;
}

/** GET /api/tactics/free-catalog: «Descubre las rarezas» rows for every catalog champion in content. */
export async function freeCatalogBody(db: D1Database, userId: number, content: GameContent, record: PlayerRecord, masteryOn: boolean) {
  const facts = await catalogFactsFor(db, userId, record, masteryOn);
  return {
    released: freeCatalogReleased(content),
    masteryAvailable: masteryOn,
    champions: Object.fromEntries(
      Object.keys(FREE_CATALOG)
        .filter((heroId) => content.heroes[heroId])
        .map((heroId) => [heroId, discoverRarities(content, record.profile, heroId, facts)]),
    ),
  };
}
