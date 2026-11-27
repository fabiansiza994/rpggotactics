/**
 * Security Hardening 1.0 — final remediation of the independent review (B1–B5).
 * The five independent reproductions are kept here with the CORRECTED expectations (each `REPRO`
 * test reproduces the original scenario step by step and now asserts the secure outcome), plus
 * the concurrency, compatibility and migration cases the review required. Local only: node:sqlite,
 * fictitious accounts, simulated sockets (no workerd transport).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import { SocialHub } from '../server/src/social';
import { createPlayer, saveCampaignStep } from '../server/src/repo';
import { loadWinterPlayer } from '../server/src/winterCampaign';
import { checkStoryAttempt, issueStoryAttempt, RECEIPTS_PER_ADMISSION, type AttemptReceipt } from '../server/src/storyAttempts';
import { checkSession, resolveSession, sessionDigest } from '../server/src/sessionAuth';
import type { Env } from '../server/src/db';
import { ASCENT_CAMPAIGN, DEFAULT_CONTENT, createProfile, createRun, type RunState } from '../src/game';
import { STORY_CONTENT, storyBattle } from '../src/game/run/story-rules';
import { validateLoadout } from '../src/game/pvp/duel';
import { competitiveFixture } from './support/competitive-profile';
import { playBattle } from './support/bot';
import { addAccount, memoryD1 } from './support/d1';

type DB = ReturnType<typeof memoryD1>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const migration = (f: string) => readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8');
const PVP_MIGRATIONS = ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql', '0030_tactics_ranked_bots.sql'];
const withPvp = (db: DB) => { for (const f of PVP_MIGRATIONS) db.sql.exec(migration(f)); return db; };
const req = (token: string, path: string, body?: unknown) =>
  new Request(`https://api.test/api/tactics${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ── SEC-006 (B1–B3) ─────────────────────────────────────────────────────────────────────────
const NOW = 1_800_000_000_000;
const run = () => createRun(ASCENT_CAMPAIGN, STORY_CONTENT, 71, 'mage');
async function admitted(name: string, binding: boolean, db = memoryD1({ legacyProfiles: true, storyAttempts: true })) {
  const a = addAccount(db, name), r = run();
  await createPlayer(db, a.id, name, createProfile(STORY_CONTENT), [r], { source: 'STARTER', importedAt: null, now: 1000, storySeedBinding: binding });
  return { db, a, r };
}
const revisionOf = async (db: DB, userId: number, r: RunState) => (await loadWinterPlayer(db, userId, STORY_CONTENT))!.campaignRevisions?.[`${r.campaignId}:${r.heroId}`];
const issue = async (db: DB, userId: number, r: RunState, seed: number) => issueStoryAttempt(db, userId, r, await revisionOf(db, userId, r), seed, NOW) as Promise<AttemptReceipt | null>;
const admissions = (db: DB) => db.sql.prepare('SELECT run_seed, encounter_id, mode, origin, close_reason FROM tactics_story_attempt_admissions ORDER BY created_at, rowid').all();
const victory = (db: DB, token: string, proof: unknown, env: Json = {}) =>
  handle(req(token, '/campaign/victory', { heroId: 'mage', proof }), { DB: db, ...env } as Env, { content: STORY_CONTENT, now: () => NOW, seed: () => 71 });
const attemptCall = (db: DB, token: string, seed: number, env: Json = {}) =>
  handle(req(token, '/campaign/attempt', { heroId: 'mage' }), { DB: db, ...env } as Env, { content: STORY_CONTENT, now: () => NOW, seed: () => seed });
const rewards = (db: DB) => Number(db.sql.prepare("SELECT count(*) AS n FROM tactics_reward_log WHERE event IN ('OFFERED','NO_DROP')").get()!.n);
async function winningProof(db: DB, userId: number, r: RunState) {
  const { versionedSnapshot } = await import('../server/src/winterCampaign');
  const profile = versionedSnapshot((await loadWinterPlayer(db, userId, STORY_CONTENT))!, r)!.profile;
  for (let seed = 1; seed <= 30; seed++) {
    const e = storyBattle('universal-cards-1', profile, r, seed);
    playBattle(e, 35, undefined, { summonAware: true, summonLookahead: true, antiStall: true });
    if (e.state.outcome?.result === 'WON') return { encounterId: r.currentEncounterId, seed, commands: e.history };
  }
  throw new Error('no winning replay found');
}

describe('B1 — receipts of an admission never expire before its confirmed closure', { timeout: 120_000 }, () => {
  it('REPRO SEC006: a legitimate pending seed is NOT evicted by 16 requests from another device', async () => {
    const { db, a, r } = await admitted('review_window', true);
    await issue(db, a.id, r, 42);
    expect((await checkStoryAttempt(db, a.id, r, { seed: 42 })).result).toBe('OK');
    for (let i = 0; i < 16; i++) await issue(db, a.id, r, 100 + i);
    expect((await checkStoryAttempt(db, a.id, r, { seed: 42 })).result).toBe('OK');
    for (let i = 16; i < 120; i++) await issue(db, a.id, r, 100 + i); // far past any former window
    expect((await checkStoryAttempt(db, a.id, r, { seed: 42 })).result).toBe('OK');
    expect((await checkStoryAttempt(db, a.id, r, { seed: 7 })).result).toBe('WRONG_SEED'); // never issued
    db.sql.close();
  });

  it('end to end: a real victory survives 40 attempts from a second device, a reload and a lost response; one reward', async () => {
    const { db, a, r } = await admitted('b1_e2e', true);
    const proof = await winningProof(db, a.id, r);
    expect((await attemptCall(db, a.token, proof.seed)).status).toBe(200);           // device A plays this one
    for (let i = 0; i < 40; i++) expect((await attemptCall(db, a.token, 9000 + i)).status).toBe(200); // device B
    expect((await victory(db, a.token, proof)).status).toBe(200);                    // A reloads, re-sends
    expect((await victory(db, a.token, proof)).status).toBe(200);                    // response lost → again
    expect(rewards(db)).toBe(1);
    expect(admissions(db)[0]).toMatchObject({ mode: 'BOUND', close_reason: 'CONCLUDED' });
    db.sql.close();
  });

  it('storage stays bounded without eviction: past the cap the latest receipt is re-issued, the first stays valid', async () => {
    const { db, a, r } = await admitted('b1_cap', true);
    for (let i = 0; i < RECEIPTS_PER_ADMISSION; i++) await issue(db, a.id, r, 1 + i);
    const extra = (await issue(db, a.id, r, 999_999))!;
    expect(extra).toMatchObject({ reissued: true, seq: RECEIPTS_PER_ADMISSION, seed: RECEIPTS_PER_ADMISSION });
    expect(Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_story_attempt_receipts').get()!.n)).toBe(RECEIPTS_PER_ADMISSION);
    expect((await checkStoryAttempt(db, a.id, r, { seed: 1 })).result).toBe('OK');
    expect((await checkStoryAttempt(db, a.id, r, { seed: 999_999 })).result).toBe('WRONG_SEED');
    db.sql.close();
  }, 60_000);
});

describe('B2 — the mode of an admission is durable; issuing attempts never binds it', { timeout: 120_000 }, () => {
  it('REPRO SEC006: the optional attempt endpoint does NOT bind an older admission without STORY_SEED_BINDING', async () => {
    const { db, a, r } = await admitted('review_old', false);
    expect((await checkStoryAttempt(db, a.id, r, { seed: 42 })).result).toBe('LEGACY');
    await issue(db, a.id, r, 99);
    expect((await checkStoryAttempt(db, a.id, r, { seed: 42 })).result).toBe('LEGACY');
    expect(admissions(db)).toEqual([{ run_seed: 71, encounter_id: r.currentEncounterId, mode: 'LEGACY', origin: 'ADMITTED', close_reason: null }]);
    db.sql.close();
  });

  it('turning the switch on later binds only NEW admissions; a pending legacy victory is still accepted', async () => {
    const { db, a, r } = await admitted('b2_switch', false);
    const proof = await winningProof(db, a.id, r);
    for (let i = 0; i < 3; i++) expect((await attemptCall(db, a.token, 500 + i, { STORY_SEED_BINDING: '1' })).status).toBe(200);
    expect((await victory(db, a.token, proof, { STORY_SEED_BINDING: '1' })).status).toBe(200);
    expect(rewards(db)).toBe(1);
    const fresh = await admitted('b2_new', true, db);
    expect((await checkStoryAttempt(db, fresh.a.id, fresh.r, { seed: proof.seed })).result).toBe('NOT_ISSUED');
    db.sql.close();
  });

  it('an admission from before the ledger (migration 0040 applied later) stays verifiable and is recorded LEGACY once', async () => {
    const db = memoryD1({ legacyProfiles: true }), a = addAccount(db, 'b2_preledger'), r = run();
    await createPlayer(db, a.id, 'b2_preledger', createProfile(STORY_CONTENT), [r], { source: 'STARTER', importedAt: null, now: 1000 });
    const proof = await winningProof(db, a.id, r);
    db.sql.exec(migration('0038_tactics_story_attempt_seeds.sql'));
    db.sql.exec(migration('0040_tactics_story_attempt_receipts.sql'));
    expect((await checkStoryAttempt(db, a.id, r, proof)).result).toBe('UNTRACKED');
    expect((await attemptCall(db, a.token, 1234, { STORY_SEED_BINDING: '1' })).status).toBe(200);
    expect(admissions(db)).toEqual([expect.objectContaining({ mode: 'LEGACY', origin: 'RECONCILED', close_reason: null })]);
    expect((await victory(db, a.token, proof, { STORY_SEED_BINDING: '1' })).status).toBe(200);
    expect(rewards(db)).toBe(1);
    db.sql.close();
  });
});

describe('B3 — atomic admissions: delayed requests never overwrite or unbind a newer admission', { timeout: 120_000 }, () => {
  it('REPRO SEC006: a stale attempt request does NOT overwrite a newer seed-bound admission nor make it FREE', async () => {
    const { db, a, r: old } = await admitted('review_race', true);
    const staleRevision = await revisionOf(db, a.id, old); // the request read the old admission…
    const next: RunState = { ...old, currentEncounterId: ASCENT_CAMPAIGN.encounters[1]!.id };
    await saveCampaignStep(db, a.id, NOW, { run: next, storySeedBinding: true }); // …a victory/restart admitted the next one
    expect((await checkStoryAttempt(db, a.id, next, { seed: 42 })).result).toBe('NOT_ISSUED');
    // The request resumes: it must not touch the new admission.
    expect(await issueStoryAttempt(db, a.id, old, staleRevision, 99, NOW)).toBeNull();
    expect((await checkStoryAttempt(db, a.id, next, { seed: 42 })).result).toBe('NOT_ISSUED');
    expect((await checkStoryAttempt(db, a.id, next, { seed: 99 })).result).toBe('NOT_ISSUED');
    expect(admissions(db).map((x: Json) => [x.encounter_id, x.mode, x.close_reason])).toEqual([
      [old.currentEncounterId, 'BOUND', 'SUPERSEDED'], [next.currentEncounterId, 'BOUND', null],
    ]);
    expect(Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_story_attempt_receipts').get()!.n)).toBe(0);
    db.sql.close();
  });

  it('a stale request can neither reconcile a pre-ledger admission of a run that moved on', async () => {
    const db = memoryD1({ legacyProfiles: true }), a = addAccount(db, 'b3_preledger'), old = run();
    await createPlayer(db, a.id, 'b3_preledger', createProfile(STORY_CONTENT), [old], { source: 'STARTER', importedAt: null, now: 1000 });
    db.sql.exec(migration('0038_tactics_story_attempt_seeds.sql')); db.sql.exec(migration('0040_tactics_story_attempt_receipts.sql'));
    const stale = await revisionOf(db, a.id, old);
    const next: RunState = { ...old, currentEncounterId: ASCENT_CAMPAIGN.encounters[1]!.id };
    await saveCampaignStep(db, a.id, NOW, { run: next, storySeedBinding: true });
    expect(await issueStoryAttempt(db, a.id, old, stale, 5, NOW)).toBeNull();
    expect(admissions(db)).toEqual([expect.objectContaining({ encounter_id: next.currentEncounterId, mode: 'BOUND', close_reason: null })]);
    db.sql.close();
  });

  it('a victory verified against an admission that a restart superseded meanwhile never settles (no reward)', async () => {
    const { db, a, r } = await admitted('b3_restart', true);
    await issue(db, a.id, r, 42);
    const check = await checkStoryAttempt(db, a.id, r, { seed: 42 });
    expect(check.result).toBe('OK');
    await saveCampaignStep(db, a.id, NOW, { run: createRun(ASCENT_CAMPAIGN, STORY_CONTENT, 72, 'mage'), storySeedBinding: true }); // restart
    const before = rewards(db);
    await expect(saveCampaignStep(db, a.id, NOW, { run: { ...r, completedEncounterIds: [r.currentEncounterId] }, admissionGuard: check.admissionId!, log: undefined })).rejects.toThrow();
    expect(rewards(db)).toBe(before);
    expect((await loadWinterPlayer(db, a.id, STORY_CONTENT))!.runs.mage!.seed).toBe(72);
    db.sql.close();
  });

  it('concurrent attempt + victory + duplicate victory: one reward, the admission concludes, nothing else is touched', async () => {
    const { db, a, r } = await admitted('b3_concurrent', true);
    const proof = await winningProof(db, a.id, r);
    await attemptCall(db, a.token, proof.seed);
    const results = await Promise.all([victory(db, a.token, proof), attemptCall(db, a.token, 77), victory(db, a.token, proof), attemptCall(db, a.token, 78)]);
    expect([results[0]!.status, results[2]!.status]).toEqual([200, 200]);
    for (const res of [results[1]!, results[3]!]) expect([200, 409]).toContain(res.status);
    expect(rewards(db)).toBe(1);
    expect(admissions(db).filter((x: Json) => x.encounter_id === r.currentEncounterId)).toEqual([expect.objectContaining({ mode: 'BOUND', close_reason: 'CONCLUDED' })]);
    db.sql.close();
  });

  it('identity, mode and receipts are immutable; an admission closes once; account deletion cascades', async () => {
    const { db, a, r } = await admitted('b3_immutable', true);
    await issue(db, a.id, r, 42);
    expect(() => db.sql.exec("UPDATE tactics_story_attempt_admissions SET mode='LEGACY'")).toThrow(/immutable/);
    expect(() => db.sql.exec('UPDATE tactics_story_attempt_admissions SET encounter_id=\'x\'')).toThrow(/immutable/);
    expect(() => db.sql.exec('UPDATE tactics_story_attempt_receipts SET seed=7')).toThrow(/immutable/);
    db.sql.exec("UPDATE tactics_story_attempt_admissions SET closed_at=1, close_reason='SUPERSEDED'");
    expect(() => db.sql.exec("UPDATE tactics_story_attempt_admissions SET closed_at=2, close_reason='CONCLUDED'")).toThrow(/already closed/);
    db.sql.exec('DELETE FROM tactics_story_attempt_admissions'); // cascade path used by account deletion
    expect(Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_story_attempt_receipts').get()!.n)).toBe(0);
    db.sql.close();
  });
});

// ── SEC-002 / SEC-009 (B4, B5) ──────────────────────────────────────────────────────────────
class Sock {
  closed: { code?: number; reason?: string } | null = null;
  messages: string[] = [];
  constructor(public attachment: Json) {}
  deserializeAttachment() { return this.attachment; }
  serializeAttachment(v: Json) { this.attachment = v; }
  send(s: string) { this.messages.push(s); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
}
function hub(db: DB, sockets: Sock[] = []) {
  const store = new Map<string, unknown>();
  const h = new SocialHub({ storage: { get: async <T>(k: string) => store.get(k) as T, put: async (k: string, v: unknown) => void store.set(k, v) }, acceptWebSocket: () => {}, getWebSockets: () => sockets.filter((s) => !s.closed) } as never, { DB: db } as never);
  return { h, store, sockets };
}
function roomHarness(env: Json) {
  const data = new Map<string, unknown>();
  let init: Promise<unknown> = Promise.resolve();
  const sockets: Sock[] = [];
  const ctx = {
    storage: { get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined, put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), setAlarm: async () => {}, deleteAlarm: async () => {} },
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => { const p = fn(); init = p; return p; },
    acceptWebSocket: () => {},
    getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || String(s.attachment.seat) === tag)),
  };
  const room = new PvPMatchRoom(ctx as never, env as never);
  return { room, data, sockets, fetch: async (r: Request) => { await init; return room.fetch(r); } };
}
const pvpProfile = (() => { const p = createProfile(DEFAULT_CONTENT); p.heroes.mage = competitiveFixture('mage').profile.heroes.mage!; p.heroes.mage.activeDeckId = 'competitive'; return p; })();
async function createdRoom(db: DB) {
  const h = roomHarness({ DB: db });
  const post = (path: string, headers: Record<string, string> = {}) =>
    h.fetch(new Request('https://room/' + path, { method: 'POST', headers: { 'X-Pvp-User': '1', 'X-Pvp-Name': 'u1', ...headers }, body: JSON.stringify({ code: 'ABCDEFGH', mode: 'DUEL', mapId: 'classic', loadout: validateLoadout(pvpProfile, 'mage') }) }));
  expect((await post('create')).status).toBe(200);
  return { ...h, post };
}

describe('B4 — no socket or ticket without a verified session identity acts or receives private data', () => {
  it('REPRO SEC002: a legacy social attachment without sid receives NO private data after all sessions are revoked; it is asked to renew', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'review_legacy');
    const legacy = new Sock({ userId: a.id });
    const { h } = hub(db, [legacy]);
    db.sql.exec('DELETE FROM sessions');
    await h.fetch(new Request('https://hub/push', { method: 'POST', body: '{"private":"review-only"}' }));
    expect(legacy.messages).toEqual([]);
    expect(legacy.closed).toEqual({ code: 4402, reason: 'SESSION_RENEW_REQUIRED' });
    db.sql.close();
  });

  it('social: a legacy socket is asked to renew even while its session is alive; legacy tickets never open a socket; tickets need a sid', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'b4_social');
    const legacy = new Sock({ userId: a.id }), { h, store } = hub(db, [legacy]);
    await h.webSocketMessage(legacy as never, 'ping');
    expect(legacy.messages).toEqual([]); // not even a pong
    expect(legacy.closed?.code).toBe(4402);
    store.set('userId', a.id);
    store.set('tickets', { legacyNumber: Date.now() + 30_000, legacyNull: { expires: Date.now() + 30_000, sid: null } });
    for (const t of ['legacyNumber', 'legacyNull'])
      expect((await h.fetch(new Request(`https://hub/socket?ticket=${t}`, { headers: { Upgrade: 'websocket' } }))).status).toBe(401);
    expect((await h.fetch(new Request('https://hub/ticket', { method: 'POST', headers: { 'X-Social-User': String(a.id) } }))).status).toBe(503);
    db.sql.close();
  });

  it('PvP: a legacy attachment never applies an action nor receives a snapshot; the match and seat are untouched (no surrender)', async () => {
    const db = withPvp(memoryD1({ sessionDigest: true }));
    const { room, data, sockets } = await createdRoom(db);
    const legacy = new Sock({ seat: 0 }); sockets.push(legacy);
    const before = JSON.stringify(data.get('room'));
    await room.webSocketMessage(legacy as never, JSON.stringify({ type: 'surrender' }));
    expect(legacy.closed).toEqual({ code: 4402, reason: 'SESSION_RENEW_REQUIRED' });
    expect(legacy.messages).toEqual([]);
    expect(JSON.stringify(data.get('room'))).toBe(before);
    const second = new Sock({ seat: 0 }); sockets.push(second);
    (room as unknown as { broadcast(): void }).broadcast();
    expect(second.messages).toEqual([]);
    expect(second.closed?.code).toBe(4402);
    expect((data.get('room') as Room).result).toBeNull();
    db.sql.close();
  });

  it('PvP: a ticket issued before the deploy (no sid) is refused at upgrade; a new ticket always carries the sid', async () => {
    const db = withPvp(memoryD1({ sessionDigest: true }));
    const { room, post } = await createdRoom(db);
    expect((await post('connect')).status).toBe(503); // no session identity → retryable, nothing stored
    const issued = (await (await post('connect', { 'X-Pvp-Session': 'f'.repeat(64) })).json()) as Json;
    const live = room as unknown as { room: Room };
    expect(live.room.ticket[issued.ticket]).toMatchObject({ sid: 'f'.repeat(64) });
    live.room.ticket.legacy = { seat: 0, expires: Date.now() + 30_000 };
    const res = await room.fetch(new Request('https://room/socket?ticket=legacy', { headers: { Upgrade: 'websocket' } }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as Json).error.code).toBe('SESSION_RENEW_REQUIRED');
    expect(live.room.ticket.legacy).toBeUndefined();
    db.sql.close();
  });
});

describe('B5 — a backfill that could not be persisted is never treated as a revocation', () => {
  it('REPRO SEC002: a transient backfill failure no longer labels a live bearer REVOKED; tickets wait, HTTP keeps working', async () => {
    const db = withPvp(memoryD1({ sessionDigest: true, legacyProfiles: true })), a = addAccount(db, 'review_backfill');
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((q: string) => { if (q.startsWith('UPDATE sessions SET token_digest')) throw Error('temporary D1 write failure'); return original(q); });
    const s = await resolveSession(db, a.token, 1);
    expect(s).toMatchObject({ username: 'review_backfill', sid: null }); // live session, no unpersisted sid
    // HTTP keeps serving the account; socket tickets are refused with a retryable code instead.
    expect((await handle(req(a.token, '/profile', {}), { DB: db } as Env)).status).toBe(200);
    const seen: Request[] = [];
    const env = { DB: db, PVP_ROOMS: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => { seen.push(r); return Response.json({ ticket: 't' }); } }) }, SOCIAL_HUBS: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ticket: 't' }) }) } } as unknown as Env;
    await handle(req(a.token, '/pvp/connect', { code: 'ABCDEFGH' }), env);
    expect(seen[0]!.headers.get('X-Pvp-Session')).toBeNull(); // the room then answers 503 (see B4)
    const social = await handle(req(a.token, '/social/connect', {}), env);
    expect(social.status).toBe(503);
    expect(((await social.json()) as Json).error.code).toBe('SESSION_BINDING_RETRY');
    // Write path recovers: the next request persists the digest and the sid is issued and VALID.
    spy.mockRestore();
    const again = await resolveSession(db, a.token, 1);
    expect(again!.sid).toBe(await sessionDigest(a.token));
    expect(await checkSession(db, again!.sid, 1)).toBe('VALID');
    db.sql.close();
  });

  it('a lost backfill write (no error, nothing stored) is detected the same way', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'b5_lost');
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((q: string) => (q.startsWith('UPDATE sessions SET token_digest') ? original('SELECT 1') : original(q)));
    expect((await resolveSession(db, a.token, 1))!.sid).toBeNull();
    db.sql.close();
  });

  it('a real revocation after a persisted backfill still closes the socket (4401)', async () => {
    const db = memoryD1({ sessionDigest: true }), a = addAccount(db, 'b5_revoked');
    const { sid } = (await resolveSession(db, a.token, 1))!;
    expect(sid).toBe(await sessionDigest(a.token));
    db.sql.exec('DELETE FROM sessions');
    expect(await checkSession(db, sid, 1)).toBe('REVOKED');
    db.sql.close();
  });
});

// ── Migrations with pre-existing data ───────────────────────────────────────────────────────
describe('migrations 0037–0040 on a database with existing players', () => {
  it('are additive: sessions, profiles, runs and in-battle admissions are preserved; re-applying 0040 is a no-op', async () => {
    const db = memoryD1({ legacyProfiles: true, importClaims: false }), a = addAccount(db, 'mig_existing'), r = run();
    await createPlayer(db, a.id, 'mig_existing', createProfile(STORY_CONTENT), [r], { source: 'STARTER', importedAt: null, now: 1000 });
    const snapshot = () => JSON.stringify([
      db.sql.prepare('SELECT token, username, expires_at FROM sessions').all(),
      db.sql.prepare('SELECT * FROM tactics_profiles').all(),
      db.sql.prepare('SELECT user_id, campaign_id, hero_id, run_json, revision FROM tactics_hero_campaign_runs').all(),
      db.sql.prepare('SELECT * FROM tactics_player_cards ORDER BY hero_id, card_id').all(),
    ]);
    const before = snapshot();
    for (const f of ['0037_tactics_session_token_digest.sql', '0038_tactics_story_attempt_seeds.sql', '0039_tactics_import_claims.sql', '0040_tactics_story_attempt_receipts.sql']) db.sql.exec(migration(f));
    db.sql.exec(migration('0040_tactics_story_attempt_receipts.sql')); // IF NOT EXISTS throughout
    expect(snapshot()).toBe(before);
    expect(db.sql.prepare('SELECT token_digest FROM sessions').get()).toEqual({ token_digest: null });
    expect(db.sql.prepare('SELECT count(*) AS n FROM tactics_story_attempt_admissions').get()).toEqual({ n: 0 });
    // The existing session and in-battle run keep working after the migrations.
    expect((await resolveSession(db, a.token, 1))!.sid).toBe(await sessionDigest(a.token));
    const proof = await winningProof(db, a.id, r);
    expect((await victory(db, a.token, proof)).status).toBe(200);
    db.sql.close();
  });
});
