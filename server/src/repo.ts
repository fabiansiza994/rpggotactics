import {
  ASCENT_CAMPAIGN,
  defaultCampaignHero,
  rewardContextFor,
  parseRunSave,
  isNeutral,
  serializeRun,
  SHARED_POOL_ID,
  starterHeroProfile,
  starterShared,
  type ChampionProgress,
  type ChampionUnlock,
  type DeckEntry,
  type GameContent,
  type HeroProfile,
  type PlayerProfile,
  type RunState,
  type SharedCollection,
  type WorldHistory,
  type WorldRecord,
  WORLDS,
  WORLD_CAMPAIGNS,
  PREMIUM_CURRENCY_ID,
} from '../../src/game';
import { ledgerStatement } from './store';
import type { D1Database, D1PreparedStatement } from './db';

/** Bumped when the stored shape of Tactics player data changes (rows or run_json). */
export const SERVER_SAVE_VERSION = 1;

/**
 * Where a card copy came from. CAMPAIGN_REWARD is the pre-Phase-2 value; drops record their
 * pool. PVP_REWARD is reserved for a later phase (no code path writes it yet).
 * STORE_PURCHASE copies are written by the store (server/src/store.ts) into the same collection.
 */
export type CardSource =
  | 'STARTER'
  | 'CAMPAIGN_REWARD'
  | 'LOCAL_IMPORT'
  | 'NORMAL_DROP'
  | 'ELITE_DROP'
  | 'BOSS_DROP'
  | 'PVP_REWARD'
  | 'STORE_PURCHASE'
  /** Granted by redeeming a gift/promo code (server/src/promo.ts). */
  | 'PROMO_CODE'
  /** A store product another player bought as a gift, granted when the recipient claims it (server/src/gifts.ts). */
  | 'STORE_GIFT'
  /** Exclusive card granted with a world's one-time completion reward (worldCompletionStatements). */
  | 'WORLD_REWARD'
  /** A neutral card's copies moved from a champion's rows to the shared pool (`hero_id = '*'`). */
  | 'NEUTRAL_MERGE'
  | 'QA_BALANCE';

/** One audit row of tactics_reward_log. */
export interface RewardLogEntry {
  campaignId: string;
  /** Champion whose run produced the event. */
  heroId: string;
  runSeed: number;
  encounterId: string;
  pool: string;
  event: 'OFFERED' | 'NO_DROP' | 'CLAIMED';
  offered: unknown;
  chosen: unknown;
  pityBefore: number;
  pityAfter: number;
}

export interface ProfileMeta {
  displayName: string;
  saveVersion: number;
  createdAt: number;
  updatedAt: number;
  migratedFromLocalAt: number | null;
}

/** Everything the server knows about one player, rebuilt into the game's own models. */
export interface PlayerRecord {
  meta: ProfileMeta;
  profile: PlayerProfile;
  /** Every campaign champion's own run (null = never started). */
  runs: Record<string, RunState | null>;
  /** The Mage run (`runs.mage`), still sent for clients from before multi-champion campaigns. */
  run: RunState | null;
  /**
   * Runs of the worlds after World 1, by campaign id then champion (World 1's are `runs`, kept
   * as they were for older clients). Example: `worldRuns.infernal.summoner`.
   */
  worldRuns: Record<string, Record<string, RunState | null>>;
  /** Server-only revision keyed by campaign/champion; never accepted from the client. */
  campaignRevisions?: Record<string, number>;
  /** Durable world achievements per champion (stored rows + legacy evidence, see loadWorldHistory). */
  worldHistory: Record<string, WorldHistory>;
  skirmish: StoredSkirmish | null;
}

export interface StoredSkirmish {
  id: number;
  run: RunState;
  deck: DeckEntry[];
}

export async function loadSkirmish(
  db: D1Database,
  userId: number,
  content: GameContent,
): Promise<StoredSkirmish | null> {
  const row = await db
    .prepare(
      'SELECT id, run_json, deck_json FROM tactics_skirmishes WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    )
    .bind(userId)
    .first<{ id: number; run_json: string; deck_json: string }>();
  if (!row) return null;
  try {
    const raw = JSON.parse(row.run_json).run as RunState;
    const parsed = parseRunSave(row.run_json, rewardContextFor(raw), content);
    return parsed.status === 'OK'
      ? { id: row.id, run: parsed.run, deck: JSON.parse(row.deck_json) }
      : null;
  } catch {
    return null;
  }
}

export async function startSkirmish(
  db: D1Database,
  userId: number,
  run: RunState,
  deck: readonly DeckEntry[],
  now: number,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO tactics_skirmishes (user_id, run_json, deck_json, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(userId, serializeRun(run), JSON.stringify(deck), now)
    .run();
}

interface ProfileRow {
  display_name: string;
  selected_champion_id: string;
  champion_mode: string;
  starting_champion_id: string | null;
  campaign_best: number;
  save_version: number;
  migrated_from_local_at: number | null;
  created_at: number;
  updated_at: number;
}
interface CardRow {
  hero_id: string;
  card_id: string;
  copies: number;
  acquired: number;
}
interface DeckRow {
  hero_id: string;
  deck_id: string;
  name: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}
interface DeckCardRow {
  hero_id: string;
  deck_id: string;
  card_id: string;
  count: number;
}

export async function loadPlayer(
  db: D1Database,
  userId: number,
  content: GameContent,
): Promise<PlayerRecord | null> {
  const row = await db
    .prepare(
      'SELECT display_name, selected_champion_id, champion_mode, starting_champion_id, campaign_best, save_version, migrated_from_local_at, created_at, updated_at FROM tactics_profiles WHERE user_id = ?',
    )
    .bind(userId)
    .first<ProfileRow>();
  if (!row) return null;
  const [cards, decks, deckCards, runRows, progress, legacyRun, unlockRows] = await Promise.all([
    db
      .prepare(
        'SELECT hero_id, card_id, copies, acquired FROM tactics_player_cards WHERE user_id = ?',
      )
      .bind(userId)
      .all<CardRow>(),
    db
      .prepare(
        'SELECT hero_id, deck_id, name, is_active, created_at, updated_at FROM tactics_decks WHERE user_id = ? ORDER BY created_at, rowid',
      )
      .bind(userId)
      .all<DeckRow>(),
    db
      .prepare(
        'SELECT hero_id, deck_id, card_id, count FROM tactics_deck_cards WHERE user_id = ? ORDER BY card_id',
      )
      .bind(userId)
      .all<DeckCardRow>(),
    db
      .prepare('SELECT campaign_id, hero_id, run_json, updated_at, revision FROM tactics_hero_campaign_runs WHERE user_id = ?')
      .bind(userId)
      .all<{ campaign_id: string; hero_id: string; run_json: string; updated_at: number; revision: number }>(),
    db
      .prepare('SELECT hero_id, reward_pity FROM tactics_hero_progress WHERE user_id = ?')
      .bind(userId)
      .all<{ hero_id: string; reward_pity: number }>(),
    db.prepare('SELECT run_json, updated_at FROM tactics_campaign_runs WHERE user_id = ? AND campaign_id = ?')
      .bind(userId, ASCENT_CAMPAIGN.id)
      .first<{ run_json: string; updated_at: number }>(),
    db.prepare('SELECT hero_id, milestone FROM tactics_champion_unlocks WHERE user_id = ? ORDER BY unlocked_at, rowid')
      .bind(userId)
      .all<{ hero_id: string; milestone: ChampionUnlock['milestone'] | 'FREE' }>(),
  ]);
  const pityOf = (heroId: string) =>
    progress.results.find((p) => p.hero_id === heroId)?.reward_pity ?? 0;
  const neutral = (c: CardRow) => {
    const card = content.cards[c.card_id];
    return card !== undefined && isNeutral(card);
  };
  const cardRows = await foldNeutralRows(db, userId, cards.results, neutral, content, Date.now());

  const heroes: Record<string, HeroProfile> = {};
  for (const hero of Object.values(content.heroes)) {
    // A champion added to the content after this player was created starts from its starter set.
    const base = starterHeroProfile(hero, content);
    const owned = cardRows.filter((c) => c.hero_id === hero.id && content.cards[c.card_id] && !neutral(c));
    const heroDecks = decks.results.filter((d) => d.hero_id === hero.id);
    if (!owned.length && !heroDecks.length) {
      heroes[hero.id] = { ...base, rewardPity: pityOf(hero.id) };
      continue;
    }
    // Starter copies are always owned. Accounts created before a champion existed have no
    // starter rows for it, so its first stored grant/deck must not hide the starter set.
    const collection: HeroProfile['collection'] = { ...base.collection };
    for (const c of owned)
      collection[c.card_id] = { copies: Math.max(c.copies, base.collection[c.card_id]?.copies ?? 0), acquired: c.acquired };
    const savedDecks = heroDecks.map((d) => ({
      id: d.deck_id,
      name: d.name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      cards: deckCards.results
        .filter((c) => c.hero_id === hero.id && c.deck_id === d.deck_id && content.cards[c.card_id])
        .map((c) => ({ cardId: c.card_id, count: c.count })),
    }));
    heroes[hero.id] = {
      heroId: hero.id,
      collection,
      acquisitions: owned.reduce((n, c) => Math.max(n, c.acquired), 0),
      decks: savedDecks.length ? savedDecks : base.decks,
      activeDeckId:
        heroDecks.find((d) => d.is_active)?.deck_id ?? savedDecks[0]?.id ?? base.activeDeckId,
      rewardPity: pityOf(hero.id),
    };
  }

  // Runs were written by this server; they are still re-validated against the current content,
  // and a row is only accepted as the run of the champion it is stored under.
  const runs: Record<string, RunState | null> = {};
  for (const heroId of ASCENT_CAMPAIGN.heroIds) {
    let stored: { run_json: string; updated_at: number } | undefined = runRows.results.find((r) => r.campaign_id === ASCENT_CAMPAIGN.id && r.hero_id === heroId);
    // The previous Worker can still write during rollout or rollback. Prefer its newer Mage
    // row so progress written after the migration copy is never replaced by the stale copy.
    if (heroId === defaultCampaignHero(ASCENT_CAMPAIGN) && legacyRun && (!stored || legacyRun.updated_at > stored.updated_at))
      stored = legacyRun;
    const parsed = stored ? parseRunSave(stored.run_json, ASCENT_CAMPAIGN, content) : null;
    runs[heroId] = parsed?.status === 'OK' && parsed.run.heroId === heroId ? parsed.run : null;
  }
  const worldRuns: Record<string, Record<string, RunState | null>> = {};
  for (const campaign of Object.values(WORLD_CAMPAIGNS)) {
    if (campaign.id === ASCENT_CAMPAIGN.id) continue;
    worldRuns[campaign.id] = {};
    for (const heroId of campaign.heroIds) {
      const stored = runRows.results.find((r) => r.campaign_id === campaign.id && r.hero_id === heroId);
      const parsed = stored ? parseRunSave(stored.run_json, campaign, content) : null;
      worldRuns[campaign.id]![heroId] = parsed?.status === 'OK' && parsed.run.heroId === heroId ? parsed.run : null;
    }
  }
  // Preserve historical server-owned progress before a new campaign can replace its run.
  const campaignBest = Math.max(row.campaign_best, ...Object.values(runs).map(r => r?.completedEncounterIds.length ?? 0));
  if (campaignBest > row.campaign_best)
    await db.prepare('UPDATE tactics_profiles SET campaign_best = MAX(campaign_best, ?) WHERE user_id = ?').bind(campaignBest, userId).run();
  // Legacy keeps Mage/Summoner; Warrior requires VI. Derive the best from existing
  // server runs as well, so victories recorded before onboarding count retroactively.
  const champions: ChampionProgress | undefined =
    row.champion_mode === 'PROGRESSION'
      ? {
          mode: 'PROGRESSION',
          startingChampionId: row.starting_champion_id && content.heroes[row.starting_champion_id] ? row.starting_champion_id : null,
          unlocks: unlockRows.results
            .filter((u) => content.heroes[u.hero_id])
            .map((u) => ({ heroId: u.hero_id, milestone: u.milestone === 'FREE' ? 'ASCENT_6' as const : u.milestone, ...(u.milestone === 'FREE' ? { source: 'FREE' as const } : {}) })),
          campaignBest: campaignBest,
        }
      : {
          mode: 'LEGACY', startingChampionId: null, unlocks: unlockRows.results.filter(u => content.heroes[u.hero_id] && u.milestone === 'FREE').map(u => ({ heroId: u.hero_id, milestone: 'ASCENT_6' as const, source: 'FREE' as const })),
          campaignBest: campaignBest,
        };
  return {
    meta: {
      displayName: row.display_name,
      saveVersion: row.save_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      migratedFromLocalAt: row.migrated_from_local_at,
    },
    profile: {
      heroes,
      shared: sharedFromRows(cardRows.filter(neutral), content),
      selectedChampionId: content.heroes[row.selected_champion_id]
        ? row.selected_champion_id
        : Object.keys(content.heroes)[0]!,
      ...(champions ? { champions } : {}),
    },
    runs,
    run: runs[defaultCampaignHero(ASCENT_CAMPAIGN)] ?? null,
    worldRuns,
    campaignRevisions: Object.fromEntries(runRows.results.map(r => [`${r.campaign_id}:${r.hero_id}`, r.revision])),
    worldHistory: await loadWorldHistory(db, userId),
    skirmish: await loadSkirmish(db, userId, content),
  };
}

/**
 * Per champion: world id → completion record. Stored rows (tactics_world_progress) plus legacy
 * evidence that needs no migration: a replay-verified victory of a world's boss in the reward
 * log (every verified victory writes an OFFERED or NO_DROP row; rows logged before champions
 * were recorded, hero_id NULL, are the Mage's). COMPLETED runs are added by the world rules
 * (`worldCompleted`). A Worker deployed before migration 0014 still reads the evidence.
 */
export async function loadWorldHistory(db: D1Database, userId: number): Promise<Record<string, WorldHistory>> {
  const out: Record<string, Record<string, WorldRecord>> = {};
  const put = (heroId: string, worldId: string, record: WorldRecord) => {
    const hero = (out[heroId] ??= {});
    const prev = hero[worldId];
    hero[worldId] = {
      completedAt: prev?.completedAt != null && record.completedAt != null ? Math.min(prev.completedAt, record.completedAt) : (prev?.completedAt ?? record.completedAt),
      rewardGrantedAt: prev?.rewardGrantedAt ?? record.rewardGrantedAt,
    };
  };
  const bosses = WORLDS.map((w) => w.bossEncounterId);
  const evidence = await db
    .prepare(
      `SELECT campaign_id, encounter_id, COALESCE(hero_id, 'mage') AS hero_id, MIN(created_at) AS at FROM tactics_reward_log
       WHERE user_id = ? AND event IN ('OFFERED', 'NO_DROP') AND encounter_id IN (${bosses.map(() => '?').join(', ')})
       GROUP BY campaign_id, encounter_id, COALESCE(hero_id, 'mage')`,
    )
    .bind(userId, ...bosses)
    .all<{ campaign_id: string; encounter_id: string; hero_id: string; at: number }>();
  for (const row of evidence.results) {
    const world = WORLDS.find((w) => w.campaignId === row.campaign_id && w.bossEncounterId === row.encounter_id);
    if (world) put(row.hero_id, world.id, { completedAt: row.at, rewardGrantedAt: null });
  }
  try {
    const stored = await db
      .prepare('SELECT hero_id, world_id, completed_at, reward_granted_at FROM tactics_world_progress WHERE user_id = ?')
      .bind(userId)
      .all<{ hero_id: string; world_id: string; completed_at: number; reward_granted_at: number | null }>();
    for (const row of stored.results) put(row.hero_id, row.world_id, { completedAt: row.completed_at, rewardGrantedAt: row.reward_granted_at });
  } catch {
    // Migration 0014 not applied yet: the derived evidence above is still correct.
  }
  return out;
}

/**
 * A world's boss was defeated (replay-verified): record the completion once, and pay the
 * one-time completion reward when it has not been paid. Returns the statements for the same
 * batch as the victory. The ledger's UNIQUE (user, currency, reason, reference) makes a
 * concurrent duplicate fail as a whole, so the reward can never be paid twice.
 */
export function worldCompletionStatements(
  db: D1Database,
  userId: number,
  e: {
    heroId: string;
    worldId: string;
    crystals: number;
    payReward: boolean;
    transactionId: string;
    now: number;
    /** The champion's exclusive card (1 additional copy; `cap` is legacy deck metadata); `acquired` = its next acquisition index. */
    card?: { cardId: string; acquired: number; /** @deprecated Ignored. Deck capacity never limits inventory. */ cap?: number };
  },
): D1PreparedStatement[] {
  const out = [
    db
      .prepare(
        `INSERT INTO tactics_world_progress (user_id, hero_id, world_id, completed_at, reward_granted_at) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT (user_id, hero_id, world_id) DO NOTHING`,
      )
      .bind(userId, e.heroId, e.worldId, e.now),
  ];
  // The card goes to the collection only (never into a deck). It is inserted only while the
  // reward is still unpaid INSIDE this transaction, so even a duplicate that skipped the ledger
  // (a world without crystals) cannot grant it twice; inventory is incremented without a deck cap.
  if (e.payReward && e.card)
    out.push(
      db
        .prepare(
          `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at)
           SELECT ?, ?, ?, 1, ?, 'WORLD_REWARD', ?
           WHERE NOT EXISTS (SELECT 1 FROM tactics_world_progress WHERE user_id = ? AND hero_id = ? AND world_id = ? AND reward_granted_at IS NOT NULL)
           ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = copies + 1, acquired = excluded.acquired, source = excluded.source`,
        )
        .bind(userId, e.heroId, e.card.cardId, e.card.acquired, e.now, userId, e.heroId, e.worldId),
    );
  if (e.payReward && e.crystals > 0)
    out.push(
      ledgerStatement(db, {
        transactionId: e.transactionId,
        userId,
        currencyId: PREMIUM_CURRENCY_ID,
        delta: e.crystals,
        reason: 'ACHIEVEMENT_REWARD',
        referenceId: `world:${e.worldId}:${e.heroId}`,
        note: `World completion reward (${e.worldId})`,
        now: e.now,
      }),
      db
        .prepare('UPDATE tactics_world_progress SET reward_granted_at = ? WHERE user_id = ? AND hero_id = ? AND world_id = ? AND reward_granted_at IS NULL')
        .bind(e.now, userId, e.heroId, e.worldId),
    );
  else if (e.payReward && e.card)
    out.push(
      db
        .prepare('UPDATE tactics_world_progress SET reward_granted_at = ? WHERE user_id = ? AND hero_id = ? AND world_id = ? AND reward_granted_at IS NULL')
        .bind(e.now, userId, e.heroId, e.worldId),
    );
  return out;
}

/** The shared neutral pool from its `hero_id = '*'` rows, never below the starter neutrals. */
function sharedFromRows(rows: readonly CardRow[], content: GameContent): SharedCollection {
  const shared = starterShared(content);
  for (const c of rows)
    shared.collection[c.card_id] = {
      copies: Math.max(c.copies, shared.collection[c.card_id]?.copies ?? 0),
      acquired: c.acquired,
    };
  shared.acquisitions = rows.reduce((n, c) => Math.max(n, c.acquired), 0);
  return shared;
}

/**
 * Neutral copies stored under a champion (written before that card became neutral) move to
 * the shared pool, in one transaction, so every later read and grant sees a single row per
 * neutral card. Copies are added, never lost. Returns the rows as they are after the move.
 */
async function foldNeutralRows(
  db: D1Database,
  userId: number,
  rows: readonly CardRow[],
  neutral: (c: CardRow) => boolean,
  content: GameContent,
  now: number,
): Promise<CardRow[]> {
  const legacy = rows.filter((c) => neutral(c) && c.hero_id !== SHARED_POOL_ID);
  if (!legacy.length) return [...rows];
  const ids = [...new Set(legacy.map(c => c.card_id))];
  const starter = starterShared(content).collection;
  // Read legacy quantities INSIDE the transaction, not from the loaded profile. A second
  // concurrent fold sees no legacy rows and adds nothing; a concurrent purchase is retained.
  await db.batch([
    ...ids.map(cardId => db.prepare(`INSERT INTO tactics_player_cards
      (user_id, hero_id, card_id, copies, acquired, source, unlocked_at)
      SELECT ?, ?, ?, SUM(copies) + CASE WHEN EXISTS (
        SELECT 1 FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?
      ) THEN 0 ELSE ? END, MAX(acquired), 'NEUTRAL_MERGE', ?
      FROM tactics_player_cards WHERE user_id = ? AND card_id = ? AND hero_id <> ?
      HAVING COUNT(*) > 0
      ON CONFLICT(user_id, hero_id, card_id) DO UPDATE SET
        copies = copies + excluded.copies, acquired = MAX(acquired, excluded.acquired)`)
      .bind(userId, SHARED_POOL_ID, cardId, userId, SHARED_POOL_ID, cardId, starter[cardId]?.copies ?? 0, now, userId, cardId, SHARED_POOL_ID)),
    ...ids.map(cardId => db.prepare('DELETE FROM tactics_player_cards WHERE user_id = ? AND card_id = ? AND hero_id <> ?')
      .bind(userId, cardId, SHARED_POOL_ID)),
  ]);
  return (await db.prepare('SELECT hero_id, card_id, copies, acquired FROM tactics_player_cards WHERE user_id = ?')
    .bind(userId).all<CardRow>()).results;
}

/** Statements that write the shared neutral pool (creation / import). */
function sharedStatements(db: D1Database, userId: number, shared: SharedCollection, source: CardSource, now: number): D1PreparedStatement[] {
  return Object.entries(shared.collection).map(([cardId, owned]) =>
    db
      .prepare(
        'INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(userId, SHARED_POOL_ID, cardId, owned.copies, owned.acquired, owned.acquired === 0 ? 'STARTER' : source, now),
  );
}

/** Statements that write a hero's whole collection and decks (used on creation / import). */
function heroStatements(
  db: D1Database,
  userId: number,
  hero: HeroProfile,
  source: CardSource,
  now: number,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const [cardId, owned] of Object.entries(hero.collection)) {
    out.push(
      db
        .prepare(
          'INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          userId,
          hero.heroId,
          cardId,
          owned.copies,
          owned.acquired,
          owned.acquired === 0 ? 'STARTER' : source,
          now,
        ),
    );
  }
  for (const deck of hero.decks) {
    out.push(
      db
        .prepare(
          'INSERT INTO tactics_decks (user_id, hero_id, deck_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(userId, hero.heroId, deck.id, deck.name, deck.id === hero.activeDeckId ? 1 : 0, now, now),
    );
    out.push(...deckCardStatements(db, userId, hero.heroId, deck.id, deck.cards));
  }
  return out;
}

export function deckCardStatements(
  db: D1Database,
  userId: number,
  heroId: string,
  deckId: string,
  cards: readonly DeckEntry[],
) {
  return cards.map((e) =>
    db
      .prepare(
        'INSERT INTO tactics_deck_cards (user_id, hero_id, deck_id, card_id, count) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(userId, heroId, deckId, e.cardId, e.count),
  );
}

/** The run, in its champion's row. Mage runs are mirrored to the pre-0011 table (rollback safety). */
function runStatements(
  db: D1Database,
  userId: number,
  run: RunState,
  now: number,
): D1PreparedStatement[] {
  const json = serializeRun(run);
  const out = [
    db
      .prepare(
        `INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, campaign_id, hero_id) DO UPDATE SET run_json = excluded.run_json, save_version = excluded.save_version, updated_at = excluded.updated_at`,
      )
      .bind(userId, run.campaignId, run.heroId, json, SERVER_SAVE_VERSION, now),
  ];
  if (run.heroId === defaultCampaignHero(ASCENT_CAMPAIGN) && run.campaignId === ASCENT_CAMPAIGN.id)
    out.push(
      db
        .prepare(
          `INSERT INTO tactics_campaign_runs (user_id, campaign_id, run_json, save_version, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, campaign_id) DO UPDATE SET run_json = excluded.run_json, save_version = excluded.save_version, updated_at = excluded.updated_at`,
        )
        .bind(userId, run.campaignId, json, SERVER_SAVE_VERSION, now),
    );
  return out;
}

function pityStatement(
  db: D1Database,
  userId: number,
  heroId: string,
  pity: number,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tactics_hero_progress (user_id, hero_id, reward_pity, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, hero_id) DO UPDATE SET reward_pity = excluded.reward_pity, updated_at = excluded.updated_at`,
    )
    .bind(userId, heroId, pity, now);
}

function logStatement(
  db: D1Database,
  userId: number,
  e: RewardLogEntry,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tactics_reward_log (user_id, campaign_id, hero_id, run_seed, encounter_id, pool, event, offered_json, chosen_json, pity_before, pity_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      e.campaignId,
      e.heroId,
      e.runSeed,
      e.encounterId,
      e.pool,
      e.event,
      e.offered === null ? null : JSON.stringify(e.offered),
      e.chosen === null ? null : JSON.stringify(e.chosen),
      e.pityBefore,
      e.pityAfter,
      now,
    );
}

export const touch = (db: D1Database, userId: number, now: number) =>
  db.prepare('UPDATE tactics_profiles SET updated_at = ? WHERE user_id = ?').bind(now, userId);

/** Creates the player in one transaction: profile, every champion's collection and decks, optional run. */
export async function createPlayer(
  db: D1Database,
  userId: number,
  displayName: string,
  profile: PlayerProfile,
  runs: readonly RunState[],
  options: { source: CardSource; importedAt: number | null; now: number },
): Promise<void> {
  const { now } = options;
  await db.batch([
    db
      .prepare(
        `INSERT INTO tactics_profiles (user_id, display_name, selected_champion_id, champion_mode, starting_champion_id, campaign_best, save_version, migrated_from_local_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        userId,
        displayName,
        profile.selectedChampionId,
        profile.champions?.mode ?? 'LEGACY',
        profile.champions?.startingChampionId ?? null,
        profile.champions?.campaignBest ?? 0,
        SERVER_SAVE_VERSION,
        options.importedAt,
        now,
        now,
      ),
    ...(profile.champions?.unlocks ?? []).map((u) => unlockStatement(db, userId, u, now)),
    ...Object.values(profile.heroes).flatMap((h) =>
      heroStatements(db, userId, h, options.source, now),
    ),
    ...(profile.shared ? sharedStatements(db, userId, profile.shared, options.source, now) : []),
    ...Object.values(profile.heroes).map((h) =>
      pityStatement(db, userId, h.heroId, h.rewardPity, now),
    ),
    ...runs.flatMap((run) => runStatements(db, userId, run, now)),
  ]);
}

function unlockStatement(db: D1Database, userId: number, unlock: ChampionUnlock, now: number): D1PreparedStatement {
  return db
    .prepare('INSERT INTO tactics_champion_unlocks (user_id, hero_id, milestone, unlocked_at) VALUES (?, ?, ?, ?)')
    .bind(userId, unlock.heroId, unlock.source === 'FREE' ? 'FREE' : unlock.milestone, now);
}

/**
 * The first-time choice, in one transaction. The START row is unique per player, so a second
 * (concurrent or repeated) choice fails as a whole instead of unlocking two champions.
 */
export async function saveStartingChampion(db: D1Database, userId: number, heroId: string, now: number): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE tactics_profiles SET starting_champion_id = ?, selected_champion_id = ?, updated_at = ? WHERE user_id = ? AND champion_mode = 'PROGRESSION' AND starting_champion_id IS NULL",
      )
      .bind(heroId, heroId, now, userId),
    unlockStatement(db, userId, { heroId, milestone: 'START' }, now),
  ]);
}

/** One milestone unlock (the primary key and the once-per-milestone index reject duplicates). */
export async function saveChampionUnlock(db: D1Database, userId: number, unlock: ChampionUnlock, now: number): Promise<void> {
  await db.batch([unlockStatement(db, userId, unlock, now), touch(db, userId, now)]);
}

export async function setChampion(
  db: D1Database,
  userId: number,
  championId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE tactics_profiles SET selected_champion_id = ?, updated_at = ? WHERE user_id = ?',
    )
    .bind(championId, now, userId)
    .run();
}

/**
 * One campaign step in ONE transaction: the run, plus optionally the card copy granted, the
 * champion's new pity and the audit row. Either all of it is stored or none of it.
 */
export async function saveCampaignStep(
  db: D1Database,
  userId: number,
  now: number,
  step: {
    run: RunState;
    expectedRevision?: number;
    skirmish?: { id: number; step: 'VICTORY' | 'CLAIM' };
    grant?: {
      /** Collection owner: the champion, or SHARED_POOL_ID for a neutral card (`collectionOwner`). */
      ownerId: string;
      cardId: string;
      /** Positive delta, never a client/computed inventory total. */
      copies: number;
      acquired: number;
      source: CardSource;
    };
    pity?: { heroId: string; value: number };
    log?: RewardLogEntry;
    /** Encounters the run has completed: raises the account-wide best (champion milestones). */
    campaignBest?: number;
    /** Extra statements of the same step (world completion, see worldCompletionStatements). */
    extra?: D1PreparedStatement[];
    beforeLog?: D1PreparedStatement[];
  },
): Promise<void> {
  const { grant } = step;
  if (grant && (!Number.isSafeInteger(grant.copies) || grant.copies < 1)) throw new Error('Invalid card acquisition delta');
  const campaignClaim = step.log?.event === 'CLAIMED' && !step.skirmish;
  if (campaignClaim && !Number.isSafeInteger(step.expectedRevision)) throw new Error('Missing campaign claim revision');
  await db.batch([
    ...(!step.skirmish && step.expectedRevision !== undefined ? [db.prepare(`UPDATE tactics_profiles SET save_version = CASE WHEN EXISTS (
      SELECT 1 FROM tactics_hero_campaign_runs WHERE revision = ? AND user_id = ? AND campaign_id = ? AND hero_id = ?
      ) THEN save_version ELSE NULL END WHERE user_id = ?`)
      .bind(step.expectedRevision, userId, step.run.campaignId, step.run.heroId, userId)] : []),
    ...(step.skirmish
      ? [
          db
            .prepare('INSERT INTO tactics_skirmish_steps (battle_id, step) VALUES (?, ?)')
            .bind(step.skirmish.id, step.skirmish.step),
          db
            .prepare('UPDATE tactics_skirmishes SET run_json = ? WHERE id = ? AND user_id = ?')
            .bind(serializeRun(step.run), step.skirmish.id, userId),
        ]
      : runStatements(db, userId, step.run, now)),
    ...(grant
      ? [
          db
            .prepare(
              `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = copies + excluded.copies, acquired = MAX(acquired, excluded.acquired), source = excluded.source`,
            )
            .bind(
              userId,
              grant.ownerId,
              grant.cardId,
              grant.copies,
              grant.acquired,
              grant.source,
              now,
            ),
        ]
      : []),
    ...(step.pity ? [pityStatement(db, userId, step.pity.heroId, step.pity.value, now)] : []),
    ...(step.beforeLog ?? []),
    ...(step.log ? [logStatement(db, userId, step.log, now)] : []),
    ...(step.campaignBest !== undefined
      ? [db.prepare('UPDATE tactics_profiles SET campaign_best = MAX(campaign_best, ?) WHERE user_id = ?').bind(step.campaignBest, userId)]
      : []),
    ...(step.extra ?? []),
    touch(db, userId, now),
  ]);
}

/** QA-only caller authorization is enforced before this atomic Summoner setup. Mage, wallet,
 * cosmetics and other players are untouched. Existing owned copies are never reduced. */
export async function prepareSummonerQa(db: D1Database, userId: number, run: RunState, deckId: string, cards: readonly DeckEntry[], now: number): Promise<void> {
  await db.batch([
    ...cards.map(e=>db.prepare(`INSERT INTO tactics_player_cards (user_id,hero_id,card_id,copies,acquired,source,unlocked_at) VALUES (?,'summoner',?,?,0,'QA_BALANCE',?) ON CONFLICT(user_id,hero_id,card_id) DO UPDATE SET copies=MAX(copies,excluded.copies)`).bind(userId,e.cardId,e.count,now)),
    db.prepare('DELETE FROM tactics_deck_cards WHERE user_id=? AND hero_id=? AND deck_id=?').bind(userId,'summoner',deckId),
    ...deckCardStatements(db,userId,'summoner',deckId,cards),
    ...runStatements(db,userId,run,now),
    pityStatement(db,userId,'summoner',0,now),
    touch(db,userId,now),
  ]);
}
