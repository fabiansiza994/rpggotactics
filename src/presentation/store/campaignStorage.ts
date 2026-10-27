import { ASCENT_CAMPAIGN, WORLD_CAMPAIGNS } from "../qa/shapeshifter/campaigns";
import { shapeshifterQaEnabled, qaStorageKey } from '../qa/shapeshifter/access';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../qa/shapeshifter/runtime';
import {
  defaultCampaignHero,
  type CampaignDef,
  type WorldHistory,
  parseProfileSave,
  parseRunSave,
  serializeProfile,
  serializeRun,
  type PlayerProfile,
  type RunState,
} from '../../game';

/**
 * Local persistence (no backend) of campaign progression and of the player profile
 * (card collections + decks, which outlive any campaign). Only the RunState is stored; battle
 * state, hover, targeting and animation state never are. Every storage access is guarded:
 * private mode, quota or disabled storage degrade to an in-memory session, never a crash.
 */
/**
 * Pre-multi-champion slot: a Mage run. It is copied into the Mage slot on first load and never
 * written or deleted afterwards (it stays as a backup of the old progress).
 */
export const CAMPAIGN_SAVE_KEY = 'rpg-go-tactics:campaign';
/** Where unusable legacy data is moved before a new campaign overwrites the slot (never silently lost). */
export const CAMPAIGN_BACKUP_KEY = `${CAMPAIGN_SAVE_KEY}:unreadable`;
/**
 * One campaign slot per champion and world: each champion's progress is independent. World 1
 * («El Ascenso», campaign 'ascent') keeps its historical key; later worlds add the campaign id.
 */
export const campaignKey = (heroId: string, campaignId: string = ASCENT_CAMPAIGN.id) =>
  campaignId === ASCENT_CAMPAIGN.id ? `${CAMPAIGN_SAVE_KEY}:hero:${heroId}` : `${CAMPAIGN_SAVE_KEY}:${campaignId}:hero:${heroId}`;
const campaignBackupKey = (heroId: string, campaignId?: string) => `${campaignKey(heroId, campaignId)}:unreadable`;
/** Guest world achievements (champion → world → record): what a replayed run cannot keep. */
export const WORLD_HISTORY_KEY = 'rpg-go-tactics:worlds';
export const PROFILE_SAVE_KEY = 'rpg-go-tactics:profile';
export const PROFILE_BACKUP_KEY = `${PROFILE_SAVE_KEY}:unreadable`;

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let storage: KeyValueStorage | null | undefined;

function backend(): KeyValueStorage | null {
  if (storage !== undefined) return storage;
  try {
    const local = typeof window !== 'undefined' ? window.localStorage : null;
    storage = local ? {
      getItem: key => local.getItem(qaStorageKey(key)),
      setItem: (key, value) => local.setItem(qaStorageKey(key), value),
      removeItem: key => local.removeItem(qaStorageKey(key)),
    } : null;
  } catch {
    storage = null;
  }
  return storage;
}

/** Tests inject a fake storage; `undefined` restores auto-detection. */
export function setCampaignStorage(next: KeyValueStorage | null | undefined): void {
  storage = next;
}

function readKey(key: string): string | null {
  try {
    return backend()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Parses one slot; unusable data is copied to `backupKey` and reported, never deleted. */
function parseSlot(raw: string | null, backupKey: string, heroId: string, campaign: CampaignDef = ASCENT_CAMPAIGN): RunState | null {
  const result = parseRunSave(raw, campaign, DEFAULT_CONTENT);
  if (result.status === 'OK') return result.run.heroId === heroId ? result.run : null;
  if (result.status === 'INVALID') {
    console.warn(`[campaign] saved progress could not be loaded (${result.reason}); it is kept as a backup.`);
    try {
      if (raw !== null) backend()?.setItem(backupKey, raw);
    } catch {
      /* best effort */
    }
  }
  return null;
}

/**
 * One champion's saved campaign. The Mage falls back to the pre-multi-champion slot once and
 * copies it into its own slot (the old slot is left as it was).
 */
export function loadCampaign(heroId: string = defaultCampaignHero(ASCENT_CAMPAIGN)): RunState | null {
  const raw = readKey(campaignKey(heroId));
  if (raw !== null) return parseSlot(raw, campaignBackupKey(heroId), heroId);
  if (heroId !== defaultCampaignHero(ASCENT_CAMPAIGN)) return null;
  const legacy = parseSlot(readKey(CAMPAIGN_SAVE_KEY), CAMPAIGN_BACKUP_KEY, heroId);
  if (legacy) saveCampaign(legacy);
  return legacy;
}

/** QA-only write-ahead record: run and reward profile recover as one transition after reload. */
const QA_TRANSACTION = 'shapeshifter:campaign-transaction';
export function saveQaCampaignTransition(run: RunState, profile: PlayerProfile): boolean {
  if (!shapeshifterQaEnabled || run.heroId !== 'shapeshifter') return false;
  try {
    const target = backend();
    if (!target) return false;
    target.setItem(QA_TRANSACTION, JSON.stringify({ campaignId: run.campaignId, run: serializeRun(run), profile: serializeProfile(profile) }));
    recoverQaCampaignTransition();
    return true;
  } catch { return false; }
}
export function recoverQaCampaignTransition(): void {
  if (!shapeshifterQaEnabled) return;
  const target = backend(), raw = target?.getItem(QA_TRANSACTION);
  if (!target || !raw) return;
  const data = JSON.parse(raw), campaign = WORLD_CAMPAIGNS[data.campaignId];
  if (!campaign) throw Error('Campaña QA desconocida');
  const run = parseRunSave(data.run, campaign, DEFAULT_CONTENT);
  const profile = parseProfileSave(data.profile, DEFAULT_CONTENT);
  if (run.status !== 'OK' || run.run.heroId !== 'shapeshifter' || profile.status !== 'OK') throw Error('Transición QA inválida');
  target.setItem(campaignKey('shapeshifter', campaign.id), data.run);
  target.setItem(PROFILE_SAVE_KEY, data.profile);
  target.removeItem(QA_TRANSACTION);
}

/** Every champion's saved campaign (null = never started on this device). */
export function loadCampaigns(): Record<string, RunState | null> {
  recoverQaCampaignTransition();
  return Object.fromEntries(ASCENT_CAMPAIGN.heroIds.map((heroId) => [heroId, loadCampaign(heroId)]));
}

/** Writes the run into its own champion's slot of its own world (never another's). */
export function saveCampaign(run: RunState): boolean {
  try {
    const target = backend();
    if (!target) return false;
    target.setItem(campaignKey(run.heroId, run.campaignId), serializeRun(run));
    return true;
  } catch {
    return false;
  }
}

/** Every champion's run in the worlds after World 1 (campaign id → champion → run). */
export function loadWorldRuns(): Record<string, Record<string, RunState | null>> {
  const out: Record<string, Record<string, RunState | null>> = {};
  for (const campaign of Object.values(WORLD_CAMPAIGNS)) {
    if (campaign.id === ASCENT_CAMPAIGN.id) continue;
    out[campaign.id] = Object.fromEntries(
      campaign.heroIds.map((heroId) => [heroId, parseSlot(readKey(campaignKey(heroId, campaign.id)), campaignBackupKey(heroId, campaign.id), heroId, campaign)]),
    );
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));

/** Guest world history; malformed entries are dropped (never invented). */
export function loadWorldHistory(): Record<string, WorldHistory> {
  try {
    const data: unknown = JSON.parse(readKey(WORLD_HISTORY_KEY) ?? '{}');
    if (!isRecord(data)) return {};
    const out: Record<string, WorldHistory> = {};
    for (const [heroId, worlds] of Object.entries(data)) {
      if (!isRecord(worlds)) continue;
      const hero: Record<string, { completedAt: number | null; rewardGrantedAt: number | null }> = {};
      for (const [worldId, r] of Object.entries(worlds))
        if (isRecord(r) && isStamp(r.completedAt) && isStamp(r.rewardGrantedAt)) hero[worldId] = { completedAt: r.completedAt, rewardGrantedAt: r.rewardGrantedAt };
      out[heroId] = hero;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveWorldHistory(history: Record<string, WorldHistory>): boolean {
  try {
    const target = backend();
    if (!target) return false;
    target.setItem(WORLD_HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

/** The saved profile, or null when there is none (or it was unreadable: then kept as a backup). */
export function loadProfile(): PlayerProfile | null {
  let raw: string | null;
  try {
    raw = backend()?.getItem(PROFILE_SAVE_KEY) ?? null;
  } catch {
    return null;
  }
  const result = parseProfileSave(raw, DEFAULT_CONTENT);
  if (result.status === 'OK') {
    for (const note of result.notes) console.warn(`[profile] ${note}`);
    return result.profile;
  }
  if (result.status === 'INVALID') {
    console.warn(`[profile] saved collection could not be loaded (${result.reason}); it is kept as a backup.`);
    try {
      if (raw !== null) backend()?.setItem(PROFILE_BACKUP_KEY, raw);
    } catch {
      /* best effort */
    }
  }
  return null;
}

export function saveProfile(profile: PlayerProfile): boolean {
  try {
    const target = backend();
    if (!target) return false;
    target.setItem(PROFILE_SAVE_KEY, serializeProfile(profile));
    return true;
  } catch {
    return false;
  }
}

export interface LocalSaves {
  profile: string | null;
  /** The Mage run (its slot, or the pre-multi-champion slot): what older servers import. */
  campaign: string | null;
  /** Every champion's slot. */
  campaigns: Record<string, string | null>;
}

/** The raw guest saves of this device (for the one-time import into an account; the server re-validates them). */
export function readLocalSaves(): LocalSaves {
  const mage = defaultCampaignHero(ASCENT_CAMPAIGN);
  const campaigns: Record<string, string | null> = Object.fromEntries(
    ASCENT_CAMPAIGN.heroIds.map((heroId) => [heroId, readKey(campaignKey(heroId))]),
  );
  campaigns[mage] ??= readKey(CAMPAIGN_SAVE_KEY);
  return { profile: readKey(PROFILE_SAVE_KEY), campaign: campaigns[mage] ?? null, campaigns };
}

/** Per-device convenience: the champion the campaign card showed last (not progress). */
const CAMPAIGN_HERO_KEY = 'rpg-go-tactics:campaign-hero';
export function readCampaignHero(): string | null {
  return readKey(CAMPAIGN_HERO_KEY);
}
export function writeCampaignHero(heroId: string): void {
  try {
    backend()?.setItem(CAMPAIGN_HERO_KEY, heroId);
  } catch {
    /* best effort */
  }
}
