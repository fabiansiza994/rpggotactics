/**
 * Builds the SQL that creates or updates ONE promo code (admin tooling, no API). Kept separate
 * from promo-code.mjs so tests run the exact statement against the real migration.
 *
 * Safety: the code must already be in normalised form (A-Z0-9, 4–32), the reward must be one of
 * the known shapes with bounded amounts, and every value is validated before it is interpolated.
 * Content checks (does the card exist / is it released) happen again at every redemption, so a
 * code naming missing content can never grant it. Updating a code never touches `uses`.
 */
export const PROMO_CODE = /^[A-Z0-9]{4,32}$/;
const ID = /^[a-z0-9_]{1,64}$/;
const MAX_CRYSTALS = 10_000;
const MAX_ITEMS = 8;

function checkItem(i) {
  if (typeof i !== 'object' || i === null) throw new Error('Reward item must be an object.');
  if (i.type === 'ARCANE_CRYSTALS') {
    if (!Number.isInteger(i.amount) || i.amount < 1 || i.amount > MAX_CRYSTALS) throw new Error(`Crystals must be 1..${MAX_CRYSTALS}.`);
    return { type: i.type, amount: i.amount };
  }
  if (i.type === 'CARD') {
    if (!ID.test(i.cardId ?? '') || !Number.isInteger(i.copies) || i.copies < 1 || i.copies > 3) throw new Error('Bad card reward.');
    return { type: i.type, cardId: i.cardId, copies: i.copies };
  }
  if (i.type === 'COSMETIC') {
    if (!ID.test(i.cosmeticId ?? '')) throw new Error('Bad cosmetic reward.');
    return { type: i.type, cosmeticId: i.cosmeticId };
  }
  throw new Error(`Unknown reward type ${String(i.type)}.`);
}

/** Validated, canonical reward JSON (unknown fields dropped). */
export function promoRewardJson(reward) {
  if (reward?.type === 'MULTI') {
    if (!Array.isArray(reward.items) || reward.items.length < 1 || reward.items.length > MAX_ITEMS) throw new Error(`MULTI needs 1..${MAX_ITEMS} items.`);
    return JSON.stringify({ type: 'MULTI', items: reward.items.map(checkItem) });
  }
  return JSON.stringify(checkItem(reward));
}

const intOrNull = (v, name) => {
  if (v === null || v === undefined) return 'NULL';
  if (!Number.isInteger(v) || v < 0) throw new Error(`${name} must be a non-negative integer (ms) or null.`);
  return String(v);
};

/**
 * INSERT a new code, or UPDATE an existing one's reward/active flag/window/global limit
 * (`uses` is kept). `note` is admin-only text (never sent to players).
 */
export function promoCodeSql({ code, reward, active = true, startsAt = null, expiresAt = null, maxGlobalUses = null, note = null, now }) {
  if (!PROMO_CODE.test(code ?? '')) throw new Error('Code must be normalised: A-Z and 0-9, 4..32 characters.');
  if (!Number.isInteger(now)) throw new Error('Bad timestamp.');
  if (maxGlobalUses !== null && (!Number.isInteger(maxGlobalUses) || maxGlobalUses < 1)) throw new Error('maxGlobalUses must be >= 1 or null.');
  if (startsAt !== null && expiresAt !== null && expiresAt <= startsAt) throw new Error('expiresAt must be after startsAt.');
  if (note !== null && (typeof note !== 'string' || note.length > 200)) throw new Error('Note must be text up to 200 characters.');
  const json = promoRewardJson(reward).replaceAll("'", "''");
  const text = note === null ? 'NULL' : `'${note.replaceAll("'", "''")}'`;
  const values = `'${code}', ${active ? 1 : 0}, ${intOrNull(startsAt, 'startsAt')}, ${intOrNull(expiresAt, 'expiresAt')}, ${maxGlobalUses ?? 'NULL'}, '${json}', ${text}, ${now}, ${now}`;
  return `INSERT INTO tactics_promo_codes (code, is_active, starts_at, expires_at, max_global_uses, reward_json, note, created_at, updated_at)
VALUES (${values})
ON CONFLICT (code) DO UPDATE SET is_active = excluded.is_active, starts_at = excluded.starts_at, expires_at = excluded.expires_at,
  max_global_uses = excluded.max_global_uses, reward_json = excluded.reward_json, note = excluded.note, updated_at = excluded.updated_at;`;
}
