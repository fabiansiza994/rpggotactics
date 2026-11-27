import type { RunState } from '../../game';
import type { AttemptReceipt } from '../cloud/api';
import { freshBattleSeed } from './battleSeed';

/**
 * SEC-006 (Security Hardening 1.0) — signed-in Story battles use a battle seed the server issued
 * for the run's current admission (`POST /campaign/attempt`). Battle starts stay synchronous: the
 * next receipt is prefetched while the player is on the map or fighting, and consumed at start.
 *
 * The server keeps every receipt of an admission until the admission closes, so a battle started
 * with any issued receipt stays verifiable after reloads, other devices/tabs requesting attempts
 * and lost responses. Receipts are persisted per account on this device (`store`): a reload or a
 * battle started offline reuses an issued receipt instead of a seed the server never issued.
 * Without any receipt, a local seed is used only while new admissions are not seed-bound (the
 * legacy behaviour); with binding on, `take` returns null and the caller shows a recoverable
 * "connect to start" message instead of starting a battle whose victory could not be verified.
 */
/**
 * A locally kept, not yet confirmed victory of this admission is re-submitted before any new
 * attempt is requested for it (no receipt is needed to confirm a result already obtained).
 */
export const pendingBlocksPrefetch = (
  run: Pick<RunState, 'heroId' | 'campaignId' | 'seed' | 'currentEncounterId'>,
  pending: { heroId: string; campaignId: string; runSeed: number; proof: { encounterId: string } } | null,
): boolean =>
  !!pending && pending.heroId === run.heroId && pending.campaignId === run.campaignId && pending.runSeed === run.seed && pending.proof.encounterId === run.currentEncounterId;

export type AttemptGrant = AttemptReceipt;
export type AttemptFetch = (run: RunState) => Promise<AttemptGrant | null>;
/** Issued-but-unused (`ready`) and last used (`last`) receipt of one admission. */
export interface StoredAttempt { ready?: AttemptGrant; last?: AttemptGrant }
export interface ReceiptStore { load(): Record<string, StoredAttempt>; save(all: Record<string, StoredAttempt>): void }

const keyOf = (r: { campaignId: string; heroId: string }, runSeed: number, encounterId: string) =>
  `${r.campaignId}:${r.heroId}:${runSeed >>> 0}:${encounterId}`;
export const admissionKey = (run: Pick<RunState, 'campaignId' | 'heroId' | 'seed' | 'currentEncounterId'>) =>
  keyOf(run, run.seed, run.currentEncounterId);
const validGrant = (g: unknown): g is AttemptGrant => {
  const v = g as AttemptGrant | null;
  return !!v && Number.isSafeInteger(v.seed) && typeof v.campaignId === 'string' && typeof v.heroId === 'string' && Number.isSafeInteger(v.runSeed) && typeof v.encounterId === 'string';
};

/** Receipts of one account on this device (never shared across accounts; malformed data ignored). */
export function localReceiptStore(username: string, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): ReceiptStore {
  const key = `rpg-go-tactics:story-attempts:${username}`;
  return {
    load() {
      try {
        const raw = JSON.parse(storage.getItem(key) ?? '{}') as Record<string, StoredAttempt>;
        const out: Record<string, StoredAttempt> = {};
        for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
          const entry: StoredAttempt = {};
          if (validGrant(v?.ready) && keyOf(v.ready, v.ready.runSeed, v.ready.encounterId) === k) entry.ready = v.ready;
          if (validGrant(v?.last) && keyOf(v.last, v.last.runSeed, v.last.encounterId) === k) entry.last = v.last;
          if (entry.ready || entry.last) out[k] = entry;
        }
        return out;
      } catch {
        return {};
      }
    },
    save(all) {
      try {
        storage.setItem(key, JSON.stringify(all));
      } catch {
        /* storage full or disabled: the in-memory receipts still serve this session */
      }
    },
  };
}

export function createStoryAttemptSeeds(
  fetchAttempt: AttemptFetch,
  options: { store?: () => ReceiptStore | null; binding?: () => boolean } = {},
) {
  let memory: Record<string, StoredAttempt> | null = null;
  // A prefetch already running is shared: awaiting prefetch() always waits for the issued receipt.
  const inFlight = new Map<string, Promise<void>>();
  let generation = 0;

  const all = (): Record<string, StoredAttempt> => (memory ??= options.store?.()?.load() ?? {});
  function write(key: string, entry: StoredAttempt): void {
    const next = { ...all() };
    if (entry.ready || entry.last) next[key] = entry;
    else delete next[key];
    memory = next;
    options.store?.()?.save(next);
  }

  function prefetch(run: RunState): Promise<void> {
    if (run.status !== 'IN_BATTLE') return Promise.resolve();
    const key = admissionKey(run);
    if (all()[key]?.ready) return Promise.resolve();
    const running = inFlight.get(key);
    if (running) return running;
    const epoch = generation;
    let work: Promise<void> | undefined = undefined;
    work = (async () => {
      try {
        const grant = await fetchAttempt(run);
        if (epoch !== generation || !validGrant(grant)) return;
        if (keyOf(grant, grant.runSeed, grant.encounterId) === key) write(key, { ...all()[key], ready: grant });
      } catch {
        /* offline / older Worker: take() falls back to a stored receipt */
      } finally {
        if (inFlight.get(key) === work) inFlight.delete(key);
      }
    })();
    inFlight.set(key, work);
    return work;
  }

  /**
   * Seed for a battle about to start: the unused receipt, else the last used one (same admission,
   * still verifiable), else a local seed while admissions are not seed-bound. Null means "a
   * receipt is required and none is available" (offline with binding on): do not start.
   */
  function take(run: RunState): number | null {
    const key = admissionKey(run);
    const entry = all()[key];
    if (entry?.ready) write(key, { last: entry.ready });
    void prefetch(run);
    const receipt = entry?.ready ?? entry?.last;
    if (receipt) return receipt.seed >>> 0;
    return options.binding?.() ? null : freshBattleSeed();
  }

  /** Drops receipts of admissions that are no longer current (keeps only the given runs). */
  function retain(runs: readonly RunState[]): void {
    const keep = new Set(runs.filter((r) => r.status === 'IN_BATTLE').map(admissionKey));
    const current = all();
    const next = Object.fromEntries(Object.entries(current).filter(([k]) => keep.has(k)));
    if (Object.keys(next).length === Object.keys(current).length) return;
    memory = next;
    options.store?.()?.save(next);
  }

  /** Sign-out / account switch: forget this session's receipts in memory (each account keeps its own on the device). */
  function reset(): void {
    generation++;
    memory = null;
    inFlight.clear();
  }

  return { prefetch, take, retain, reset };
}
