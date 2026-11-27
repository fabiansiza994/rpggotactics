/**
 * Security Hardening 1.0 — SEC-006 compatibility: server-issued attempt seeds on the FROZEN
 * Winter Dominion engine, and the client prefetch module (retries, reload, offline, sign-out).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { memoryD1, addAccount } from './support/d1';
import { createPlayer as winterCreate } from '../qa/story-versioning-20261125/winter-handler.mjs';
import { handle } from '../server/src/index';
import { createPlayer } from '../server/src/repo';
import { loadWinterPlayer, versionedSnapshot } from '../server/src/winterCampaign';
import { storyBattle, STORY_CONTENT } from '../src/game/run/story-rules';
import { createProfile, createRun, ASCENT_CAMPAIGN, type PlayerProfile, type VictoryProof } from '../src/game';
import { createStoryAttemptSeeds, localReceiptStore, pendingBlocksPrefetch } from '../src/presentation/store/storyAttemptSeeds';
import { playBattle } from './support/bot';

const migration = readFileSync(new URL('../server/migrations/0036_tactics_story_rule_versions.sql', import.meta.url), 'utf8');
const attempts = readFileSync(new URL('../server/migrations/0038_tactics_story_attempt_seeds.sql', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../server/migrations/0040_tactics_story_attempt_receipts.sql', import.meta.url), 'utf8');
const run = createRun(ASCENT_CAMPAIGN, STORY_CONTENT, 71, 'summoner');
let profile: PlayerProfile, proof: VictoryProof;

function makeProfile() {
  const p = createProfile(STORY_CONTENT), deck = p.heroes.summoner!.decks[0]!.cards;
  p.heroes.summoner!.collection.dark_scorpion_king = { copies: 1, acquired: 0 };
  const last = deck.at(-1)!; last.count--; if (!last.count) deck.pop();
  deck.push({ cardId: 'dark_scorpion_king', count: 1 }); deck.sort((a, b) => a.cardId.localeCompare(b.cardId));
  return p;
}
beforeAll(() => {
  profile = makeProfile();
  for (let seed = 1; seed <= 100 && !proof; seed++) {
    const e = storyBattle('winter-dominion-1', profile, run, seed);
    playBattle(e, 35, undefined, { summonAware: true, summonLookahead: true, antiStall: true });
    if (e.state.outcome?.result === 'WON') proof = { encounterId: run.currentEncounterId, seed, commands: e.history } as VictoryProof;
  }
  if (!proof) throw Error('no winning frozen-engine replay');
}, 120_000);

/**
 * A Winter Dominion admission on the FROZEN engine. `bound` models that admission being created by
 * this Worker while STORY_SEED_BINDING was on (ledger row BOUND); otherwise it predates the ledger.
 */
async function frozenFixture(options: { bound?: boolean } = {}) {
  const db = memoryD1({ legacyProfiles: true, storyVersioning: false }), a = addAccount(db, 'sec6-frozen');
  await winterCreate(db, a.id, 'sec6-frozen', profile, [run], { source: 'QA_BALANCE', importedAt: null, now: 1000 });
  db.sql.exec(migration); db.sql.exec("UPDATE tactics_story_rule_transition SET phase='ACTIVE'"); db.sql.exec(attempts); db.sql.exec(ledger);
  if (options.bound)
    db.sql.prepare("INSERT INTO tactics_story_attempt_admissions(admission_id,user_id,campaign_id,hero_id,run_seed,encounter_id,mode,origin,created_at) VALUES ('frozen-bound-admission-0001',?,?,?,?,?,'BOUND','ADMITTED',1000)")
      .run(a.id, run.campaignId, run.heroId, run.seed >>> 0, run.currentEncounterId);
  return { db, a };
}
const call = (f: Awaited<ReturnType<typeof frozenFixture>>, path: string, body: unknown, seed = 912, env: Record<string, string> = {}) =>
  handle(new Request('https://qa.local/api/tactics/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + f.a.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { DB: f.db, RELEASE2_MAINTENANCE: '0', SUMMONER_CAMPAIGN: '1', ...env }, { content: STORY_CONTENT, now: () => 3000, seed: () => seed });
const rewards = (f: Awaited<ReturnType<typeof frozenFixture>>) => Number(f.db.sql.prepare("SELECT count(*) n FROM tactics_reward_log WHERE event IN ('OFFERED','NO_DROP')").get()!.n);

describe('SEC-006 on the frozen Winter Dominion engine', { timeout: 120_000 }, () => {
  it('the admitted frozen engine is untouched and still verifies a free-seed victory (admission before the ledger)', async () => {
    const f = await frozenFixture();
    const r = (await loadWinterPlayer(f.db, f.a.id, STORY_CONTENT))!;
    expect(versionedSnapshot(r, run)?.rules).toBe('winter-dominion-1');
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof })).status).toBe(200);
  });
  it('B2: issuing attempts never binds an older admission, even with STORY_SEED_BINDING on (recorded LEGACY once)', async () => {
    const f = await frozenFixture();
    for (const env of [{}, { STORY_SEED_BINDING: '1' }] as Record<string, string>[])
      expect((await call(f, 'campaign/attempt', { heroId: 'summoner' }, (proof.seed + 7) >>> 0, env)).status).toBe(200);
    expect(f.db.sql.prepare('SELECT mode, origin FROM tactics_story_attempt_admissions').all()).toEqual([{ mode: 'LEGACY', origin: 'RECONCILED' }]);
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof }, 912, { STORY_SEED_BINDING: '1' })).status).toBe(200);
    expect(rewards(f)).toBe(1);
  });
  it('a BOUND frozen admission only accepts its receipts; the issued one wins once with one reward', async () => {
    const f = await frozenFixture({ bound: true });
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof })).status).toBe(409); // STORY_ATTEMPT_REQUIRED
    expect((await call(f, 'campaign/attempt', { heroId: 'summoner' }, (proof.seed + 1) >>> 0)).status).toBe(200);
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof })).status).toBe(422);
    expect(rewards(f)).toBe(0);
    expect((await call(f, 'campaign/attempt', { heroId: 'summoner' }, proof.seed)).status).toBe(200);
    const results = await Promise.all([call(f, 'campaign/victory', { heroId: 'summoner', proof }), call(f, 'campaign/victory', { heroId: 'summoner', proof })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]); // one wins, the other recovers the durable result
    expect(rewards(f)).toBe(1);
    expect(f.db.sql.prepare('SELECT COUNT(*) n FROM tactics_story_verified_proofs').get()).toEqual({ n: 1 });
    expect(f.db.sql.prepare('SELECT close_reason FROM tactics_story_attempt_admissions').get()).toEqual({ close_reason: 'CONCLUDED' });
  });
  it('B1: a pending victory survives 40 newer attempts from other devices, a reload and a lost response; confirmed once', async () => {
    const f = await frozenFixture({ bound: true });
    await call(f, 'campaign/attempt', { heroId: 'summoner' }, proof.seed); // the battle that was won
    for (let i = 0; i < 40; i++) await call(f, 'campaign/attempt', { heroId: 'summoner' }, 1000 + i); // other devices / tabs
    expect(Number(f.db.sql.prepare('SELECT count(*) n FROM tactics_story_attempt_receipts').get()!.n)).toBe(41); // nothing evicted
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof })).status).toBe(200);
    // Connection lost after commit → the client re-sends the same pending result: no second reward.
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof })).status).toBe(200);
    expect(rewards(f)).toBe(1);
  });
  it('receipts belong to one account: a seed issued to another account never validates this account\'s victory', async () => {
    const f = await frozenFixture({ bound: true });
    const other = addAccount(f.db, 'sec6-frozen-other');
    await createPlayer(f.db, other.id, 'sec6-frozen-other', profile, [run], { source: 'QA_BALANCE', importedAt: null, now: 1000, storySeedBinding: true });
    const asOther = (path: string, body: unknown, seed = 912) => handle(new Request('https://qa.local/api/tactics/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + other.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { DB: f.db, RELEASE2_MAINTENANCE: '0', SUMMONER_CAMPAIGN: '1' }, { content: STORY_CONTENT, now: () => 3000, seed: () => seed });
    expect((await asOther('campaign/attempt', { heroId: 'summoner' }, proof.seed)).status).toBe(200); // issued to the OTHER account
    await call(f, 'campaign/attempt', { heroId: 'summoner' }, 4242);      // this account's own attempt
    expect((await call(f, 'campaign/victory', { heroId: 'summoner', proof })).status).toBe(422);
    expect(rewards(f)).toBe(0);
  });
});

describe('SEC-006 client prefetch (storyAttemptSeeds)', () => {
  const r = { campaignId: 'ascent', heroId: 'mage', seed: 71, currentEncounterId: 'e1', status: 'IN_BATTLE' } as never;
  it('uses the issued seed, then prefetches the next one for a retry', async () => {
    let n = 100; const fetchAttempt = vi.fn(async () => ({ seed: n++, campaignId: 'ascent', heroId: 'mage', runSeed: 71, encounterId: 'e1' }));
    const seeds = createStoryAttemptSeeds(fetchAttempt);
    await seeds.prefetch(r);
    expect(seeds.take(r)).toBe(100);
    await vi.waitFor(() => expect(fetchAttempt).toHaveBeenCalledTimes(2));
    expect(seeds.take(r)).toBe(101);
  });
  it('offline/old Worker: reuses the last issued seed of the same encounter, else a local seed', async () => {
    let fail = false; const seeds = createStoryAttemptSeeds(async () => { if (fail) throw new Error('offline'); return { seed: 42, campaignId: 'ascent', heroId: 'mage', runSeed: 71, encounterId: 'e1' }; });
    await seeds.prefetch(r); fail = true;
    expect(seeds.take(r)).toBe(42);
    await Promise.resolve();
    expect(seeds.take(r)).toBe(42);
    const fresh = createStoryAttemptSeeds(async () => null);
    expect(typeof fresh.take(r)).toBe('number');
  });
  it('receipts persist per account on the device: a reload or an offline start reuses an issued receipt', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const online = createStoryAttemptSeeds(async () => ({ seed: 4242, campaignId: 'ascent', heroId: 'mage', runSeed: 71, encounterId: 'e1', attemptId: 'a'.repeat(36), admissionId: 'b'.repeat(36), mode: 'BOUND' }), { store: () => localReceiptStore('ana', storage), binding: () => true });
    await online.prefetch(r);
    // Reload, now offline: a new module instance only has what the device kept.
    const offline = createStoryAttemptSeeds(async () => { throw new Error('offline'); }, { store: () => localReceiptStore('ana', storage), binding: () => true });
    expect(offline.take(r)).toBe(4242);
    expect(offline.take(r)).toBe(4242); // retry of the same admission keeps an issued receipt
    // Another account on the same device never sees ana's receipts; bound + no receipt → do not start.
    const other = createStoryAttemptSeeds(async () => { throw new Error('offline'); }, { store: () => localReceiptStore('bea', storage), binding: () => true });
    expect(other.take(r)).toBeNull();
    // Without binding (switch off) the legacy local seed is still used.
    const legacy = createStoryAttemptSeeds(async () => { throw new Error('offline'); }, { store: () => localReceiptStore('bea', storage), binding: () => false });
    expect(typeof legacy.take(r)).toBe('number');
    // Closed admissions are pruned; malformed stored data is ignored.
    offline.retain([]);
    expect(JSON.parse(data.get('rpg-go-tactics:story-attempts:ana')!)).toEqual({});
    data.set('rpg-go-tactics:story-attempts:ana', '{"x":{"ready":{"seed":"no"}}}');
    expect(localReceiptStore('ana', storage).load()).toEqual({});
  });
  it('never uses a seed issued for another encounter, run or account (reset on sign-out)', async () => {
    const seeds = createStoryAttemptSeeds(async () => ({ seed: 9, campaignId: 'ascent', heroId: 'mage', runSeed: 71, encounterId: 'OTHER' }));
    await seeds.prefetch(r);
    expect(seeds.take(r)).not.toBe(9);
    const s2 = createStoryAttemptSeeds(async () => ({ seed: 10, campaignId: 'ascent', heroId: 'mage', runSeed: 71, encounterId: 'e1' }));
    await s2.prefetch(r); s2.reset();
    expect(s2.take(r)).not.toBe(10);
  });
  it('awaiting a prefetch that is already running waits for the issued seed (first battle uses it)', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const fetchAttempt = vi.fn(async () => { await gate; return { seed: 77, campaignId: 'ascent', heroId: 'mage', runSeed: 71, encounterId: 'e1' }; });
    const seeds = createStoryAttemptSeeds(fetchAttempt);
    void seeds.prefetch(r); // background prefetch after the state is applied
    const awaited = seeds.prefetch(r); // startRun awaits before beginning the battle
    release(); await awaited;
    expect(fetchAttempt).toHaveBeenCalledTimes(1);
    expect(seeds.take(r)).toBe(77);
  });
  it('an admission with an unconfirmed (pending) victory is not prefetched, so its seed is never aged by reloads', () => {
    const pending = { heroId: 'mage', campaignId: 'ascent', runSeed: 71, proof: { encounterId: 'e1' } };
    expect(pendingBlocksPrefetch(r as never, pending)).toBe(true);
    expect(pendingBlocksPrefetch({ ...(r as object), currentEncounterId: 'e2' } as never, pending)).toBe(false); // next encounter
    expect(pendingBlocksPrefetch({ ...(r as object), heroId: 'summoner' } as never, pending)).toBe(false);       // other champion
    expect(pendingBlocksPrefetch(r as never, null)).toBe(false);
  });
  it('guests and finished runs never request attempts', async () => {
    const fetchAttempt = vi.fn(async () => null);
    const seeds = createStoryAttemptSeeds(fetchAttempt);
    await seeds.prefetch({ ...(r as object), status: 'CHOOSING_REWARD' } as never);
    expect(fetchAttempt).not.toHaveBeenCalled();
  });
});
