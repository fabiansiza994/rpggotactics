import type { PlayerProfile } from './profile';

/**
 * Account-wide champion ownership (onboarding + early unlocks). It belongs to the player, not
 * to a campaign run: every champion keeps its own run, but the milestones count the player's
 * best progress on ANY champion, so the second champion never needs encounter III replayed.
 *
 * `available` everywhere below = the champions currently released to this player (release
 * flags: Summoner campaign, QA-only Warrior). A champion behind a flag is never offered, and
 * becomes reachable through the same milestones as soon as its flag turns on.
 */

/** How a champion was unlocked (legacy profiles have no unlock rows: they own every champion). */
export type UnlockMilestoneId = 'START' | 'ASCENT_3' | 'ASCENT_6';

export interface ChampionMilestone {
  id: Exclude<UnlockMilestoneId, 'START'>;
  /** Campaign encounters completed (best run of any champion) that reach it. */
  encounters: number;
  /** Champions it unlocks: one the player picks, or every champion still locked. */
  grants: number | 'ALL';
}

/** Encounter III → choose 1 of the remaining champions; encounter VI → the rest. */
export const CHAMPION_MILESTONES: readonly ChampionMilestone[] = [
  { id: 'ASCENT_3', encounters: 3, grants: 1 },
  { id: 'ASCENT_6', encounters: 6, grants: 'ALL' },
];

export interface ChampionUnlock {
  heroId: string;
  milestone: UnlockMilestoneId;
  /** FREE uses a compatibility milestone in profiles; server stores its provenance in the same unlock row. */
  source?: 'FREE';
}

export interface ChampionProgress {
  /**
   * LEGACY = a profile from before champion unlocks existed: Mago/Invocador keep their access; the newly released
   * Warrior unlocks retroactively at VI. PROGRESSION = onboarding + milestones.
   */
  mode: 'LEGACY' | 'PROGRESSION';
  /** Null until the first-time choice (PROGRESSION only). */
  startingChampionId: string | null;
  /** Each unlock with the milestone it consumed (START = the first-time choice). */
  unlocks: ChampionUnlock[];
  /** Most campaign encounters completed in any champion's run. Never decreases (new runs keep it). */
  campaignBest: number;
}

const LEGACY: ChampionProgress = Object.freeze({ mode: 'LEGACY', startingChampionId: null, unlocks: [], campaignBest: 0 }) as ChampionProgress;

/** A profile without the field predates unlocks: LEGACY. */
export const championProgress = (profile: PlayerProfile): ChampionProgress => profile.champions ?? LEGACY;

/** Unlock state of a brand-new player (nothing owned until the first-time choice). */
export const newChampionProgress = (): ChampionProgress => ({ mode: 'PROGRESSION', startingChampionId: null, unlocks: [], campaignBest: 0 });

/** Same profile marked as a new player (onboarding pending). */
export const asNewPlayer = (profile: PlayerProfile): PlayerProfile => ({ ...profile, champions: newChampionProgress() });

/** Ownership only; combine with the release flags (`available`) before letting someone play. */
export function isChampionUnlocked(profile: PlayerProfile, heroId: string): boolean {
  const progress = championProgress(profile);
  return heroId === 'archer' || (progress.mode === 'LEGACY' && heroId !== 'shapeshifter' && (heroId !== 'warrior' || progress.campaignBest >= 6)) || progress.unlocks.some((u) => u.heroId === heroId);
}

/** Released AND owned: the single rule every mode (campaign, skirmish, PvP, decks) uses. */
export const championPlayable = (profile: PlayerProfile, heroId: string, available: readonly string[]): boolean =>
  available.includes(heroId) && isChampionUnlocked(profile, heroId);

/** The first-time choice is still pending (only new profiles; never a legacy one). */
export const needsStartingChampion = (profile: PlayerProfile): boolean => {
  const progress = championProgress(profile);
  return progress.mode === 'PROGRESSION' && progress.startingChampionId === null;
};

export type UnlockError = 'LEGACY_PROFILE' | 'ALREADY_CHOSEN' | 'NOT_AVAILABLE' | 'NO_STARTING_CHAMPION' | 'NO_UNLOCK_PENDING' | 'NOT_AN_OPTION';
export type UnlockResult =
  | { ok: true; profile: PlayerProfile; unlock: ChampionUnlock | null }
  | { ok: false; error: UnlockError };

/**
 * The first-time choice. Repeating the same choice is a no-op (a retried request); a second,
 * different choice is refused. The chosen champion also becomes the selected one.
 */
export const isCampaignStartingChampion = (heroId: string): boolean => heroId !== 'shapeshifter' && heroId !== 'archer';

export function chooseStartingChampion(profile: PlayerProfile, heroId: string, available: readonly string[]): UnlockResult {
  const progress = championProgress(profile);
  if (progress.mode === 'LEGACY') return { ok: false, error: 'LEGACY_PROFILE' };
  if (progress.startingChampionId === heroId) return { ok: true, profile, unlock: null };
  if (progress.startingChampionId !== null) return { ok: false, error: 'ALREADY_CHOSEN' };
  // The free fourth champion must not consume one of the three progression choices.
  if (!available.includes(heroId) || !isCampaignStartingChampion(heroId)) return { ok: false, error: 'NOT_AVAILABLE' };
  const unlock: ChampionUnlock = { heroId, milestone: 'START' };
  return {
    ok: true,
    unlock,
    profile: {
      ...profile,
      selectedChampionId: heroId,
      champions: { ...progress, startingChampionId: heroId, unlocks: [...progress.unlocks, unlock] },
    },
  };
}

/** What the player can unlock right now: pick one (CHOICE) or receive them (REVEAL). Never random. */
export interface PendingUnlock {
  milestone: ChampionMilestone['id'];
  kind: 'CHOICE' | 'REVEAL';
  /** Locked, released champions this milestone can unlock (in content order). */
  options: string[];
}

export function pendingChampionUnlock(profile: PlayerProfile, available: readonly string[]): PendingUnlock | null {
  const progress = championProgress(profile);
  if (progress.mode !== 'PROGRESSION' || progress.startingChampionId === null) return null;
  const locked = available.filter((id) => id !== 'shapeshifter' && !isChampionUnlocked(profile, id));
  if (!locked.length) return null;
  for (const m of CHAMPION_MILESTONES) {
    if (progress.campaignBest < m.encounters) break;
    const used = progress.unlocks.filter((u) => u.milestone === m.id).length;
    const left = m.grants === 'ALL' ? Infinity : m.grants - used;
    if (left <= 0) continue;
    return { milestone: m.id, kind: locked.length <= left ? 'REVEAL' : 'CHOICE', options: locked };
  }
  return null;
}

/**
 * Claim one champion of the pending milestone. Claiming a champion that is already unlocked
 * is a no-op (retries are idempotent); anything else outside the pending options is refused,
 * so a milestone can never be claimed twice.
 */
export function claimChampionUnlock(profile: PlayerProfile, heroId: string, available: readonly string[]): UnlockResult {
  if (heroId === 'archer') return available.includes(heroId) ? {ok:true, profile, unlock:null} : {ok:false,error:'NOT_AVAILABLE'};
  if (heroId === 'shapeshifter') return claimFreeChampion(profile, heroId, available);
  const progress = championProgress(profile);
  if (progress.mode === 'LEGACY') return { ok: false, error: 'LEGACY_PROFILE' };
  if (progress.startingChampionId === null) return { ok: false, error: 'NO_STARTING_CHAMPION' };
  if (isChampionUnlocked(profile, heroId)) return { ok: true, profile, unlock: null };
  const pending = pendingChampionUnlock(profile, available);
  if (!pending) return { ok: false, error: 'NO_UNLOCK_PENDING' };
  if (!pending.options.includes(heroId)) return { ok: false, error: 'NOT_AN_OPTION' };
  const unlock: ChampionUnlock = { heroId, milestone: pending.milestone };
  return { ok: true, unlock, profile: { ...profile, champions: { ...progress, unlocks: [...progress.unlocks, unlock] } } };
}

/** Free release claim: same ownership collection, no wallet/card/reward operation. */
export function claimFreeChampion(profile: PlayerProfile, heroId: string, available: readonly string[]): UnlockResult {
  if (heroId !== 'shapeshifter' || !available.includes(heroId)) return { ok: false, error: 'NOT_AVAILABLE' };
  if (isChampionUnlocked(profile, heroId)) return { ok: true, profile, unlock: null };
  const progress = championProgress(profile);
  // ASCENT_6 remains readable by old clients. FREE provenance is persisted in the existing row.
  const unlock: ChampionUnlock = { heroId, milestone: 'ASCENT_6', source: 'FREE' };
  return { ok: true, unlock, profile: { ...profile, champions: { ...progress, unlocks: [...progress.unlocks, unlock] } } };
}

/** A campaign victory counts toward the account-wide milestones (never lowers the best). */
export function recordCampaignBest(profile: PlayerProfile, completedEncounters: number): PlayerProfile {
  const progress = championProgress(profile);
  if (completedEncounters <= progress.campaignBest) return profile;
  return { ...profile, champions: { ...progress, campaignBest: completedEncounters } };
}

/** How a locked champion can be obtained (for the Champions screen). Null = nothing left to reach it. */
export interface UnlockRequirement {
  milestone: ChampionMilestone['id'];
  encounters: number;
  /** True when the milestone lets the player pick among several locked champions. */
  choice: boolean;
  /** Already reached: the unlock is waiting to be claimed. */
  ready: boolean;
}

export function unlockRequirement(profile: PlayerProfile, heroId: string, available: readonly string[]): UnlockRequirement | null {
  const progress = championProgress(profile);
  if (heroId === 'shapeshifter' || isChampionUnlocked(profile, heroId) || !available.includes(heroId)) return null;
  if (progress.mode === 'LEGACY') return heroId === 'warrior' ? { milestone: 'ASCENT_6', encounters: 6, choice: false, ready: progress.campaignBest >= 6 } : null;
  const locked = available.filter((id) => id !== 'shapeshifter' && !isChampionUnlocked(profile, id));
  for (const m of CHAMPION_MILESTONES) {
    const used = progress.unlocks.filter((u) => u.milestone === m.id).length;
    const left = m.grants === 'ALL' ? Infinity : m.grants - used;
    if (left <= 0) continue;
    return { milestone: m.id, encounters: m.encounters, choice: locked.length > left, ready: progress.campaignBest >= m.encounters };
  }
  return null;
}

/**
 * Untrusted unlock state (a guest save being imported) rebuilt through the same rules: the
 * starting choice must be available, and every later unlock must be claimable in order given
 * the progress `campaignBest` proves. Whatever cannot be justified is dropped and reported.
 */
export function revalidateChampionProgress(
  claimed: ChampionProgress,
  profile: PlayerProfile,
  available: readonly string[],
  campaignBest: number,
  notes: string[],
): ChampionProgress {
  if (claimed.mode === 'LEGACY') {
    const free = claimed.unlocks.some(u => u.heroId === 'shapeshifter') && available.includes('shapeshifter');
    return { ...LEGACY, campaignBest: Math.max(0, Math.floor(campaignBest)), unlocks: free ? [{ heroId: 'shapeshifter', milestone: 'ASCENT_6', source: 'FREE' }] : [] };
  }
  let rebuilt: PlayerProfile = { ...profile, champions: { ...newChampionProgress(), campaignBest: Math.max(0, Math.floor(campaignBest)) } };
  if (claimed.startingChampionId === null) {
    if (claimed.unlocks.some(u => u.heroId === 'shapeshifter')) { const free = claimFreeChampion(rebuilt, 'shapeshifter', available); if (free.ok) rebuilt = free.profile; }
    return rebuilt.champions!;
  }
  const start = chooseStartingChampion(rebuilt, claimed.startingChampionId, available);
  if (!start.ok) {
    notes.push(`champions: starting champion "${claimed.startingChampionId}" is not available; choose again`);
    return rebuilt.champions!;
  }
  rebuilt = start.profile;
  for (const u of claimed.unlocks) {
    if (u.milestone === 'START') continue;
    const next = claimChampionUnlock(rebuilt, u.heroId, available);
    if (next.ok) rebuilt = next.profile;
    else notes.push(`champions: unlock of "${u.heroId}" dropped (${next.error})`);
  }
  return rebuilt.champions!;
}
