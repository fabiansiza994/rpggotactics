import {
  copyName,
  DECK_RULES,
  deckSummaries,
  DEFAULT_DECK_SLOTS_PER_CHAMPION,
  heroProfile,
  NEW_DECK_NAME,
  normalizeDeckName,
  ownedFor,
  starterDeck,
  validateDeck,
  type DeckEntry,
  type GameContent,
  type PlayerProfile,
} from '../../src/game';
import type { D1Database, D1PreparedStatement } from './db';
import { error, json } from './http';
import { deckCardStatements, touch } from './repo';

/**
 * Multi-deck per champion (migration 0028). Every limit is enforced INSIDE the write: the
 * slot count by a conditional INSERT, "one default" by a two-step UPDATE in one transaction
 * plus a partial unique index, "never zero decks" by a conditional DELETE. Concurrent requests
 * (double click, two devices) can therefore never exceed DEFAULT_DECK_SLOTS_PER_CHAMPION or
 * leave two defaults; the route re-reads the row afterwards to learn what actually happened.
 *
 * Routes (all scoped to the caller's own account; ids of other accounts are simply not found):
 *   GET    /api/tactics/decks/:heroId                     → { decks: ChampionDeckSummary[], slots }
 *   POST   /api/tactics/decks/:heroId                     { name?, cards?, requestId? } create
 *   PUT    /api/tactics/decks/:heroId/:deckId             { cards, name? }   edit cards
 *   PATCH  /api/tactics/decks/:heroId/:deckId             { name }           rename
 *   POST   /api/tactics/decks/:heroId/:deckId/duplicate   { requestId? }     "Copia de …"
 *   PUT    /api/tactics/decks/:heroId/:deckId/default                         make default
 *   DELETE /api/tactics/decks/:heroId/:deckId                                 delete
 * Mutations answer with the full state (like every other step) plus `deckId` and `decks`.
 */

const SLOTS = DEFAULT_DECK_SLOTS_PER_CHAMPION;
/** Client-chosen idempotency key: a retried create/duplicate with the same key makes one deck. */
const REQUEST_ID = /^[a-z0-9-]{8,30}$/;

interface StoredDeck {
  deck_id: string;
  is_active: number;
}

export interface DeckRouteContext {
  db: D1Database;
  userId: number;
  profile: PlayerProfile;
  content: GameContent;
  now: number;
  body: Record<string, unknown>;
  /** Released + unlocked for this account (same guard as champion selection). */
  usable(heroId: string): Response | null;
  /** Full state response (fresh read) with extra fields. */
  respond(extra: Record<string, unknown>): Promise<Response>;
  /** Fresh profile read after a write. */
  reload(): Promise<PlayerProfile | null>;
}

export function parseDeckCards(raw: unknown): DeckEntry[] | null {
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out: DeckEntry[] = [];
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) return null;
    const { cardId, count } = e as Record<string, unknown>;
    if (typeof cardId !== 'string' || typeof count !== 'number' || !Number.isInteger(count) || count <= 0 || count > 99)
      return null;
    out.push({ cardId, count });
  }
  return out;
}

const storedDecks = (db: D1Database, userId: number, heroId: string) =>
  db
    .prepare('SELECT deck_id, is_active FROM tactics_decks WHERE user_id = ? AND hero_id = ? ORDER BY created_at, rowid')
    .bind(userId, heroId)
    .all<StoredDeck>()
    .then((r) => r.results);

const deckExists = async (db: D1Database, userId: number, heroId: string, deckId: string) =>
  (await db.prepare('SELECT 1 AS x FROM tactics_decks WHERE user_id = ? AND hero_id = ? AND deck_id = ?').bind(userId, heroId, deckId).first()) !== null;

/**
 * A champion with no stored deck fights with its (virtual) starter deck. Before the first deck
 * operation that row becomes real, as the default. A plain INSERT: if a concurrent request
 * stored it first, this batch fails as a whole and the route retries on fresh rows.
 */
function materialize(ctx: DeckRouteContext, heroId: string, stored: StoredDeck[]): D1PreparedStatement[] {
  if (stored.length) return [];
  const { db, userId, now } = ctx;
  const deck = heroProfile(ctx.profile, heroId, ctx.content).decks[0]!;
  return [
    db
      .prepare('INSERT INTO tactics_decks (user_id, hero_id, deck_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .bind(userId, heroId, deck.id, deck.name, now, now),
    ...deckCardStatements(db, userId, heroId, deck.id, deck.cards),
  ];
}

/** Runs `build` against fresh rows; one retry when a concurrent request won a race on the batch. */
async function write(ctx: DeckRouteContext, heroId: string, build: (stored: StoredDeck[]) => D1PreparedStatement[]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const stored = await storedDecks(ctx.db, ctx.userId, heroId);
    try {
      await ctx.db.batch([...materialize(ctx, heroId, stored), ...build(stored), touch(ctx.db, ctx.userId, ctx.now)]);
      return;
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}

const newDeckId = (requestId: unknown): string | null => {
  if (requestId === undefined) return `d${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  return typeof requestId === 'string' && REQUEST_ID.test(requestId) ? `d${requestId}` : null;
};

/** Conditional insert of a deck row: only while the champion holds fewer than SLOTS decks. */
function insertDeck(ctx: DeckRouteContext, heroId: string, deckId: string, name: string): D1PreparedStatement {
  const { db, userId, now } = ctx;
  return db
    .prepare(
      `INSERT OR IGNORE INTO tactics_decks (user_id, hero_id, deck_id, name, is_active, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4,
              NOT EXISTS (SELECT 1 FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2 AND is_active = 1),
              ?5, ?5
       WHERE (SELECT count(*) FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2) < ?6`,
    )
    .bind(userId, heroId, deckId, name, now, SLOTS);
}

/** Card rows of `deckId`, written only if that deck row exists (it may have lost a race). */
const insertCardsIfDeck = (ctx: DeckRouteContext, heroId: string, deckId: string, cards: readonly DeckEntry[]) =>
  cards.map((e) =>
    ctx.db
      .prepare(
        `INSERT OR IGNORE INTO tactics_deck_cards (user_id, hero_id, deck_id, card_id, count)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2 AND deck_id = ?3)`,
      )
      .bind(ctx.userId, heroId, deckId, e.cardId, e.count),
  );

export async function deckRoute(method: string, path: string, ctx: DeckRouteContext): Promise<Response | null> {
  const m = path.match(/^\/api\/tactics\/decks\/([a-z0-9_-]{1,32})(?:\/([a-z0-9_-]{1,32}))?(?:\/(duplicate|default))?$/);
  if (!m) return null;
  const [, heroId, deckId, action] = m as unknown as [string, string, string | undefined, string | undefined];
  const { db, userId, content, body } = ctx;
  if (!content.heroes[heroId]) return error(422, 'UNKNOWN_CHAMPION', 'Campeón desconocido.');

  if (method === 'GET' && !deckId)
    return json({ decks: deckSummaries(ctx.profile, heroId, content, DECK_RULES), slots: SLOTS });

  // Every write: a released champion this account owns (a locked one keeps its decks unplayable).
  const locked = ctx.usable(heroId);
  if (locked) return locked;
  const hero = heroProfile(ctx.profile, heroId, content);
  const summaries = async () => {
    const fresh = await ctx.reload();
    return fresh ? deckSummaries(fresh, heroId, content, DECK_RULES) : [];
  };
  const done = async (id: string) => ctx.respond({ deckId: id, decks: await summaries() });

  // ── Create ────────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && !deckId) {
    const id = newDeckId(body.requestId);
    if (!id) return error(400, 'BAD_REQUEST', 'requestId inválido.');
    if (hero.decks.some((d) => d.id === id)) return done(id); // lost-response retry
    const name = body.name === undefined ? NEW_DECK_NAME : normalizeDeckName(body.name);
    if (!name) return error(422, 'INVALID_NAME', 'Nombre de mazo inválido.');
    let cards: DeckEntry[];
    if (body.cards === undefined) cards = starterDeck(content.heroes[heroId]!);
    else {
      const parsed = parseDeckCards(body.cards);
      if (!parsed) return error(400, 'BAD_REQUEST', 'Lista de cartas inválida.');
      const issues = validateDeck(parsed, heroId, ownedFor(ctx.profile, heroId, content), content, DECK_RULES);
      if (issues.length) return error(422, 'INVALID_DECK', 'El mazo no es válido.', { issues });
      cards = parsed;
    }
    if (hero.decks.length >= SLOTS) return slotsFull();
    await write(ctx, heroId, () => [insertDeck(ctx, heroId, id, name), ...insertCardsIfDeck(ctx, heroId, id, cards)]);
    if (!(await deckExists(db, userId, heroId, id))) return slotsFull();
    return done(id);
  }

  if (!deckId) return error(405, 'BAD_METHOD', 'Método no permitido.');
  const source = hero.decks.find((d) => d.id === deckId);

  // ── Duplicate ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && action === 'duplicate') {
    const id = newDeckId(body.requestId);
    if (!id) return error(400, 'BAD_REQUEST', 'requestId inválido.');
    if (hero.decks.some((d) => d.id === id)) return done(id); // lost-response retry
    if (!source) return unknownDeck();
    if (hero.decks.length >= SLOTS) return slotsFull();
    // Same cards as the source, copied as the server holds them (never a client list).
    await write(ctx, heroId, () => [insertDeck(ctx, heroId, id, copyName(source.name)), ...insertCardsIfDeck(ctx, heroId, id, source.cards)]);
    if (!(await deckExists(db, userId, heroId, id))) return slotsFull();
    return done(id);
  }

  if (!source) return unknownDeck();
  const where = 'user_id = ? AND hero_id = ? AND deck_id = ?';

  // ── Make default ──────────────────────────────────────────────────────────────────────
  if (method === 'PUT' && action === 'default') {
    // Two statements in one transaction: clear the others, then mark this one. Two concurrent
    // calls serialise; the last one wins and exactly one default remains (unique index 0028).
    await write(ctx, heroId, () => [
      db
        .prepare(`UPDATE tactics_decks SET is_active = 0 WHERE user_id = ?1 AND hero_id = ?2 AND deck_id <> ?3
                  AND EXISTS (SELECT 1 FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2 AND deck_id = ?3)`)
        .bind(userId, heroId, deckId),
      db.prepare(`UPDATE tactics_decks SET is_active = 1 WHERE ${where}`).bind(userId, heroId, deckId),
    ]);
    if (!(await deckExists(db, userId, heroId, deckId))) return unknownDeck();
    return done(deckId);
  }

  if (action) return error(405, 'BAD_METHOD', 'Método no permitido.');

  // ── Rename ────────────────────────────────────────────────────────────────────────────
  if (method === 'PATCH') {
    const name = normalizeDeckName(body.name);
    if (!name) return error(422, 'INVALID_NAME', 'Nombre de mazo inválido.');
    await write(ctx, heroId, () => [db.prepare(`UPDATE tactics_decks SET name = ?, updated_at = ? WHERE ${where}`).bind(name, ctx.now, userId, heroId, deckId)]);
    if (!(await deckExists(db, userId, heroId, deckId))) return unknownDeck();
    return done(deckId);
  }

  // ── Edit cards (+ optional name) ─────────────────────────────────────────────────────
  if (method === 'PUT') {
    const cards = parseDeckCards(body.cards);
    if (!cards) return error(400, 'BAD_REQUEST', 'Lista de cartas inválida.');
    const name = body.name === undefined ? source.name : normalizeDeckName(body.name);
    if (!name) return error(422, 'INVALID_NAME', 'Nombre de mazo inválido.');
    // Same rules as the Deck Builder, against the collection the SERVER holds.
    const issues = validateDeck(cards, heroId, ownedFor(ctx.profile, heroId, content), content, DECK_RULES);
    if (issues.length) return error(422, 'INVALID_DECK', 'El mazo no es válido.', { issues });
    await write(ctx, heroId, () => [
      db.prepare(`DELETE FROM tactics_deck_cards WHERE ${where}`).bind(userId, heroId, deckId),
      ...insertCardsIfDeck(ctx, heroId, deckId, cards),
      db.prepare(`UPDATE tactics_decks SET name = ?, updated_at = ? WHERE ${where}`).bind(name, ctx.now, userId, heroId, deckId),
    ]);
    if (!(await deckExists(db, userId, heroId, deckId))) return unknownDeck();
    return done(deckId);
  }

  // ── Delete ────────────────────────────────────────────────────────────────────────────
  if (method === 'DELETE') {
    if (hero.decks.length <= 1) return lastDeck();
    await write(ctx, heroId, () => [
      // Never the last deck, even if two deletes race (the count is read inside the statement).
      db
        .prepare(`DELETE FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2 AND deck_id = ?3
                  AND (SELECT count(*) FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2) > 1`)
        .bind(userId, heroId, deckId),
      // Deleting the default promotes the oldest remaining deck (same order as the summaries).
      db
        .prepare(`UPDATE tactics_decks SET is_active = 1 WHERE user_id = ?1 AND hero_id = ?2
                  AND deck_id = (SELECT deck_id FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2 ORDER BY created_at, rowid LIMIT 1)
                  AND NOT EXISTS (SELECT 1 FROM tactics_decks WHERE user_id = ?1 AND hero_id = ?2 AND is_active = 1)`)
        .bind(userId, heroId),
    ]);
    if (await deckExists(db, userId, heroId, deckId)) return lastDeck();
    const fresh = await ctx.reload();
    return done(fresh ? heroProfile(fresh, heroId, content).activeDeckId : deckId);
  }

  return error(405, 'BAD_METHOD', 'Método no permitido.');
}

const unknownDeck = () => error(404, 'UNKNOWN_DECK', 'Ese mazo no existe.');
const slotsFull = () => error(409, 'DECK_LIMIT', `Ya tienes ${SLOTS} mazos para este campeón.`, { slots: SLOTS });
const lastDeck = () => error(409, 'LAST_DECK', 'Un campeón necesita al menos un mazo.');
