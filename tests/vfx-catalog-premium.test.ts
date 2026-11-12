import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { DEFAULT_CONTENT, GameEngine, type GameEvent } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { CatalogEffects } from '../src/presentation/vfx/CatalogEffects';
import {
  allCardEffects,
  cardRecipe,
  catalogBatch,
  catalogEventRecipes,
  catalogPilot,
  confirmedAttackFamily,
  existingPresentation,
  familyRecipe,
  usesPhysicalArrow,
} from '../src/presentation/vfx/catalogRecipes';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { projectEvent } from '../src/presentation/vfx/visualProjection';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import { ElementEffects, type FxGeometry } from '../src/presentation/vfx/ElementEffects';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { makeEngine, mutable, setHand, p, ctxFor } from './helpers';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({ loadSharedTexture: vi.fn() }));
const C = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const geometry: FxGeometry = {
  center: (p) => ({ x: p.x * 96, y: p.y * 48 }),
  footprint: () => ({ w: 96, h: 48 }),
  quad: () => [],
  depth: (p) => p.y,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  catalogPilot.enabled = true;
  vi.mocked(loadSharedTexture).mockResolvedValue(
    new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) }),
  );
});
function cast(id: string, heroId = 'mage') {
  const card = C.cards[id]!,
    distance = 'minRange' in card.targeting ? (card.targeting.minRange ?? 1) : 1;
  const enemyPos = p(2 + distance, 2);
  const e = makeEngine(
    {
      hero: { heroId, pos: p(2, 2) },
      enemies: [{ id: 'enemy', enemyId: 'orc_warrior', pos: enemyPos }],
    },
    C,
    42,
  );
  const s = mutable(e);
  s.player.energy = 50;
  const hero = s.units.find((u) => u.id === s.player.heroId)!;
  hero.hp = Math.max(1, hero.maxHp - 5);
  hero.shield = 4;
  if (hero.momentum) hero.momentum.value = hero.momentum.max;
  if (card.requiredForms?.length) {
    const form = card.requiredForms[0];
    if (form) hero.activeForm = form;
  }
  if (heroId === 'summoner' && !allCardEffects(card).some((f) => f.type === 'SUMMON')) {
    const pet = spawnSummon(ctxFor(e), hero, 'fox', p(2, 3))!;
    pet.summon!.readyRound = s.round;
    pet.hp = Math.max(1, pet.hp - 3);
  }
  if ('preyOnly' in card.targeting && card.targeting.preyOnly)
    s.units
      .find((u) => u.faction === 'ENEMY')!
      .statuses.push({ id: 'PREY', turnsLeft: 2, sourceId: hero.id });
  const [uid] = setHand(e, [id]);
  const targets = e.getValidTargets(uid!);
  const target =
    card.targeting.type === 'SELF'
      ? null
      : (targets.find((t) => t.x === enemyPos.x && t.y === enemyPos.y) ?? targets[0] ?? null);
  const before = structuredClone(e.state),
    cmd = { type: 'PLAY_CARD' as const, cardUid: uid!, target };
  const result = e.dispatch(cmd);
  if (!result.ok) throw Error(id + ': ' + result.error);
  return { before, after: e.state, events: result.events, scenario: e.scenario, cmd };
}
async function show(
  f: Pick<ReturnType<typeof cast>, 'before' | 'after' | 'events'>,
  reduced = false,
) {
  const fx = new ElementEffects(new Container(), new Container(), geometry, new Container());
  await fx.catalog.prepare(catalogEventRecipes(f.events, (id) => C.cards[id]));
  const number = vi.spyOn(fx, 'number'),
    hit = vi.spyOn(fx, 'unitReaction');
  let shown = f.before;
  const host: DirectorHost = {
    redraw: (s) => {
      shown = structuredClone(s);
    },
    unit: () => undefined,
    obstacle: () => undefined,
    walk: () => {},
    busy: () => {},
    impulse: () => {},
    handPulse: () => {},
    card: (id) => C.cards[id],
    turnBanner: () => {},
  };
  const d = new VfxDirector(fx, host);
  d.sync(f.before);
  d.enqueue(f.events, f.after, reduced);
  return { fx, d, number, hit, shown: () => shown };
}
describe('lote A — Mago', () => {
  it.each(
    Object.values(C.cards)
      .filter((c) => c.heroId === 'mage')
      .map((c) => [c.id]),
  )('%s has a recipe or a preserved pilot', (id) => {
    const card = C.cards[id]!;
    expect(existingPresentation(card) ?? cardRecipe(card, []).bank).toBeTruthy();
  });
  it.each([
    'arcane_burst',
    'barrier',
    'ice_wall',
    'glacial_field',
    'arcane_surge',
    'dispel',
    'flame_tile',
    'force_push',
    'arcane_pull',
    'elemental_detonation',
    'archmage_eruption',
  ])('%s: real command, ordered presentation, cleanup and deterministic replay', async (id) => {
    const f = cast(id),
      original = structuredClone(f.after),
      ui = await show(f);
    ui.d.tick(10000);
    ui.d.tick(10000);
    expect(ui.shown()).toEqual(f.after);
    expect(ui.d.busy).toBe(false);
    expect(f.after).toEqual(original);
    for (const bank of Object.values(ui.fx.catalog.snapshot)) expect(bank.active).toBe(0);
    const replay = GameEngine.fromSnapshot(f.before, C, f.scenario);
    expect(replay.dispatch(f.cmd)).toMatchObject({ ok: true, events: f.events });
    expect(replay.state).toEqual(f.after);
    ui.d.destroy();
  });
  it('preserves all five pilot entry points, even aliases resolve by actual card id', () => {
    for (const id of [
      'fireball',
      'magic_missile',
      'frost_nova',
      'bastion_blow',
      'summon_pact_golem',
    ])
      expect(existingPresentation(C.cards[id]!)).toBe('A');
    expect(existingPresentation(C.cards.arcane_burst_ii!)).toBeNull();
    expect(C.cards.arcane_surge!.heroId).toBe('mage');
    expect(C.cards.arcane_surge!.effects).toEqual([{ type: 'DRAW', count: 2 }]);
  });
  it('loads only the necessary atlas, retries fallback, and forbids public use', async () => {
    const fx = new CatalogEffects(new Container(), new Container(), geometry),
      r = familyRecipe('arcane');
    vi.mocked(loadSharedTexture).mockRejectedValueOnce(Error('offline'));
    await fx.prepare([r]);
    fx.beginBatch();
    expect(fx.handles(r)).toBe(false);
    await fx.prepare([r]);
    expect(fx.handles(r)).toBe(true);
    expect(loadSharedTexture).toHaveBeenLastCalledWith(
      '/art/vfx/mage-spells/mage-spells-v1-1024.webp',
    );
    fx.destroy();
    vi.stubGlobal('location', { hostname: 'rpg-go-tactics.com' });
    const off = new CatalogEffects(new Container(), new Container(), geometry);
    const n = vi.mocked(loadSharedTexture).mock.calls.length;
    await off.prepare([r]);
    off.beginBatch();
    expect(off.handles(r)).toBe(false);
    expect(loadSharedTexture).toHaveBeenCalledTimes(n);
    off.destroy();
  });
});

describe('lote B — Guerrero y contacto físico', () => {
  it.each(
    Object.values(C.cards)
      .filter((c) => c.heroId === 'warrior')
      .map((c) => [c.id]),
  )('%s retains an explicit family/pilot', (id) => {
    const card = C.cards[id]!;
    expect(existingPresentation(card) ?? cardRecipe(card, []).bank).toBeTruthy();
  });
  it.each([
    'heavy_strike',
    'shield_bash',
    'warrior_charge',
    'guard',
    'riposte',
    'second_wind',
    'brutal_shove',
    'sweep',
    'grapple',
    'steel_wall',
    'bastion',
    'ram',
    'vanguard_fury',
    'execution',
    'last_bastion',
    'judgement_hammer',
  ])('%s executes without changing HP/outcomes and clears', async (id) => {
    const f = cast(id, 'warrior'),
      ui = await show(f);
    ui.d.tick(10000);
    ui.d.tick(10000);
    expect(ui.shown()).toEqual(f.after);
    expect(ui.number.mock.calls.filter((c) => c[3] === 'damage')).toHaveLength(
      f.events.filter((e) => e.type === 'UNIT_DAMAGED' && e.hpLost > 0).length,
    );
    expect(Object.values(ui.fx.catalog.snapshot).every((b) => b.active === 0)).toBe(true);
    ui.d.destroy();
  });
  it('charge impact cannot precede the actual movement and damage event', async () => {
    const f = cast('warrior_charge', 'warrior'),
      recipe = catalogBatch(f.events, (id) => C.cards[id]).get(
        f.events.find((e) => e.type === 'CARD_PLAYED')!,
      )!;
    expect(recipe.contactOnDamage).toBe(true);
    const ui = await show(f),
      contact = vi.spyOn(ui.fx.catalog, 'contact');
    const plan = compileTimeline(f.events, (id) => C.cards[id]!.presentation.visualKey, false);
    const at = plan.cues.find((c) => c.event.type === 'UNIT_DAMAGED')!.at;
    ui.d.tick(at - 1);
    expect(contact).not.toHaveBeenCalled();
    ui.d.tick(1);
    expect(contact).toHaveBeenCalledTimes(
      f.events.filter((e) => e.type === 'UNIT_DAMAGED' && e.sourceId === f.before.player.heroId)
        .length,
    );
    ui.d.destroy();
  });
  it('blocked physical hits show shield numbers and never fake HP loss', async () => {
    const f = cast('heavy_strike', 'warrior'); // Re-resolve the same card against a real shield.
    const before = structuredClone(f.before);
    before.units.find((u) => u.faction === 'ENEMY')!.shield = 50;
    const engine = GameEngine.fromSnapshot(before, C, f.scenario),
      r = engine.dispatch(f.cmd);
    if (!r.ok) throw Error(r.error);
    const ui = await show({ ...f, before, events: r.events, after: engine.state });
    ui.d.tick(10000);
    expect(ui.number.mock.calls.some((c) => c[3] === 'damage')).toBe(false);
    expect(ui.number.mock.calls.some((c) => c[3] === 'shield')).toBe(true);
    ui.d.destroy();
  });
});

describe('lote C — Invocador, rituales y criaturas', () => {
  it.each(
    Object.values(C.cards)
      .filter((c) => c.heroId === 'summoner')
      .map((c) => [c.id]),
  )('%s maps to a shared recipe or existing ceremony', (id) => {
    const card = C.cards[id]!;
    expect(existingPresentation(card) ?? cardRecipe(card, []).bank).toBeTruthy();
  });
  it.each([
    'summon_chicken',
    'summon_fox',
    'summon_turtle',
    'summon_raven',
    'summon_wolf',
    'summon_war_drake',
    'summon_ash_hound',
    'nurture',
    'pack_hymn',
    'ancestral_pack',
    'recall_familiar',
    'vital_offering',
    'binder_command',
    'pact_relay',
    'double_moon_pact',
    'pack_oath',
  ])('%s: authoritative spawn/heal/order/recall and cleanup', async (id) => {
    const f = cast(id, 'summoner'),
      ui = await show(f);
    ui.d.tick(20000);
    ui.d.tick(20000);
    expect(ui.shown()).toEqual(f.after);
    expect(ui.d.busy).toBe(false);
    expect(Object.values(ui.fx.catalog.snapshot).every((b) => b.active === 0)).toBe(true);
    ui.d.destroy();
  });
  it.each(Object.keys(C.summons ?? {}))(
    '%s: one materialization only on confirmed spawn; no spawn during snapshot restore',
    async (id) => {
      const e = makeEngine({ hero: { heroId: 'summoner', pos: p(2, 2) } }, C),
        events: GameEvent[] = [];
      mutable(e).units.find((u) => u.id === e.heroId)!.summonCapacityBonus = 20;
      const before = structuredClone(e.state);
      const summoned = spawnSummon(
        ctxFor(e, events),
        mutable(e).units.find((u) => u.id === e.heroId)!,
        id,
        p(3, 2),
      );
      expect(summoned).toBeTruthy();
      const f = {
          before,
          after: e.state,
          events,
          scenario: e.scenario,
          cmd: { type: 'END_TURN' as const },
        },
        ui = await show(f),
        arrival = vi.spyOn(ui.fx.catalog, 'arrival');
      ui.d.tick(20000);
      ui.d.tick(20000);
      expect(arrival).toHaveBeenCalledOnce();
      expect(ui.shown().units.some((u) => u.id === summoned!.id)).toBe(true);
      ui.d.clear();
      ui.d.sync(e.state);
      ui.d.tick(20000);
      expect(arrival).toHaveBeenCalledOnce();
      ui.d.destroy();
    },
  );
  it('summon contact and HP are emitted at the same contact beat, never on attack start', async () => {
    const f = cast('binder_command', 'summoner'),
      ui = await show(f),
      contact = vi.spyOn(ui.fx.catalog, 'contact');
    const plan = compileTimeline(f.events, (id) => C.cards[id]!.presentation.visualKey, false);
    const attack = plan.cues.find(
      (c) => c.event.type === 'SUMMON_ATTACKED' && c.kind === 'attackImpact',
    );
    expect(attack).toBeTruthy();
    ui.d.tick(attack!.at - 1);
    expect(contact).not.toHaveBeenCalled();
    ui.d.tick(1);
    expect(contact).toHaveBeenCalledOnce();
    expect(ui.number.mock.calls.some((c) => c[3] === 'damage')).toBe(true);
    ui.d.destroy();
  });
  it('recall has no invented HP loss and is distinguishable from lethal damage', () => {
    const f = cast('recall_familiar', 'summoner'),
      map = catalogBatch(f.events, (id) => C.cards[id]);
    const defeated = f.events.find((e) => e.type === 'UNIT_DEFEATED')!;
    expect(map.get(defeated)?.recall).toBe(true);
    expect(f.events.some((e) => e.type === 'UNIT_DAMAGED')).toBe(false);
  });
});

describe('lote D — Cambiaformas y formas registradas', () => {
  it.each(
    Object.values(C.cards)
      .filter((c) => c.heroId === 'shapeshifter')
      .map((c) => [c.id]),
  )('%s maps all authored form variants without a fixed beast list', (id) => {
    expect(cardRecipe(C.cards[id]!, []).bank).toBeTruthy();
    expect(allCardEffects(C.cards[id]!).length).toBeGreaterThan(0);
  });
  it.each([
    'qa_bear_form',
    'qa_minotaur_form',
    'qa_wild_strike',
    'qa_bear_claw',
    'qa_protective_roar',
    'qa_brutal_charge',
    'qa_axe_sweep',
    'qa_mend_spirit',
    'qa_bear_recovery',
    'qa_legacy_guardian_circle',
    'minotaur_awakening',
    'form_dance',
    'ancestral_stampede',
  ])('%s: actual events, no changed combat and no orphan effects', async (id) => {
    const f = cast(id, 'shapeshifter'),
      ui = await show(f);
    ui.d.tick(30000);
    ui.d.tick(30000);
    expect(ui.shown()).toEqual(f.after);
    expect(Object.values(ui.fx.catalog.snapshot).every((b) => b.active === 0)).toBe(true);
    const replay = GameEngine.fromSnapshot(f.before, C, f.scenario);
    expect(replay.dispatch(f.cmd)).toMatchObject({ ok: true, events: f.events });
    expect(replay.state).toEqual(f.after);
    ui.d.destroy();
  });
  it('projects the two real Stampede form changes in order, rather than borrowing its final Bear too early', () => {
    const f = cast('ancestral_stampede', 'shapeshifter');
    const forms = f.events.filter(
      (e): e is Extract<GameEvent, { type: 'FORM_CHANGED' }> => e.type === 'FORM_CHANGED',
    );
    expect(forms.map((e) => e.to)).toEqual(['minotaur', 'bear']);
    const first = projectEvent(f.before, forms[0]!, f.after);
    expect(first.units.find((u) => u.id === f.before.player.heroId)!.activeForm).toBe('minotaur');
    const last = projectEvent(first, forms[1]!, f.after);
    expect(last.units.find((u) => u.id === f.before.player.heroId)!.activeForm).toBe('bear');
    expect(f.before.units.find((u) => u.id === f.before.player.heroId)!.activeForm).toBeUndefined();
  });
  it('a future registered Beast uses the exact same universal card and event-driven recipe', () => {
    const card = Object.values(C.cards).find(
      (c) =>
        c.heroId === 'shapeshifter' &&
        c.formEffects &&
        c.targeting.type === 'SELF' &&
        !c.requiredForms,
    )!;
    const third = {
      ...C,
      transformations: {
        ...C.transformations,
        qa_future: {
          id: 'qa_future',
          name: 'Fixture only',
          nature: 'BEAST' as const,
          armorBonus: 0,
        },
      },
      heroes: {
        ...C.heroes,
        shapeshifter: {
          ...C.heroes.shapeshifter!,
          transformationForms: [...C.heroes.shapeshifter!.transformationForms!, 'qa_future'],
        },
      },
    };
    const e = makeEngine({ hero: { heroId: 'shapeshifter', pos: p(2, 2) } }, third);
    mutable(e).units.find((u) => u.id === e.heroId)!.activeForm = 'qa_future';
    mutable(e).player.energy = 20;
    const [uid] = setHand(e, [card.id]);
    const r = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recipe = cardRecipe(card, r.events, e.heroId);
    expect(recipe.bank).toBeTruthy();
    expect(card).toBe(C.cards[card.id]);
  });
  it('selects a healing outcome from the events even when a universal card also authors Beast damage', () => {
    const mixed = {
      ...C.cards.qa_legacy_lineage_pulse!,
      formEffects: {
        HUMAN: [{ type: 'HEAL' as const, amount: 2, to: 'CASTER' as const }],
        BEAST: [
          {
            type: 'DAMAGE' as const,
            amount: 2,
            damageType: 'PHYSICAL' as const,
            to: 'ENEMIES' as const,
          },
        ],
      },
    };
    expect(
      cardRecipe(
        mixed,
        [{ type: 'UNIT_HEALED', unitId: 'hero', sourceId: 'hero', amount: 2, hpAfter: 10 }],
        'hero',
      ).family,
    ).toBe('heal');
  });
});

describe('lote E — Arquero, enemigos y límites compartidos', () => {
  it.each(
    Object.values(C.cards)
      .filter((c) => c.heroId === 'archer')
      .map((c) => [c.id]),
  )('%s has a real arrow or catalog recipe', (id) => {
    const card = C.cards[id]!;
    expect(
      existingPresentation(card) || usesPhysicalArrow(card) || cardRecipe(card, []).bank,
    ).toBeTruthy();
  });
  it.each(['arrow_rain', 'tracking_arrow', 'deflecting_arrow', 'stalker_heart'])(
    '%s resolves and restores without altering results',
    async (id) => {
      const f = cast(id, 'archer'),
        ui = await show(f);
      ui.d.tick(30000);
      ui.d.tick(30000);
      expect(ui.shown()).toEqual(f.after);
      expect(Object.values(ui.fx.catalog.snapshot).every((b) => b.active === 0)).toBe(true);
      ui.d.destroy();
    },
  );
  it('volley keeps area targeting and does not invent a projectile event', () => {
    const f = cast('arrow_rain', 'archer');
    expect(f.events.some((e) => e.type === 'PROJECTILE_LAUNCHED')).toBe(false);
    expect(cardRecipe(C.cards.arrow_rain!, f.events, f.before.player.heroId)).toMatchObject({
      shape: 'area',
      bank: 'wild-spirit',
      style: 'volley',
    });
  });
  it.each(Object.keys(C.enemies))(
    '%s uses confirmed attack types, and real turn events restore exactly',
    async (enemyId) => {
      const e = makeEngine(
          {
            hero: { heroId: 'warrior', pos: p(2, 2) },
            enemies: [{ id: 'enemy', enemyId, pos: p(3, 2) }],
          },
          C,
          42,
        ),
        before = structuredClone(e.state),
        result = e.dispatch({ type: 'END_TURN' });
      if (!result.ok) throw Error(result.error);
      for (const ev of result.events)
        if (ev.type === 'ENEMY_ATTACKED')
          expect(confirmedAttackFamily(result.events, ev)).toBe(
            familyRecipe(
              ev.damageType === 'PHYSICAL'
                ? 'physical'
                : ev.damageType === 'FIRE'
                  ? 'fire'
                  : ev.damageType === 'ICE'
                    ? 'ice'
                    : ev.damageType === 'ARCANE'
                      ? 'arcane'
                      : 'force',
            ).family,
          );
      const ui = await show({ before, after: e.state, events: result.events });
      ui.d.tick(60000);
      ui.d.tick(60000);
      expect(ui.shown()).toEqual(e.state);
      ui.d.destroy();
    },
  );
  it.each([false, true])(
    'repeated casts and cancellation release all sprites (reduced=%s)',
    async (reduced) => {
      const f = cast('arcane_burst'),
        ui = await show(f, reduced);
      for (let i = 0; i < 30; i++) {
        ui.d.tick(30000);
        ui.d.tick(30000);
        ui.d.clear();
        ui.d.sync(f.before);
        ui.d.enqueue(f.events, f.after, reduced);
      }
      ui.d.clear();
      expect(Object.values(ui.fx.catalog.snapshot).every((b) => b.active === 0)).toBe(true);
      ui.d.destroy();
    },
  );
  it('missing confirmed damage never invents an elemental summon reaction', () => {
    const attack: GameEvent = {
      type: 'SUMMON_ATTACKED',
      unitId: 'pet',
      targetId: 'enemy',
      from: p(2, 2),
      to: p(3, 2),
      ranged: false,
    };
    expect(confirmedAttackFamily([attack], attack)).toBe('tactic');
  });
});

describe('creature attacks — real turn resolution', () => {
  it.each(Object.keys(C.summons ?? {}))(
    '%s keeps attack/HP events and cleans after the real turn',
    async (id) => {
      const e = makeEngine(
        {
          hero: { heroId: 'summoner', pos: p(1, 2) },
          enemies: [{ id: 'enemy', enemyId: 'orc_warrior', pos: p(4, 2) }],
        },
        C,
        42,
      );
      const hero = mutable(e).units.find((u) => u.id === e.heroId)!;
      hero.summonCapacityBonus = 20;
      const pet = spawnSummon(ctxFor(e), hero, id, p(3, 2))!;
      pet.summon!.readyRound = e.state.round;
      const before = structuredClone(e.state),
        r = e.dispatch({ type: 'END_TURN' });
      if (!r.ok) throw Error(r.error);
      const ui = await show({ before, events: r.events, after: e.state });
      ui.d.tick(60000);
      ui.d.tick(60000);
      expect(ui.shown()).toEqual(e.state);
      expect(Object.values(ui.fx.catalog.snapshot).every((b) => b.active === 0)).toBe(true);
      ui.d.destroy();
    },
  );
  it('mobile chooses the 512 atlas and keeps a bounded pool', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const fx = new CatalogEffects(new Container(), new Container(), geometry),
      r = familyRecipe('transform');
    await fx.prepare([r]);
    fx.beginBatch();
    expect(loadSharedTexture).toHaveBeenLastCalledWith(
      '/art/vfx/wild-spirit/wild-spirit-v1-512.webp',
    );
    for (let i = 0; i < 80; i++) fx.arrival(p(2, 2), true);
    expect(fx.snapshot['wild-spirit']!.active).toBeLessThanOrEqual(24);
    fx.clear();
    expect(fx.snapshot['wild-spirit']!.active).toBe(0);
    fx.destroy();
  });
});
