import { isCardForHero } from '../collection/deck-rules';
import type { GameContent } from '../domain/content';
import { encounterOrder, supportsHero, type CampaignDef } from './encounter';
import type { RewardOption } from './rewards';
import type { RunState, RunStatus } from './run';

/**
 * Versioned save of the campaign progression (RunState only — never a battle in progress:
 * an interrupted battle restarts from its encounter). Bump the version when RunState changes
 * shape and add a migration step in `migrate`.
 */
export const RUN_SAVE_VERSION = 2;

interface RunSaveV2 {
  version: 2;
  run: RunState;
}

export type RunLoad =
  | { status: 'EMPTY' }
  | { status: 'OK'; run: RunState }
  /** Unusable data (corrupt JSON, unknown version, refers to content that no longer exists). */
  | { status: 'INVALID'; reason: string };

export function serializeRun(run: RunState): string {
  const save: RunSaveV2 = { version: RUN_SAVE_VERSION, run };
  return JSON.stringify(save);
}

const RUN_STATUSES: readonly RunStatus[] = ['IN_BATTLE', 'CHOOSING_REWARD', 'COMPLETED'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A card reward must exist and belong to the run's champion (or be neutral). */
function rewardError(o: unknown, content: GameContent, heroId: string): string | null {
  if (!isRecord(o) || typeof o.id !== 'string') return 'malformed reward';
  if (o.kind === 'ADD_CARD') {
    const card = typeof o.cardId === 'string' ? content.cards[o.cardId] : undefined;
    if (!card) return `unknown reward card "${String(o.cardId)}"`;
    return isCardForHero(card, heroId) ? null : `reward card "${card.id}" is not a ${heroId} card`;
  }
  if (o.kind === 'MAX_HP') return isCount(o.amount) ? null : 'malformed MAX_HP reward';
  return `unknown reward kind "${String(o.kind)}"`;
}

/**
 * Older save shapes → current; unknown versions are rejected, not guessed.
 * v1 → v2: the run deck moved to the player profile. Its card rewards are still listed in
 * `chosenRewards`, which the presentation grants to a fresh collection (see `legacyCardRewards`).
 */
function migrate(save: Record<string, unknown>): Record<string, unknown> | string {
  if (save.version === 1 && isRecord(save.run)) {
    const run = { ...save.run };
    delete run.deck;
    return { version: 2, run };
  }
  if (save.version === 2) return save;
  return `unsupported save version ${String(save.version)}`;
}

/**
 * Parses and validates a stored run against the current campaign and content. Anything that
 * would crash or soft-lock the run (unknown encounter/card, inconsistent status) is INVALID.
 */
export function parseRunSave(raw: string | null, campaign: CampaignDef, content: GameContent): RunLoad {
  if (raw === null || raw === '') return { status: 'EMPTY' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'INVALID', reason: 'not JSON' };
  }
  if (!isRecord(data)) return { status: 'INVALID', reason: 'not a save object' };
  const migrated = migrate(data);
  if (typeof migrated === 'string') return { status: 'INVALID', reason: migrated };
  const run = migrated.run;
  const bad = (reason: string): RunLoad => ({ status: 'INVALID', reason });
  if (!isRecord(run)) return bad('missing run');

  if (run.campaignId !== campaign.id) return bad(`save is for campaign "${String(run.campaignId)}"`);
  if (!supportsHero(campaign, run.heroId)) return bad(`unknown hero "${String(run.heroId)}"`);
  if (!isCount(run.seed)) return bad('malformed seed');
  if (!RUN_STATUSES.includes(run.status as RunStatus)) return bad(`unknown status "${String(run.status)}"`);
  const order = encounterOrder(campaign).map((e) => e.id);
  if (typeof run.currentEncounterId !== 'string' || !order.includes(run.currentEncounterId))
    return bad(`unknown encounter "${String(run.currentEncounterId)}"`);

  const completed = run.completedEncounterIds;
  if (!Array.isArray(completed) || completed.some((id) => typeof id !== 'string')) return bad('malformed completed list');
  // Completed encounters are always a prefix of the route (linear progression).
  if (completed.some((id, i) => order[i] !== id)) return bad('completed encounters do not match the route');
  const at = order.indexOf(run.currentEncounterId);
  const status = run.status as RunStatus;
  const expectedDone = status === 'IN_BATTLE' ? at : at + 1;
  if (completed.length !== expectedDone) return bad(`${completed.length} completed encounters at "${run.currentEncounterId}" (${status})`);
  if (status === 'COMPLETED' && completed.length !== order.length) return bad('completed run with encounters left');

  if (!Array.isArray(run.rewardOptions)) return bad('malformed reward options');
  for (const o of run.rewardOptions) {
    const e = rewardError(o, content, run.heroId);
    if (e) return bad(e);
  }
  if (status === 'CHOOSING_REWARD' && run.rewardOptions.length === 0) return bad('reward pending without options');
  if (!Array.isArray(run.chosenRewards)) return bad('malformed chosen rewards');
  for (const c of run.chosenRewards) {
    if (!isRecord(c) || typeof c.encounterId !== 'string' || !order.includes(c.encounterId)) return bad('malformed chosen reward');
    const e = rewardError(c.reward, content, run.heroId);
    if (e) return bad(e);
  }

  if (!isCount(run.maxHpBonus)) return bad('malformed max HP bonus');

  return {
    status: 'OK',
    run: {
      campaignId: campaign.id,
      seed: run.seed,
      heroId: run.heroId,
      status,
      currentEncounterId: run.currentEncounterId,
      completedEncounterIds: [...completed] as string[],
      rewardOptions: structuredClone(run.rewardOptions) as RewardOption[],
      chosenRewards: structuredClone(run.chosenRewards) as RunState['chosenRewards'],
      maxHpBonus: run.maxHpBonus,
    },
  };
}

/** Card ids this run earned as rewards (used once to seed a profile created after a v1 save). */
export function legacyCardRewards(run: RunState): string[] {
  return run.chosenRewards.flatMap(({ reward }) => (reward.kind === 'ADD_CARD' ? [reward.cardId] : []));
}
