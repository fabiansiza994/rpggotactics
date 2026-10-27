import { encounterOrder, type CampaignDef, type EncounterDef } from './encounter';
import type { RunState } from './run';

/**
 * Progress of one encounter on the campaign route. The route is linear, so the encounter the
 * player can play next is the only unlocked one (CURRENT); there is no separate "available".
 * Tier (NORMAL/ELITE/BOSS) is orthogonal and read from the encounter itself.
 */
export type RouteProgress = 'COMPLETED' | 'CURRENT' | 'LOCKED';

export interface RouteNode {
  encounter: EncounterDef;
  index: number;
  progress: RouteProgress;
}

/** The encounter "Continue" leads to (after a pending reward, the following one); null when done. */
export function nextEncounterId(campaign: CampaignDef, run: RunState | null): string | null {
  if (!run) return campaign.start;
  if (run.status === 'COMPLETED') return null;
  if (run.status === 'CHOOSING_REWARD')
    return campaign.encounters.find((e) => e.id === run.currentEncounterId)?.next ?? null;
  return run.currentEncounterId;
}

/** Route state derived from the run only (no run = a fresh campaign). Never stored. */
export function campaignRoute(campaign: CampaignDef, run: RunState | null): RouteNode[] {
  const done = new Set(run?.completedEncounterIds ?? []);
  const next = nextEncounterId(campaign, run);
  return encounterOrder(campaign).map((encounter, index) => ({
    encounter,
    index,
    progress: done.has(encounter.id) ? 'COMPLETED' : encounter.id === next ? 'CURRENT' : 'LOCKED',
  }));
}
