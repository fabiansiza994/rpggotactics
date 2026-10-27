import type { RunState, VictoryProof } from '../../game';
import { MAX_PROOF_COMMANDS, parseCommand } from '../../game/run/verify';
const key = (username: string) => `rpg-go-tactics:pending-victory:${username}`;
export interface PendingVictory {
  runSeed: number;
  /** Champion whose run the victory belongs to (journals from before it are Mage runs). */
  heroId: string;
  /** Campaign (world) of that run; journals from before worlds are World 1 ('ascent'). */
  campaignId: string;
  proof: VictoryProof;
}
const memory = new Map<string, PendingVictory>();
export function pendingVictory(username: string): PendingVictory | null {
  if (memory.has(username)) return memory.get(username)!;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(key(username)) ?? 'null',
    ) as (Omit<PendingVictory, 'heroId' | 'campaignId'> & { heroId?: unknown; campaignId?: unknown }) | null;
    return value &&
      (value.heroId === undefined || typeof value.heroId === 'string') &&
      (value.campaignId === undefined || typeof value.campaignId === 'string') &&
      Number.isInteger(value.runSeed) &&
      value.proof &&
      typeof value.proof.encounterId === 'string' &&
      Number.isInteger(value.proof.seed) &&
      Array.isArray(value.proof.commands) &&
      value.proof.commands.length <= MAX_PROOF_COMMANDS &&
      value.proof.commands.every((command) => parseCommand(command) !== null)
      ? {
          ...value,
          heroId: typeof value.heroId === 'string' ? value.heroId : 'mage',
          campaignId: typeof value.campaignId === 'string' ? value.campaignId : 'ascent',
        }
      : null;
  } catch {
    return null;
  }
}
export function keepVictory(username: string, run: RunState, proof: VictoryProof): void {
  const pending: PendingVictory = { runSeed: run.seed, heroId: run.heroId, campaignId: run.campaignId, proof };
  memory.set(username, pending);
  try {
    window.localStorage.setItem(key(username), JSON.stringify(pending));
  } catch {
    /* In-memory engine/proof still permits retry in this session. */
  }
}
export function clearVictory(username: string): void {
  memory.delete(username);
  try {
    window.localStorage.removeItem(key(username));
  } catch {
    /* Server completion makes a remaining journal harmless. */
  }
}
