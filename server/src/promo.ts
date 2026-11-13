import {
  DECK_RULES,
  describePromoGrant,
  normalizePromoCode,
  parsePromoReward,
  planPromoReward,
  PREMIUM_CURRENCY_ID,
  PROMO_RESULT_LABEL,
  type PromoContext,
  type PromoGrant,
  type PromoResult,
} from '../../src/game';
import type { D1Database, D1PreparedStatement } from './db';
import { error, json } from './http';
import { loadPlayer } from './repo';
import { cardInventoryGuards, cardGrantStatements, ledgerStatement, ownership, walletView, type StoreRequest } from './store';

/**
 * Gift / promo codes: POST /api/tactics/store/promo/redeem { code }. The body's `code` is the
 * ONLY input read: user id comes from the session, the reward from D1. One redemption is one D1
 * batch — redemption row (unique per account; its triggers re-check active/window and count the
 * global cap) + ledger credit + card/cosmetic grants + a final integrity guard — all or nothing.
 */

/** Redeem attempts allowed per account per window (successes and failures alike). */
export const PROMO_RATE = { attempts: 8, windowMs: 60_000 } as const;
/** Attempt rows (rate limit + short audit of failures) older than this are pruned. */
const ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface CodeRow {
  id: number;
  code: string;
  is_active: number;
  starts_at: number | null;
  expires_at: number | null;
  max_global_uses: number | null;
  uses: number;
  reward_json: string;
}

interface RedemptionRow {
  reward_json: string;
  redeemed_at: number;
}

const STATUS: Record<Exclude<PromoResult, 'SUCCESS'>, number> = {
  INVALID_CODE: 404,
  ALREADY_REDEEMED: 409,
  EXPIRED: 410,
  NOT_STARTED: 409,
  INACTIVE: 410,
  GLOBAL_LIMIT_REACHED: 410,
  CARD_AT_CAP: 409,
  ALREADY_OWNED: 409,
  REWARD_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
};

const fail = (result: Exclude<PromoResult, 'SUCCESS'>, extra: Record<string, unknown> = {}) =>
  error(STATUS[result], result, PROMO_RESULT_LABEL[result], { result, ...extra });

const codeByText = (db: D1Database, code: string) =>
  db
    .prepare('SELECT id, code, is_active, starts_at, expires_at, max_global_uses, uses, reward_json FROM tactics_promo_codes WHERE code = ?')
    .bind(code)
    .first<CodeRow>();

const redemptionOf = (db: D1Database, userId: number, codeId: number) =>
  db
    .prepare('SELECT reward_json, redeemed_at FROM tactics_promo_redemptions WHERE user_id = ? AND promo_code_id = ?')
    .bind(userId, codeId)
    .first<RedemptionRow>();

/** Why a code cannot be redeemed right now, independent of the player (null = redeemable). */
function codeState(row: CodeRow, now: number): Exclude<PromoResult, 'SUCCESS'> | null {
  if (!row.is_active) return 'INACTIVE';
  if (row.starts_at !== null && now < row.starts_at) return 'NOT_STARTED';
  if (row.expires_at !== null && now >= row.expires_at) return 'EXPIRED';
  if (row.max_global_uses !== null && row.uses >= row.max_global_uses) return 'GLOBAL_LIMIT_REACHED';
  return null;
}

function redemptionStatements(
  r: StoreRequest,
  row: CodeRow,
  grant: PromoGrant,
  ids: { redemptionId: string; transactionId: string | null },
): D1PreparedStatement[] {
  const { db, userId, now } = r;
  const out: D1PreparedStatement[] = [
    // First: the receipt. UNIQUE (user_id, promo_code_id) = one use per account; its triggers
    // abort if the code stopped being redeemable and count the use against the global cap.
    db
      .prepare(
        `INSERT INTO tactics_promo_redemptions (redemption_id, promo_code_id, user_id, code, status, reward_json, transaction_id, redeemed_at)
         VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      )
      .bind(ids.redemptionId, row.id, userId, row.code, JSON.stringify(grant), ids.transactionId, now),
  ];
  if (grant.crystals > 0)
    out.push(
      ledgerStatement(db, {
        transactionId: ids.transactionId!,
        userId,
        currencyId: PREMIUM_CURRENCY_ID,
        delta: grant.crystals,
        reason: 'PROMO_GRANT',
        referenceId: ids.redemptionId,
        note: row.code,
        now,
      }),
    );
  out.push(...cardGrantStatements(db, userId, r.record, r.content, grant.cards, 'PROMO_CODE', now));
  for (const c of grant.cosmetics)
    out.push(
      db
        .prepare("INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, reference_id, acquired_at) VALUES (?, ?, ?, 'PROMO_CODE', ?, ?)")
        .bind(userId, c.cosmeticId, c.kind, ids.redemptionId, now),
    );
  // Last: inventory integrity re-checked inside the transaction (a concurrent grant may have added copies).
  const { guards, binds } = cardInventoryGuards(userId, r.content, grant.cards);
  if (guards.length)
    out.push(
      db
        .prepare(`UPDATE tactics_promo_redemptions SET status = CASE WHEN ${guards.join(' AND ')} THEN status ELSE NULL END WHERE redemption_id = ?`)
        .bind(...binds, ids.redemptionId),
    );
  out.push(db.prepare('UPDATE tactics_profiles SET updated_at = ? WHERE user_id = ?').bind(now, userId));
  return out;
}

/** Promo route; null = not this route. */
export async function promoRoute(route: string, r: StoreRequest): Promise<Response | null> {
  if (route !== 'POST /api/tactics/store/promo/redeem') return null;
  const { db, userId, now } = r;

  // Rate limit per account (the endpoint needs a session; account creation is itself limited
  // per IP by the auth Worker). Normal typos never lock anyone out beyond the window.
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM tactics_promo_attempts WHERE user_id = ? AND created_at > ?')
    .bind(userId, now - PROMO_RATE.windowMs)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PROMO_RATE.attempts) return fail('RATE_LIMITED', { retryAfterMs: PROMO_RATE.windowMs });

  const code = normalizePromoCode(r.body.code);
  const audit = (result: PromoResult) =>
    db.batch([
      db.prepare('DELETE FROM tactics_promo_attempts WHERE user_id = ? AND created_at < ?').bind(userId, now - ATTEMPT_RETENTION_MS),
      db.prepare('INSERT INTO tactics_promo_attempts (user_id, code, result, created_at) VALUES (?, ?, ?, ?)').bind(userId, code, result, now),
    ]);
  const reject = async (result: Exclude<PromoResult, 'SUCCESS'>, extra: Record<string, unknown> = {}) => {
    await audit(result);
    return fail(result, extra);
  };
  const ctx: PromoContext = {
    content: r.content,
    rules: DECK_RULES,
    cosmetics: r.store.cosmetics,
    heroAllowed: r.heroAllowed,
  };
  const describe = (grant: PromoGrant) => ({ items: describePromoGrant(grant, r.content, r.store.cosmetics) });

  if (!code) return reject('INVALID_CODE');
  const row = await codeByText(db, code);
  if (!row) return reject('INVALID_CODE');

  // Already redeemed by this account: a retry, a double click or a repeat. Answer consistently,
  // with what that redemption granted (the caller's own data), and never grant again.
  const previous = await redemptionOf(db, userId, row.id);
  if (previous) return reject('ALREADY_REDEEMED', { promoCode: code, reward: describe(JSON.parse(previous.reward_json) as PromoGrant) });

  const blocked = codeState(row, now);
  if (blocked) return reject(blocked);

  const reward = parsePromoReward(safeJson(row.reward_json));
  if (!reward) return reject('REWARD_UNAVAILABLE');
  const plan = async (record = r.record) => planPromoReward(reward, await ownership(db, userId, record, r.content), ctx);
  const planned = await plan();
  if (!planned.ok) return reject(planned.reason);

  const redemptionId = `prm_${r.store.newId()}`;
  try {
    await db.batch(
      redemptionStatements(r, row, planned.grant, {
        redemptionId,
        transactionId: planned.grant.crystals > 0 ? `txn_${r.store.newId()}` : null,
      }),
    );
  } catch {
    // Rolled back entirely. Same account won a concurrent race → ALREADY_REDEEMED; otherwise the
    // code or the collection changed under us → report it from fresh state.
    const raced = await redemptionOf(db, userId, row.id);
    if (raced) return reject('ALREADY_REDEEMED', { promoCode: code, reward: describe(JSON.parse(raced.reward_json) as PromoGrant) });
    const fresh = await codeByText(db, code);
    const state = fresh ? codeState(fresh, now) : 'INVALID_CODE';
    if (state) return reject(state);
    const record = await loadPlayer(db, userId, r.content);
    const again = record ? await plan(record) : null;
    if (again && !again.ok) return reject(again.reason);
    return reject('REWARD_UNAVAILABLE');
  }
  await audit('SUCCESS');
  return json({
    ...(await r.state()),
    success: true,
    result: 'SUCCESS',
    code,
    reward: describe(planned.grant),
    wallet: await walletView(db, userId),
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
