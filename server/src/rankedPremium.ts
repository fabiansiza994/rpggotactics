import { RANKED_SEASON } from '../../src/game/ranked/ranked';
import {
  PREMIUM_SHOWCASE_NODE,
  RANKED_PREMIUM,
  isPremiumShowcaseChoice,
  rankedPremiumGrantTable,
  rankedPremiumView,
  type PremiumTrackInput,
} from '../../src/game/ranked/premiumTrack';
import type { D1Database, D1PreparedStatement, Env } from './db';
import { error, json } from './http';

/**
 * Ranked Premium Track (migration 0027). Identity is always the session caller; the client sends
 * only an idempotency key (purchase) or a card id (Showcase). Price, season, peak RP, ownership and
 * every grant are decided here from D1.
 *
 *   GET  /api/tactics/ranked/premium            PREMIUM row view (reconciles first)
 *   POST /api/tactics/ranked/premium/purchase   { idempotencyKey, seasonId? } buy the pass (600)
 *   POST /api/tactics/ranked/premium/showcase   { cardId } the one Diamante I Showcase
 *
 * Grants: ONE statement per account inserts every premium reward the PEAK RP reaches, only with
 * that season's pass, guarded by the (user, season, reward) PRIMARY KEY. It runs in the purchase
 * batch (retroactive, same transaction as the payment), in PvPMatchRoom.recordResult's batch and
 * as an idempotent reconcile on reads.
 */

const QA_USERS = ['tactics_qa_a', 'tactics_qa_b'];
/** Table present (migration 0027 applied): the only condition for the server-side statements. */
export const premiumConfigured = (env: Pick<Env, 'RANKED_PREMIUM_ENABLED' | 'RANKED_PREMIUM_QA'>) =>
  env.RANKED_PREMIUM_ENABLED === '1' || env.RANKED_PREMIUM_QA === '1';
/** RANKED_PREMIUM_ENABLED="1" opens it; RANKED_PREMIUM_QA="1" only for the QA accounts. Ranked must be open too. */
export const premiumAllowed = (env: Env, username: string) =>
  env.RANKED_PREMIUM_ENABLED === '1' || (env.RANKED_PREMIUM_QA === '1' && QA_USERS.includes(username));

const GRANT_TABLE = JSON.stringify(rankedPremiumGrantTable());
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export function premiumGrantStatement(db: D1Database, userId: number, matchId: string, now: number): D1PreparedStatement {
  const season = RANKED_PREMIUM.seasonId;
  return db
    .prepare(
      `INSERT INTO tactics_ranked_premium_rewards (user_id, season_id, reward_id, node_id, reward_type, item_id, hero_id, item_kind, quantity, granted, required_rp, match_id, granted_at)
       SELECT ?, ?, json_extract(r.value, '$.rewardId'), json_extract(r.value, '$.nodeId'), json_extract(r.value, '$.type'),
              json_extract(r.value, '$.itemId'), json_extract(r.value, '$.heroId'), json_extract(r.value, '$.itemKind'),
              json_extract(r.value, '$.quantity'),
              CASE WHEN json_extract(r.value, '$.type') = 'CARD'
                   THEN MAX(0, json_extract(r.value, '$.quantity') - COALESCE((SELECT copies FROM tactics_player_cards
                          WHERE user_id = ? AND hero_id = json_extract(r.value, '$.heroId') AND card_id = json_extract(r.value, '$.itemId')), 0))
                   ELSE json_extract(r.value, '$.quantity') END,
              json_extract(r.value, '$.requiredRp'), ?, ?
       FROM json_each(?) r
       WHERE EXISTS (SELECT 1 FROM tactics_ranked_premium_passes WHERE user_id = ? AND season_id = ?)
         -- No ranked history = 0 RP (Hierro III, 0 RP, is reached on purchase, as the view shows).
         AND COALESCE((SELECT MAX(rp_after) FROM tactics_ranked_results WHERE user_id = ? AND season_id = ?), 0) >= json_extract(r.value, '$.requiredRp')
       ON CONFLICT (user_id, season_id, reward_id) DO NOTHING`,
    )
    .bind(userId, season, userId, matchId, now, GRANT_TABLE, userId, season, userId, season);
}

/** Both seats of a finished ranked match (after the RP rows; grants only to pass holders). */
export const premiumResultStatements = (db: D1Database, players: [number, number], matchId: string, finishedAt: number) =>
  players.map((id) => premiumGrantStatement(db, id, matchId, finishedAt));

export async function reconcilePremium(db: D1Database, userId: number, now: number): Promise<void> {
  await premiumGrantStatement(db, userId, 'RECONCILE', now).run();
}

async function peakRp(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(rp_after) AS peak FROM tactics_ranked_results WHERE user_id = ? AND season_id = ?')
    .bind(userId, RANKED_PREMIUM.seasonId)
    .first<{ peak: number | null }>();
  return row?.peak ?? 0;
}

interface PassRow {
  idempotency_key: string;
  purchased_at: number;
}
const passRow = (db: D1Database, userId: number) =>
  db
    .prepare('SELECT idempotency_key, purchased_at FROM tactics_ranked_premium_passes WHERE user_id = ? AND season_id = ?')
    .bind(userId, RANKED_PREMIUM.seasonId)
    .first<PassRow>();
const balanceOf = async (db: D1Database, userId: number) =>
  (
    await db
      .prepare('SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = ?')
      .bind(userId, RANKED_PREMIUM.currencyId)
      .first<{ balance: number }>()
  )?.balance ?? 0;

export async function premiumInput(db: D1Database, userId: number): Promise<PremiumTrackInput> {
  const season = RANKED_PREMIUM.seasonId;
  const [player, peak, pass, granted, showcase] = await Promise.all([
    db.prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ? AND season_id = ?').bind(userId, season).first<{ rp: number }>(),
    peakRp(db, userId),
    passRow(db, userId),
    db
      .prepare('SELECT reward_id, granted, granted_at FROM tactics_ranked_premium_rewards WHERE user_id = ? AND season_id = ?')
      .bind(userId, season)
      .all<{ reward_id: string; granted: number; granted_at: number }>(),
    db
      .prepare('SELECT card_id, chosen_at FROM tactics_ranked_premium_showcase WHERE user_id = ? AND season_id = ?')
      .bind(userId, season)
      .first<{ card_id: string; chosen_at: number }>(),
  ]);
  return {
    rp: player?.rp ?? 0,
    peakRp: peak,
    pass: pass ? { purchasedAt: pass.purchased_at } : null,
    granted: Object.fromEntries(granted.results.map((g) => [g.reward_id, { grantedAt: g.granted_at, copies: g.granted }])),
    showcase: showcase ? { cardId: showcase.card_id, chosenAt: showcase.chosen_at } : null,
  };
}

export async function premiumView(db: D1Database, userId: number, now: number) {
  await reconcilePremium(db, userId, now);
  return rankedPremiumView(await premiumInput(db, userId));
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const raw = await request.text();
    if (raw.length > 1024) return error(413, 'TOO_LARGE', 'Solicitud demasiado grande.');
    const body = JSON.parse(raw || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : error(400, 'BAD_REQUEST', 'Cuerpo inválido.');
  } catch {
    return error(400, 'BAD_REQUEST', 'Cuerpo inválido.');
  }
}

/** Rewards the purchase itself granted (retroactive), for the reveal. Own rows only. */
const purchaseGrants = async (db: D1Database, userId: number) =>
  (
    await db
      .prepare("SELECT reward_id, reward_type, item_id, hero_id, quantity, granted FROM tactics_ranked_premium_rewards WHERE user_id = ? AND season_id = ? AND match_id = 'PURCHASE' ORDER BY required_rp, reward_id")
      .bind(userId, RANKED_PREMIUM.seasonId)
      .all<{ reward_id: string; reward_type: string; item_id: string; hero_id: string | null; quantity: number; granted: number }>()
  ).results.map((r) => ({ rewardId: r.reward_id, type: r.reward_type, itemId: r.item_id, heroId: r.hero_id, quantity: r.quantity, granted: r.granted }));

async function purchase(db: D1Database, userId: number, body: Record<string, unknown>, now: number): Promise<Response> {
  const key = body.idempotencyKey;
  if (typeof key !== 'string' || !KEY.test(key)) return error(400, 'BAD_IDEMPOTENCY_KEY', 'Falta una clave de compra válida.');
  // The pass belongs to the LIVE season only; a client on a stale season never buys the wrong one.
  if (RANKED_PREMIUM.seasonId !== RANKED_SEASON.id) return error(409, 'SEASON_CLOSED', 'El pase de esta temporada ya no está a la venta.');
  if (body.seasonId !== undefined && body.seasonId !== RANKED_SEASON.id) return error(409, 'SEASON_MISMATCH', 'La temporada cambió. Actualiza la pantalla.');

  const answer = async (pass: PassRow, status: 'PURCHASED' | 'REPLAYED') =>
    pass.idempotency_key === key
      ? json({ status, balance: await balanceOf(db, userId), granted: await purchaseGrants(db, userId), premium: await premiumView(db, userId, now) })
      : error(409, 'ALREADY_PURCHASED', 'Ya tienes el Pase Premium de esta temporada.');

  const existing = await passRow(db, userId);
  if (existing) return answer(existing, 'REPLAYED');
  const balance = await balanceOf(db, userId);
  if (balance < RANKED_PREMIUM.price) return error(409, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente.', { balance, price: RANKED_PREMIUM.price });
  try {
    // Payment (pass row → ledger debit trigger) + every reward the peak already reached, atomically.
    await db.batch([
      db
        .prepare('INSERT INTO tactics_ranked_premium_passes (user_id, season_id, price, currency_id, idempotency_key, purchased_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, RANKED_PREMIUM.seasonId, RANKED_PREMIUM.price, RANKED_PREMIUM.currencyId, key, now),
      premiumGrantStatement(db, userId, 'PURCHASE', now),
    ]);
  } catch (e) {
    // A concurrent request won the row (PK) or spent the balance first (ledger CHECK): answer from the truth.
    const raced = await passRow(db, userId);
    if (raced) return answer(raced, 'REPLAYED');
    const after = await balanceOf(db, userId);
    if (after < RANKED_PREMIUM.price) return error(409, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente.', { balance: after, price: RANKED_PREMIUM.price });
    throw e;
  }
  return answer((await passRow(db, userId))!, 'PURCHASED');
}

async function chooseShowcase(db: D1Database, userId: number, body: Record<string, unknown>, now: number): Promise<Response> {
  const cardId = body.cardId;
  if (!isPremiumShowcaseChoice(cardId)) return error(422, 'UNKNOWN_SHOWCASE', 'Esa carta no tiene Showcase en el pase.');
  if (!(await passRow(db, userId))) return error(403, 'PREMIUM_REQUIRED', 'Necesitas el Pase Premium de esta temporada.');
  await db
    .prepare(
      `INSERT INTO tactics_ranked_premium_showcase (user_id, season_id, card_id, chosen_at)
       SELECT ?, ?, ?, ? WHERE COALESCE((SELECT MAX(rp_after) FROM tactics_ranked_results WHERE user_id = ? AND season_id = ?), -1) >= ?
       ON CONFLICT (user_id, season_id) DO NOTHING`,
    )
    .bind(userId, RANKED_PREMIUM.seasonId, cardId, now, userId, RANKED_PREMIUM.seasonId, PREMIUM_SHOWCASE_NODE.requiredRp)
    .run();
  const row = await db
    .prepare('SELECT card_id FROM tactics_ranked_premium_showcase WHERE user_id = ? AND season_id = ?')
    .bind(userId, RANKED_PREMIUM.seasonId)
    .first<{ card_id: string }>();
  if (!row) return error(403, 'SHOWCASE_LOCKED', 'Alcanza Diamante I para elegir tu Showcase.');
  // Same pick again = idempotent success; a different pick never replaces the first.
  if (row.card_id !== cardId) return error(409, 'SHOWCASE_ALREADY_CHOSEN', 'Ya elegiste tu Showcase de esta temporada.', { chosenCardId: row.card_id });
  return json({ chosenCardId: row.card_id, premium: await premiumView(db, userId, now) });
}

/** Sub-routes of /api/tactics/ranked/premium (the caller already passed rankedAllowed). */
export async function premiumRoute(route: string, request: Request, env: Env, caller: { userId: number; username: string }, now: number): Promise<Response> {
  if (!premiumAllowed(env, caller.username)) {
    if (route === 'GET premium') return json({ enabled: false });
    return error(403, 'PREMIUM_DISABLED', 'El Pase Premium todavía no está disponible.');
  }
  const db = env.DB;
  if (route === 'GET premium') return json({ enabled: true, premium: await premiumView(db, caller.userId, now) });
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (route === 'POST premium/purchase') return purchase(db, caller.userId, body, now);
  return chooseShowcase(db, caller.userId, body, now);
}

export const PREMIUM_ROUTES = ['GET premium', 'POST premium/purchase', 'POST premium/showcase'];
