import type { IntentPlan } from '../domain/ai/ai';
import { getHero } from '../domain/board/occupancy';
import type { PathNode } from '../domain/board/pathfinding';
import { checkPlayability, playCard } from '../domain/cards/play-card';
import { areaTiles, iceWallFits, getValidTargets, pairSwapPartners, resolveTarget, type ResolvedTarget } from '../domain/cards/targeting';
import { effectiveCost } from '../domain/cards/form-effects';
import { unitAt } from '../domain/board/occupancy';
import type { GameContent } from '../domain/content';
import { queryContext, type RuleContext } from '../domain/context';
import type { Pos } from '../domain/core/position';
import type { GameEvent } from '../domain/events';
import type { RuleError } from '../domain/result';
import type { ScenarioDef } from '../domain/scenario';
import type { GameState } from '../domain/state';
import { legalHeroMoves } from '../domain/turn/player-actions';
import { resolveEnemyPhase } from '../domain/turn/turn-flow';
import { executeCommand, type Command } from './commands';
import type { TargetingDef } from '../domain/cards/card';
import { isEmptyTile } from '../domain/board/occupancy';
import {
  activateRitual,
  altarStatus,
  checkCommit,
  checkRitual,
  resolveRitualTarget,
  ritualProgress,
  type AltarStatus,
  type RitualProgress,
} from '../domain/rituals/ritual-rules';

/**
 * UI selection keys: a hand card's uid, or `ritual:<ritualId>` for a ritual activation. Every
 * targeting query below accepts both, so the board preview works the same for rituals.
 */
export const RITUAL_SELECTION = 'ritual:';
export const ritualSelection = (ritualId: string): string => RITUAL_SELECTION + ritualId;
const ritualIdOf = (key: string): string | null => (key.startsWith(RITUAL_SELECTION) ? key.slice(RITUAL_SELECTION.length) : null);
import { createBattle } from './setup';
import { interactionOptions, type InteractionOption } from '../domain/mechanisms/mechanism-rules';
import { mechanismView, type MechanismView } from '../domain/mechanisms/mechanism-view';

export type CommandResult =
  { ok: true; events: GameEvent[] } | { ok: false; error: RuleError; message: string; events: [] };

export type EngineListener = (events: readonly GameEvent[], state: Readonly<GameState>) => void;

export type CardPlayability =
  { playable: true } | { playable: false; reason: RuleError; message: string };

export interface CardPreview {
  valid: boolean;
  resolved: ResolvedTarget | null;
  /** Events a dry-run of this play would emit (damage numbers, pushes, …) for UI previews. */
  predictedEvents: GameEvent[];
}

/**
 * The authority over a battle.
 *
 *   UI → Command → engine.dispatch → validation → state mutation → GameEvent[] → listeners
 *
 * `dispatch` is atomic: it works on a clone and only commits if the command is valid, so a
 * rejected command never leaves partial changes. Each successful dispatch produces a NEW
 * state object (safe for React/zustand identity checks). Never mutate `engine.state`.
 */
export class GameEngine {
  /** Presentation selection only; authoritative resolution uses the command field. */
  wallOrientation: import('../domain/cards/targeting').WallOrientation = 'HORIZONTAL';
  private wallChoice(key: string) { return this.current.player.hand.find(c=>c.uid===key)?.cardId === 'ice_wall' ? this.wallOrientation : undefined; }
  private current: GameState;
  private currentSeed: number;
  private readonly listeners = new Set<EngineListener>();
  /** Accepted commands since the battle started — (scenario, seed, history) replays a battle. */
  readonly history: Command[] = [];
  initialEvents: GameEvent[];

  constructor(
    readonly scenario: ScenarioDef,
    readonly content: GameContent,
    seed: number = scenario.defaultSeed,
  ) {
    this.currentSeed = seed >>> 0;
    const { state, events } = createBattle(scenario, content, this.currentSeed);
    this.current = state;
    this.initialEvents = events;
  }

  /** Seed of the battle in progress: drives the deck shuffle (and reshuffles). */
  get seed(): number {
    return this.currentSeed;
  }

  get state(): Readonly<GameState> {
    return this.current;
  }

  /** Presentation query adapter for server snapshots; it never executes online actions. */
  static fromSnapshot(state: GameState, content: GameContent, scenario: ScenarioDef): GameEngine {
    const engine = new GameEngine(scenario, content);
    engine.current = state;
    engine.initialEvents = [];
    return engine;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(command: Command): CommandResult {
    const draft = structuredClone(this.current);
    const events: GameEvent[] = [];
    const ctx: RuleContext = { state: draft, content: this.content, emit: (e) => events.push(e) };
    const result = executeCommand(ctx, command);
    if (!result.ok) return { ok: false, error: result.error, message: result.message, events: [] };
    this.current = draft;
    this.history.push(command);
    for (const listener of this.listeners) listener(events, this.current);
    return { ok: true, events };
  }

  /**
   * Restart the same scenario from a fresh battle state (new draw pile, empty hand/discard).
   * Without `seed` it replays the same seed (deterministic replay); pass a new one for a new shuffle.
   */
  restart(seed: number = this.currentSeed): GameEvent[] {
    this.currentSeed = seed >>> 0;
    const { state, events } = createBattle(this.scenario, this.content, this.currentSeed);
    this.current = state;
    this.initialEvents = events;
    this.history.length = 0;
    for (const listener of this.listeners) listener(events, this.current);
    return events;
  }

  // ── Queries (pure, never mutate) ─────────────────────────────────────────

  private query(state: GameState = this.current): RuleContext {
    return queryContext(state, this.content);
  }

  getLegalMoves(): PathNode[] {
    return legalHeroMoves(this.query());
  }

  getCardPlayability(cardUid: string): CardPlayability {
    if (this.current.phase !== 'PLAYER') {
      return { playable: false, reason: 'NOT_PLAYER_TURN', message: 'Not the player turn.' };
    }
    const ritualId = ritualIdOf(cardUid);
    const check = ritualId ? checkRitual(this.query(), ritualId) : checkPlayability(this.query(), cardUid);
    return check.ok
      ? { playable: true }
      : { playable: false, reason: check.error, message: check.message };
  }

  /** Targeting of a selection key (hand card or ritual), or null when it does not exist. */
  selectionTargeting(key: string): TargetingDef | null {
    const ritualId = ritualIdOf(key);
    if (ritualId) return (Object.hasOwn(this.content.rituals ?? {}, ritualId) && this.content.rituals![ritualId]?.targeting) || null;
    const card = this.current.player.hand.find((c) => c.uid === key);
    return (card && this.content.cards[card.cardId]?.targeting) || null;
  }

  /** The command that acting with this selection on `target` sends (`secondary`: pairSwap cards only). */
  selectionCommand(key: string, target: Pos | null, secondary?: Pos | null): Command {
    const ritualId = ritualIdOf(key);
    if (ritualId) return { type: 'ACTIVATE_RITUAL', ritualId, target };
    return { type: 'PLAY_CARD', cardUid: key, target, ...(secondary ? {secondary} : {}), ...(this.wallChoice(key) ? {wallOrientation:this.wallChoice(key)} : {}) };
  }

  /**
   * Pacto de la Doble Luna: second picks for a chosen `target` — `null` (swap with the caster)
   * and/or the tiles of other own summons. Empty for any other card or an illegal first pick.
   */
  getSecondaryTargets(cardUid: string, target: Pos): (Pos | null)[] {
    if (this.current.phase !== 'PLAYER') return [];
    const ctx = this.query();
    const check = checkPlayability(ctx, cardUid);
    if (!check.ok || check.def.targeting.type !== 'UNIT' || !check.def.targeting.pairSwap) return [];
    if (!getValidTargets(ctx, check.caster, check.def.targeting).some((p) => p.x === target.x && p.y === target.y)) return [];
    const first = unitAt(ctx.state, target);
    return first ? pairSwapPartners(ctx, check.caster, check.def.targeting, first) : [];
  }

  /** Energy this hand card costs right now (printed cost minus a pending discount). */
  getCardCost(cardUid: string): { cost: number; discount: number } | null {
    const card = this.current.player.hand.find((c) => c.uid === cardUid);
    const def = card && this.content.cards[card.cardId];
    const hero = getHero(this.current);
    if (!def || !hero) return null;
    const { cost, discount } = effectiveCost(this.content, hero, def);
    return { cost, discount };
  }

  getValidTargets(cardUid: string): Pos[] {
    const ctx = this.query();
    if (this.current.phase !== 'PLAYER') return [];
    const ritualId = ritualIdOf(cardUid);
    if (ritualId) {
      const check = checkRitual(ctx, ritualId);
      if (!check.ok) return [];
      const summons = check.ritual.result.effects.some((fx) => fx.type === 'SUMMON');
      return getValidTargets(ctx, check.caster, check.ritual.targeting).filter((p) => !summons || isEmptyTile(ctx, p));
    }
    const check = checkPlayability(ctx, cardUid);
    if (!check.ok) return [];
    const targets=getValidTargets(ctx, check.caster, check.def.targeting);
    const orientation=this.wallChoice(cardUid);
    return orientation && check.def.targeting.type==='TILE' ? targets.filter(p=>iceWallFits(ctx,areaTiles(ctx.state.board,check.def.targeting.type==='TILE'?check.def.targeting.area:undefined,p,check.caster.pos,orientation))) : targets;
  }

  previewCard(cardUid: string, target: Pos | null, secondary?: Pos | null): CardPreview {
    const none: CardPreview = { valid: false, resolved: null, predictedEvents: [] };
    const ctx = this.query();
    if (this.current.phase !== 'PLAYER') return none;
    const ritualId = ritualIdOf(cardUid);
    let resolved: ResolvedTarget | null;
    if (ritualId) {
      const check = checkRitual(ctx, ritualId);
      resolved = check.ok ? resolveRitualTarget(ctx, check, target) : null;
    } else {
      const check = checkPlayability(ctx, cardUid);
      resolved = check.ok ? resolveTarget(ctx, check.caster, check.def.targeting, target, secondary, this.wallChoice(cardUid)) : null;
    }
    if (!resolved) {
      if (this.wallChoice(cardUid) && target) {
        const def=this.content.cards.ice_wall;
        const caster=this.current.units.find(u=>u.id===this.heroId);
        if(def?.targeting.type==='TILE' && caster) return {...none,resolved:{target,impact:target,direction:null,hitUnitId:null,affectedTiles:areaTiles(this.current.board,def.targeting.area,target,caster.pos,this.wallChoice(cardUid))}};
      }
      return none;
    }
    const predictedEvents: GameEvent[] = [];
    const dryRun: RuleContext = {
      state: structuredClone(this.current),
      content: this.content,
      emit: (e) => predictedEvents.push(e),
    };
    if (ritualId) activateRitual(dryRun, ritualId, target);
    else { const result = playCard(dryRun, cardUid, target, undefined, secondary, this.wallChoice(cardUid)); if (!result.ok) return {valid:false,resolved,predictedEvents:[]}; }
    return { valid: true, resolved, predictedEvents };
  }

  /** Can this hand card be sealed onto the altar now? Same check COMMIT_RITUAL_PIECE runs. */
  getCommitPlayability(cardUid: string): CardPlayability {
    if (this.current.phase !== 'PLAYER') return { playable: false, reason: 'NOT_PLAYER_TURN', message: 'Not the player turn.' };
    const check = checkCommit(this.query(), cardUid);
    return check.ok ? { playable: true } : { playable: false, reason: check.error, message: check.message };
  }

  /** Ritual progress of the player's own champion (own altar only; never the rival's). */
  getRitualProgress(): RitualProgress[] {
    const hero = getHero(this.current);
    return hero ? ritualProgress(this.content, hero.defId, this.current.player) : [];
  }

  /**
   * Altar UI contract (own altar only): seals this turn, next seal's energy, and per ritual its
   * "2 / 3" progress, creature and ready state. Null for champions without an altar.
   */
  getAltarStatus(): AltarStatus | null {
    const status = altarStatus(this.query());
    if (!status || this.current.phase === 'PLAYER') return status;
    const blockedBy = { code: 'NOT_PLAYER_TURN', message: 'Not the player turn.' };
    return { ...status, rituals: status.rituals.map((r) => (r.complete ? { ...r, ready: false, blockedBy } : r)) };
  }

  /**
   * What every enemy will do if the player ends the turn now (for telegraphs). Simulates the
   * real enemy phase on a clone — end-of-turn terrain/status, then each enemy in order — so a
   * plan accounts for enemies that act before it. Enemies that would not get to act (killed
   * earlier in the phase, battle already decided) have no plan. Cached per state snapshot.
   */
  getIntentPreviews(): IntentPlan[] {
    if (
      this.current.scenarioId === 'private_duel' ||
      this.current.scenarioId === 'private_dominion'
    )
      return [];
    if (this.previewCache?.state === this.current) return this.previewCache.plans;
    const plans: IntentPlan[] = [];
    if (this.current.phase === 'PLAYER') {
      resolveEnemyPhase(queryContext(structuredClone(this.current), this.content), (plan) =>
        plans.push(plan),
      );
    }
    this.previewCache = { state: this.current, plans };
    return plans;
  }

  private previewCache: { state: GameState; plans: IntentPlan[] } | null = null;

  /**
   * Contextual board actions (Act III): every interactable mechanism with its verb, adjacency and
   * whether INTERACT would be accepted now (`reason` when not). Empty on static boards and in PvP.
   */
  getInteractions(): InteractionOption[] {
    return interactionOptions(this.query());
  }

  /** Visual telegraph of the interactive battlefield (null on static boards and in PvP). */
  getMechanismView(): MechanismView | null {
    return mechanismView(this.current);
  }

  get heroId(): string {
    return getHero(this.current)?.id ?? this.current.player.heroId;
  }
}
