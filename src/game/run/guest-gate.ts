import { encounterOrder, type CampaignDef } from './encounter';
import type { RunState } from './run';

/**
 * Guests (no account) play the first encounters of a campaign; continuing past them needs an
 * account. Checked where a battle STARTS (not where a button is drawn), so a crafted save, a
 * stale run or a repeated click cannot reach encounter IV. Accounts are never limited here:
 * their campaign steps are authorised and replay-verified by the server.
 */
export const GUEST_ENCOUNTER_LIMIT = 3;

/**
 * Whether a guest may fight `encounterId` (its 0-based position is inside the free part). The
 * free part is World 1's opening only: any later world's encounter — and a champion's own act
 * (the Archer's «Sendero del Cazador», whose rewards and 250 crystals are server-granted) — needs
 * an account.
 */
export function guestMayFight(campaign: CampaignDef, encounterId: string): boolean {
  if (campaign.id !== 'ascent' && campaign.id !== 'skirmish') return false;
  const at = encounterOrder(campaign).findIndex((e) => e.id === encounterId);
  return at >= 0 && at < GUEST_ENCOUNTER_LIMIT;
}

/** A guest run that already finished the free encounters and is waiting at the next one. */
export const guestGateReached = (campaign: CampaignDef, run: RunState | null): boolean =>
  run !== null && run.status !== 'COMPLETED' && !guestMayFight(campaign, run.currentEncounterId);
