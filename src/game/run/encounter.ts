import { boardSizeErrors, type BoardSize } from '../domain/board/board-size';
import type { GameContent } from '../domain/content';
import type { Pos } from '../domain/core/position';
import type { EnemySpawnDef, ScenarioDef, WaveDef } from '../domain/scenario';
import { scenarioBoardSize, validateScenario } from '../domain/scenario-validation';
import type { RewardPoolId } from './rewards';

/**
 * How one champion meets an encounter. The board, objective, tier and rewards never change:
 * only the opening does (where the champion starts, which enemies stand where, when waves
 * arrive), so champions with a different identity get a comparable fight on the same map.
 */
export interface ChampionSetup {
  /** Why this champion needs it (documentation for balance reviews; not shown in game). */
  reason: string;
  heroPos?: Pos;
  /** Full enemy list for this champion (replaces the authored one). */
  enemies?: EnemySpawnDef[];
  /** Full wave list for this champion (replaces the authored one). */
  waves?: WaveDef[];
}

/** NORMAL fight, ELITE (an elite enemy, better rewards) or BOSS (special board/objective/pool). */
export type EncounterTier = 'NORMAL' | 'ELITE' | 'BOSS';

/**
 * A battle inside a campaign. It IS a ScenarioDef (the engine's input: layout, spawns,
 * waves, objectives), plus progression metadata the engine never reads. Adding an encounter
 * is data only.
 */
export interface EncounterDef extends ScenarioDef {
  tier: EncounterTier;
  /** Declared playable size; must match `layout` (validated). */
  board: BoardSize;
  /** One-line tactical lesson of this fight (shown to the player). */
  focus: string;
  /**
   * Reward quality comes from the tier pool, never from the encounter id. `favorTags`
   * (optional) makes cards with those tags more likely — themed boss pools, for example.
   * `cards` (optional) is an authored offer: those cards (still below their copy limit) are the
   * offer instead of a pool roll; once all are capped the pool rolls as usual (replays).
   */
  rewards: { pool: RewardPoolId; choices: number; favorTags?: string[]; cards?: readonly string[] };
  /** Encounter that follows a victory; null = the campaign ends here. */
  next: string | null;
  /** Per-champion openings (see ChampionSetup); champions not listed play the authored one. */
  champions?: Partial<Record<string, ChampionSetup>>;
}

/**
 * One campaign shared by several champions. Encounters are authored once; the run's champion
 * is placed on the authored hero spawn (`encounterFor`). Each champion keeps its own run.
 */
export type CampaignKind = 'MAIN_ACT' | 'CHAMPION_STORY';

export interface CampaignDef {
  /** Absent on legacy definitions = shared main act. Does not change save IDs. */
  kind?: CampaignKind;
  id: string;
  name: string;
  /** Champions that can play this campaign; the first is the default (legacy saves). */
  heroIds: readonly string[];
  start: string;
  encounters: readonly EncounterDef[];
}

export const defaultCampaignHero = (campaign: CampaignDef): string => campaign.heroIds[0]!;

export const supportsHero = (campaign: CampaignDef, heroId: unknown): heroId is string =>
  typeof heroId === 'string' && campaign.heroIds.includes(heroId);

export function encounterById(campaign: CampaignDef, id: string): EncounterDef {
  const encounter = campaign.encounters.find((e) => e.id === id);
  if (!encounter) throw new Error(`Campaign ${campaign.id}: unknown encounter "${id}"`);
  return encounter;
}

/**
 * The encounter as `heroId` fights it: same board, objective and rewards, that champion on the
 * hero spawn, with its ChampionSetup (if any) applied. Client and server build battles from it.
 */
export function encounterFor(campaign: CampaignDef, id: string, heroId: string): EncounterDef {
  const encounter = encounterById(campaign, id);
  if (!supportsHero(campaign, heroId)) throw new Error(`Campaign ${campaign.id}: champion "${heroId}" cannot play it`);
  return withChampion(encounter, heroId);
}

function withChampion(encounter: EncounterDef, heroId: string): EncounterDef {
  const setup = encounter.champions?.[heroId];
  return {
    ...encounter,
    hero: { heroId, pos: setup?.heroPos ?? encounter.hero.pos },
    enemies: setup?.enemies ?? encounter.enemies,
    waves: setup?.waves ?? encounter.waves,
  };
}

/** Encounters in play order (following `next` from `start`). */
export function encounterOrder(campaign: CampaignDef): EncounterDef[] {
  const order: EncounterDef[] = [];
  const seen = new Set<string>();
  for (let id: string | null = campaign.start; id && !seen.has(id); ) {
    seen.add(id);
    const encounter = campaign.encounters.find((e) => e.id === id);
    if (!encounter) break;
    order.push(encounter);
    id = encounter.next;
  }
  return order;
}

export function validateEncounter(encounter: EncounterDef, content: GameContent): string[] {
  const errors = boardSizeErrors(encounter.board).map((e) => `Encounter ${encounter.id}: ${e}`);
  const actual = scenarioBoardSize(encounter);
  if (actual.rows !== encounter.board.rows || actual.columns !== encounter.board.columns)
    errors.push(
      `Encounter ${encounter.id}: declares ${encounter.board.rows}x${encounter.board.columns} but layout is ${actual.rows}x${actual.columns}`,
    );
  if (encounter.rewards.choices < 0) errors.push(`Encounter ${encounter.id}: negative reward choices`);
  for (const cardId of encounter.rewards.cards ?? [])
    if (!content.cards[cardId]) errors.push(`Encounter ${encounter.id}: unknown reward card "${cardId}"`);
  return [...errors, ...validateScenario(encounter, content, { authoring: true })];
}

/** Every encounter valid, unique ids, `next` links resolve, and all encounters are reachable. */
export function validateCampaign(campaign: CampaignDef, content: GameContent): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const e of campaign.encounters) {
    if (ids.has(e.id)) errors.push(`Campaign ${campaign.id}: duplicate encounter "${e.id}"`);
    ids.add(e.id);
    if (e.next && !campaign.encounters.some((o) => o.id === e.next))
      errors.push(`Encounter ${e.id}: next "${e.next}" does not exist`);
    // Every champion must be able to start every encounter (spawn, objectives, board).
    for (const heroId of campaign.heroIds) errors.push(...validateEncounter(withChampion(e, heroId), content));
    for (const heroId of Object.keys(e.champions ?? {}))
      if (!campaign.heroIds.includes(heroId)) errors.push(`Encounter ${e.id}: setup for "${heroId}", who cannot play the campaign`);
  }
  if (campaign.heroIds.length === 0) errors.push(`Campaign ${campaign.id}: no champions`);
  for (const heroId of campaign.heroIds)
    if (!content.heroes[heroId]) errors.push(`Campaign ${campaign.id}: unknown champion "${heroId}"`);
  if (!ids.has(campaign.start)) errors.push(`Campaign ${campaign.id}: unknown start "${campaign.start}"`);
  const reachable = encounterOrder(campaign);
  if (reachable.length !== campaign.encounters.length)
    errors.push(`Campaign ${campaign.id}: ${campaign.encounters.length - reachable.length} unreachable encounter(s) or a cycle`);
  if (reachable.at(-1)?.next) errors.push(`Campaign ${campaign.id}: progression loops back`);
  return errors;
}
