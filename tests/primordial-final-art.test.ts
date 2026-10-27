import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { Container } from 'pixi.js';
import { CHARACTER_PAINTINGS, FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { unitVisualId, unitVisualTint } from '../src/presentation/assets/visualIdentity';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';
import { summonPose } from '../src/presentation/pixi/summonMotion';
import { ElementEffects } from '../src/presentation/vfx/ElementEffects';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import {
  createProfile,
  grantCard,
  DEFAULT_CONTENT,
  GameEngine,
  withHeroDeck,
  DECK_RULES,
  validateDeck,
  ownedFor,
  type GameEvent,
} from '../src/game';
import { skirmishRewardContext } from '../src/game/run/skirmish';

describe('final Primordial presentation', () => {
  it('keeps all four seals Rare/showcase with one dragon identity', () => {
    for (const id of ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart']) {
      const card = DEFAULT_CONTENT.cards[id]!;
      expect(card.rarity).toBe('RARE');
      expect(premiumIdentity(card)).toMatchObject({ treatment: 'showcase', motif: 'dragon' });
    }
  });
  it('anticipates the bite, then lunges and returns without residual offsets', () => {
    expect(summonPose('primordial_dragon', 'attack', .2, 0, false, false)!.x).toBeLessThan(0);
    expect(summonPose('primordial_dragon', 'attack', .6, 0, false, false)!.x).toBeGreaterThan(0);
    expect(summonPose('primordial_dragon', 'attack', 1, 0, false, false)!.x).toBeCloseTo(0);
  });
  it('uses original own art for the creature and four distinct seals', () => {
    expect(unitVisualId('primordial_dragon')).toBe('primordial_dragon');
    expect(unitVisualTint('primordial_dragon')).toBe(0xffffff);
    const paths = [
      CHARACTER_PAINTINGS.primordial_dragon,
      ...['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'].map((id) => FINAL_CARD_ART[id]),
    ];
    expect(new Set(paths).size).toBe(5);
    for (const p of paths) {
      expect(p).toMatch(/^\/art\/primordial\//);
      expect(existsSync('public' + p)).toBe(true);
    }
  });
  it('supports arrival, idle, movement, attack, hit and death with the shared pose system', () => {
    for (const motion of ['arrival', 'idle', 'walk', 'attack', 'hit', 'death'] as const)
      expect(
        summonPose('primordial_dragon', motion, 0.5, 1000, motion === 'walk', false),
      ).not.toBeNull();
    expect(summonPose('primordial_dragon', 'death', 1, 1000, false, false)?.alpha).toBe(0);
    expect(summonPose('primordial_dragon', 'attack', 0.5, 1000, false, true)?.rotation).toBe(0);
  });
  it('schedules breath windup before damage with a short bounded presentation', () => {
    const breath: GameEvent = {
      type: 'SUMMON_BREATH',
      unitId: 'dragon',
      name: 'Aliento Primordial',
      from: { x: 1, y: 2 },
      direction: { x: 1, y: 0 },
      tiles: [{ x: 2, y: 2 }],
      targetIds: ['orc'],
    };
    const hit: GameEvent = {
      type: 'UNIT_DAMAGED',
      unitId: 'orc',
      damageType: 'ARCANE',
      sourceId: 'dragon',
      pos: { x: 2, y: 2 },
      rawAmount: 4,
      armorMitigated: 0,
      shieldAbsorbed: 0,
      hpLost: 4,
      hpAfter: 4,
    };
    for (const reduced of [false, true]) {
      const t = compileTimeline([breath, hit], () => '', reduced);
      expect(t.cues[0]!.event).toEqual(breath);
      expect(t.cues[1]!.at).toBeGreaterThan(t.cues[0]!.at);
      expect(t.duration).toBeLessThanOrEqual(500);
    }
  });
  it('draws the authoritative footprint, reuses graphics and respects reduced motion', () => {
    for (const reduced of [false, true]) {
      const layer = new Container(),
        ground = new Container(),
        fx = new ElementEffects(
          layer,
          new Container(),
          (p) => ({ x: p.x * 96, y: p.y * 96 }),
          ground,
        );
      fx.reduced = reduced;
      fx.primordialBreath({ x: 1, y: 2 }, [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]);
      expect(layer.children.some((c) => c.label === 'primordial-breath')).toBe(true);
      expect(ground.children.some((c) => c.label === 'primordial-breath-tiles')).toBe(true);
      fx.tick(600);
      expect(layer.children.some((c) => c.label === 'primordial-breath')).toBe(false);
    }
  });
});

// Controlled guest fixture: find an opening hand, not a balance simulation or a battle run.
it('prepares a legal owned 30-card QA deck and reproducible four-seal opening', () => {
  const seals = ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'];
  let profile = createProfile(DEFAULT_CONTENT);
  for (const cardId of seals)
    for (let copy = 0; copy < 2; copy++) {
      const r = grantCard(profile, 'summoner', cardId, DEFAULT_CONTENT);
      if (!r.ok) throw Error('QA seal grant');
      profile = r.profile;
    }
  const deck = DEFAULT_CONTENT.heroes.summoner!.deck.map((e) => ({ ...e }));
  let remove = 8;
  for (const e of [...deck].reverse())
    while (remove > 0 && e.count > 1) {
      e.count--;
      remove--;
    }
  deck.push(...seals.map((cardId) => ({ cardId, count: 2 })));
  expect(
    validateDeck(
      deck,
      'summoner',
      ownedFor(profile, 'summoner', DEFAULT_CONTENT),
      DEFAULT_CONTENT,
      DECK_RULES,
    ),
  ).toEqual([]);
  profile.heroes.summoner!.decks[0]!.cards = deck;
  profile.selectedChampionId = 'summoner';
  const scenario = skirmishRewardContext('first_blood', 'summoner').encounters[0]!;
  const content = withHeroDeck(DEFAULT_CONTENT, 'summoner', deck);
  let seed = 1;
  for (; seed <= 2048; seed++) {
    const initial = new GameEngine(scenario, content, seed).state.player.hand;
    if (seals.every((id) => initial.some((c) => c.cardId === id))) break;
  }
  expect(seed).toBeLessThanOrEqual(2048);
  writeFileSync(
    'qa/primordial-final/guest-fixture.json',
    JSON.stringify({ seed, profile }, null, 2),
  );
});
