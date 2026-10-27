/**
 * When a dialogue may play, and remembering that it already did. Cosmetic only: losing this
 * state (private window, cleared storage) can at worst show a short skippable scene again.
 *
 * Rules:
 * - Intros only play on a pristine battle (nothing played yet), so a reconnect, refresh or
 *   replay recovery of a started battle goes straight back to combat.
 * - Each sequence id is remembered once shown: PvP ids include the server match id (persisted),
 *   campaign ids are champion + encounter (per browser session, so restarts don't repeat it).
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DialogueSettings {
  /** PvP intro banter and post-match line. */
  pvp: boolean;
  /** Campaign scenes (always skippable even when on). */
  campaign: boolean;
}

export const DEFAULT_DIALOGUE_SETTINGS: DialogueSettings = { pvp: true, campaign: true };
const SETTINGS_KEY = 'rpg-go-tactics:dialogue-settings';
const SEEN_KEY = 'rpg-go-tactics:dialogue-seen';
const SEEN_LIMIT = 80;

const safe = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

const browserStore = (kind: 'localStorage' | 'sessionStorage'): KeyValueStore | null =>
  safe(() => (typeof globalThis[kind] === 'undefined' ? null : globalThis[kind]), null);

export function readDialogueSettings(store: KeyValueStore | null = browserStore('localStorage')): DialogueSettings {
  const raw = safe(() => store?.getItem(SETTINGS_KEY) ?? null, null);
  const parsed = raw ? safe(() => JSON.parse(raw) as Partial<DialogueSettings>, {}) : {};
  return {
    pvp: typeof parsed.pvp === 'boolean' ? parsed.pvp : DEFAULT_DIALOGUE_SETTINGS.pvp,
    campaign: typeof parsed.campaign === 'boolean' ? parsed.campaign : DEFAULT_DIALOGUE_SETTINGS.campaign,
  };
}

export function writeDialogueSettings(next: DialogueSettings, store: KeyValueStore | null = browserStore('localStorage')): void {
  safe(() => store?.setItem(SETTINGS_KEY, JSON.stringify(next)), undefined);
}

/** Bounded list of sequence ids already shown in one store. */
export class SeenDialogues {
  constructor(private readonly store: KeyValueStore | null) {}

  private list(): string[] {
    const raw = safe(() => this.store?.getItem(SEEN_KEY) ?? null, null);
    const parsed = raw ? safe(() => JSON.parse(raw) as unknown, []) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  }

  has(id: string): boolean {
    return this.list().includes(id);
  }

  mark(id: string): void {
    const next = [...this.list().filter((v) => v !== id), id].slice(-SEEN_LIMIT);
    safe(() => this.store?.setItem(SEEN_KEY, JSON.stringify(next)), undefined);
  }
}

/** PvP ids carry the match id, so they survive refreshes and reconnects from this device. */
export const pvpSeen = () => new SeenDialogues(browserStore('localStorage'));
/** Campaign ids are champion + encounter: once per browser session (restarts don't repeat). */
export const campaignSeen = () => new SeenDialogues(browserStore('sessionStorage'));

export interface BattleProgress {
  round: number;
  /** Commands already applied (campaign engine history). */
  commands?: number;
  cardsPlayed?: number;
  finished: boolean;
}

/** A battle nobody has acted in yet: the only moment an intro may play. */
export const pristineBattle = (p: BattleProgress): boolean =>
  !p.finished && p.round <= 1 && (p.commands ?? 0) === 0 && (p.cardsPlayed ?? 0) === 0;

export type IntroDecision = 'PLAY' | 'SKIP_DISABLED' | 'SKIP_SEEN' | 'SKIP_STARTED' | 'SKIP_NONE';

export function introDecision(input: {
  sequenceId: string | null;
  enabled: boolean;
  progress: BattleProgress;
  seen: Pick<SeenDialogues, 'has'>;
}): IntroDecision {
  if (!input.sequenceId) return 'SKIP_NONE';
  if (!input.enabled) return 'SKIP_DISABLED';
  if (!pristineBattle(input.progress)) return 'SKIP_STARTED';
  if (input.seen.has(input.sequenceId)) return 'SKIP_SEEN';
  return 'PLAY';
}

/** Outros play once per sequence id; a refresh on the result screen does not repeat them. */
export function outroDecision(input: { sequenceId: string | null; enabled: boolean; seen: Pick<SeenDialogues, 'has'> }): IntroDecision {
  if (!input.sequenceId) return 'SKIP_NONE';
  if (!input.enabled) return 'SKIP_DISABLED';
  return input.seen.has(input.sequenceId) ? 'SKIP_SEEN' : 'PLAY';
}
