import { describe, expect, it } from 'vitest';
import { createEngine, SCENARIOS, type IntentPlan } from '../src/game';
import { playBattle } from './support/bot';
import { ENEMIES } from '../src/game/data';
import { makeEngine, ofType, p, unit } from './helpers';

describe('enemy intents', () => {
  it('are declared at the start of the player turn and are deterministic', () => {
    const build = () =>
      makeEngine({
        enemies: [
          { id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 2) },
          { id: 'wolf-1', enemyId: 'shadow_wolf', pos: p(6, 0) },
          { id: 'shaman-1', enemyId: 'dark_shaman', pos: p(3, 3) },
        ],
      });
    const a = build();
    const b = build();
    expect(a.state.intents).toEqual(b.state.intents);
    expect(a.state.intents.map((i) => i.kind)).toEqual(['MELEE_ATTACK', 'APPROACH', 'AREA_SPELL']);
    expect(ofType(a.initialEvents, 'ENEMY_INTENT_DECLARED')).toHaveLength(3);
  });

  it('melee: preview shows the path and executes exactly as previewed', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 2) }] });
    const [plan] = engine.getIntentPreviews();
    expect(plan).toMatchObject({ end: p(4, 2), cost: 2, attackTiles: [p(3, 2)], targetUnitIds: ['mage'], damage: 3 });
    const r = engine.dispatch({ type: 'END_TURN' });
    expect(unit(engine, 'orc-1').pos).toEqual(p(4, 2));
    expect(unit(engine, 'mage').hp).toBe(17);
    const types = r.events.map((e) => e.type);
    expect(types.indexOf('UNIT_MOVED')).toBeLessThan(types.indexOf('ENEMY_ATTACKED'));
  });

  it('melee intent follows its target: moving away updates the preview', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 2) }] });
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 2) });
    const [plan] = engine.getIntentPreviews();
    expect(plan?.attackTiles).toEqual([]);
    engine.dispatch({ type: 'END_TURN' });
    expect(unit(engine, 'mage').hp).toBe(20);
  });

  it('wolf charges in a locked direction when aligned; stepping out of the lane dodges it', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: p(5, 2) }] });
    expect(engine.state.intents[0]).toMatchObject({ kind: 'CHARGE', direction: 'LEFT' });
    expect(engine.getIntentPreviews()[0]?.attackTiles).toEqual([p(1, 2)]);

    const hit = makeEngine({ hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: p(5, 2) }] });
    const r = hit.dispatch({ type: 'END_TURN' });
    expect(ofType(r.events, 'UNIT_MOVED')[0]).toMatchObject({ mode: 'CHARGE', to: p(2, 2) });
    const wolf = ENEMIES.shadow_wolf!.behavior;
    expect(unit(hit, 'mage').hp).toBe(20 - (wolf.type === 'CHARGE' ? wolf.damage : 0));

    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 1) });
    engine.dispatch({ type: 'END_TURN' });
    expect(unit(engine, 'mage').hp).toBe(20);
    expect(unit(engine, 'wolf-1').pos).toEqual(p(1, 2)); // charged the full lane (range 4)
  });

  it('wolf repositions to get aligned when it is not', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: p(5, 0) }] });
    expect(engine.state.intents[0]?.kind).toBe('APPROACH');
    engine.dispatch({ type: 'END_TURN' });
    expect(engine.state.intents[0]?.kind).toBe('CHARGE');
  });

  it('area spells lock their tiles at declaration: the player can step out', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(2, 2) }, enemies: [{ id: 'shaman-1', enemyId: 'dark_shaman', pos: p(5, 2) }] });
    const intent = engine.state.intents[0];
    expect(intent).toMatchObject({ kind: 'AREA_SPELL', center: p(2, 2) });
    expect(intent?.kind === 'AREA_SPELL' ? intent.tiles : []).toHaveLength(5);

    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 0) });
    const r = engine.dispatch({ type: 'END_TURN' });
    expect(ofType(r.events, 'ENEMY_ATTACKED')[0]?.tiles).toHaveLength(5);
    expect(unit(engine, 'mage').hp).toBe(20);
  });

  it('enemies with OBJECTIVE preference go after the protected structure', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(6, 0) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 2) }],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2), targetPreference: 'OBJECTIVE' }],
      objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 6 }],
    });
    expect(engine.state.intents[0]).toMatchObject({ kind: 'MELEE_ATTACK', targetUnitId: 'crystal' });
    engine.dispatch({ type: 'END_TURN' });
    expect(unit(engine, 'crystal').hp).toBe(7);
  });

  it('a wolf charge hits whatever unit is first in the lane, including allies of the wolf', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(0, 2) },
      enemies: [
        { id: 'wolf-1', enemyId: 'shadow_wolf', pos: p(4, 2) },
        { id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) },
      ],
    });
    expect(engine.state.intents[0]).toMatchObject({ kind: 'CHARGE', direction: 'LEFT' });
    // Arrange: another enemy steps into the locked charge lane.
    unit(engine, 'orc-1').pos = p(2, 2);
    const [plan] = engine.getIntentPreviews();
    expect(plan?.targetUnitIds).toEqual(['orc-1']);
  });
});

describe('telegraph == execution (regression: previews ignored earlier enemies moving)', () => {
  it('in First Blood, the wolf ends exactly where its telegraph says even though the orc moves first', () => {
    const engine = createEngine('first_blood');
    // Same inputs as the manual QA run that exposed the bug.
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    const wolfPlan = engine.getIntentPreviews().find((pl) => pl.enemyId === 'wolf-1');
    engine.dispatch({ type: 'END_TURN' });
    expect(unit(engine, 'wolf-1').pos).toEqual(wolfPlan?.end);
  });

  it('holds for every enemy action across full bot playthroughs of all scenarios', () => {
    let checked = 0;
    for (const scenario of SCENARIOS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const engine = createEngine(scenario.id, seed);
        let plans: IntentPlan[] = [];
        engine.subscribe((events) => {
          if (plans.length === 0 && !events.some((e) => e.type === 'ENEMY_ACTION_STARTED')) return;
          const actors = ofType(events, 'ENEMY_ACTION_STARTED').map((e) => e.enemyId);
          expect(actors).toEqual(plans.map((pl) => pl.enemyId));
          for (const plan of plans) {
            const start = events.findIndex((e) => e.type === 'ENEMY_ACTION_STARTED' && e.enemyId === plan.enemyId);
            const end = events.findIndex((e, i) => i > start && e.type === 'ENEMY_ACTION_ENDED');
            const segment = events.slice(start, end);
            const moved = ofType(segment, 'UNIT_MOVED').at(-1);
            if (moved) expect(moved.to).toEqual(plan.end);
            else expect(plan.path).toEqual([]);
            const attack = ofType(segment, 'ENEMY_ATTACKED')[0];
            expect(attack?.targetUnitIds ?? []).toEqual(plan.targetUnitIds);
            checked++;
          }
          plans = [];
        });
        playBattle(engine, 20, (e) => {
          plans = e.getIntentPreviews();
        });
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120000);
});
