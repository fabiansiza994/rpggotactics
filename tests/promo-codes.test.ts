import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkPromoReward,
  COSMETICS,
  DECK_RULES,
  DEFAULT_CONTENT,
  normalizePromoCode,
  parsePromoReward,
  RITUAL_EXPANSION,
  type PlayerProfile,
} from '../src/game';
import { handle } from '../server/src/index';
import { PROMO_RATE } from '../server/src/promo';
import { promoCodeSql } from '../server/scripts/promo-code-sql.mjs';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

type Body = {
  success?: boolean;
  result?: string;
  code?: string;
  reward?: { items: { kind: string; id: string; label: string; amount: number }[] };
  wallet: { balance: number };
  profile: PlayerProfile;
  error?: { code: string; result: string; message: string; reward?: { items: { label: string }[] } };
};

const NOW = 1_800_000_000_000;
let now = NOW;
let ids = 0;
let db: ReturnType<typeof memoryD1>;
/** Production release state: Warrior and the ritual set are public. */
const RELEASED: Partial<Env> = { WARRIOR_ENABLED: '1', SUMMONER_RITUALS_ENABLED: '1' };
const deps = () => ({
  content: DEFAULT_CONTENT,
  now: () => now,
  seed: () => 7,
  store: { catalog: [], cosmetics: COSMETICS, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
});

async function call(token: string | null, method: string, path: string, body?: unknown, env: Partial<Env> = RELEASED) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db, ...env }, deps());
  return { status: res.status, body: (await res.json()) as Body };
}
const redeem = (token: string | null, code: unknown, extra: Record<string, unknown> = {}, env?: Partial<Env>) =>
  call(token, 'POST', '/store/promo/redeem', { code, ...extra }, env);

async function player(username = 'tactics_qa_a') {
  const account = addAccount(db, username);
  await call(account.token, 'POST', '/profile', {});
  return account;
}
const balance = async (token: string) => (await call(token, 'GET', '/wallet')).body.wallet.balance;
const copies = (profile: PlayerProfile, heroId: string, cardId: string) => profile.heroes[heroId]!.collection[cardId]?.copies ?? 0;
const uses = (code: string) => (db.sql.prepare('SELECT uses FROM tactics_promo_codes WHERE code = ?').get(code) as { uses: number }).uses;
const redemptions = (userId: number) =>
  db.sql.prepare('SELECT code, reward_json FROM tactics_promo_redemptions WHERE user_id = ? ORDER BY redeemed_at').all(userId) as {
    code: string;
    reward_json: string;
  }[];
function addCode(code: string, reward: unknown, patch: { active?: 0 | 1; starts?: number | null; expires?: number | null; max?: number | null } = {}) {
  db.sql
    .prepare(
      'INSERT INTO tactics_promo_codes (code, is_active, starts_at, expires_at, max_global_uses, reward_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
    )
    .run(code, patch.active ?? 1, patch.starts ?? null, patch.expires ?? null, patch.max ?? null, JSON.stringify(reward));
}
/** Owns `n` copies of a card, as a previous grant would have stored them. */
function own(userId: number, heroId: string, cardId: string, n: number) {
  db.sql
    .prepare(
      `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, 99, 'QA_BALANCE', 0)
       ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = excluded.copies`,
    )
    .run(userId, heroId, cardId, n);
}

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  now = NOW;
});

describe('code text', () => {
  it('normalises case, spaces, hyphens and underscores consistently', () => {
    expect(normalizePromoCode(' war-dragon ')).toBe('WARDRAGON');
    expect(normalizePromoCode('War_Dragon')).toBe('WARDRAGON');
    expect(normalizePromoCode('welcome 30')).toBe('WELCOME30');
  });
  it('rejects malformed, SQL-like, unicode, too short and oversized input', () => {
    for (const bad of ["WELCOME30'; DROP TABLE users;--", 'WELC0ME30🎁', 'ÑANDU2026', 'abc', 'A'.repeat(33), 'A'.repeat(200), '', 42, null, { code: 'X' }])
      expect(normalizePromoCode(bad)).toBeNull();
  });
});

describe('reward payloads', () => {
  it('only accepts the known shapes and drops unknown fields', () => {
    expect(parsePromoReward({ type: 'ARCANE_CRYSTALS', amount: 300, userId: 9 })).toEqual({ type: 'ARCANE_CRYSTALS', amount: 300 });
    for (const bad of [
      { type: 'ARCANE_CRYSTALS', amount: -5 },
      { type: 'ARCANE_CRYSTALS', amount: 1e9 },
      { type: 'CARD', cardId: 'execution', copies: 0 },
      { type: 'GOLD', amount: 5 },
      { type: 'MULTI', items: [] },
      { type: 'MULTI', items: [{ type: 'MULTI', items: [] }] },
      { type: 'MULTI', items: [{ type: 'ARCANE_CRYSTALS', amount: 1 }, { type: 'ARCANE_CRYSTALS', amount: 1 }] },
    ])
      expect(parsePromoReward(bad)).toBeNull();
  });

  it('every seeded code names real, released content; FOUNDERSGIFT is inactive and ungrantable', () => {
    const content = { ...DEFAULT_CONTENT, releasedExpansions: [RITUAL_EXPANSION] };
    const rows = db.sql.prepare('SELECT code, is_active, reward_json, max_global_uses, starts_at, expires_at FROM tactics_promo_codes ORDER BY id').all() as {
      code: string;
      is_active: number;
      reward_json: string;
    }[];
    expect(rows.map((r) => r.code)).toEqual(['WELCOME30', 'TACTICS100', 'WARDRAGON', 'WARRIOROATH', 'ARCANEGIFT', 'RITUALSTART', 'FRIENDS2026', 'THANKYOU', 'FOUNDERSGIFT']);
    for (const r of rows) {
      const reward = parsePromoReward(JSON.parse(r.reward_json));
      expect(reward, r.code).not.toBeNull();
      expect(checkPromoReward(reward!, { content, rules: DECK_RULES, cosmetics: COSMETICS }), r.code).toBe(r.code !== 'FOUNDERSGIFT');
      expect(r.is_active, r.code).toBe(r.code === 'FOUNDERSGIFT' ? 0 : 1);
    }
    // No legendary ritual piece in the ritual starter.
    expect(rows.find((r) => r.code === 'RITUALSTART')!.reward_json).not.toMatch(/seal_|primordial/);
  });
});

describe('redeem', () => {
  it('WELCOME30 credits 300 crystals through an audited PROMO_GRANT ledger row', async () => {
    const { token, id } = await player();
    const res = await redeem(token, ' welcome-30 ');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, result: 'SUCCESS', code: 'WELCOME30', wallet: { balance: 300 } });
    expect(res.body.reward!.items).toEqual([{ kind: 'CURRENCY', id: 'arcane_crystals', label: '300 Cristales Arcanos', amount: 300 }]);
    const ledger = db.sql.prepare('SELECT reason, amount_delta, balance_before, balance_after, reference_id, note FROM tactics_wallet_ledger WHERE user_id = ?').all(id) as Record<string, unknown>[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ reason: 'PROMO_GRANT', amount_delta: 300, balance_before: 0, balance_after: 300, note: 'WELCOME30' });
    expect(String(ledger[0]!.reference_id)).toMatch(/^prm_/);
    expect(redemptions(id).map((r) => r.code)).toEqual(['WELCOME30']);
    expect(uses('WELCOME30')).toBe(1);
  });

  it('a second redemption by the same account is rejected and grants nothing', async () => {
    const { token } = await player();
    await redeem(token, 'WELCOME30');
    const again = await redeem(token, 'WELCOME30');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'ALREADY_REDEEMED', result: 'ALREADY_REDEEMED' });
    // A retried request can still show what it got.
    expect(again.body.error!.reward!.items[0]!.label).toBe('300 Cristales Arcanos');
    expect(await balance(token)).toBe(300);
    expect(uses('WELCOME30')).toBe(1);
  });

  it('WARDRAGON grants Invocar Dragón de Guerra x1 into the Summoner collection', async () => {
    const { token } = await player();
    const res = await redeem(token, 'WARDRAGON');
    expect(res.status).toBe(200);
    expect(res.body.reward!.items).toEqual([{ kind: 'CARD', id: 'summon_war_drake', label: 'Invocar Dragón de Guerra x1', amount: 1 }]);
    expect(copies(res.body.profile, 'summoner', 'summon_war_drake')).toBe(1);
    expect(await balance(token)).toBe(0);
  });

  it('WARRIOROATH grants Ejecución x1; a locked Warrior makes it unavailable without consuming it', async () => {
    const { token, id } = await player();
    const locked = await redeem(token, 'WARRIOROATH', {}, { SUMMONER_RITUALS_ENABLED: '1' });
    expect(locked.body.error!.code).toBe('REWARD_UNAVAILABLE');
    expect(redemptions(id)).toEqual([]);
    const res = await redeem(token, 'WARRIOROATH');
    expect(res.status).toBe(200);
    expect(copies(res.body.profile, 'warrior', 'execution')).toBe(1);
  });

  it('unreleased content (rituals QA-only) is never granted', async () => {
    const { token, id } = await player();
    const res = await redeem(token, 'WARDRAGON', {}, { WARRIOR_ENABLED: '1' });
    expect(res.body.error!.code).toBe('REWARD_UNAVAILABLE');
    expect(uses('WARDRAGON')).toBe(0);
    expect(redemptions(id)).toEqual([]);
  });

  it('a card at its copy cap rejects the code (CARD_AT_CAP) and leaves it unused', async () => {
    const { token, id } = await player();
    own(id, 'summoner', 'summon_war_drake', 1);
    const res = await redeem(token, 'WARDRAGON');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CARD_AT_CAP' });
    expect(uses('WARDRAGON')).toBe(0);
    expect(redemptions(id)).toEqual([]);
  });

  it('RITUALSTART grants both minor-ritual pieces, or nothing if one is at cap', async () => {
    const a = await player('tactics_qa_a');
    const ok = await redeem(a.token, 'RITUALSTART');
    expect(ok.body.reward!.items.map((i) => i.id)).toEqual(['rune_stone', 'rune_shell']);
    expect(copies(ok.body.profile, 'summoner', 'rune_stone')).toBe(1);
    expect(copies(ok.body.profile, 'summoner', 'rune_shell')).toBe(1);

    const b = await player('tactics_qa_b');
    own(b.id, 'summoner', 'rune_shell', 2);
    const capped = await redeem(b.token, 'RITUALSTART');
    expect(capped.body.error!.code).toBe('CARD_AT_CAP');
    const state = (await call(b.token, 'GET', '/state')).body;
    expect(copies(state.profile, 'summoner', 'rune_stone')).toBe(0);
  });

  it('multi rewards are atomic: an owned cosmetic blocks the crystals and the card too', async () => {
    const { token, id } = await player();
    addCode('BUNDLE01', {
      type: 'MULTI',
      items: [
        { type: 'ARCANE_CRYSTALS', amount: 200 },
        { type: 'CARD', cardId: 'frost_nova', copies: 1 },
        { type: 'COSMETIC', cosmeticId: 'frame_arcane_gilt' },
      ],
    });
    db.sql
      .prepare("INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, acquired_at) VALUES (?, 'frame_arcane_gilt', 'PROFILE_FRAME', 'QA', 0)")
      .run(id);
    const res = await redeem(token, 'BUNDLE01');
    expect(res.body.error!.code).toBe('ALREADY_OWNED');
    expect(await balance(token)).toBe(0);
    expect(copies((await call(token, 'GET', '/state')).body.profile, 'mage', 'frost_nova')).toBe(0);

    // A failure inside the transaction (forced here by a cap guard) rolls back every grant.
    db.sql.prepare('DELETE FROM tactics_player_cosmetics WHERE user_id = ?').run(id);
    db.sql.exec(`CREATE TRIGGER sabotage BEFORE INSERT ON tactics_player_cosmetics BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    const failed = await redeem(token, 'BUNDLE01');
    expect(failed.body.error!.code).toBe('REWARD_UNAVAILABLE');
    expect(await balance(token)).toBe(0);
    expect(redemptions(id)).toEqual([]);
    expect(uses('BUNDLE01')).toBe(0);
    db.sql.exec('DROP TRIGGER sabotage');
    const done = await redeem(token, 'BUNDLE01');
    expect(done.status).toBe(200);
    expect(done.body.reward!.items.map((i) => i.kind)).toEqual(['CURRENCY', 'CARD', 'COSMETIC']);
    expect(await balance(token)).toBe(200);
  });

  it('honours the server clock: NOT_STARTED, EXPIRED, then INACTIVE', async () => {
    const { token } = await player();
    addCode('SOON2026', { type: 'ARCANE_CRYSTALS', amount: 10 }, { starts: NOW + 1000 });
    addCode('OLD2025', { type: 'ARCANE_CRYSTALS', amount: 10 }, { expires: NOW });
    addCode('PAUSED', { type: 'ARCANE_CRYSTALS', amount: 10 }, { active: 0 });
    expect((await redeem(token, 'SOON2026', { now: NOW + 5000 })).body.error!.code).toBe('NOT_STARTED');
    expect((await redeem(token, 'OLD2025')).body.error!.code).toBe('EXPIRED');
    expect((await redeem(token, 'PAUSED')).body.error!.code).toBe('INACTIVE');
    expect((await redeem(token, 'FOUNDERSGIFT')).body.error!.code).toBe('INACTIVE');
    now = NOW + 1000;
    expect((await redeem(token, 'SOON2026')).status).toBe(200);
  });

  it('enforces the global cap at the boundary, including concurrent last uses', async () => {
    addCode('LIMIT2', { type: 'ARCANE_CRYSTALS', amount: 5 }, { max: 2 });
    const players = [];
    for (const name of ['p1', 'p2', 'p3', 'p4']) players.push(await player(name));
    expect((await redeem(players[0]!.token, 'LIMIT2')).status).toBe(200);
    // Two accounts race for the last slot: exactly one gets it.
    const race = await Promise.all([redeem(players[1]!.token, 'LIMIT2'), redeem(players[2]!.token, 'LIMIT2')]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(race.find((r) => r.status === 410)!.body.error!.code).toBe('GLOBAL_LIMIT_REACHED');
    expect((await redeem(players[3]!.token, 'LIMIT2')).body.error!.code).toBe('GLOBAL_LIMIT_REACHED');
    expect(uses('LIMIT2')).toBe(2);
  });

  it('a double click / retry by one account grants exactly once', async () => {
    const { token, id } = await player();
    const results = await Promise.all([redeem(token, 'WELCOME30'), redeem(token, 'WELCOME30'), redeem(token, 'welcome30')]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'ALREADY_REDEEMED')).toHaveLength(2);
    expect(await balance(token)).toBe(300);
    expect(redemptions(id)).toHaveLength(1);
    expect(uses('WELCOME30')).toBe(1);
  });

  it('ignores forged userId / reward / amount / cardId / balance in the body', async () => {
    const victim = await player('tactics_qa_b');
    const { token, id } = await player('tactics_qa_a');
    const res = await redeem(token, 'TACTICS100', {
      userId: victim.id,
      reward: { type: 'ARCANE_CRYSTALS', amount: 99999 },
      amount: 99999,
      cardId: 'summon_war_drake',
      balance: 99999,
    });
    expect(res.body.wallet.balance).toBe(100);
    expect(copies(res.body.profile, 'summoner', 'summon_war_drake')).toBe(0);
    expect(redemptions(id)).toHaveLength(1);
    expect(redemptions(victim.id)).toEqual([]);
    expect(await balance(victim.token)).toBe(0);
  });

  it('requires a session; malformed, SQL-like and oversized codes are INVALID_CODE', async () => {
    expect((await redeem(null, 'WELCOME30')).status).toBe(401);
    expect((await redeem('forged-token', 'WELCOME30')).status).toBe(401);
    const { token } = await player();
    for (const bad of ["WELCOME30' OR '1'='1", 'X'.repeat(5000), 'NOPE2026', 17])
      expect((await redeem(token, bad)).body.error!.code).toBe('INVALID_CODE');
    expect(uses('WELCOME30')).toBe(0);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_promo_codes').get()).toEqual({ n: 9 });
  });

  it(`rate limits to ${PROMO_RATE.attempts} attempts per minute per account, then recovers`, async () => {
    const { token } = await player();
    const other = await player('tactics_qa_b');
    for (let i = 0; i < PROMO_RATE.attempts; i++) expect((await redeem(token, `WRONG${i}A`)).body.error!.code).toBe('INVALID_CODE');
    const limited = await redeem(token, 'WELCOME30');
    expect(limited.status).toBe(429);
    expect(limited.body.error!.code).toBe('RATE_LIMITED');
    expect((await redeem(other.token, 'WELCOME30')).status).toBe(200); // per account
    now = NOW + PROMO_RATE.windowMs + 1;
    expect((await redeem(token, 'WELCOME30')).status).toBe(200);
  });

  it('prunes attempt rows after a week and never stores session tokens', async () => {
    const { token, id } = await player();
    await redeem(token, 'NOPE2026');
    now = NOW + 8 * 24 * 60 * 60 * 1000;
    await redeem(token, 'WELCOME30');
    const rows = db.sql.prepare('SELECT code, result FROM tactics_promo_attempts WHERE user_id = ?').all(id);
    expect(rows).toEqual([{ code: 'WELCOME30', result: 'SUCCESS' }]);
    expect(JSON.stringify(db.sql.prepare('SELECT * FROM tactics_promo_attempts').all())).not.toContain(token);
  });

  it('persists across logout/login: the new session sees the reward and cannot redeem again', async () => {
    const { token, id } = await player();
    await redeem(token, 'WARDRAGON');
    await redeem(token, 'THANKYOU');
    db.sql.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    db.sql.prepare("INSERT INTO sessions (token, username, created_at, expires_at) VALUES ('second-login', 'tactics_qa_a', 0, 4000000000000)").run();
    expect((await call(token, 'GET', '/state')).status).toBe(401);
    const state = await call('second-login', 'GET', '/state');
    expect(copies(state.body.profile, 'summoner', 'summon_war_drake')).toBe(1);
    expect(await balance('second-login')).toBe(200);
    expect((await redeem('second-login', 'WARDRAGON')).body.error!.code).toBe('ALREADY_REDEEMED');
    expect(redemptions(id)).toHaveLength(2);
  });

  it('account deletion removes its redemptions but never reopens a capped code', async () => {
    addCode('ONCE', { type: 'ARCANE_CRYSTALS', amount: 5 }, { max: 1 });
    const { token, id } = await player();
    await redeem(token, 'ONCE');
    expect(() => db.sql.prepare('DELETE FROM tactics_promo_redemptions WHERE user_id = ?').run(id)).toThrow(/append-only/);
    db.sql.prepare('DELETE FROM users WHERE id = ?').run(id); // RPG-GO account deletion → cascade
    expect(redemptions(id)).toEqual([]);
    expect(uses('ONCE')).toBe(1);
    const next = await player('tactics_qa_b');
    expect((await redeem(next.token, 'ONCE')).body.error!.code).toBe('GLOBAL_LIMIT_REACHED');
  });
});

describe('admin seed script', () => {
  it('creates a code, updates it without resetting uses, and refuses bad input', async () => {
    db.sql.exec(promoCodeSql({ code: 'SPRING2027', reward: { type: 'ARCANE_CRYSTALS', amount: 150, extra: 'dropped' }, maxGlobalUses: 2, note: "O'Brien", now: 1 }));
    const { token } = await player();
    expect((await redeem(token, 'spring-2027')).status).toBe(200);
    db.sql.exec(promoCodeSql({ code: 'SPRING2027', reward: { type: 'ARCANE_CRYSTALS', amount: 150 }, active: false, maxGlobalUses: 2, now: 2 }));
    const row = db.sql.prepare("SELECT is_active, uses, reward_json, note FROM tactics_promo_codes WHERE code = 'SPRING2027'").get();
    expect(row).toEqual({ is_active: 0, uses: 1, reward_json: '{"type":"ARCANE_CRYSTALS","amount":150}', note: null });
    for (const bad of [
      { code: 'spring', reward: { type: 'ARCANE_CRYSTALS', amount: 1 } },
      { code: "X'); DROP TABLE users;--", reward: { type: 'ARCANE_CRYSTALS', amount: 1 } },
      { code: 'GOODCODE', reward: { type: 'ARCANE_CRYSTALS', amount: 50_000 } },
      { code: 'GOODCODE', reward: { type: 'CARD', cardId: "x'--", copies: 1 } },
      { code: 'GOODCODE', reward: { type: 'RANDOM_CARD' } },
      { code: 'GOODCODE', reward: { type: 'ARCANE_CRYSTALS', amount: 1 }, maxGlobalUses: 0 },
    ])
      expect(() => promoCodeSql({ ...bad, now: 1 })).toThrow();
  });
});
