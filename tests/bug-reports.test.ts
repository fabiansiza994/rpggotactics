import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { COSMETICS, DEFAULT_CONTENT } from '../src/game';
import { BUG_CATEGORIES, BUG_LIMITS, BUG_REPORT_RATE, containsHtml, parseBugReport, sanitizeBugContext } from '../src/game/support/bugReport';
import { handle } from '../server/src/index';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

type Body = { success?: boolean; reportId?: string; replayed?: boolean; error?: { code: string; message: string; retryAfterMs?: number } };
type Row = Record<string, unknown> & { client_context_json: string; server_flags_json: string };

const NOW = 1_800_000_000_000;
let now = NOW;
let ids = 0;
let db: ReturnType<typeof memoryD1>;
const ENV: Partial<Env> = { WARRIOR_ENABLED: '1', WORLD_2_ENABLED: '1', ALLOWED_ORIGINS: 'https://rpg-go-tactics.com' };
const deps = () => ({
  content: DEFAULT_CONTENT,
  now: () => now,
  seed: () => 7,
  store: { catalog: [], cosmetics: COSMETICS, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
});

async function send(token: string | null, body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const req = new Request('https://api.test/api/tactics/support/bug-reports', {
    method,
    headers: h,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handle(req, { DB: db, ...ENV }, deps());
  return { status: res.status, body: (await res.json()) as Body };
}
const valid = (extra: Record<string, unknown> = {}) => ({ category: 'BATTLE', description: 'La carta Bola de Fuego no hizo daño.', ...extra });
const rows = (userId?: number) =>
  (userId === undefined
    ? db.sql.prepare('SELECT * FROM tactics_bug_reports ORDER BY created_at').all()
    : db.sql.prepare('SELECT * FROM tactics_bug_reports WHERE user_id = ? ORDER BY created_at').all(userId)) as Row[];

beforeEach(() => {
  db = memoryD1();
  db.sql.exec(readFileSync(new URL('../server/migrations/0016_tactics_bug_reports.sql', import.meta.url), 'utf8'));
  now = NOW;
});

describe('auth', () => {
  it('rejects guests (no session) and expired sessions without storing anything', async () => {
    expect((await send(null, valid())).status).toBe(401);
    const old = addAccount(db, 'expired', { expiresAt: NOW - 1 });
    expect((await send(old.token, valid())).status).toBe(401);
    expect(rows()).toHaveLength(0);
  });

  it('accepts a signed-in account, even without a Tactics profile', async () => {
    const a = addAccount(db, 'tactics_qa_a');
    const res = await send(a.token, valid());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, reportId: expect.stringMatching(/^bug_/) });
    const [row] = rows(a.id);
    expect(row).toMatchObject({ report_id: res.body.reportId, user_id: a.id, username_snapshot: 'tactics_qa_a', category: 'BATTLE', status: 'OPEN', created_at: NOW });
  });

  it('ignores a forged userId/username in the body or context: identity is the session', async () => {
    const a = addAccount(db, 'alice');
    const b = addAccount(db, 'bob');
    const res = await send(a.token, valid({ userId: b.id, user_id: b.id, username: 'bob', context: { userId: b.id, username: 'bob' } }));
    expect(res.status).toBe(200);
    expect(rows(b.id)).toHaveLength(0);
    const [row] = rows(a.id);
    expect(row!.username_snapshot).toBe('alice');
    expect(row!.client_context_json).not.toContain('bob');
  });

  it('only accepts POST', async () => {
    const a = addAccount(db, 'alice');
    expect((await send(a.token, null, {}, 'GET')).status).toBe(405);
  });
});

describe('validation', () => {
  it('accepts every category and rejects anything else', async () => {
    const a = addAccount(db, 'alice');
    for (const category of ['battle', 'HACK', '', 3, null]) {
      const res = await send(a.token, valid({ category }));
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('BAD_CATEGORY');
    }
    for (const category of BUG_CATEGORIES) expect(parseBugReport(valid({ category })).ok).toBe(true);
  });

  it('enforces description 10–2000 characters (after trimming) and steps ≤ 2000', async () => {
    const a = addAccount(db, 'alice');
    for (const description of ['corto', '         x         ', 'x'.repeat(BUG_LIMITS.descriptionMax + 1), undefined, 42]) {
      const res = await send(a.token, valid({ description }));
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('DESCRIPTION_LENGTH');
    }
    expect((await send(a.token, valid({ reproductionSteps: 'x'.repeat(BUG_LIMITS.stepsMax + 1) }))).body.error?.code).toBe('STEPS_LENGTH');
    expect((await send(a.token, valid({ reproductionSteps: { html: true } }))).body.error?.code).toBe('STEPS_LENGTH');
    expect((await send(a.token, valid({ description: 'x'.repeat(BUG_LIMITS.descriptionMax) }))).status).toBe(200);
    expect((await send(a.token, valid({ description: '0123456789', reproductionSteps: '' }))).status).toBe(200);
    expect(rows(a.id).at(-1)!.reproduction_steps).toBeNull();
  });

  it('rejects HTML markup and stores plain text as written', async () => {
    const a = addAccount(db, 'alice');
    for (const description of ['<script>alert(1)</script> roto', 'texto <img src=x onerror=alert(1)>', 'hola <!-- x --> mundo', 'mira </div> esto']) {
      const res = await send(a.token, valid({ description }));
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('HTML_NOT_ALLOWED');
    }
    expect((await send(a.token, valid({ reproductionSteps: '1. <b>abrir</b>' }))).body.error?.code).toBe('HTML_NOT_ALLOWED');
    // Not markup: comparisons, hearts, ampersands and quotes are kept verbatim.
    const text = 'El daño fue < 3 & "raro" <3 cuando HP > 10';
    expect((await send(a.token, valid({ description: text }))).status).toBe(200);
    expect(rows(a.id)[0]!.description).toBe(text);
    expect(containsHtml('a<b')).toBe(true);
  });

  it('strips control characters and normalises newlines', () => {
    const parsed = parseBugReport(valid({ description: '  Línea uno\r\nLínea\u0000 dos‮  ' }));
    expect(parsed.ok && parsed.value.description).toBe('Línea uno\nLínea dos');
  });

  it('rejects malformed and oversized bodies', async () => {
    const a = addAccount(db, 'alice');
    expect((await send(a.token, '{not json')).status).toBe(400);
    expect((await send(a.token, [valid()])).status).toBe(400);
    expect((await send(a.token, valid({ padding: 'x'.repeat(20_000) }))).status).toBe(400);
    expect(rows()).toHaveLength(0);
  });
});

describe('rate limit', () => {
  it('allows 5 reports per hour per account, then 429 with a retry hint, then frees up', async () => {
    const a = addAccount(db, 'alice');
    const b = addAccount(db, 'bob');
    for (let i = 0; i < BUG_REPORT_RATE.reports; i++) {
      now = NOW + i * 60_000;
      expect((await send(a.token, valid())).status).toBe(200);
    }
    const limited = await send(a.token, valid());
    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe('RATE_LIMITED');
    expect(limited.body.error?.retryAfterMs).toBe(NOW + BUG_REPORT_RATE.windowMs - now);
    // Per account: another player is unaffected.
    expect((await send(b.token, valid())).status).toBe(200);
    // Not permanent: once the oldest report leaves the window, one more fits.
    now = NOW + BUG_REPORT_RATE.windowMs + 1;
    expect((await send(a.token, valid())).status).toBe(200);
    expect((await send(a.token, valid())).status).toBe(429);
    expect(rows(a.id)).toHaveLength(BUG_REPORT_RATE.reports + 1);
  });
});

describe('duplicate submit', () => {
  it('stores a retried submission (same clientReportId) once and returns the same id', async () => {
    const a = addAccount(db, 'alice');
    const body = valid({ clientReportId: 'rep_0123456789' });
    const [first, second] = await Promise.all([send(a.token, body), send(a.token, body)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.reportId).toBe(first.body.reportId);
    const third = await send(a.token, body);
    expect(third.body).toMatchObject({ success: true, reportId: first.body.reportId, replayed: true });
    expect(rows(a.id)).toHaveLength(1);
    // Another account may reuse the same client id: it is scoped per account.
    const b = addAccount(db, 'bob');
    expect((await send(b.token, body)).body.reportId).not.toBe(first.body.reportId);
  });

  it('a replay does not count against the rate limit', async () => {
    const a = addAccount(db, 'alice');
    for (let i = 0; i < BUG_REPORT_RATE.reports; i++) expect((await send(a.token, valid({ clientReportId: `rep_${i}_abcdefgh` }))).status).toBe(200);
    expect((await send(a.token, valid({ clientReportId: 'rep_0_abcdefgh' }))).body.replayed).toBe(true);
  });
});

describe('context and privacy', () => {
  it('persists battle context (campaign world, encounter, champion, round, turn, battle id)', async () => {
    const a = addAccount(db, 'alice');
    const context = {
      route: 'BATTLE',
      screen: 'CAMPAIGN_BATTLE',
      heroId: 'mage',
      worldId: 'world_1',
      campaignId: 'ascent',
      encounterId: 'enc_1_2',
      battleId: 'ascent:mage:12345',
      runId: 'ascent:mage',
      deckId: 'starter',
      round: 3,
      turn: 5,
      phase: 'PLAYER_TURN',
      buildVersion: '0.1.0',
      platform: 'web',
      host: 'rpg-go-tactics.com',
      flags: { WARRIOR: true, WORLD_2: false },
    };
    await send(a.token, valid({ context }));
    const [row] = rows(a.id);
    expect(row).toMatchObject({
      route: 'BATTLE',
      screen_context: 'CAMPAIGN_BATTLE',
      hero_id: 'mage',
      world_id: 'world_1',
      encounter_id: 'enc_1_2',
      battle_id: 'ascent:mage:12345',
      run_id: 'ascent:mage',
      deck_id: 'starter',
      build_version: '0.1.0',
      client_platform: 'web',
      client_host: 'rpg-go-tactics.com',
      match_id: null,
    });
    expect(JSON.parse(row!.client_context_json)).toEqual(context);
    expect(JSON.parse(row!.server_flags_json)).toEqual({ WARRIOR_ENABLED: '1', WORLD_2_ENABLED: '1' });
  });

  it('persists PvP context (room, mode, own champion, round) and drops hidden opponent data', async () => {
    const a = addAccount(db, 'alice');
    await send(
      a.token,
      valid({
        category: 'PVP',
        context: {
          route: 'PVP',
          screen: 'PVP_MATCH',
          matchId: 'ABCD2345',
          pvpMode: 'DOMINION',
          heroId: 'warrior',
          round: 4,
          opponentHand: [{ cardId: 'fireball' }],
          opponentDeck: ['frost_nova'],
          game: { units: [] },
        },
      }),
    );
    const [row] = rows(a.id);
    expect(row).toMatchObject({ category: 'PVP', match_id: 'ABCD2345', hero_id: 'warrior', route: 'PVP' });
    const ctx = JSON.parse(row!.client_context_json);
    expect(ctx).toEqual({ route: 'PVP', screen: 'PVP_MATCH', matchId: 'ABCD2345', pvpMode: 'DOMINION', heroId: 'warrior', round: 4 });
  });

  it('never stores tokens, headers, cookies, passwords or unknown fields', async () => {
    const a = addAccount(db, 'alice');
    await send(
      a.token,
      valid({
        password: 'hunter2',
        token: a.token,
        context: { token: a.token, authorization: `Bearer ${a.token}`, cookie: 'sid=1', promoCode: 'WELCOME30', chat: 'private', route: '<script>', heroId: 'mage' },
      }),
      { Cookie: 'sid=secret-cookie', 'User-Agent': `Mozilla/5.0 (Test)\tInjected ${'x'.repeat(400)}`, Origin: 'https://rpg-go-tactics.com', 'X-Secret': 'nope' },
    );
    const [row] = rows(a.id);
    const stored = JSON.stringify(row);
    for (const secret of [a.token, 'hunter2', 'secret-cookie', 'sid=1', 'WELCOME30', 'private', 'nope', '<script>']) expect(stored).not.toContain(secret);
    expect(row).toMatchObject({ route: null, hero_id: 'mage', user_agent: `Mozilla/5.0 (Test) Injected ${'x'.repeat(272)}`, client_host: 'rpg-go-tactics.com' });
  });

  it('sanitizeBugContext keeps only well-formed whitelisted values', () => {
    expect(
      sanitizeBugContext({ round: -1, turn: 1.5, heroId: 'x'.repeat(81), viewport: '1280x720', language: 'es-CO', online: 'yes', flags: { ok: true, GOOD: 'true', FINE: true } }),
    ).toEqual({ viewport: '1280x720', language: 'es-CO', flags: { FINE: true } });
    expect(sanitizeBugContext(null)).toEqual({});
    expect(sanitizeBugContext(['route'])).toEqual({});
  });
});
