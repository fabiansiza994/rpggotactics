import { describe, expect, it } from 'vitest';
import {
  ARSENAL_EXPANSION,
  COSMETICS,
  DECK_RULES,
  DEFAULT_CONTENT,
  SHOWCASE_STORE_CARDS,
  SHOWCASE_STORE_EXPANSION,
  STORE_CATALOG,
  TACTICAL_EXPANSION,
  contentValue,
  validOffers,
  validateCatalog,
  type StoreContext,
} from '../src/game';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { releasedContent } from '../server/src/ritualRelease';
import { featuredCardOf, isPremiumOffer } from '../src/presentation/shop/StoreHeroShot';
import { ALL_RELEASED, droppableThroughPlay } from './support/drops';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';

const ctx: StoreContext = { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS };
const withSets = (...sets: string[]): StoreContext => ({ ...ctx, content: { ...DEFAULT_CONTENT, releasedExpansions: sets } });
const PREMIUM_PACKS = STORE_CATALOG.filter((o) => o.type === 'CHAMPION_PACK' && o.tags.includes('premium'));

describe('«Vitrina I» Showcase Rares', () => {
  it('one RARE Showcase card per champion, in the QA-gated Vitrina set, normal drops once released', () => {
    expect(SHOWCASE_STORE_CARDS.map((c) => [c.id, c.heroId, c.rarity, c.presentation.premiumTreatment])).toEqual([
      ['frost_comet', 'mage', 'RARE', 'showcase'],
      ['pack_oath', 'summoner', 'RARE', 'showcase'],
      ['judgement_hammer', 'warrior', 'RARE', 'showcase'],
    ]);
    for (const c of SHOWCASE_STORE_CARDS) {
      expect(c.expansion).toBe(SHOWCASE_STORE_EXPANSION);
      expect(c.acquisition).toBeUndefined(); // never store-exclusive
      expect(droppableThroughPlay(c.heroId!, c.id)).toBe(false); // not before release
      expect(droppableThroughPlay(c.heroId!, c.id, 300, ALL_RELEASED)).toBe(true);
    }
  });

  it('Cometa de Escarcha: cross at range 4 with LoS — 2 ice + Rooted 1 on every enemy hit', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(0, 2) },
      enemies: [
        { id: 'a', enemyId: 'orc_warrior', pos: p(4, 2) },
        { id: 'b', enemyId: 'orc_warrior', pos: p(4, 1) },
        { id: 'c', enemyId: 'orc_warrior', pos: p(6, 0) },
      ],
    });
    mutable(engine).player.energy = 5;
    const [uid] = setHand(engine, ['frost_comet']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(4, 2) }).ok).toBe(true);
    for (const id of ['a', 'b']) expect(unit(engine, id)).toMatchObject({ hp: 6, statuses: [{ id: 'ROOTED', turnsLeft: 1 }] });
    expect(unit(engine, 'c')).toMatchObject({ hp: 8, statuses: [] });
    expect(engine.state.player.energy).toBe(2);
  });

  it('Juramento de la Manada: every own summon heals 2 + 3 shield, the Summoner 2 shield', () => {
    const engine = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } });
    const ctx2 = ctxFor(engine);
    const hero = unit(engine, engine.heroId);
    const near = spawnSummon(ctx2, hero, 'fox', p(1, 2))!;
    const far = spawnSummon(ctx2, hero, 'chicken', p(5, 4))!;
    near.hp -= 3;
    const [uid] = setHand(engine, ['pack_oath']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(unit(engine, near.id)).toMatchObject({ hp: near.maxHp - 1, shield: 3 });
    expect(unit(engine, far.id)).toMatchObject({ shield: 3 });
    expect(unit(engine, engine.heroId).shield).toBe(2);
    expect(unit(engine, 'orc-1').shield).toBe(0); // enemies never
  });

  it('Martillo del Juicio: 4 + push 1 + 2 Guard; Impulso 2 → 5 + push 2 + 3 Guard', () => {
    const swing = (momentum: number) => {
      const engine = makeEngine({ hero: { heroId: 'warrior', pos: p(1, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }] });
      unit(engine, engine.heroId).momentum!.value = momentum;
      const [uid] = setHand(engine, ['judgement_hammer']);
      expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(true);
      return { orc: unit(engine, 'orc-1'), hero: unit(engine, engine.heroId) };
    };
    expect(swing(0)).toMatchObject({ orc: { hp: 4, pos: p(3, 2) }, hero: { shield: 2 } });
    expect(swing(2)).toMatchObject({ orc: { hp: 3, pos: p(4, 2) }, hero: { shield: 3, momentum: { value: 0 } } });
  });
});

describe('premium store offers', () => {
  it('2 premium packs per champion, each headlined by its Showcase Rare (featuredCardId)', () => {
    for (const heroId of ['mage', 'summoner', 'warrior']) {
      const mine = PREMIUM_PACKS.filter((o) => o.heroId === heroId);
      expect(mine).toHaveLength(2);
      for (const o of mine) {
        expect(o.categories).toContain('PREMIUM');
        expect(isPremiumOffer(o)).toBe(true);
        expect(DEFAULT_CONTENT.cards[o.featuredCardId!]!.presentation.premiumTreatment).toBe('showcase');
        expect(featuredCardOf(o)).toBe(o.featuredCardId);
        // Bundle price: below the parts, above the priciest part (ladder rule).
        const parts = o.contents.map((c) => contentValue(c, ctx));
        expect(o.price).toBeLessThan(parts.reduce((a, b) => a + b, 0));
        expect(o.price).toBeGreaterThan(Math.max(...parts));
      }
    }
    // Single Showcase cards at the RARE price.
    for (const c of SHOWCASE_STORE_CARDS) expect(STORE_CATALOG.find((o) => o.id === `card_${c.id}`)).toMatchObject({ price: 250 });
  });

  it('never sold before release: unreleased-set offers are not served; each set opens its own offers', () => {
    const served = (c: StoreContext) => new Set(validOffers(STORE_CATALOG, c).map((o) => o.id));
    const today = served(ctx);
    for (const o of PREMIUM_PACKS) expect(today.has(o.id)).toBe(false);
    expect(today.has('pack_warrior_executioner_oath')).toBe(true); // existing offers unchanged
    const vitrina = served(withSets(SHOWCASE_STORE_EXPANSION));
    expect(['pack_mage_frost_tempest', 'pack_summoner_pack_oath', 'pack_warrior_judgement', 'card_frost_comet'].every((id) => vitrina.has(id))).toBe(true);
    expect(vitrina.has('pack_mage_archmage_seal')).toBe(false); // needs Arsenal I
    const all = served(withSets(SHOWCASE_STORE_EXPANSION, ARSENAL_EXPANSION, TACTICAL_EXPANSION));
    for (const o of PREMIUM_PACKS) expect(all.has(o.id)).toBe(true);
  });

  it('featuredCardId must be one of the offer cards', () => {
    const o = PREMIUM_PACKS[0]!;
    expect(validateCatalog([{ ...o, featuredCardId: 'blink' }], { ...ctx, content: ALL_RELEASED })).toContainEqual(
      expect.objectContaining({ code: 'BAD_FEATURED_CARD', cardId: 'blink' }),
    );
  });

  it('presentation falls back to the highest-rarity card when no featuredCardId is set', () => {
    const glacial = STORE_CATALOG.find((o) => o.id === 'pack_mage_glacial_control')!;
    expect(featuredCardOf(glacial)).toBe('glacial_shell');
  });

  it('server switch STORE_SHOWCASE_ENABLED releases only the Vitrina set (off by default)', () => {
    expect(releasedContent(DEFAULT_CONTENT, {} as never).releasedExpansions ?? []).not.toContain(SHOWCASE_STORE_EXPANSION);
    expect(releasedContent(DEFAULT_CONTENT, { STORE_SHOWCASE_ENABLED: '1' } as never).releasedExpansions).toEqual([...(DEFAULT_CONTENT.releasedExpansions ?? []), SHOWCASE_STORE_EXPANSION]);
  });
});
