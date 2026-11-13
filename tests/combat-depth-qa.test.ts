import { describe, expect, it } from 'vitest';
import { GameEngine, type GameState } from '../src/game';
import { DEFAULT_CONTENT, SCENARIOS_BY_ID, type GameContent, type GameEvent } from '../src/game';
import { shapeshifterCatalog } from '../src/game/data/shapeshifter-catalog';
import {
  createShapeshifterBattle,
  replayShapeshifterBattle,
} from '../src/game/qa/shapeshifter-battle';
import { dealDamage } from '../src/game/domain/combat/damage';
import { walkUnit, teleportUnit } from '../src/game/domain/combat/movement';
import { behind, combatFacing, type AttackKind } from '../src/game/domain/combat/qa-depth';
import { locomotionRoute, locomotionClip } from '../src/presentation/pixi/locomotion';
import { CHARACTER_ANIMATIONS } from '../src/presentation/pixi/characterAnimations';
import { GridWalk } from '../src/presentation/pixi/GridWalk';
const base = shapeshifterCatalog(DEFAULT_CONTENT);
const content: GameContent = {
  ...base,
  qaCombatDepth: { version: 1, backstab: true, formCounter: 'perHit' },
};
const scenario = {
  ...SCENARIOS_BY_ID.first_blood!,
  hero: { ...SCENARIOS_BY_ID.first_blood!.hero, heroId: 'shapeshifter' },
};
function fixture(counter: 'perHit' | 'oncePerRound' = 'perHit') {
  const engine = createShapeshifterBattle(
    scenario,
    { ...content, qaCombatDepth: { ...content.qaCombatDepth!, formCounter: counter } },
    13,
    'guaranteed',
  );
  const state = structuredClone(engine.state) as GameState,
    events: GameEvent[] = [];
  const hero = state.units.find((u) => u.kind === 'HERO')!,
    enemy = state.units.find((u) => u.kind === 'ENEMY')!;
  hero.pos = { x: 2, y: 2 };
  hero.hp = hero.maxHp = 40;
  hero.armor = 0;
  hero.activeForm = 'bear';
  hero.combatFacing = 'RIGHT';
  enemy.pos = { x: 3, y: 2 };
  enemy.hp = enemy.maxHp = 40;
  enemy.armor = 0;
  enemy.combatFacing = 'LEFT';
  return {
    engine,
    state,
    hero,
    enemy,
    events,
    ctx: { state, content: engine.content, emit: (e: GameEvent) => events.push(e) },
  };
}
describe('private QA directional damage', () => {
  it.each([
    { x: 3, y: 2, extra: 0 },
    { x: 2, y: 1, extra: 0 },
    { x: 2, y: 3, extra: 0 },
    { x: 1, y: 2, extra: 1 },
    { x: 1, y: 1, extra: 0 },
  ])('front/side/rear, exact rear ray: %j', ({ x, y, extra }) => {
    const { ctx, hero, enemy, events } = fixture();
    hero.activeForm = undefined;
    enemy.pos = { x, y };
    hero.armor = 2;
    expect(dealDamage(ctx, hero, 3, enemy.id, 'PHYSICAL', 'DIRECT_MELEE').hpLost).toBe(1 + extra);
    expect(events.filter((e) => e.type === 'BACKSTAB')).toHaveLength(extra);
  });
  it('supports all four real directions and deterministic legacy fallback', () => {
    const { hero, enemy } = fixture();
    for (const [direction, pos] of Object.entries({
      UP: { x: 2, y: 3 },
      DOWN: { x: 2, y: 1 },
      LEFT: { x: 3, y: 2 },
      RIGHT: { x: 1, y: 2 },
    })) {
      hero.combatFacing = direction as typeof hero.combatFacing;
      enemy.pos = pos;
      expect(behind(enemy, hero)).toBe(true);
    }
    delete hero.combatFacing;
    expect(combatFacing(hero)).toBe('RIGHT');
  });
  it('adds final damage after armor but shields absorb it; no public or duel leakage', () => {
    const f = fixture();
    f.hero.activeForm = undefined;
    f.enemy.pos = { x: 1, y: 2 };
    f.hero.armor = 5;
    f.hero.shield = 2;
    expect(
      dealDamage(f.ctx, f.hero, 2, f.enemy.id, 'PHYSICAL', 'DIRECT_MELEE').shieldAbsorbed,
    ).toBe(1);
    expect(f.hero.hp).toBe(40);
    const ordinary = fixture();
    ordinary.ctx.content = { ...base };
    ordinary.enemy.pos = { x: 1, y: 2 };
    ordinary.hero.armor = 5;
    expect(
      dealDamage(ordinary.ctx, ordinary.hero, 2, ordinary.enemy.id, 'PHYSICAL', 'DIRECT_MELEE')
        .hpLost,
    ).toBe(0);
    const duel = fixture();
    duel.state.duel = {} as NonNullable<typeof duel.state.duel>;
    duel.enemy.pos = { x: 1, y: 2 };
    expect(
      dealDamage(duel.ctx, duel.hero, 2, duel.enemy.id, 'PHYSICAL', 'DIRECT_MELEE').hpLost,
    ).toBe(2);
    expect(duel.events.some((e) => e.type === 'BACKSTAB')).toBe(false);
    expect(duel.events.filter((e) => e.type === 'COUNTER_ATTACK')).toHaveLength(1);
  });
  it.each([undefined, 'RANGED', 'GROUND_HAZARD', 'COUNTER'] as (AttackKind | undefined)[])(
    'excludes area, DoT, hazard and reactions (%s)',
    (kind) => {
      const f = fixture();
      f.enemy.pos = { x: 1, y: 2 };
      dealDamage(f.ctx, f.hero, 2, f.enemy.id, 'PHYSICAL', kind);
      expect(f.events.some((e) => e.type === 'COUNTER_ATTACK' || e.type === 'BACKSTAB')).toBe(
        false,
      );
    },
  );
  it('only voluntary movement changes facing using the final actual segment', () => {
    const f = fixture();
    walkUnit(
      f.ctx,
      f.hero,
      [
        { x: 2, y: 3 },
        { x: 1, y: 3 },
      ],
      2,
    );
    expect(f.hero.combatFacing).toBe('LEFT');
    teleportUnit(f.ctx, f.hero, { x: 1, y: 4 }, 'qa');
    expect(f.hero.combatFacing).toBe('LEFT');
  });
});
describe('form reactions reuse Riposte', () => {
  it.each(['bear', 'minotaur'])(
    'replies in %s without spending resources, with mitigation',
    (form) => {
      const f = fixture();
      f.hero.activeForm = form;
      f.enemy.armor = 1;
      const before = structuredClone(f.state.player);
      dealDamage(f.ctx, f.hero, 2, f.enemy.id, 'PHYSICAL', 'DIRECT_MELEE');
      expect(f.events.filter((e) => e.type === 'COUNTER_ATTACK')).toHaveLength(1);
      expect(f.enemy.hp).toBe(40);
      expect(f.state.player).toEqual(before);
    },
  );
  it('cannot recurse and does not reply while humanoid, dead, out of reach or attacker missing', () => {
    for (const mode of ['humanoid', 'dead', 'range', 'missing']) {
      const f = fixture();
      if (mode === 'humanoid') delete f.hero.activeForm;
      if (mode === 'dead') f.hero.hp = 1;
      if (mode === 'range') f.enemy.pos = { x: 4, y: 2 };
      dealDamage(
        f.ctx,
        f.hero,
        2,
        mode === 'missing' ? 'absent' : f.enemy.id,
        'PHYSICAL',
        'DIRECT_MELEE',
      );
      expect(f.events.some((e) => e.type === 'COUNTER_ATTACK')).toBe(false);
    }
    const f = fixture();
    f.enemy.defId = 'shapeshifter';
    f.enemy.activeForm = 'minotaur';
    dealDamage(f.ctx, f.hero, 2, f.enemy.id, 'PHYSICAL', 'DIRECT_MELEE');
    expect(f.events.filter((e) => e.type === 'COUNTER_ATTACK')).toHaveLength(1);
  });
  it('compares per-hit against once per round, without changing the public policy', () => {
    for (const [mode, count] of [
      ['perHit', 4],
      ['oncePerRound', 1],
    ] as const) {
      const f = fixture(mode);
      for (let i = 0; i < 4; i++)
        dealDamage(f.ctx, f.hero, 2, f.enemy.id, 'PHYSICAL', 'DIRECT_MELEE');
      expect(f.enemy.hp).toBe(40 - count);
      expect(f.events.filter((e) => e.type === 'COUNTER_ATTACK')).toHaveLength(count);
      f.state.round++;
      dealDamage(f.ctx, f.hero, 2, f.enemy.id, 'PHYSICAL', 'DIRECT_MELEE');
      expect(f.enemy.hp).toBe(39 - count);
    }
  });
  it('persists facing and reaction state and replays real commands identically', () => {
    const f = fixture();
    const e = f.engine;
    const card = e.state.player.hand.find((c) =>
      e.content.cards[c.cardId]!.effects.some((fx) => fx.type === 'TRANSFORM'),
    )!;
    e.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: null });
    for (let i = 0; i < 3 && !e.state.outcome; i++)
      e.dispatch({
        type: 'END_TURN',
        ...(e.state.player.hand.length > 5 ? { discardUid: e.state.player.hand[0]!.uid } : {}),
      });
    const replay = replayShapeshifterBattle(scenario, e.content, 13, 'guaranteed', e.history);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
    expect(JSON.parse(JSON.stringify(e.state))).toEqual(e.state);
  });
});
describe('QA locomotion', () => {
  it('uses path steps rather than displacement and keeps short/long routes distinct', () => {
    expect(
      locomotionRoute({
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        path: [
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      }).mode,
    ).toBe('walk');
    expect(
      locomotionRoute({
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        path: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
        ],
      }).mode,
    ).toBe('run');
    expect(
      locomotionRoute({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, path: [] }).segments,
    ).toHaveLength(0);
    expect(locomotionClip(CHARACTER_ANIMATIONS.warrior, 'run')).toBe('walk');
    expect(locomotionClip(undefined, 'run')).toBeNull();
  });
  it('plays each executed route, queues safely, settles to idle and suppresses gait with reduced motion', () => {
    const motions: string[] = [],
      view = {
        root: {
          position: {
            x: 0,
            y: 0,
            set(x: number, y: number) {
              this.x = x;
              this.y = y;
            },
          },
        },
        faceHorizontal: () => {},
        playAnimation: (m: string) => {
          motions.push(m);
          return true;
        },
      };
    const walk = new GridWalk(
      (p) => p,
      () => {},
      true,
    );
    walk.enqueue(
      'u',
      view,
      {
        from: { x: 0, y: 0 },
        to: { x: 3, y: 0 },
        path: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
      },
      false,
    );
    expect(motions[0]).toBe('run');
    walk.tick(900);
    expect(view.root.position.x).toBe(3);
    expect(motions.at(-1)).toBe('idle');
    motions.length = 0;
    walk.enqueue(
      'u',
      view,
      { from: { x: 3, y: 0 }, to: { x: 4, y: 0 }, path: [{ x: 4, y: 0 }] },
      true,
    );
    expect(motions[0]).toBe('idle');
    walk.tick(100);
    expect(walk.has('u')).toBe(false);
  });
});

it('classifies the real card target contract, not how many victims happen to be in an area', () => {
  for (const cardId of ['qa_wild_strike', 'qa_axe_sweep']) {
    const f = fixture();
    f.hero.activeForm = 'minotaur';
    f.enemy.combatFacing = 'RIGHT';
    f.state.player.hand = [{ uid: 'qa-card', cardId }];
    const e = GameEngine.fromSnapshot(f.state, f.ctx.content, scenario);
    const def = e.content.cards[cardId]!;
    const result = e.dispatch({
      type: 'PLAY_CARD',
      cardUid: 'qa-card',
      target: def.targeting.type === 'SELF' ? null : f.enemy.pos,
    });
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.type === 'BACKSTAB')).toBe(cardId === 'qa_wild_strike');
  }
});
