/** Disposable Phase 8 actor fixtures. No persistence, network or combat-rule replacement. */
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../../../game';
import { withArcher } from '../../../game/data/archer';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { spawnSummon } from '../../../game/domain/summons/summons';
import { fallbackDiscardUid } from '../../../game/domain/cards/hand-limit';
export const reviewContent = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
export function prepareActorReview(choice: string): GameEngine | null {
  const [kind, id, variant] = choice.split(':');
  if (!id || !['enemy', 'summon', 'ritual'].includes(kind!)) return null;
  if (
    (kind === 'enemy' && !reviewContent.enemies[id]) ||
    (kind === 'summon' && !reviewContent.summons?.[id]) ||
    (kind === 'ritual' && !reviewContent.rituals?.[id])
  )
    return null;
  const ritual = kind === 'ritual' ? reviewContent.rituals?.[id] : undefined;
  const scenario: ScenarioDef = {
    id: 'catalog_actor_review',
    name: 'Actores VFX · QA',
    description: 'Fixture desechable, seed 42',
    layout: Array(5).fill('.......'),
    legend: { '.': {} },
    hero: {
      heroId: ritual?.heroId ?? (kind === 'enemy' ? 'warrior' : 'summoner'),
      pos: { x: 1, y: 2 },
    },
    structures: [],
    enemies: [
      { id: 'review-enemy', enemyId: kind === 'enemy' ? id : 'orc_warrior', pos: { x: 4, y: 2 } },
    ],
    waves: [],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 42,
  };
  const engine = new GameEngine(scenario, reviewContent, 42),
    state = engine.state as GameState;
  if (kind === 'enemy' && variant?.startsWith('phase-')) {
    const phase = reviewContent.enemies[id]!.phases?.[Number(variant.slice(6))];
    if (!phase) throw Error('Unknown QA enemy phase');
    const enemy = state.units.find((u) => u.faction === 'ENEMY')!;
    enemy.hp = Math.max(1, Math.floor((enemy.maxHp * phase.belowHpPct) / 100));
  }
  state.player.hand = [];
  state.player.energy = 30;
  const hero = state.units.find((u) => u.id === state.player.heroId)!;
  if (kind === 'summon') {
    hero.summonCapacityBonus = 20;
    const pet = spawnSummon({ state, content: reviewContent, emit: () => {} }, hero, id, {
      x: 3,
      y: 2,
    });
    if (!pet) throw Error('Cannot prepare summon fixture ' + id);
    pet.summon!.readyRound = state.round;
  }
  if (ritual)
    state.player.altar = ritual.pieces.map((cardId, i) => ({ uid: 'review-piece-' + i, cardId }));
  return engine;
}
export function actorReviewCommand(engine: GameEngine, choice: string) {
  if (choice.startsWith('ritual:')) {
    const ritualId = choice.slice(7),
      targets = engine.getValidTargets('ritual:' + ritualId);
    return { type: 'ACTIVATE_RITUAL' as const, ritualId, target: targets[0] ?? null };
  }
  const discardUid = fallbackDiscardUid(engine.state);
  return { type: 'END_TURN' as const, ...(discardUid ? { discardUid } : {}) };
}
