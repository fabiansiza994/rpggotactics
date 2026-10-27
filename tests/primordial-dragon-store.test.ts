import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  COSMETICS,
  DECK_RULES,
  DEFAULT_CONTENT,
  RITUAL_EXPANSION,
  STORE_CATALOG,
  contentValue,
  planPurchase,
  validateCatalog,
  type PlayerProfile,
  type StoreContext,
  type StoreOffer,
  type StoreOwnership,
} from '../src/game';
import { handle } from '../server/src/index';
import { qaGrantSql } from '../server/scripts/qa-grant-sql.mjs';
import { featuredCardOf, isPremiumOffer } from '../src/presentation/shop/StoreHeroShot';
import { offerKind } from '../src/presentation/shop/presentation';
import { RitualHeroShot, RitualPreviewArt, RitualRecipe, ritualArt } from '../src/presentation/shop/RitualHeroShot';
import type { CatalogOffer } from '../src/presentation/shop/api';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';
import { addAccount, memoryD1 } from './support/d1';
import { ALL_RELEASED } from './support/drops';

const SEALS = ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'];
const PACK = STORE_CATALOG.find((o) => o.id === 'pack_summoner_primordial_ritual')!;
const released: StoreContext = { content: ALL_RELEASED, rules: DECK_RULES, cosmetics: COSMETICS };
const view = (o: StoreOffer = PACK): CatalogOffer => ({ ...o, basePrice: o.price, excluded: [], availability: { purchasable: true } });

describe('Ritual del Dragón Primordial — offer', () => {
  it('a featured premium Summoner ritual pack that headlines Destacado', () => {
    expect(PACK).toMatchObject({
      title: 'Ritual del Dragón Primordial',
      type: 'CHAMPION_PACK',
      heroId: 'summoner',
      ritualPreview: 'primordial_dragon',
      purchaseLimit: 1,
      giftable: true,
    });
    expect(PACK.categories).toEqual(expect.arrayContaining(['FEATURED', 'PREMIUM', 'SUMMONER']));
    const featured = STORE_CATALOG.filter((o) => o.categories.includes('FEATURED'));
    expect(Math.min(...featured.map((o) => o.sortOrder))).toBe(PACK.sortOrder);
    expect(PACK.description).toContain('Reúne las piezas sagradas y completa la invocación.');
  });

  it('sells the ritual path only: exactly the four seals, never the dragon', () => {
    expect(PACK.contents.every((c) => c.kind === 'CARD' && c.copies === 1)).toBe(true);
    expect([...PACK.contents.map((c) => c.kind === 'CARD' && c.cardId)].sort()).toEqual([...SEALS].sort());
    expect(DEFAULT_CONTENT.rituals!.primordial_dragon!.pieces).toEqual(SEALS);
    // No content summons the dragon directly; it exists only through the ritual.
    for (const c of PACK.contents)
      if (c.kind === 'CARD') expect(DEFAULT_CONTENT.cards[c.cardId]!.effects.some((fx) => fx.type === 'SUMMON')).toBe(false);
    expect(JSON.stringify(PACK.contents)).not.toContain('primordial_dragon');
  });

  it('conservative price: below its parts, above its priciest part; valid once the set is released', () => {
    const parts = PACK.contents.map((c) => contentValue(c, released));
    expect(parts).toEqual([250, 250, 250, 250]);
    expect(PACK.price).toBe(850);
    expect(PACK.price).toBeLessThan(parts.reduce((a, b) => a + b, 0));
    expect(PACK.price).toBeGreaterThan(Math.max(...parts));
    expect(validateCatalog(STORE_CATALOG, released)).toEqual([]);
  });

  it('never served while the Dragón Primordial set is unreleased (production today)', () => {
    const live: StoreContext = { content: { ...DEFAULT_CONTENT, releasedExpansions: [RITUAL_EXPANSION] }, rules: DECK_RULES, cosmetics: COSMETICS };
    const issues = validateCatalog([PACK], live);
    expect(issues.map((i) => i.code)).toEqual(['UNRELEASED_CARD', 'UNRELEASED_CARD', 'UNRELEASED_CARD', 'UNRELEASED_CARD']);
  });

  it('ritualPreview must point at a ritual of the champion whose every piece is in the offer', () => {
    const missing = { ...PACK, contents: PACK.contents.filter((c) => c.kind !== 'CARD' || c.cardId !== 'seal_wing') };
    expect(validateCatalog([missing], released)).toContainEqual({ code: 'BAD_RITUAL_PREVIEW', offerId: PACK.id, ritualId: 'primordial_dragon' });
    for (const ritualPreview of ['nope', '__proto__', 'ancestral_wolf'])
      expect(validateCatalog([{ ...PACK, ritualPreview }], released).map((i) => i.code), ritualPreview).toContain('BAD_RITUAL_PREVIEW');
  });

  it('prorated when the player already owns a seal (the server leaves it out and lowers the price)', () => {
    const owned: StoreOwnership = { copies: (_hero, id) => (id === 'seal_claw' ? 2 : 0), hasCosmetic: () => false, purchases: () => 0 };
    const plan = planPurchase(PACK, owned, released, Date.now());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.quote.contents.map((c) => c.kind === 'CARD' && c.cardId).sort()).toEqual(['seal_fang', 'seal_heart', 'seal_wing']);
      expect(plan.quote.price).toBeLessThan(PACK.price);
    }
  });
});

describe('Ritual pack — server purchase (real Worker, in-process)', () => {
  let db: ReturnType<typeof memoryD1>;
  beforeEach(() => {
    db = memoryD1({ legacyProfiles: true });
  });
  const call = async (env: Record<string, string>, token: string, method: string, path: string, body?: unknown) => {
    const res = await handle(
      new Request(`https://api.test/api/tactics${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { DB: db, ...env },
    );
    return { status: res.status, body: (await res.json()) as { offers?: StoreOffer[]; profile?: PlayerProfile; error?: { code: string } } };
  };

  it('hidden and refused with the flag off; listed and grants only the four seals with PRIMORDIAL_DRAGON_ENABLED', async () => {
    const { token } = addAccount(db, 'tactics_qa_a');
    const off = { SUMMONER_RITUALS_ENABLED: '1' };
    await call(off, token, 'POST', '/profile', {});
    db.sql.prepare(qaGrantSql({ username: 'tactics_qa_a', amount: 2000, reference: 'ref-1', transactionId: 'txn_qa_00000000-0000-4000-8000-000000000001', now: Date.now() })).run();
    expect((await call(off, token, 'GET', '/store/catalog')).body.offers!.map((o) => o.id)).not.toContain(PACK.id);
    expect((await call(off, token, 'POST', '/store/purchase', { offerId: PACK.id, idempotencyKey: 'key-00000001' })).status).toBe(404);

    const on = { ...off, PRIMORDIAL_DRAGON_ENABLED: '1' };
    const listed = (await call(on, token, 'GET', '/store/catalog')).body.offers!;
    expect(listed.find((o) => o.id === PACK.id)).toMatchObject({ ritualPreview: 'primordial_dragon', price: 850 });
    const bought = await call(on, token, 'POST', '/store/purchase', { offerId: PACK.id, idempotencyKey: 'key-00000002' });
    expect(bought.status).toBe(200);
    const collection = bought.body.profile!.heroes.summoner!.collection;
    for (const id of SEALS) expect(collection[id]?.copies, id).toBe(1);
    expect(JSON.stringify(bought.body.profile)).not.toContain('primordial_dragon');
  });
});

describe('Ritual pack — store presentation', () => {
  it('seals use the existing showcase treatment (dragon motif): the pack reads as premium', () => {
    expect(isPremiumOffer(PACK)).toBe(true);
    expect(featuredCardOf(PACK)).toBe('seal_heart');
    for (const id of SEALS) expect(premiumIdentity(DEFAULT_CONTENT.cards[id]!)).toMatchObject({ treatment: 'showcase', motif: 'dragon' });
    expect(offerKind(view())).toBe('Pack ritual');
    expect(offerKind(view(), true)).toBe('Pack ritual · Invocación ritual');
  });

  it('modal hero shot uses the original final Dragón Primordial artwork, with its numbers', () => {
    const html = renderToStaticMarkup(createElement(RitualHeroShot, { offer: view() }));
    expect(html).toContain('Recompensa del ritual');
    expect(html).toContain('Invocación mítica');
    expect(html).toContain('Dragón Primordial');
    expect(html).toContain('<b>26</b> PV');
    expect(html).toContain('Aliento Primordial <b>4</b>');
    expect(html).toContain('Una invocación legendaria reservada para quienes completan el ritual.');
    expect(ritualArt('primordial_dragon')).toMatchObject({ placeholder: false, summonId: 'primordial_dragon', src: '/art/primordial/primordial_dragon.webp' });
    expect(html).not.toContain('data-placeholder');
    expect(renderToStaticMarkup(createElement(RitualPreviewArt, { ritualId: 'primordial_dragon', pieces: SEALS }))).toContain('ritual-seal-chip');
  });

  it('recipe: the four pieces, what is included or already owned, and the explanation', () => {
    const html = renderToStaticMarkup(createElement(RitualRecipe, { offer: view() }));
    expect(html).toContain('Este pack contiene las cartas clave del ritual. <strong>Domina la secuencia y desata al Dragón Primordial.</strong>');
    expect(html).toContain('Por separado: <s>1000</s>');
    expect(html).toContain('Completa el ritual para invocar al Dragón Primordial.');
    for (const name of ['Garra Primordial', 'Colmillo Primordial', 'Ala Primordial', 'Corazón Primordial']) expect(html).toContain(name);
    expect(html.match(/data-state="included"/g)).toHaveLength(4);
    const prorated = view({ ...PACK, contents: PACK.contents.filter((c) => c.kind !== 'CARD' || c.cardId !== 'seal_claw') });
    prorated.excluded = [{ kind: 'CARD', cardId: 'seal_claw', owned: 2, cap: 2 }] as CatalogOffer['excluded'];
    expect(renderToStaticMarkup(createElement(RitualRecipe, { offer: prorated }))).toContain('Ya la tienes');
  });
});
