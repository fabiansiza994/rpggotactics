import type { GameContent } from '../domain/content';
import type { TerrainType } from '../domain/terrain/terrain';
import { encounterOrder, validateCampaign, type CampaignDef } from './encounter';
import type { RunState, RunStatus } from './run';

/**
 * Campaign WORLDS: the campaign is a sequence of worlds (acts) of 10 encounters, each with its
 * own identity (board theme, enemy family, hazards, boss, reward theme). Gameplay never reads
 * this file's presentation fields; it only uses ids, order and unlock rules.
 *
 * Architecture (qa/campaign-worlds/REPORT.md):
 * - A world OWNS one CampaignDef (`campaignId`). Runs stay what they were: one RunState per
 *   (player, campaign, champion), so World 1 keeps the historical «El Ascenso» campaign, its
 *   encounter ids and every saved run unchanged, and each world has its own independent run.
 * - What a champion has ACHIEVED in a world (completed = its boss defeated once) is durable
 *   history, separate from the run: replaying a world ("Nueva campaña") resets only that
 *   world's run, never an unlock (`WorldHistory`).
 * - Unlocks are data (`WorldUnlock`) and per champion, like the runs: a world opens for the
 *   champion who completed the previous one.
 */

/** When a world opens for a champion. */
export type WorldUnlock =
  | { type: 'ALWAYS' }
  /** The champion has completed (defeated the boss of) that world at least once. */
  | { type: 'WORLD_COMPLETED'; worldId: string };

/**
 * How the board of this world should look (Codex renders it). Pure metadata: ids/keywords the
 * presentation maps to textures, props and effects. The grid itself stays readable.
 */
export interface BoardTheme {
  id: string;
  /** Floor material / style keyword. */
  floor: string;
  /** Board edge and backdrop. */
  edge: string;
  /** Decorative props allowed around (never on) the playable grid. */
  props: readonly string[];
  /** Visual treatment of each hazard terrain this world uses. */
  hazardVisuals: Partial<Record<TerrainType, string>>;
  /** Ambient effects (embers, heat haze…), always reduced-motion aware. */
  atmosphere: readonly string[];
}

/** One-time reward for completing the world (boss defeated), per champion. No new economy. */
export interface WorldCompletionReward {
  /** Arcane Crystals through the existing wallet ledger (reason ACHIEVEMENT_REWARD). */
  crystals: number;
  /** Optional cosmetic id from the store catalog; granted only if it exists there. */
  cosmeticId?: string;
  /**
   * Champion id → exclusive card (1 copy) granted to that champion's collection with the reward,
   * never equipped automatically. The card must declare this world as its `acquisition`.
   */
  championCards?: Readonly<Record<string, string>>;
  /** Durable achievement id shown by the client (the world progress row is the record). */
  badgeId: string;
  badgeName: string;
}

export interface WorldDef {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  description: string;
  /** Short theme key for the client (`ascension`, `infernal`…). */
  theme: string;
  /** The campaign holding this world's encounters and runs. */
  campaignId: string;
  /** Encounter ids in play order (must equal the campaign's route; validated). */
  encounterIds: readonly string[];
  bossEncounterId: string;
  backgroundId: string;
  boardTheme: BoardTheme;
  /** Enemy definitions this world introduces or relies on (for art lists and validation). */
  enemyPool: readonly string[];
  /** Hazard terrain this world uses. */
  hazardSet: readonly TerrainType[];
  unlock: WorldUnlock;
  /**
   * Thematic reward hook: tags favoured by this world's boss offer, plus the card each champion
   * should eventually get from this world (future sets; null = none planned yet).
   */
  rewardTheme: { id: string; favorTags: readonly string[]; championHooks: Readonly<Record<string, string | null>> };
  completionReward: WorldCompletionReward | null;
  /**
   * Release switch name: a world with a flag is hidden (not playable, not listed) until the
   * caller says it is released (server env / client build flag). Null = always released.
   */
  releaseFlag: string | null;
  presentation: {
    accent: string;
    accentSoft: string;
    /** Display index ("Mundo 1"). */
    label: string;
    /** Route header label ("Acto I"); absent = "Acto <order>". */
    actLabel?: string;
    /** Encounter number of the world's first encounter in the campaign-wide count (1, 11…). */
    firstEncounterNumber: number;
    /** Final art key per enemy and the existing art it borrows until then. */
    enemyArt: Readonly<Record<string, { visualKey: string; placeholderBase: string }>>;
  };
}

/**
 * A champion's durable world achievements: world id → completion record. Kept outside runs, so a
 * replayed world never relocks the next one, and a completion reward is granted only once.
 */
export interface WorldRecord {
  completedAt: number | null;
  /** When the one-time completion reward was granted (null = not granted / none). */
  rewardGrantedAt: number | null;
}
export type WorldHistory = Readonly<Record<string, WorldRecord>>;

/** The runs of one champion, by campaign id (null = never started). */
export type ChampionRuns = Readonly<Record<string, RunState | null | undefined>>;

const isCompletedRun = (run: RunState | null | undefined, campaign: CampaignDef): boolean =>
  !!run && run.status === 'COMPLETED' && run.completedEncounterIds.length === encounterOrder(campaign).length;

export interface WorldContext {
  worlds: readonly WorldDef[];
  campaigns: Readonly<Record<string, CampaignDef>>;
  /** Whether a world with a release flag is released for this caller (default: hidden). */
  released?: (world: WorldDef) => boolean;
}

export const worldReleased = (ctx: WorldContext, world: WorldDef): boolean =>
  world.releaseFlag === null || (ctx.released?.(world) ?? false);

export function worldById(ctx: WorldContext, worldId: string): WorldDef | undefined {
  return ctx.worlds.find((w) => w.id === worldId);
}

export function worldOfCampaign(ctx: WorldContext, campaignId: string): WorldDef | undefined {
  return ctx.worlds.find((w) => w.campaignId === campaignId);
}

/**
 * Completed = the boss was defeated once: either recorded in the history or visible in the
 * current run (legacy runs completed before worlds existed count with no migration).
 */
export function worldCompleted(ctx: WorldContext, world: WorldDef, runs: ChampionRuns, history: WorldHistory): boolean {
  if (history[world.id]?.completedAt != null) return true;
  const campaign = ctx.campaigns[world.campaignId];
  return !!campaign && isCompletedRun(runs[world.campaignId], campaign);
}

/** Whether `world` is open for this champion (release switch + unlock rule). */
export function worldUnlocked(ctx: WorldContext, world: WorldDef, runs: ChampionRuns, history: WorldHistory): boolean {
  if (!worldReleased(ctx, world)) return false;
  const rule = world.unlock;
  if (rule.type === 'ALWAYS') return true;
  const previous = worldById(ctx, rule.worldId);
  return !!previous && worldCompleted(ctx, previous, runs, history);
}

export type WorldStatus = 'LOCKED' | 'UNLOCKED' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * Frontend contract for one world, for one champion (the world selector / campaign screen).
 * `completedEncounters` is the world's best (a completed world reads 10/10 even while it is being
 * replayed); `run` is the current run of that world, if any.
 */
export interface WorldView {
  /** Optional only for compatibility with older servers; absent means MAIN_ACT. */
  kind?: CampaignDef['kind'];
  id: string;
  order: number;
  name: string;
  subtitle: string;
  theme: string;
  campaignId: string;
  unlocked: boolean;
  completed: boolean;
  bossDefeated: boolean;
  status: WorldStatus;
  completedEncounters: number;
  totalEncounters: number;
  /** Where "Continue" goes in this world (encounter id; null = nothing left / not unlocked). */
  currentEncounter: string | null;
  /** Stable short alias of `currentEncounter` (w1_e04, w2_e01…). */
  currentEncounterAlias: string | null;
  run: { status: RunStatus; completedEncounters: number; currentEncounterId: string } | null;
  /** The run is waiting for a reward choice. */
  rewardPending: boolean;
  completionReward: { crystals: number; badgeId: string; badgeName: string; granted: boolean; cardId: string | null } | null;
  accent: string;
  /** Route header label ("Acto 1", "Acto I"). */
  actLabel: string;
}

/** "Continue" target inside one world's run (after a pending reward, the following encounter). */
function continueTarget(campaign: CampaignDef, run: RunState | null | undefined): string | null {
  if (!run) return campaign.start;
  if (run.status === 'COMPLETED') return null;
  if (run.status === 'CHOOSING_REWARD') return campaign.encounters.find((e) => e.id === run.currentEncounterId)?.next ?? null;
  return run.currentEncounterId;
}

/**
 * Released worlds for one champion, in order. Unreleased worlds are not listed at all, nor worlds
 * whose campaign the champion cannot play (a champion's own act, like the Archer's, is not shown
 * to the others). `heroId` names the champion (also for its reward card); omitted = the default
 * campaign champion's worlds, without a reward card (legacy callers).
 */
export function worldsView(ctx: WorldContext, runs: ChampionRuns, history: WorldHistory, heroId?: string): WorldView[] {
  const first = [...ctx.worlds].sort((a, b) => a.order - b.order)[0];
  const shownFor = heroId ?? (first && ctx.campaigns[first.campaignId]?.heroIds[0]);
  return [...ctx.worlds]
    .filter((w) => worldReleased(ctx, w))
    .filter((w) => shownFor === undefined || (ctx.campaigns[w.campaignId]?.heroIds.includes(shownFor) ?? false))
    .sort((a, b) => a.order - b.order)
    .map((world) => {
      const campaign = ctx.campaigns[world.campaignId]!;
      const run = runs[world.campaignId] ?? null;
      const total = encounterOrder(campaign).length;
      const unlocked = worldUnlocked(ctx, world, runs, history);
      const completed = worldCompleted(ctx, world, runs, history);
      const runDone = run?.completedEncounterIds.length ?? 0;
      const current = unlocked ? continueTarget(campaign, run) : null;
      const record = history[world.id];
      return {
        id: world.id,
        kind: campaign.kind ?? 'MAIN_ACT',
        order: world.order,
        name: world.name,
        subtitle: world.subtitle,
        theme: world.theme,
        campaignId: world.campaignId,
        unlocked,
        completed,
        bossDefeated: completed,
        status: !unlocked ? 'LOCKED' : completed ? 'COMPLETED' : run ? 'IN_PROGRESS' : 'UNLOCKED',
        completedEncounters: completed ? total : runDone,
        totalEncounters: total,
        currentEncounter: current,
        currentEncounterAlias: current ? encounterAlias(ctx, current) : null,
        run: run ? { status: run.status, completedEncounters: runDone, currentEncounterId: run.currentEncounterId } : null,
        rewardPending: run?.status === 'CHOOSING_REWARD',
        completionReward: world.completionReward
          ? {
              crystals: world.completionReward.crystals,
              badgeId: world.completionReward.badgeId,
              badgeName: world.completionReward.badgeName,
              granted: record?.rewardGrantedAt != null,
              cardId: (heroId && world.completionReward.championCards?.[heroId]) || null,
            }
          : null,
        accent: world.presentation.accent,
        actLabel: world.presentation.actLabel ?? `Acto ${world.order}`,
      } satisfies WorldView;
    });
}

/** Campaign-wide totals over the released worlds (best progress, not the current runs). */
export function totalProgress(views: readonly WorldView[]): { completedEncounters: number; totalEncounters: number; completedWorlds: number } {
  return {
    completedEncounters: views.reduce((n, w) => n + w.completedEncounters, 0),
    totalEncounters: views.reduce((n, w) => n + w.totalEncounters, 0),
    completedWorlds: views.filter((w) => w.completed).length,
  };
}

/**
 * The world the main campaign button should lead to: the first unlocked world not completed yet
 * (a run in progress there, or a fresh start), else the last unlocked world (everything done).
 */
export function primaryWorld(views: readonly WorldView[]): WorldView | null {
  const open = views.filter((w) => w.unlocked);
  return open.find((w) => !w.completed) ?? open.at(-1) ?? null;
}

/** Stable short alias: w{order}_e{NN}. World 1's historical ids (ascent_01_outpost) map to w1_e01. */
export function encounterAlias(ctx: WorldContext, encounterId: string): string | null {
  for (const world of ctx.worlds) {
    const at = world.encounterIds.indexOf(encounterId);
    if (at >= 0) return `w${world.order}_e${String(at + 1).padStart(2, '0')}`;
  }
  return null;
}

/** Encounter id from an id or an alias (adapter for clients/tools that use w1_e01-style ids). */
export function resolveEncounterId(ctx: WorldContext, idOrAlias: string): string | null {
  for (const world of ctx.worlds) {
    if (world.encounterIds.includes(idOrAlias)) return idOrAlias;
    const m = /^w(\d+)_e(\d{2})$/.exec(idOrAlias);
    if (m && Number(m[1]) === world.order) return world.encounterIds[Number(m[2]) - 1] ?? null;
  }
  return null;
}

/** The world an encounter belongs to (null = not a world encounter, e.g. a skirmish). */
export function worldOfEncounter(ctx: WorldContext, encounterId: string): WorldDef | undefined {
  return ctx.worlds.find((w) => w.encounterIds.includes(encounterId));
}

/** Campaign-wide number of an encounter (World 2's first encounter is 11). */
export function encounterNumber(ctx: WorldContext, encounterId: string): number | null {
  const world = worldOfEncounter(ctx, encounterId);
  return world ? world.presentation.firstEncounterNumber + world.encounterIds.indexOf(encounterId) : null;
}

/** Static checks: unique ids/orders, campaign route matches, boss is last, unlock chain valid, pools exist. */
export function validateWorlds(ctx: WorldContext, content: GameContent): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  const encounters = new Set<string>();
  for (const world of ctx.worlds) {
    const err = (m: string) => errors.push(`World ${world.id}: ${m}`);
    if (ids.has(world.id)) err('duplicate id');
    ids.add(world.id);
    if (orders.has(world.order)) err(`duplicate order ${world.order}`);
    orders.add(world.order);
    const campaign = ctx.campaigns[world.campaignId];
    if (!campaign) {
      err(`unknown campaign "${world.campaignId}"`);
      continue;
    }
    errors.push(...validateCampaign(campaign, content));
    const route = encounterOrder(campaign).map((e) => e.id);
    if (route.join() !== world.encounterIds.join()) err('encounterIds do not match the campaign route');
    if (route.at(-1) !== world.bossEncounterId) err('boss is not the last encounter');
    if (campaign.encounters.find((e) => e.id === world.bossEncounterId)?.tier !== 'BOSS') err('boss encounter is not tier BOSS');
    for (const id of route) {
      if (encounters.has(id)) err(`encounter "${id}" belongs to two worlds`);
      encounters.add(id);
    }
    for (const enemyId of world.enemyPool) if (!content.enemies[enemyId]) err(`unknown enemy "${enemyId}" in pool`);
    for (const t of world.hazardSet) if (!content.terrain[t]?.isHazard) err(`"${t}" is not a hazard terrain`);
    for (const [heroId, cardId] of Object.entries(world.completionReward?.championCards ?? {})) {
      const card = content.cards[cardId];
      if (!card) err(`unknown reward card "${cardId}"`);
      else if (card.heroId !== heroId) err(`reward card "${cardId}" is not a ${heroId} card`);
      else if (card.acquisition?.source !== 'WORLD_COMPLETION' || card.acquisition.worldId !== world.id)
        err(`reward card "${cardId}" does not declare this world as its source`);
    }
    if (world.unlock.type === 'WORLD_COMPLETED') {
      const previous = worldById(ctx, world.unlock.worldId);
      if (!previous) err(`unlocks after unknown world "${world.unlock.worldId}"`);
      else if (previous.order >= world.order) err('unlocks after a later world');
    }
    // No unit or pickup starts on a hazard, and no exit is one.
    for (const e of campaign.encounters) {
      const terrainAt = (p: { x: number; y: number }) => e.legend[e.layout[p.y]?.[p.x] ?? '.']?.terrain;
      const hazard = (p: { x: number; y: number }) => {
        const t = terrainAt(p);
        return t !== undefined && content.terrain[t]?.isHazard === true;
      };
      const spawns = [e.hero.pos, ...e.structures.map((s) => s.pos), ...e.enemies.map((x) => x.pos), ...(e.collectibles ?? []).map((c) => c.pos), ...e.waves.flatMap((w) => w.enemies.map((x) => x.pos))];
      for (const heroId of Object.keys(e.champions ?? {})) {
        const setup = e.champions![heroId]!;
        if (setup.heroPos) spawns.push(setup.heroPos);
        for (const x of setup.enemies ?? []) spawns.push(x.pos);
      }
      for (const p of spawns) if (hazard(p)) err(`${e.id}: something starts on a hazard at (${p.x},${p.y})`);
      for (const o of e.objectives) if (o.type === 'REACH_TILE') for (const p of o.tiles) if (hazard(p)) err(`${e.id}: exit on a hazard at (${p.x},${p.y})`);
      for (const x of [...e.enemies, ...e.waves.flatMap((w) => w.enemies)])
        if (world.enemyPool.length && !world.enemyPool.includes(x.enemyId) && world.order > 1) err(`${e.id}: enemy "${x.enemyId}" is not in the world's pool`);
    }
  }
  const first = [...ctx.worlds].sort((a, b) => a.order - b.order)[0];
  if (first && first.unlock.type !== 'ALWAYS') errors.push(`World ${first.id}: the first world must always be open`);
  return errors;
}
