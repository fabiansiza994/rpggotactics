/** Run through Vite SSR; emits real-engine traces, never browser screenshots. */
import { GameEngine, type GameState } from '../../src/game';
import {
  prepareActorReview,
  actorReviewCommand,
  reviewContent as content,
} from '../../src/presentation/qa/act3/catalogReviewFixtures';
import { spawnSummon } from '../../src/game/domain/summons/summons';
import {
  allCardEffects,
  cardRecipe,
  usesPhysicalArrow,
} from '../../src/presentation/vfx/catalogRecipes';
import { damageReaction } from '../../src/presentation/vfx/hitReactions';
import { compileTimeline } from '../../src/presentation/vfx/spellTimeline';
export { content };
const lookup = (id: string) => {
  const c = content.cards[id];
  return c ? (usesPhysicalArrow(c) ? 'archer_arrow' : c.presentation.visualKey) : id;
};
export function collect() {
  const records = [];
  for (const card of Object.values(content.cards)) {
    const distance =
      'minRange' in card.targeting
        ? Math.max(1, card.targeting.minRange ?? 1)
        : card.targeting.type === 'TILE' && card.targeting.leapAnchor
          ? card.targeting.leapAnchor.minRange
          : 1;
    const scenario = {
      id: 'vfx8_card',
      name: 'Card evidence fixture',
      description: 'QA only',
      layout: Array(5).fill('.......'),
      legend: { '.': {} },
      hero: { heroId: card.heroId ?? 'mage', pos: { x: 1, y: 2 } },
      structures: [],
      enemies: [{ id: 'target', enemyId: 'orc_warrior', pos: { x: 1 + distance, y: 2 } }],
      waves: [],
      objectives: [{ type: 'ELIMINATE_ALL' as const }],
      defaultSeed: 42,
    };
    const engine = new GameEngine(scenario, content, 42),
      s = engine.state as GameState,
      h = s.units.find((u) => u.id === s.player.heroId)!;
    s.player.energy = 50;
    h.shield = 4;
    h.hp = Math.max(1, h.hp - 5);
    if (h.momentum) h.momentum.value = h.momentum.max;
    if (h.focus) h.focus.value = h.focus.max;
    if (card.requiredForms?.[0]) h.activeForm = card.requiredForms[0];
    if (card.heroId === 'summoner' && !allCardEffects(card).some((e) => e.type === 'SUMMON')) {
      const pet = spawnSummon({ state: s, content, emit: () => {} }, h, 'fox', { x: 1, y: 3 });
      if (pet) {
        pet.hp = Math.max(1, pet.hp - 3);
        pet.summon!.readyRound = s.round;
      }
    }
    if ('preyOnly' in card.targeting && card.targeting.preyOnly)
      s.units
        .find((u) => u.faction === 'ENEMY')!
        .statuses.push({ id: 'PREY', sourceId: h.id, turnsLeft: 2 });
    s.player.hand = [{ uid: 'vfx8-card', cardId: card.id }];
    if (card.discardSearch) {
      const piece = Object.values(content.cards).find(
        (c) => c.heroId === h.defId && c.ritualPiece,
      )!;
      s.player.discard.push({ uid: 'review-search', cardId: piece.id });
    }
    if (card.deckSearch) {
      const summon = Object.values(content.cards).find(
        (c) => c.heroId === h.defId && allCardEffects(c).some((e) => e.type === 'SUMMON'),
      )!;
      s.player.deck.push({ uid: 'review-search', cardId: summon.id });
    }
    const targets = engine.getValidTargets('vfx8-card'),
      enemy = s.units.find((u) => u.faction === 'ENEMY')!;
    const target =
      card.targeting.type === 'SELF'
        ? null
        : (targets.find((t) => t.x === enemy.pos.x && t.y === enemy.pos.y) ?? targets[0] ?? null);
    const command =
      card.deckSearch || card.discardSearch
        ? { type: 'SEARCH_SUMMON' as const, cardUid: 'vfx8-card', choiceUid: 'review-search' }
        : { type: 'PLAY_CARD' as const, cardUid: 'vfx8-card', target };
    const before = structuredClone(s),
      result = engine.dispatch(command);
    const events = result.ok ? result.events : [];
    const replay = GameEngine.fromSnapshot(before, content, scenario).dispatch(command);
    const deterministic = JSON.stringify(replay) === JSON.stringify(result);
    records.push({
      kind: 'card',
      id: card.id,
      name: card.name,
      owner: card.heroId ?? 'neutral',
      actionType: card.category,
      accepted: result.ok,
      error: result.ok ? null : result.error,
      command,
      recipe: cardRecipe(card, events, h.id),
      eventTypes: [...new Set(events.map((e) => e.type))],
      reactions: events
        .filter((e) => e.type === 'UNIT_DAMAGED')
        .map((e) => ({ unitId: e.unitId, hpLost: e.hpLost, reaction: damageReaction(e) })),
      deterministic,
      events,
      timeline: compileTimeline(events, lookup, false),
      reducedTimeline: compileTimeline(events, lookup, true),
    });
  }
  for (const kind of ['enemy', 'summon', 'ritual'] as const) {
    const defs =
      kind === 'enemy' ? content.enemies : kind === 'summon' ? content.summons : content.rituals;
    const cases = Object.values(defs ?? {}).flatMap((def) => [
      { def, id: def.id, choice: kind + ':' + def.id },
      ...(kind === 'enemy'
        ? (content.enemies[def.id]!.phases ?? []).map((phase, i) => ({
            def: { ...def, name: def.name + ' · ' + phase.name },
            id: def.id + '@phase-' + i,
            choice: 'enemy:' + def.id + ':phase-' + i,
          }))
        : []),
    ]);
    for (const { def, id, choice } of cases) {
      const engine = prepareActorReview(choice)!;
      const command = actorReviewCommand(engine, choice),
        before = structuredClone(engine.state),
        result = engine.dispatch(command);
      const events = result.ok ? result.events : [],
        replay = GameEngine.fromSnapshot(before, content, engine.scenario).dispatch(command);
      records.push({
        kind,
        id,
        choice,
        name: def.name,
        owner: kind,
        actionType:
          kind === 'ritual'
            ? 'RITUAL_ACTIVATED'
            : kind === 'enemy'
              ? 'ENEMY_ATTACKED'
              : 'SUMMON_ATTACKED',
        accepted: result.ok,
        error: result.ok ? null : result.error,
        command,
        eventTypes: [...new Set(events.map((e) => e.type))],
        deterministic: JSON.stringify(replay) === JSON.stringify(result),
        events,
        timeline: compileTimeline(events, lookup, false),
        reducedTimeline: compileTimeline(events, lookup, true),
      });
    }
  }
  return records;
}
