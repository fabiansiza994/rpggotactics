import {summonSearchChoices} from '../domain/cards/play-card';
import { createDominion, refreshDominion, scoreDominion, type PvpMode } from './dominion';
import { pvpMap, mapScenario, mapSpawns } from './maps';
import { DEFAULT_CONTENT, DECK_RULES } from '../data';
import { withHeroDeck } from '../collection/profile';
import { heroProfile, ownedFor, activeDeck, type PlayerProfile } from '../collection/profile';
import { validateDeck, type DeckEntry } from '../collection/deck-rules';
import type { GameState, PlayerState } from '../domain/state';
import type { ScenarioDef } from '../domain/scenario';
import type { RuleContext } from '../domain/context';
import type { GameContent } from '../domain/content';
import type { GameEvent } from '../domain/events';
import { createBattle } from '../engine/setup';
import { executeCommand, type Command } from '../engine/commands';
import { randomInt } from '../domain/core/rng';
import { drawCards, setMovePoints } from '../domain/cards/deck';
import { effectiveMoveRange, unitById } from '../domain/board/occupancy';
import { actSummons } from '../domain/summons/summons';
import { startFactionTurn, endFactionTurn, restoreTurnEnergy, resetTurnLimits } from '../domain/turn/turn-flow';
import { tickBoardDurations } from '../domain/terrain/terrain-rules';
import { updateObjectives } from '../domain/objectives/objective-rules';

export const DUEL_SCENARIO: ScenarioDef = {
  id: 'private_duel',
  name: 'Duelo privado',
  description: 'Derrota al campeón rival.',
  layout: Array.from({ length: 6 }, () => '.........'),
  legend: { '.': {} },
  hero: { heroId: 'mage', pos: { x: 0, y: 1 } },
  structures: [],
  enemies: [],
  waves: [],
  objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 1000000 }],
  defaultSeed: 1,
};
export interface DuelMeta {
  /** Server-selected rules for new Ranked 1v1 matches; absent preserves legacy replays. */
  rankedPactGolem?: true;
  champions: [string, string];
  active: 0 | 1;
  other: PlayerState;
  turns: number;
}
/**
 * What one seat brings to a match: a SNAPSHOT of the deck's cards taken when the loadout is
 * resolved. Editing or deleting the saved deck later never changes a match that already has it.
 */
export interface Loadout {
  heroId: string;
  cards: DeckEntry[];
  /** The saved deck the snapshot came from (informational; absent in rooms from older Workers). */
  deckId?: string;
}
/**
 * `deckId` = one of this profile's decks for `heroId` (default deck when omitted). A deck of
 * another champion or another account is never in this profile's list, so it is UNKNOWN_DECK.
 * `content` defaults to the public registry; QA champions (Archer) pass their own content.
 */
export function validateLoadout(profile: PlayerProfile, heroId: unknown, content: GameContent = DEFAULT_CONTENT, deckId?: unknown): Loadout {
  if (typeof heroId !== 'string' || !Object.hasOwn(content.heroes, heroId)) throw Error('UNKNOWN_CHAMPION');
  const hero = heroProfile(profile, heroId, content),
    deck = deckId === undefined || deckId === null ? activeDeck(hero) : hero.decks.find((d) => d.id === deckId);
  if (!deck) throw Error('UNKNOWN_DECK');
  if (validateDeck(deck.cards, heroId, ownedFor(profile, heroId, content), content, DECK_RULES).length)
    throw Error('INVALID_DECK');
  return { heroId, cards: structuredClone(deck.cards), deckId: deck.id };
}
export function createDuel(
  loadouts: [Loadout, Loadout],
  seed: number,
  mode: PvpMode = 'DUEL',
  mapId = 'classic',
  content: GameContent = DEFAULT_CONTENT,
  ranked = false,
): GameState {
  const map = pvpMap(mapId, mode),
    scenario = mapScenario(map, mode);
  const [spawnA, spawnB] = mapSpawns(map, mode);
  const a = createBattle(
    { ...scenario, hero: { heroId: loadouts[0].heroId, pos: spawnA } },
    withHeroDeck(content, loadouts[0].heroId, loadouts[0].cards),
    seed,
  ).state;
  const b = createBattle(
    { ...scenario, hero: { heroId: loadouts[1].heroId, pos: spawnB } },
    withHeroDeck(content, loadouts[1].heroId, loadouts[1].cards),
    a.rngState,
  ).state;
  const heroA = a.units[0]!,
    heroB = b.units[0]!;
  heroA.id = 'champion-a';
  heroB.id = 'champion-b';
  heroB.faction = 'ENEMY';
  a.player.heroId = heroA.id;
  b.player.heroId = heroB.id;
  for (const pile of [b.player.deck, b.player.hand]) for (const c of pile) c.uid = 'b-' + c.uid;
  a.units.push(heroB);
  a.rngState = b.rngState;
  a.nextId = Math.max(a.nextId, b.nextId) + 100;
  a.duel = { ...(ranked && mode === 'DUEL' ? { rankedPactGolem: true as const } : {}), champions: [heroA.id, heroB.id], active: 0, other: b.player, turns: 0 };
  if (randomInt(a, 2) === 1) swapDuelTurn(a);
  a.mapId = map.id;
  if (mode === 'DOMINION') a.dominion = createDominion(map.objectiveNodes);
  return a;
}
function swapDuelTurn(state: GameState): void {
  const duel = state.duel!;
  [state.player, duel.other] = [duel.other, state.player];
  duel.active = duel.active === 0 ? 1 : 0;
  for (const unit of state.units) unit.faction = unit.faction === 'PLAYER' ? 'ENEMY' : 'PLAYER';
}
export function endDuelTurn(ctx: RuleContext): void {
  actSummons(ctx, ctx.state.player.heroId);
  if (updateObjectives(ctx)) return;
  endFactionTurn(ctx, 'PLAYER');
  if (updateObjectives(ctx)) return;
  const duel = ctx.state.duel!;
  duel.turns++;
  if (duel.turns % 2 === 0) {
    scoreDominion(ctx);
    if (ctx.state.outcome) return;
    tickBoardDurations(ctx);
    ctx.state.round++;
  }
  swapDuelTurn(ctx.state);
  startFactionTurn(ctx, 'PLAYER');
  if (updateObjectives(ctx)) return;
  restoreTurnEnergy(ctx);
  resetTurnLimits(ctx);
  const champion = unitById(ctx.state, ctx.state.player.heroId);
  setMovePoints(ctx, champion ? effectiveMoveRange(ctx, champion, ctx.state.player.maxMovePoints) : ctx.state.player.maxMovePoints);
  if (duel.turns >= 2) drawCards(ctx, ctx.state.player.drawPerTurn);
  updateObjectives(ctx);
}
export function applyDuel(
  state: GameState,
  command: Command,
  content: GameContent = DEFAULT_CONTENT,
): { state: GameState; events: GameEvent[] } {
  const draft = structuredClone(state),
    events: GameEvent[] = [];
  const result = executeCommand(
    { state: draft, content, emit: (e) => events.push(e) },
    command,
  );
  if (!result.ok) throw Error(result.error);
  refreshDominion(draft);
  return { state: draft, events };
}
/** Wire view: own hand/discard only, no draw order, opponent cards, seed or RNG state. */
export function duelView(
  state: GameState,
  seat: 0 | 1,
  content: GameContent = DEFAULT_CONTENT,
): GameState & {
  pileCounts: {
    deck: number;
    discard: number;
    opponentHand: number;
    opponentDeck: number;
    opponentDiscard: number;
    opponentAltar: number;
  };
} {
  const view = structuredClone(state),
    meta = view.duel!,
    own = meta.active === seat ? view.player : meta.other,
    rival = meta.active === seat ? meta.other : view.player;
  const pileCounts = {
    deck: own.deck.length,
    discard: own.discard.length,
    opponentHand: rival.hand.length,
    opponentDeck: rival.deck.length,
    opponentDiscard: rival.discard.length,
    // Ritual disclosure: the rival's altar SIZE is public (like its hand size), never its pieces.
    opponentAltar: rival.altar?.length ?? 0,
  };
  if (meta.active !== seat)
    for (const u of view.units) u.faction = u.faction === 'PLAYER' ? 'ENEMY' : 'PLAYER';
  view.player = own;
  // Only the owner's active search card authorizes a private unordered candidate list.
  view.searchChoices = own.hand.some(c => content.cards[c.cardId]?.deckSearch)
    ? summonSearchChoices({...state, player: own, pileCounts: undefined}, content) : [];
  view.player.deck = [];
  view.duel = undefined;
  view.rngState = 0;
  view.nextId = 0;
  view.phase = state.outcome ? 'ENDED' : meta.active === seat ? 'PLAYER' : 'ENEMY';
  view.activeFaction = view.phase === 'PLAYER' ? 'PLAYER' : 'ENEMY';
  if (state.outcome)
    view.outcome = {
      result: (
        state.dominion?.winner !== null && state.dominion?.winner !== undefined
          ? state.dominion.winner === seat
          : state.units.some((u) => u.id === state.duel!.champions[seat])
      )
        ? 'WON'
        : 'LOST',
      reason: state.outcome.reason,
    };
  return { ...view, pileCounts };
}

/**
 * Per-seat event projection. Draw/discard bookkeeping stays private (as before), and the rival's
 * altar commits/releases lose the card identity: a seat only learns that a piece was sealed.
 */
export function duelEvents(state: GameState, seat: 0 | 1, events: readonly GameEvent[]): GameEvent[] {
  const own = state.duel?.champions[seat];
  return events
    .filter(
      (e) =>
        !['CARD_DRAWN', 'CARD_DISCARDED', 'DECK_RESHUFFLED'].includes(e.type) ||
        (e.type === 'CARD_DISCARDED' && e.reason === 'PLAYED'),
    )
    .map((e): GameEvent =>
      e.type === 'RITUAL_PIECE_COMMITTED' && e.casterId !== own
        ? // The seal price is public (energy is): it depends on the seal count, never the piece.
          { type: e.type, casterId: e.casterId, altarSize: e.altarSize, energyCost: e.energyCost }
        : e.type === 'RITUAL_PIECE_RELEASED' && e.casterId !== own
          ? { type: e.type, casterId: e.casterId, altarSize: e.altarSize }
          : e,
    );
}
