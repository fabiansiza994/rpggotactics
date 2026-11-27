/**
 * Security Hardening 1.0 — Account & Game Integrity. Defensive regression tests: every case
 * runs locally against node:sqlite (fictitious accounts only) and checks both that the
 * unauthorized operation is refused and that the legitimate one keeps working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handle, resolveCaller } from '../server/src/index';
import { PvPMatchRoom, PVP_CONTENT, type Room } from '../server/src/pvp';
import { SocialHub } from '../server/src/social';
import { createPlayer } from '../server/src/repo';
import { loadWinterPlayer } from '../server/src/winterCampaign';
import { checkStoryAttempt } from '../server/src/storyAttempts';
import { sessionDigest } from '../server/src/sessionAuth';
import { rankedBotCatalog } from '../server/src/rankedBotCatalog';
import type { Env } from '../server/src/db';
import {
  ASCENT_CAMPAIGN, DEFAULT_CONTENT, asNewPlayer, battleSeed, createProfile, createRun, currentEncounter, serializeProfile, serializeRun,
} from '../src/game';
import { withDarkLightRelease } from '../src/game/data/dark-light';
import { STORY_CONTENT, storyBattle } from '../src/game/run/story-rules';
import { botIdentity, publicBotIdentity } from '../src/game/ai/ranked-bot-policy';
import { botDeck } from '../src/game/ai/ranked-bot-deck';
import { validateLoadout } from '../src/game/pvp/duel';
import { competitiveFixture } from './support/competitive-profile';
import { protectionNamespace } from './support/protection-hub';
import { playBattle } from './support/bot';
import { addAccount, memoryD1 } from './support/d1';

type DB = ReturnType<typeof memoryD1>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PVP_MIGRATIONS = ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql', '0030_tactics_ranked_bots.sql'];
const withPvp = (db: DB) => { for (const f of PVP_MIGRATIONS) db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8')); return db; };
const req = (token: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  new Request(`https://api.test/api/tactics${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

afterEach(() => vi.useRealTimers());

// ── SEC-001 ───────────────────────────────────────────────────────────────────────────────
describe('SEC-001 import provenance', () => {
  const content = withDarkLightRelease(DEFAULT_CONTENT);
  const importAs = (db: DB, token: string, profile: unknown, env: Partial<Env> = {}, extra: Json = {}) =>
    handle(req(token, '/import', { profile: typeof profile === 'string' ? profile : serializeProfile(profile as never), ...extra }), { DB: db, ...env } as Env, { content, now: () => 1_800_000_000_000, seed: () => 7 });
  const claimRow = (db: DB, userId: number) => db.sql.prepare('SELECT claims_json, policy, status FROM tactics_import_claims WHERE user_id = ?').get(userId) as Json | undefined;
  const ownedCopies = (db: DB, userId: number, cardId: string) => Number((db.sql.prepare('SELECT COALESCE(SUM(copies),0) AS n FROM tactics_player_cards WHERE user_id = ? AND card_id = ?').get(userId, cardId) as Json).n);

  it('a client-invented card is never granted; the claim is preserved for review, not discarded (audit PoC)', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_forged');
    const profile = asNewPlayer(createProfile(content));
    profile.heroes.mage!.collection.absolute_zero = { copies: 1, acquired: 999 };
    const res = await importAs(db, a.token, profile);
    const body = (await res.json()) as Json;
    expect(res.status).toBe(200);
    expect(body.profile.heroes.mage.collection.absolute_zero).toBeUndefined();
    expect(ownedCopies(db, a.id, 'absolute_zero')).toBe(0);
    expect(body.importPendingReview.cards).toEqual([{ ownerId: 'mage', cardId: 'absolute_zero', claimed: 1, allowance: 0 }]);
    const row = claimRow(db, a.id)!;
    expect(row).toMatchObject({ policy: 'STRICT', status: 'PENDING_REVIEW' });
    expect(JSON.parse(row.claims_json).cards[0].cardId).toBe('absolute_zero');
    db.sql.close();
  });

  it('extra copies of a granted card are not granted either (kept at the new-account grant)', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_extra');
    const profile = asNewPlayer(createProfile(content));
    const [cardId, owned] = Object.entries(profile.heroes.mage!.collection)[0]!;
    profile.heroes.mage!.collection[cardId] = { ...owned, copies: owned.copies + 1 };
    const body = (await (await importAs(db, a.token, profile)).json()) as Json;
    expect(body.profile.heroes.mage.collection[cardId].copies).toBe(owned.copies);
    expect(body.importPendingReview.cards[0]).toMatchObject({ cardId, claimed: owned.copies + 1, allowance: owned.copies });
    db.sql.close();
  });

  it('a legacy save cannot obtain the open roster: it starts with onboarding and its roster claim is preserved', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_roster');
    const res = await importAs(db, a.token, createProfile(content));
    const body = (await res.json()) as Json;
    expect(res.status).toBe(200);
    expect(body.profile.champions).toMatchObject({ mode: 'PROGRESSION', startingChampionId: null, unlocks: [] });
    expect(body.importPendingReview.claims.map((c: Json) => c.kind)).toEqual(['CHAMPION_ROSTER']);
    db.sql.close();
  });

  it('a legitimate guest save imports exactly like a new account plus its legal decks; nothing pending', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_legit');
    const local = asNewPlayer(createProfile(content));
    const granted = structuredClone(local.heroes.mage!.collection);
    for (const c of Object.values(local.heroes.mage!.collection)) c.acquired = 5000; // client counters are ignored
    const res = await importAs(db, a.token, local);
    const body = (await res.json()) as Json;
    expect(res.status).toBe(200);
    expect(body.importPendingReview).toBeUndefined();
    expect(body.profile.heroes.mage.collection).toEqual(granted);
    expect(claimRow(db, a.id)).toBeUndefined();
    db.sql.close();
  });

  it('an empty/garbage save imports as a NEW account (onboarding), never as the legacy roster', async () => {
    const db = memoryD1(), a = addAccount(db, 'sec1_empty');
    const body = (await (await importAs(db, a.token, 'not-a-save')).json()) as Json;
    expect(body.profile.champions).toMatchObject({ mode: 'PROGRESSION', startingChampionId: null });
    db.sql.close();
  });

  it('campaign progress past the guest limit is not imported; the claim is preserved', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_campaign');
    const local = asNewPlayer(createProfile(content));
    const run = createRun(ASCENT_CAMPAIGN, content, 3, 'mage');
    const order = ASCENT_CAMPAIGN.encounters.map((e) => e.id);
    const advanced = { ...run, completedEncounterIds: order.slice(0, 5), currentEncounterId: order[5]! };
    const body = (await (await importAs(db, a.token, local, {}, { campaigns: { mage: serializeRun(advanced) } })).json()) as Json;
    expect(body.importPendingReview.claims.map((c: Json) => c.kind)).toContain('CAMPAIGN_PROGRESS');
    expect(body.runs?.mage ?? null).toBeNull();
    db.sql.close();
  });

  it('without migration 0039 STRICT never degrades: an import with claims stops (503) and nothing is created', async () => {
    const db = memoryD1({ importClaims: false }), a = addAccount(db, 'sec1_premigration');
    const profile = asNewPlayer(createProfile(content));
    profile.heroes.mage!.collection.absolute_zero = { copies: 1, acquired: 999 };
    const res = await importAs(db, a.token, profile);
    expect(res.status).toBe(503);
    expect(((await res.json()) as Json).error.code).toBe('IMPORT_REVIEW_UNAVAILABLE');
    expect(Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_profiles').get()!.n)).toBe(0);
    // A claim-free (legitimate) import is unaffected by the missing table.
    const b = addAccount(db, 'sec1_premigration_ok');
    expect((await importAs(db, b.token, asNewPlayer(createProfile(content)))).status).toBe(200);
    db.sql.close();
  });

  it('stored claims are immutable, integrity-checked and can be resolved only once', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_immutable');
    const profile = asNewPlayer(createProfile(content));
    profile.heroes.mage!.collection.absolute_zero = { copies: 1, acquired: 999 };
    expect((await importAs(db, a.token, profile)).status).toBe(200);
    const row = db.sql.prepare('SELECT claims_json, claims_digest FROM tactics_import_claims WHERE user_id = ?').get(a.id) as Json;
    expect(row.claims_digest).toBe(await sessionDigest(row.claims_json)); // same SHA-256 hex construction
    expect(() => db.sql.prepare("UPDATE tactics_import_claims SET claims_json = '{}' WHERE user_id = ?").run(a.id)).toThrow(/immutable/);
    db.sql.prepare("UPDATE tactics_import_claims SET status = 'REJECTED', reviewed_at = 1, reviewer = 'qa' WHERE user_id = ?").run(a.id);
    expect(() => db.sql.prepare("UPDATE tactics_import_claims SET status = 'APPROVED', resolution_txn = 'txn-1' WHERE user_id = ?").run(a.id)).toThrow(/already resolved/);
    // A second import for the same account is impossible (409): the claim is never recorded twice.
    expect((await importAs(db, a.token, profile)).status).toBe(409);
    expect(Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_import_claims').get()!.n)).toBe(1);
    db.sql.close();
  });

  it('LEGACY_ALLOWANCE restores the previous behaviour exactly (reversible compatibility switch)', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_compat');
    const profile = asNewPlayer(createProfile(content));
    profile.heroes.mage!.collection.absolute_zero = { copies: 1, acquired: 999 };
    const res = await importAs(db, a.token, profile, { TACTICS_IMPORT_POLICY: 'LEGACY_ALLOWANCE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).profile.heroes.mage.collection.absolute_zero.copies).toBe(1);
    expect(claimRow(db, a.id)).toBeUndefined();
    db.sql.close();
  });

  it('an account that already has cloud progress is never touched by an import, and /profile still creates the grant', async () => {
    const db = memoryD1({ importClaims: true }), a = addAccount(db, 'sec1_existing');
    const created = await handle(req(a.token, '/profile', {}), { DB: db } as Env, { content, now: () => 1, seed: () => 7 });
    expect(created.status).toBe(200);
    const before = db.sql.prepare('SELECT hero_id,card_id,copies FROM tactics_player_cards ORDER BY hero_id,card_id').all();
    const profile = asNewPlayer(createProfile(content));
    profile.heroes.mage!.collection.absolute_zero = { copies: 1, acquired: 1 };
    expect((await importAs(db, a.token, profile)).status).toBe(409);
    expect(db.sql.prepare('SELECT hero_id,card_id,copies FROM tactics_player_cards ORDER BY hero_id,card_id').all()).toEqual(before);
    expect(claimRow(db, a.id)).toBeUndefined();
    db.sql.close();
  });
});

// ── SEC-002 / SEC-009 ─────────────────────────────────────────────────────────────────────
describe('SEC-009 session digest at rest (transition)', () => {
  const asReq = (token: string) => new Request('https://api.test/x', { headers: { Authorization: 'Bearer ' + token } });

  it('pre-digest sessions keep working and get their digest backfilled once', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'sec9_backfill');
    expect(db.sql.prepare('SELECT token_digest FROM sessions').get()!.token_digest).toBeNull();
    const first = await resolveCaller(asReq(a.token), db, 1);
    expect(first).toMatchObject({ userId: a.id, username: 'sec9_backfill', sid: await sessionDigest(a.token) });
    expect(db.sql.prepare('SELECT token_digest FROM sessions').get()!.token_digest).toBe(await sessionDigest(a.token));
    expect(await resolveCaller(asReq(a.token), db, 1)).toMatchObject({ userId: a.id });
    db.sql.close();
  });

  it('a digest-only row is found by its bearer; the stored value itself is never a valid bearer', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'sec9_digest_only');
    const digest = await sessionDigest(a.token);
    db.sql.prepare("UPDATE sessions SET token = 'd:' || ?, token_digest = ?").run(digest, digest);
    expect(await resolveCaller(asReq(a.token), db, 1)).toMatchObject({ userId: a.id });
    expect(await resolveCaller(asReq('d:' + digest), db, 1)).toBeNull();
    expect(await resolveCaller(asReq(digest), db, 1)).toBeNull();
    db.sql.close();
  });

  it('without migration 0037 the Worker degrades to the previous raw-token lookup', async () => {
    const db = memoryD1(), a = addAccount(db, 'sec9_premigration');
    expect(await resolveCaller(asReq(a.token), db, 1)).toEqual({ userId: a.id, username: 'sec9_premigration', sid: null });
    db.sql.close();
  });

  it('revoked or expired sessions resolve to nobody', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'sec9_revoked'), b = addAccount(db, 'sec9_expired', { expiresAt: 10 });
    await resolveCaller(asReq(a.token), db, 1);
    db.sql.prepare('DELETE FROM sessions WHERE username = ?').run('sec9_revoked');
    expect(await resolveCaller(asReq(a.token), db, 1)).toBeNull();
    expect(await resolveCaller(asReq(b.token), db, 11)).toBeNull();
    db.sql.close();
  });
});

class Sock {
  closed: { code?: number; reason?: string } | null = null;
  messages: string[] = [];
  constructor(public attachment: Json) {}
  deserializeAttachment() { return this.attachment; }
  serializeAttachment(v: Json) { this.attachment = v; }
  send(s: string) { this.messages.push(s); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
}

function roomHarness(env: Json) {
  const data = new Map<string, unknown>();
  let init: Promise<unknown> = Promise.resolve();
  const sockets: Sock[] = [];
  const ctx = {
    storage: { get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined, put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), setAlarm: async () => {}, deleteAlarm: async () => {} },
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => { const p = fn(); init = p; return p; },
    acceptWebSocket: () => {},
    getWebSockets: () => sockets.filter((s) => !s.closed),
  };
  const room = new PvPMatchRoom(ctx as never, env as never);
  return { room, data, sockets, ready: () => init, fetch: async (r: Request) => { await init; return room.fetch(r); } };
}

describe('SEC-002 session revocation reaches live sockets', () => {
  const profile = createProfile(DEFAULT_CONTENT);
  profile.heroes.mage = competitiveFixture('mage').profile.heroes.mage!;
  profile.heroes.mage.activeDeckId = 'competitive';

  async function connected(db: DB, sid: string) {
    const h = roomHarness({ DB: db });
    const post = (path: string, headers: Record<string, string> = {}) =>
      h.fetch(new Request('https://room/' + path, { method: 'POST', headers: { 'X-Pvp-User': '1', 'X-Pvp-Name': 'u1', ...headers }, body: JSON.stringify({ code: 'ABCDEFGH', mode: 'DUEL', mapId: 'classic', loadout: validateLoadout(profile, 'mage') }) }));
    expect((await post('create')).status).toBe(200);
    const ticket = (await (await post('connect', { 'X-Pvp-Session': sid })).json()) as Json;
    const stored = (h.data.get('room') as Room).ticket[ticket.ticket]!;
    expect(stored.sid).toBe(sid);
    const ws = new Sock({ seat: 0, sid: stored.sid, sessionCheckedAt: stored.expires - 30000 });
    h.sockets.push(ws);
    return { ...h, ws };
  }

  it('the outer Worker binds the room ticket to the caller session (internal header)', async () => {
    const db = withPvp(memoryD1({ sessionDigest: true, legacyProfiles: true })), a = addAccount(db, 'sec2_header');
    await createPlayer(db, a.id, 'sec2_header', profile, [], { source: 'STARTER', importedAt: null, now: 0 });
    const seen: Request[] = [];
    const env = { DB: db, PVP_ROOMS: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => { seen.push(r); return Response.json({ ticket: 't', code: 'ABCDEFGH' }); } }) } } as unknown as Env;
    await handle(req(a.token, '/pvp/connect', { code: 'ABCDEFGH' }), env);
    expect(seen[0]!.headers.get('X-Pvp-Session')).toBe(await sessionDigest(a.token));
    db.sql.close();
  });

  it('after logout/recovery the socket is closed (4401) at its next command; no command is applied', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const db = withPvp(memoryD1({ sessionDigest: true })), a = addAccount(db, 'sec2_revoked');
    const sid = await sessionDigest(a.token);
    db.sql.prepare('UPDATE sessions SET token_digest = ?').run(sid);
    const { room, ws, data } = await connected(db, sid);
    const before = JSON.stringify(data.get('room'));
    db.sql.prepare('DELETE FROM sessions').run(); // logout (or recovery) in the auth Worker
    vi.setSystemTime(Date.now() + 10_000);
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'surrender' }));
    expect(ws.closed).toEqual({ code: 4401, reason: 'SESSION_REVOKED' });
    expect(JSON.stringify(data.get('room'))).toBe(before);
    db.sql.close();
  });

  it('a protected command sent right after revocation is refused — zero authorization window, before any heartbeat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const db = withPvp(memoryD1({ sessionDigest: true })), a = addAccount(db, 'sec2_zero_window');
    const sid = await sessionDigest(a.token);
    db.sql.prepare('UPDATE sessions SET token_digest = ?').run(sid);
    const { room, ws, data } = await connected(db, sid);
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'ping' })); // confirmed just now
    const before = JSON.stringify(data.get('room'));
    db.sql.prepare('DELETE FROM sessions').run();
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'surrender' })); // same millisecond
    expect(ws.closed).toEqual({ code: 4401, reason: 'SESSION_REVOKED' });
    expect(JSON.stringify(data.get('room'))).toBe(before);
    db.sql.close();
  });

  it('heartbeats are re-checked at most every 10 s (no D1 query per heartbeat) and a live session keeps playing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const db = withPvp(memoryD1({ sessionDigest: true })), a = addAccount(db, 'sec2_live');
    const sid = await sessionDigest(a.token);
    db.sql.prepare('UPDATE sessions SET token_digest = ?').run(sid);
    const { room, ws } = await connected(db, sid);
    const prepare = vi.spyOn(db, 'prepare');
    for (let i = 0; i < 5; i++) await room.webSocketMessage(ws as never, JSON.stringify({ type: 'ping' }));
    expect(prepare.mock.calls.filter(([q]) => String(q).includes('token_digest')).length).toBe(0);
    vi.setSystemTime(Date.now() + 10_000);
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'ping' }));
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'ping' }));
    expect(prepare.mock.calls.filter(([q]) => String(q).includes('token_digest')).length).toBe(1);
    expect(ws.closed).toBeNull();
    db.sql.close();
  });

  it('a D1 failure during the re-check never disconnects a legitimate player (the action is only deferred)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const db = withPvp(memoryD1({ sessionDigest: true })), a = addAccount(db, 'sec2_d1down');
    const sid = await sessionDigest(a.token);
    const { room, ws } = await connected(db, sid);
    vi.setSystemTime(Date.now() + 10_000);
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((q: string) => { if (q.includes('token_digest')) throw new Error('D1 unavailable'); return original(q); });
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'ping' }));
    expect(ws.closed).toBeNull();
    await room.webSocketMessage(ws as never, JSON.stringify({ type: 'surrender' }));
    expect(ws.closed).toBeNull();
    expect(JSON.parse(ws.messages.at(-1)!)).toMatchObject({ type: 'error', code: 'SESSION_CHECK_UNAVAILABLE' });
    db.sql.close();
  });

  it('SocialHub: a private push never reaches a revoked session, even before its next heartbeat', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'sec2_social_push');
    const sid = await sessionDigest(a.token);
    db.sql.prepare('UPDATE sessions SET token_digest = ?').run(sid);
    const store = new Map<string, unknown>();
    const sockets: Sock[] = [];
    const hub = new SocialHub({ storage: { get: async <T>(k: string) => store.get(k) as T, put: async (k: string, v: unknown) => void store.set(k, v) }, acceptWebSocket: () => {}, getWebSockets: () => sockets.filter((s) => !s.closed) } as never, { DB: db } as never);
    const tabA = new Sock({ userId: a.id, sid, sessionCheckedAt: Date.now() }), tabB = new Sock({ userId: a.id, sid, sessionCheckedAt: Date.now() });
    sockets.push(tabA, tabB);
    await hub.fetch(new Request('https://hub/push', { method: 'POST', body: '{"type":"chat","text":"hola"}' }));
    expect([tabA.messages.length, tabB.messages.length]).toEqual([1, 1]);
    db.sql.prepare('DELETE FROM sessions').run(); // logout in one tab revokes the shared session
    await hub.fetch(new Request('https://hub/push', { method: 'POST', body: '{"type":"chat","text":"privado"}' }));
    expect([tabA.messages.length, tabB.messages.length]).toEqual([1, 1]);
    expect([tabA.closed, tabB.closed]).toEqual([{ code: 4401, reason: 'SESSION_REVOKED' }, { code: 4401, reason: 'SESSION_REVOKED' }]);
    db.sql.close();
  });

  it('SocialHub: a revoked session stops receiving private pushes at its next heartbeat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'sec2_social');
    db.sql.exec(readFileSync(new URL('../server/migrations/0009_tactics_social.sql', import.meta.url), 'utf8'));
    const sid = await sessionDigest(a.token);
    db.sql.prepare('UPDATE sessions SET token_digest = ?').run(sid);
    const store = new Map<string, unknown>();
    const sockets: Sock[] = [];
    const hub = new SocialHub({ storage: { get: async <T>(k: string) => store.get(k) as T, put: async (k: string, v: unknown) => void store.set(k, v) }, acceptWebSocket: () => {}, getWebSockets: () => sockets.filter((s) => !s.closed) } as never, { DB: db } as never);
    const issued = (await (await hub.fetch(new Request('https://hub/ticket', { method: 'POST', headers: { 'X-Social-User': String(a.id), 'X-Social-Session': sid } }))).json()) as Json;
    expect((store.get('tickets') as Json)[issued.ticket]).toMatchObject({ sid });
    const ws = new Sock({ userId: a.id, sid, sessionCheckedAt: Date.now() });
    sockets.push(ws);
    vi.setSystemTime(Date.now() + 30_000);
    await hub.webSocketMessage(ws as never, 'ping');
    expect(ws.closed).toBeNull();
    db.sql.prepare('DELETE FROM sessions').run();
    vi.setSystemTime(Date.now() + 30_000);
    await hub.webSocketMessage(ws as never, 'ping');
    expect(ws.closed).toEqual({ code: 4401, reason: 'SESSION_REVOKED' });
    db.sql.close();
  });
});

// ── SEC-005 ───────────────────────────────────────────────────────────────────────────────
describe('SEC-005 authored room quota under concurrency', () => {
  const profile = createProfile(DEFAULT_CONTENT);
  profile.heroes.mage = competitiveFixture('mage').profile.heroes.mage!;
  profile.heroes.mage.activeDeckId = 'competitive';

  function namespace(db: DB) {
    const rooms = new Map<string, ReturnType<typeof roomHarness>>();
    return { rooms, ns: { idFromName: (n: string) => n, get: (n: unknown) => { const k = String(n); if (!rooms.has(k)) rooms.set(k, roomHarness({ DB: db })); return { fetch: (r: Request) => rooms.get(k)!.fetch(r) }; } } };
  }

  it('eight parallel creations never exceed the three-room limit (audit PoC)', async () => {
    const db = withPvp(memoryD1({ legacyProfiles: true })), a = addAccount(db, 'sec5_parallel');
    await createPlayer(db, a.id, 'sec5_parallel', profile, [], { source: 'STARTER', importedAt: null, now: 0 });
    const { ns } = namespace(db);
    const env = { DB: db, PVP_ROOMS: ns } as unknown as Env;
    const statuses = (await Promise.all(Array.from({ length: 8 }, () => handle(req(a.token, '/pvp/create', { heroId: 'mage', mode: 'DUEL', mapId: 'classic' }), env)))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBe(3);
    expect(statuses.filter((s) => s === 429).length).toBe(5);
    expect(Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_pvp_rooms WHERE player_a = ?').get(a.id)!.n)).toBe(3);
    db.sql.close();
  });

  it('a closed/expired room frees its slot again (no orphaned reservation)', async () => {
    const db = withPvp(memoryD1({ legacyProfiles: true })), a = addAccount(db, 'sec5_release');
    await createPlayer(db, a.id, 'sec5_release', profile, [], { source: 'STARTER', importedAt: null, now: 0 });
    const { ns } = namespace(db);
    const env = { DB: db, PVP_ROOMS: ns } as unknown as Env;
    const create = () => handle(req(a.token, '/pvp/create', { heroId: 'mage', mode: 'DUEL', mapId: 'classic' }), env);
    for (let i = 0; i < 3; i++) expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(429);
    const code = String(db.sql.prepare('SELECT code FROM tactics_pvp_rooms LIMIT 1').get()!.code);
    db.sql.prepare('UPDATE tactics_pvp_rooms SET finished_at = 1 WHERE code = ?').run(code);
    expect((await create()).status).toBe(200);
    db.sql.close();
  });
});

// ── SEC-004 ───────────────────────────────────────────────────────────────────────────────
describe('SEC-004 private bot configuration', () => {
  it('the room view exposes only a public identity; the hidden 40-card loadout cannot be rebuilt (audit PoC)', async () => {
    const env = { SHAPESHIFTER_ENABLED: '1' } as Json;
    const identity = botIdentity('local-only', 0, 987);
    const catalog = rankedBotCatalog(PVP_CONTENT, env as Env);
    const loadout = botDeck(catalog, identity);
    const h = roomHarness(env);
    await h.ready();
    const room = h.room as unknown as { room: Room; view(seat: number): Json };
    room.room = { matchId: 'local-only', code: 'ABCDEFGH', version: 1, expiresAt: Date.now() + 60000, deadline: null, result: null, members: [{ id: 1, name: 'Fictitious', loadout: { heroId: 'mage', cards: [] } }, { id: null, name: identity.name, kind: 'BOT', loadout: { heroId: identity.heroId, cards: loadout } }], game: null, bot: { identity, policy: {}, outcome: null } } as never;
    const view = room.view(0);
    expect(view.bot.identity).toEqual(publicBotIdentity(identity));
    expect(JSON.stringify(view)).not.toContain('"seed"');
    expect(view.bot.identity).not.toHaveProperty('personality');
    expect(view.bot.identity).not.toHaveProperty('difficultyMix');
    let rebuilt: unknown = null;
    try { rebuilt = botDeck(catalog, view.bot.identity); } catch { /* missing private inputs */ }
    expect(rebuilt).not.toEqual(loadout);
    // The bot itself still plays with its full private identity (unchanged deck and behaviour).
    expect(room.room.bot!.identity.seed).toBe(identity.seed);
    expect(room.room.members[1]!.loadout.cards).toEqual(loadout);
  });

  describe('ranked queue offer', () => {
    let db: DB, env: Env;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1_800_000_000_000);
      db = withPvp(memoryD1({ legacyProfiles: true }));
      env = { DB: db, RANKED_PRESEASON_ENABLED: '1', RANKED_BOTS_ENABLED: '1', SHAPESHIFTER_ENABLED: '1' } as Env;
      env.SOCIAL_HUBS = protectionNamespace(env);
    });
    it('a pending bot offer reaches the client without seed, personality or difficulty mix', async () => {
      const a = addAccount(db, 'sec4_queue');
      const call = (method: string, path: string, body?: unknown) => handle(new Request(`https://api.test/api/tactics${path}?botProtocol=ranked-bots-1`, { method, headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      expect((await call('POST', '/profile', {})).status).toBe(200);
      expect((await call('POST', '/ranked/queue', { heroId: 'mage' })).status).toBe(200);
      vi.setSystemTime(Date.now() + 15_000);
      const queue = ((await (await call('GET', '/ranked/queue')).json()) as Json).queue;
      expect(queue.botOffer).toBeDefined();
      expect(Object.keys(queue.botOffer.identity).sort()).toEqual(['deckVersion', 'heroId', 'id', 'kind', 'name', 'policyVersion']);
      const me = ((await (await call('GET', '/ranked/me')).json()) as Json);
      expect(JSON.stringify(me)).not.toContain('"seed"');
      db.sql.close();
    });
  });
});

// ── SEC-006 ───────────────────────────────────────────────────────────────────────────────
describe('SEC-006 Story victory replays with the admitted (server-issued) seed', { timeout: 120_000 }, () => {
  const NOW = 1_800_000_000_000;
  async function admitted(name: string, options: { binding?: boolean } = {}) {
    const db = memoryD1({ legacyProfiles: true, storyAttempts: true }), a = addAccount(db, name);
    const run = createRun(ASCENT_CAMPAIGN, STORY_CONTENT, 71, 'mage');
    await createPlayer(db, a.id, name, createProfile(STORY_CONTENT), [run], { source: 'STARTER', importedAt: null, now: 1000, storySeedBinding: options.binding });
    return { db, a, run };
  }
  /** A real winning replay of the admitted encounter with `seed` (bot driver from the suite). */
  async function winWith(db: DB, userId: number, run: ReturnType<typeof createRun>, seeds: number[]) {
    const record = (await loadWinterPlayer(db, userId, STORY_CONTENT))!;
    const { versionedSnapshot } = await import('../server/src/winterCampaign');
    const profile = versionedSnapshot(record, run)!.profile;
    for (const seed of seeds) {
      const e = storyBattle('universal-cards-1', profile, run, seed);
      playBattle(e, 35, undefined, { summonAware: true, summonLookahead: true, antiStall: true });
      if (e.state.outcome?.result === 'WON') return { encounterId: run.currentEncounterId, seed, commands: e.history };
    }
    throw new Error('no winning replay found');
  }
  const victory = (db: DB, token: string, proof: unknown, env: Json = {}) =>
    handle(req(token, '/campaign/victory', { heroId: 'mage', proof }), { DB: db, ...env } as Env, { content: STORY_CONTENT, now: () => NOW, seed: () => 71 });
  const attempt = (db: DB, token: string, seed: number) =>
    handle(req(token, '/campaign/attempt', { heroId: 'mage' }), { DB: db } as Env, { content: STORY_CONTENT, now: () => NOW, seed: () => seed });

  it('a proof with a self-chosen seed is refused for a seed-bound admission (audit PoC)', async () => {
    const { db, a, run } = await admitted('sec6_chosen', { binding: true });
    const proof = await winWith(db, a.id, run, Array.from({ length: 15 }, (_, i) => i + 1));
    expect(proof.seed).not.toBe(battleSeed(run, currentEncounter(ASCENT_CAMPAIGN, run)));
    const issued = ((await (await attempt(db, a.token, 0xdeadbeef)).json()) as Json).attempt;
    expect(issued).toMatchObject({ seed: 0xdeadbeef, encounterId: run.currentEncounterId, runSeed: 71 });
    const res = await victory(db, a.token, proof);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.reason).toBe('seed not issued for this attempt');
    db.sql.close();
  });

  it('a legitimate victory with the issued seed is accepted once, rewards and progression intact', async () => {
    const { db, a, run } = await admitted('sec6_legit', { binding: true });
    const proof = await winWith(db, a.id, run, Array.from({ length: 15 }, (_, i) => i + 1));
    await attempt(db, a.token, proof.seed);
    const res = await victory(db, a.token, proof);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.runs.mage.completedEncounterIds).toEqual([run.currentEncounterId]);
    expect((await victory(db, a.token, proof)).status).toBe(200); // idempotent recovery of a lost response
    db.sql.close();
  });

  it('an earlier issued receipt stays valid (restart / second tab never loses the battle being finished)', async () => {
    const { db, a, run } = await admitted('sec6_previous', { binding: true });
    const proof = await winWith(db, a.id, run, Array.from({ length: 15 }, (_, i) => i + 1));
    await attempt(db, a.token, proof.seed);
    await attempt(db, a.token, 12345);
    expect((await victory(db, a.token, proof)).status).toBe(200);
    db.sql.close();
  });

  it('with STORY_SEED_BINDING a new admission requires an issued seed; older admissions keep free-seed verification', async () => {
    const bound = await admitted('sec6_bound', { binding: true });
    const proof = await winWith(bound.db, bound.a.id, bound.run, Array.from({ length: 15 }, (_, i) => i + 1));
    const res = await victory(bound.db, bound.a.token, proof);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error.code).toBe('STORY_ATTEMPT_REQUIRED');
    bound.db.sql.close();

    const old = await admitted('sec6_grandfathered'); // admitted while the switch was off: LEGACY, durably
    const oldProof = await winWith(old.db, old.a.id, old.run, Array.from({ length: 15 }, (_, i) => i + 1));
    expect((await checkStoryAttempt(old.db, old.a.id, old.run, oldProof)).result).toBe('LEGACY');
    expect((await victory(old.db, old.a.token, oldProof, { STORY_SEED_BINDING: '1' })).status).toBe(200);
    old.db.sql.close();
  });

  it('a Worker ahead of migration 0040 keeps the legacy behaviour (no 500 on victory)', async () => {
    const db = memoryD1({ legacyProfiles: true }), a = addAccount(db, 'sec6_premigration');
    const run = createRun(ASCENT_CAMPAIGN, STORY_CONTENT, 71, 'mage');
    await createPlayer(db, a.id, 'sec6_premigration', createProfile(STORY_CONTENT), [run], { source: 'STARTER', importedAt: null, now: 1000 });
    expect((await checkStoryAttempt(db, a.id, run, { seed: 1 })).result).toBe('FREE');
    db.sql.close();
  });
});
