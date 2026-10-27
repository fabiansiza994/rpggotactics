import { SHAPESHIFTER_CARD_ART } from '../src/presentation/assets/shapeshifterCards';
import { writeFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONTENT,
  GameEngine,
  createProfile,
  validateDeck,
  DECK_RULES,
  ownedFor,
  withHeroDeck,
  serializeProfile,
  parseProfileSave,
  type GameState,
} from '../src/game';
import {
  shapeshifterCatalog,
  SHAPESHIFTER_CATALOG_DECKS,
  shapeshifterCardGroup,
} from '../src/game/data/shapeshifter-catalog';
import { SHAPESHIFTER_QA_SCENARIO as SC } from '../src/game/data/shapeshifter-qa';
import {
  createShapeshifterBattle,
  replayShapeshifterBattle,
} from '../src/game/qa/shapeshifter-battle';
import { SHAPESHIFTER_QA_CARDS } from '../src/game/data/shapeshifter-qa';
const content = shapeshifterCatalog(DEFAULT_CONTENT),
  cards = Object.values(content.cards).filter((c) => c.heroId === 'shapeshifter' && !c.tags.includes('primordial-legacy'));
const labels = {
  universal: 'Neutrales de forma (exclusivas de clase)',
  bear: 'Oso',
  minotaur: 'Minotauro',
  transformation: 'Transformación y sinergia',
};
let catalog =
  '# Cambiaformas — catálogo inicial de 30 cartas (solo QA)\n\nBalance candidato, no aprobado para producción. Sin Furia ni formas adicionales. Se conservan los diez IDs QA existentes. Las ocho neutrales son neutrales **de forma**, no propiedad compartida con otros campeones. Todas COMMON, máximo 3 copias según las reglas reales.\n\n';
for (const group of ['universal', 'bear', 'minotaur', 'transformation'] as const) {
  catalog += `## ${labels[group]}\n\n| Carta / ID | Energía | Efecto | Arte |\n|---|---:|---|---|\n`;
  for (const c of cards.filter((c) => shapeshifterCardGroup(c) === group))
    catalog += `| ${c.name} (${c.id}) | ${c.cost} | ${c.rulesText} | ${!SHAPESHIFTER_CARD_ART[c.id] ? 'PENDIENTE' : 'Propio · WebP'} |\n`;
  catalog += '\n';
}
catalog += '## Mazo inicial propuesto\n\n';
for (const c of SHAPESHIFTER_CATALOG_DECKS.hybrid)
  catalog += `- ${c.count} × ${content.cards[c.cardId]!.name}\n`;
catalog +=
  '\n30 cartas; seis transformaciones, 3/3. Los presets Oso y Minotauro también conservan ambas transformaciones; cambian las cartas de apoyo, no la identidad del campeón.\n';
writeFileSync('qa/shapeshifter-3/CATALOG.md', catalog);

describe('Shapeshifter initial private 30-card catalog', () => {
  it('has exact partitions, reuses ten IDs and preserves every public definition', () => {
    expect(cards).toHaveLength(30);
    expect(new Set(cards.map((c) => c.id)).size).toBe(30);
    for (const [group, count] of Object.entries({
      universal: 8,
      bear: 9,
      minotaur: 9,
      transformation: 4,
    }))
      expect(cards.filter((c) => shapeshifterCardGroup(c) === group)).toHaveLength(count);
    for (const c of SHAPESHIFTER_QA_CARDS) expect(content.cards[c.id]).toBeDefined();
    for (const id of Object.keys(DEFAULT_CONTENT.cards))
      expect(content.cards[id]).toEqual(DEFAULT_CONTENT.cards[id]);
    for (const id of Object.keys(DEFAULT_CONTENT.heroes))
      expect(content.heroes[id]).toEqual(DEFAULT_CONTENT.heroes[id]);
    expect(DEFAULT_CONTENT.heroes.shapeshifter).toBeUndefined();
    expect(cards.filter((c) => !SHAPESHIFTER_CARD_ART[c.id])).toHaveLength(0);
  });
  it.each(Object.entries(SHAPESHIFTER_CATALOG_DECKS))(
    '%s is a legal 30-card deck with six transformations and real copy limits',
    (_, deck) => {
      const p = createProfile(content);
      expect(deck.reduce((n, c) => n + c.count, 0)).toBe(30);
      expect(deck.filter((c) => c.cardId.endsWith('_form')).reduce((n, c) => n + c.count, 0)).toBe(
        6,
      );
      expect(
        validateDeck(
          deck,
          'shapeshifter',
          ownedFor(p, 'shapeshifter', content),
          content,
          DECK_RULES,
        ),
      ).toEqual([]);
      expect(deck.every((c) => c.count <= 3)).toBe(true);
    },
  );
  it.each(cards)(
    '$name resolves through existing engine primitives with its required form',
    (card) => {
      const base = new GameEngine(SC, content, 7),
        s = structuredClone(base.state) as GameState,
        h = s.units.find((u) => u.id === s.player.heroId)!;
      h.pos = { x: 2, y: 2 };
      h.hp = 12;
      h.shield = 0;
      h.activeForm = card.requiredForms?.[0] ?? undefined;
      h.armor = h.activeForm === 'bear' ? 2 : h.activeForm === 'minotaur' ? 1 : 0;
      const enemy = s.units.find((u) => u.faction === 'ENEMY')!;
      enemy.pos = card.targeting.type === 'CHARGE' ? { x: 4, y: 2 } : { x: 3, y: 2 };
      s.player.energy = 4;
      s.player.movePoints = 0;
      s.player.hand = [{ uid: 'catalog-test', cardId: card.id }];
      const e = GameEngine.fromSnapshot(s, content, SC);
      const target = card.targeting.type === 'SELF' ? null : e.getValidTargets('catalog-test')[0];
      expect(target === null || target !== undefined).toBe(true);
      const result = e.dispatch({
        type: 'PLAY_CARD',
        cardUid: 'catalog-test',
        target: target ?? null,
      });
      expect(result.ok).toBe(true);
      expect(e.state.player.energy).toBe(4 - card.cost);
      if (card.effects.some((f) => f.type === 'DAMAGE'))
        expect(result.events.some((e) => e.type === 'UNIT_DAMAGED')).toBe(true);
      if (card.effects.some((f) => f.type === 'APPLY_STATUS'))
        expect(result.events.some((e) => e.type === 'STATUS_APPLIED')).toBe(true);
      if (card.effects.some((f) => f.type === 'DRAW')) expect(e.state.player.hand).toHaveLength(1);
      if (card.effects.some((f) => f.type === 'HEAL'))
        expect(e.state.units.find((u) => u.id === h.id)!.hp).toBeGreaterThan(12);
      if (card.effects.some((f) => f.type === 'SHIELD'))
        expect(e.state.units.find((u) => u.id === h.id)!.shield).toBeGreaterThan(0);
      if (card.effects.some((f) => f.type === 'GAIN_MOVE_POINTS'))
        expect(e.state.player.movePoints).toBeGreaterThan(0);
    },
  );
  it('gates every form-specific card before spending energy or discarding', () => {
    for (const card of cards.filter((c) => c.requiredForms)) {
      const base = new GameEngine(SC, content, 1),
        s = structuredClone(base.state) as GameState;
      s.player.hand = [{ uid: 'gated', cardId: card.id }];
      const e = GameEngine.fromSnapshot(s, content, SC),
        before = structuredClone(e.state);
      expect(e.getCardPlayability('gated')).toMatchObject({
        playable: false,
        reason: 'FORM_REQUIRED',
      });
      expect(e.dispatch({ type: 'PLAY_CARD', cardUid: 'gated', target: null }).ok).toBe(false);
      expect(e.state).toEqual(before);
    }
  });
  it.each(Object.entries(SHAPESHIFTER_CATALOG_DECKS))(
    '%s opening and headless replay match across fixed seeds',
    (_, deck) => {
      const configured = withHeroDeck(content, 'shapeshifter', deck);
      for (const seed of [1, 101, 1009])
        for (const policy of ['normal', 'guaranteed'] as const) {
          const e = createShapeshifterBattle(SC, configured, seed, policy);
          expect(e.state.player.hand).toHaveLength(5);
          expect(e.seed).toBe(seed);
          const form = e.state.player.hand.find((c) =>
            configured.cards[c.cardId]!.effects.some((f) => f.type === 'TRANSFORM'),
          );
          if (policy === 'guaranteed') expect(form).toBeDefined();
          if (form)
            expect(e.dispatch({ type: 'PLAY_CARD', cardUid: form.uid, target: null }).ok).toBe(
              true,
            );
          const replay = replayShapeshifterBattle(
            SC,
            configured,
            seed,
            policy,
            JSON.parse(JSON.stringify(e.history)),
          );
          expect(replay.rejectedAt).toBeNull();
          expect(replay.state).toEqual(e.state);
          expect(createShapeshifterBattle(SC, configured, seed, policy).state.rngState).toBe(
            new GameEngine(SC, configured, seed).state.rngState,
          );
        }
    },
  );
  it('persists catalog ownership without changing public profiles or allowing invalid replay commands', () => {
    const p = createProfile(content),
      loaded = parseProfileSave(serializeProfile(p), content);
    expect(loaded.status).toBe('OK');
    if (loaded.status === 'OK') expect(loaded.profile).toEqual(p);
    expect(
      replayShapeshifterBattle(SC, content, 1, 'guaranteed', [
        { type: 'PLAY_CARD', cardUid: 'fake', target: null },
      ]).rejectedAt,
    ).toBe(0);
    const deck = [{ cardId: 'qa_wild_strike', count: 4 }];
    expect(
      validateDeck(deck, 'shapeshifter', () => 99, content, DECK_RULES).some(
        (i) => i.code === 'COPY_LIMIT',
      ),
    ).toBe(true);
  });
});
