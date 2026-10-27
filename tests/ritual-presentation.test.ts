import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { AltarPanel } from '../src/presentation/react/components/Hud';
import { CardView } from '../src/presentation/react/components/CardView';
import { CHARACTER_ANIMATIONS, clipOffset } from '../src/presentation/pixi/characterAnimations';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { createDuel, applyDuel } from '../src/game/pvp/duel';
import { GameEngine } from '../src/game';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { DEFAULT_CONTENT, withPrototypeRituals, type GameEvent } from '../src/game';
import { makeEngine, mutable, p } from './helpers';

const make = () =>
  makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } }, withPrototypeRituals(DEFAULT_CONTENT));
describe('ritual presentation without changing rules', () => {
  it.each([0, 1, 2, 3, 4])('renders four sockets at %i sealed pieces', (count) => {
    const e = make();
    mutable(e).player.altar = ['rune_stone', 'rune_shell', 'mark_moon', 'mark_fang']
      .slice(0, count)
      .map((cardId, i) => ({ uid: `a${i}`, cardId }));
    const html = renderToStaticMarkup(
      createElement(AltarPanel, { state: e.state, engine: e, busy: false }),
    );
    expect((html.match(/<li /g) || []).length).toBe(4);
    expect(html).toContain(`${count}/4`);
    if (count >= 2) expect(html).toContain('RITUAL LISTO');
  });
  it('supports future 4/4 readiness without final legendary assets', () => {
    const e = make();
    mutable(e).player.altar = ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'].map(
      (cardId, i) => ({ uid: `l${i}`, cardId }),
    );
    const html = renderToStaticMarkup(
      createElement(AltarPanel, { state: e.state, engine: e, busy: false }),
    );
    expect(html).toContain('4 / 4 piezas');
    expect(html).toContain('RITUAL LISTO');
    expect(html).not.toContain('ritual_primordial_dragon.svg');
  });
  it('renders opponent count without leaking any identity', () => {
    const e = make();
    mutable(e).player.altar = [];
    mutable(e).player.hand = [];
    mutable(e).pileCounts = { opponentAltar: 3 } as NonNullable<typeof e.state.pileCounts>;
    const html = renderToStaticMarkup(
      createElement(AltarPanel, { state: e.state, engine: e, busy: false }),
    );
    expect(html).toContain('Rival: 3 selladas');
    for (const id of ['rune_stone', 'rune_shell', 'mark_moon', 'mark_fang', 'mark_blood'])
      expect(html).not.toContain(id);
    expect(html).not.toContain('Runa de Piedra');
  });
  it('distinguishes ordinary ritual-piece card selection', () => {
    const html = renderToStaticMarkup(
      createElement(CardView, {
        def: DEFAULT_CONTENT.cards.rune_stone!,
        hotkey: 1,
        selected: true,
        playable: true,
        onClick() {},
      }),
    );
    expect(html).toContain('data-ritual-piece="true"');
    expect(html).toContain('data-state="selected"');
    expect(html).toContain('ritual-glyph');
  });
  it('holds single-pose attacks/hurt for their authored duration', () => {
    const a = new CharacterAnimator(
      {
        idle: { count: 1, frameMs: 1000, loop: true },
        attack: { count: 1, frameMs: 220, loop: false },
        hit: { count: 1, frameMs: 120, loop: false },
      },
      () => {},
      () => {},
    );
    a.play('attack');
    a.tick(100, false);
    expect(a.state).toBe('attack');
    a.tick(121, false);
    expect(a.state).toBe('idle');
    a.play('hit');
    a.tick(80, false);
    expect(a.state).toBe('hit');
    a.tick(41, false);
    expect(a.state).toBe('idle');
  });
  it('separates activation, manifestation and completion without altering event payloads', () => {
    const events: GameEvent[] = [
      {
        type: 'RITUAL_ACTIVATED',
        ritualId: 'ancestral_shell',
        tier: 'MINOR',
        casterId: 'hero',
        pieces: [],
        target: p(1, 2),
        impact: p(1, 2),
        affectedTiles: [p(1, 2)],
      },
      { type: 'UNIT_SPAWNED', unitId: 'turtle', faction: 'PLAYER', kind: 'SUMMON', pos: p(1, 2) },
      { type: 'RITUAL_RESOLVED', ritualId: 'ancestral_shell', casterId: 'hero' },
    ];
    const snapshot = JSON.stringify(events),
      normal = compileTimeline(events, (id) => id, false),
      reduced = compileTimeline(events, (id) => id, true);
    expect(normal.cues[1]!.at).toBeGreaterThan(normal.cues[0]!.at);
    expect(normal.duration).toBeGreaterThanOrEqual(950);
    expect(reduced.duration).toBeLessThan(normal.duration);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
  it('resolves final ritual illustrations including the approved Primordial seals', () => {
    for (const id of [
      'rune_stone',
      'rune_shell',
      'mark_moon',
      'mark_fang',
      'mark_blood',
      'summon_war_drake',
    ])
      expect(existsSync(`public${FINAL_CARD_ART[id]}`)).toBe(true);
    expect(existsSync(`public${FINAL_CARD_ART.seal_claw}`)).toBe(true);
  });
  it.each(['ancient_turtle', 'war_drake'])(
    '%s remains healable, enemy-targetable, occupies one cell and dies normally',
    (id) => {
      let s = createDuel(
        [
          { heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck },
          { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck },
        ],
        3,
      );
      if (s.duel!.active !== 0) s = applyDuel(s, { type: 'END_TURN' }).state;
      s.units.find((u) => u.id === 'champion-a')!.pos = p(3, 3);
      s.units.find((u) => u.id === 'champion-b')!.pos = p(5, 3);
      s.player.energy = 4;
      if (id === 'ancient_turtle')
        s.player.altar = ['rune_stone', 'rune_shell'].map((cardId, i) => ({
          uid: `r${i}`,
          cardId,
        }));
      else s.player.hand = [{ uid: 'drake', cardId: 'summon_war_drake' }];
      s = applyDuel(
        s,
        id === 'ancient_turtle'
          ? { type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(4, 3) }
          : { type: 'PLAY_CARD', cardUid: 'drake', target: p(4, 3) },
      ).state;
      const u = s.units.find((u) => u.defId === id)!;
      const uid = u.id;
      u.hp -= 3;
      s.player.energy = 4;
      s.player.hand = [
        { uid: 'heal', cardId: 'nurture' },
        { uid: 'chicken', cardId: 'summon_chicken' },
      ];
      const own = GameEngine.fromSnapshot(s, DEFAULT_CONTENT, make().scenario);
      expect(own.getValidTargets('heal')).toContainEqual(p(4, 3));
      expect(own.getValidTargets('chicken')).not.toContainEqual(p(4, 3));
      const hp = u.hp;
      s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'heal', target: p(4, 3) }).state;
      expect(s.units.find((u) => u.id === uid)!.hp).toBeGreaterThan(hp);
      s = applyDuel(s, { type: 'END_TURN' }).state;
      s.player.hand = [{ uid: 'hit', cardId: 'magic_missile' }];
      s.player.energy = 4;
      const target = s.units.find((u) => u.id === uid)!;
      target.hp = 1;
      target.shield = 0;
      const rival = GameEngine.fromSnapshot(s, DEFAULT_CONTENT, make().scenario);
      expect(rival.getValidTargets('hit')).toContainEqual(target.pos);
      s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'hit', target: target.pos }).state;
      expect(s.units.some((u) => u.id === uid)).toBe(false);
    },
  );
  it.each(['ancient_turtle', 'war_drake', 'ancient_wolf'])(
    '%s has all four authored directions and action fallbacks',
    (id) => {
      const layout = CHARACTER_ANIMATIONS[id]!;
      expect(Object.keys(layout.directionalUrls!)).toEqual(['front', 'back', 'left', 'right']);
      for (const url of Object.values(layout.directionalUrls!))
        expect(existsSync(`public${url}`)).toBe(true);
      for (const motion of ['idle', 'walk', 'attack', 'hit', 'death', 'arrival'] as const)
        expect(clipOffset(layout, motion, 0)).not.toBeNull();
      expect(clipOffset(layout, 'bash', 0)).toBeNull();
      expect(clipOffset(layout, 'walk', 10)).toBeNull();
    },
  );
});

describe('premium card and altar presentation contracts', () => {
  it('shows actual seal count and authoritative energy blocking', () => {
    const e = make();
    mutable(e).player.altar = ['rune_stone', 'rune_shell'].map((cardId, i) => ({
      uid: `qa-${i}`,
      cardId,
    }));
    mutable(e).player.energy = 0;
    mutable(e).player.altarSeals = 2;
    const html = renderToStaticMarkup(
      createElement(AltarPanel, { state: e.state, engine: e, busy: false }),
    );
    expect(html).toContain('Sellos este turno: 2');
    expect(html).toContain('Bloqueado:');
    expect(html).toContain('data-ready="false"');
    expect(html).not.toContain('Listo para activar');
  });
  it('marks the real rare drake as premium without fabricating rarity', () => {
    const card = DEFAULT_CONTENT.cards.summon_war_drake!;
    const html = renderToStaticMarkup(
      createElement(CardView, {
        def: card,
        hotkey: 1,
        selected: true,
        playable: true,
        onClick() {},
      }),
    );
    expect(html).toContain('data-premium="true"');
    expect(html).toContain('data-rarity="RARE"');
    expect(html).toContain('data-target-mode="true"');
    expect(html).toContain('◆ RARA');
  });
  it('normal ancestral support never receives a ritual-piece badge', () => {
    const card = Object.values(DEFAULT_CONTENT.cards).find((c) => c.name === 'Manada Ancestral')!;
    expect(card).toBeDefined();
    const html = renderToStaticMarkup(
      createElement(CardView, {
        def: card,
        hotkey: 1,
        selected: false,
        playable: true,
        onClick() {},
      }),
    );
    expect(html).not.toContain('data-ritual-piece');
  });
});
