import type { D1Database, D1PreparedStatement } from './db';
import type { RunState } from '../../src/game';

/**
 * SEC-006 — Story victories of a seed-bound admission replay with a battle seed the SERVER issued
 * for that admission, never one the client picked. Frozen engines are untouched: only the seed fed
 * to them is checked here, in the admission layer, before any replay (migration 0040).
 *
 * Admission ledger (`tactics_story_attempt_admissions`): every admission gets an immutable identity
 * and a durable mode in the same batch as the run write that admits it.
 * - LEGACY: created while STORY_SEED_BINDING was off, or reconciled for an admission that predates
 *   the ledger. Victories keep the legacy free-seed verification until the admission closes.
 *   Issuing attempts never binds it (independent review B2).
 * - BOUND: created while STORY_SEED_BINDING was on. Its victory must use one of ITS receipts.
 * Receipts (`tactics_story_attempt_receipts`) are never evicted while the admission exists (B1): a
 * pending victory stays verifiable however many attempts other devices or tabs request. Issuing is
 * conditioned atomically on the admission still being open, so a delayed request can never touch a
 * newer admission (B3), and identities are insert-only (no UPSERT can overwrite an admission).
 */
export type AttemptResult =
  /** No ledger (Worker ahead of migration 0040): legacy behaviour. */
  | 'FREE'
  /** LEGACY admission: legacy free-seed verification. */
  | 'LEGACY'
  /** The run's admission has no ledger row (written before 0040 or by a Worker without it). */
  | 'UNTRACKED'
  | 'OK'
  | 'NOT_ISSUED'
  | 'WRONG_SEED';
export type AdmissionMode = 'LEGACY' | 'BOUND';
export interface AttemptCheck { result: AttemptResult; admissionId: string | null; mode: AdmissionMode | null; seedIssued: boolean }

/**
 * Receipts kept per admission. Past it, a new request re-issues the latest receipt instead of
 * adding a row: storage stays bounded and NO receipt is ever evicted (a cap on growth, not a
 * window). Only reachable by retrying one encounter more than this many times.
 */
export const RECEIPTS_PER_ADMISSION = 256;

const ADMISSIONS = 'tactics_story_attempt_admissions';
const RECEIPTS = 'tactics_story_attempt_receipts';

type AdmissionRow = { admission_id: string; run_seed: number; encounter_id: string; mode: AdmissionMode; closed_at: number | null };

const missingTable = (cause: unknown) => cause instanceof Error && /no such table/i.test(cause.message);
const slot = (userId: number, run: Pick<RunState, 'campaignId' | 'heroId'>) => [userId, run.campaignId, run.heroId] as const;
const matches = (row: AdmissionRow | null, run: RunState): row is AdmissionRow =>
  !!row && row.run_seed === run.seed >>> 0 && row.encounter_id === run.currentEncounterId;

/** One schema read for both Story tables a run write may need (rule registry + attempt ledger). */
export async function storySchema(db: D1Database): Promise<{ versioned: boolean; ledger: boolean }> {
  const { results } = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tactics_story_versioned_encounters','${ADMISSIONS}')`)
    .all<{ name: string }>();
  const names = new Set(results.map((r) => r.name));
  return { versioned: names.has('tactics_story_versioned_encounters'), ledger: names.has(ADMISSIONS) };
}

/**
 * Ledger statements of a run write, for the same batch (atomic with the run itself).
 * - IN_BATTLE: any other open admission of this slot is SUPERSEDED; the run's admission is created
 *   once with its mode (re-saving the same admission keeps it untouched).
 * - Any other status: the encounter is over; its admission is CONCLUDED (others SUPERSEDED).
 */
export function admissionStatements(db: D1Database, userId: number, run: RunState, now: number, bound: boolean): D1PreparedStatement[] {
  const s = slot(userId, run), seed = run.seed >>> 0, enc = run.currentEncounterId;
  if (run.status !== 'IN_BATTLE')
    return [db.prepare(`UPDATE ${ADMISSIONS} SET closed_at=?, close_reason=CASE WHEN run_seed=? AND encounter_id=? THEN 'CONCLUDED' ELSE 'SUPERSEDED' END
      WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed_at IS NULL`).bind(now, seed, enc, ...s)];
  return [
    db.prepare(`UPDATE ${ADMISSIONS} SET closed_at=?, close_reason='SUPERSEDED'
      WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed_at IS NULL AND NOT (run_seed=? AND encounter_id=?)`).bind(now, ...s, seed, enc),
    db.prepare(`INSERT INTO ${ADMISSIONS}(admission_id,user_id,campaign_id,hero_id,run_seed,encounter_id,mode,origin,created_at)
      SELECT ?,?,?,?,?,?,?,'ADMITTED',? WHERE NOT EXISTS (SELECT 1 FROM ${ADMISSIONS} WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed_at IS NULL)`)
      .bind(crypto.randomUUID(), ...s, seed, enc, bound ? 'BOUND' : 'LEGACY', now, ...s),
  ];
}

/**
 * Same-batch guard for a victory: aborts the whole batch (save_version is NOT NULL) unless the
 * admission that was checked is still open — a restart or another device's write in between can
 * never let a victory settle against an admission that is no longer current.
 */
export function admissionStillOpen(db: D1Database, userId: number, admissionId: string): D1PreparedStatement {
  return db
    .prepare(`UPDATE tactics_profiles SET save_version = CASE WHEN EXISTS (SELECT 1 FROM ${ADMISSIONS} WHERE admission_id=? AND user_id=? AND closed_at IS NULL) THEN save_version ELSE NULL END WHERE user_id=?`)
    .bind(admissionId, userId, userId);
}

/** The confirmed victory closes the admission it was verified against (same batch, before the run write). */
export function concludeAdmission(db: D1Database, userId: number, admissionId: string, now: number): D1PreparedStatement {
  return db
    .prepare(`UPDATE ${ADMISSIONS} SET closed_at=?, close_reason='CONCLUDED' WHERE admission_id=? AND user_id=? AND closed_at IS NULL`)
    .bind(now, admissionId, userId);
}

async function openAdmission(db: D1Database, userId: number, run: RunState): Promise<AdmissionRow | null> {
  return db
    .prepare(`SELECT admission_id,run_seed,encounter_id,mode,closed_at FROM ${ADMISSIONS} WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed_at IS NULL`)
    .bind(...slot(userId, run))
    .first<AdmissionRow>();
}

/**
 * The run's current admission. An admission without a ledger row (it predates migration 0040, or a
 * Worker without the ledger wrote the run) is recorded once as LEGACY/RECONCILED — conditioned on
 * the run revision the caller read, so a delayed request never records anything for a run that
 * has moved on. Returns null when the run changed meanwhile.
 */
async function currentAdmission(db: D1Database, userId: number, run: RunState, revision: number | undefined, now: number) {
  const open = await openAdmission(db, userId, run);
  if (matches(open, run)) return open;
  if (revision === undefined) return null;
  const s = slot(userId, run), seed = run.seed >>> 0, enc = run.currentEncounterId;
  const unchanged = 'EXISTS (SELECT 1 FROM tactics_hero_campaign_runs WHERE user_id=? AND campaign_id=? AND hero_id=? AND revision=?)';
  await db.batch([
    db.prepare(`UPDATE ${ADMISSIONS} SET closed_at=?, close_reason='SUPERSEDED'
      WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed_at IS NULL AND NOT (run_seed=? AND encounter_id=?) AND ${unchanged}`)
      .bind(now, ...s, seed, enc, ...s, revision),
    db.prepare(`INSERT INTO ${ADMISSIONS}(admission_id,user_id,campaign_id,hero_id,run_seed,encounter_id,mode,origin,created_at)
      SELECT ?,?,?,?,?,?,'LEGACY','RECONCILED',? WHERE NOT EXISTS (SELECT 1 FROM ${ADMISSIONS} WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed_at IS NULL) AND ${unchanged}`)
      .bind(crypto.randomUUID(), ...s, seed, enc, now, ...s, ...s, revision),
  ]);
  const after = await openAdmission(db, userId, run);
  return matches(after, run) ? after : null;
}

export async function checkStoryAttempt(db: D1Database, userId: number, run: RunState, proof: unknown): Promise<AttemptCheck> {
  let open: AdmissionRow | null;
  try {
    open = await openAdmission(db, userId, run);
  } catch (cause) {
    if (missingTable(cause)) return { result: 'FREE', admissionId: null, mode: null, seedIssued: false };
    throw cause;
  }
  if (!matches(open, run)) return { result: 'UNTRACKED', admissionId: null, mode: null, seedIssued: false };
  const raw = (proof as { seed?: unknown } | null)?.seed;
  const seed = typeof raw === 'number' && Number.isSafeInteger(raw) ? raw >>> 0 : -1;
  const issued = await db
    .prepare(`SELECT count(*) AS n, coalesce(sum(seed = ?), 0) AS hit FROM ${RECEIPTS} WHERE admission_id=?`)
    .bind(seed, open.admission_id)
    .first<{ n: number; hit: number }>();
  const seedIssued = Number(issued?.hit ?? 0) > 0;
  const base = { admissionId: open.admission_id, mode: open.mode, seedIssued };
  if (open.mode === 'LEGACY') return { result: 'LEGACY', ...base };
  if (!Number(issued?.n ?? 0)) return { result: 'NOT_ISSUED', ...base };
  return { result: seedIssued ? 'OK' : 'WRONG_SEED', ...base };
}

export interface AttemptReceipt {
  attemptId: string; admissionId: string; seq: number; seed: number; mode: AdmissionMode; reissued: boolean;
  campaignId: string; heroId: string; runSeed: number; encounterId: string;
}

/**
 * Issues the next attempt of the run's current admission (never changes its mode). Returns null
 * when the admission changed meanwhile (the caller answers 409 and the client refreshes), and
 * 'UNAVAILABLE' while migration 0040 is missing (no binding can exist then either).
 */
export async function issueStoryAttempt(db: D1Database, userId: number, run: RunState, revision: number | undefined, seed: number, now: number): Promise<AttemptReceipt | null | 'UNAVAILABLE'> {
  let admission: AdmissionRow | null;
  try {
    admission = await currentAdmission(db, userId, run, revision, now);
  } catch (cause) {
    if (missingTable(cause)) return 'UNAVAILABLE'; // Worker ahead of 0040: the client keeps a local seed
    throw cause;
  }
  if (!admission) return null;
  const attemptId = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO ${RECEIPTS}(attempt_id,admission_id,seq,seed,issued_at)
      SELECT ?, a.admission_id, (SELECT count(*) FROM ${RECEIPTS} r WHERE r.admission_id=a.admission_id)+1, ?, ?
      FROM ${ADMISSIONS} a WHERE a.admission_id=? AND a.user_id=? AND a.closed_at IS NULL
        AND (SELECT count(*) FROM ${RECEIPTS} r WHERE r.admission_id=a.admission_id) < ?`)
    .bind(attemptId, seed >>> 0, now, admission.admission_id, userId, RECEIPTS_PER_ADMISSION)
    .run();
  type R = { attempt_id: string; seq: number; seed: number };
  let row = await db.prepare(`SELECT attempt_id,seq,seed FROM ${RECEIPTS} WHERE attempt_id=?`).bind(attemptId).first<R>();
  let reissued = false;
  if (!row) {
    // Closed meanwhile (victory, restart, another device) → the caller refreshes; or the cap was
    // reached → the latest receipt is re-issued (nothing is evicted).
    const still = await db.prepare(`SELECT closed_at FROM ${ADMISSIONS} WHERE admission_id=?`).bind(admission.admission_id).first<{ closed_at: number | null }>();
    if (!still || still.closed_at !== null) return null;
    row = await db.prepare(`SELECT attempt_id,seq,seed FROM ${RECEIPTS} WHERE admission_id=? ORDER BY seq DESC LIMIT 1`).bind(admission.admission_id).first<R>();
    if (!row) return null;
    reissued = true;
  }
  return {
    attemptId: row.attempt_id, admissionId: admission.admission_id, seq: row.seq, seed: row.seed >>> 0, mode: admission.mode, reissued,
    campaignId: run.campaignId, heroId: run.heroId, runSeed: run.seed >>> 0, encounterId: run.currentEncounterId,
  };
}
