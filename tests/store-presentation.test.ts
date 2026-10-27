import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_CONTENT, createProfile, STORE_CATALOG } from '../src/game';
import {
  availabilityText,
  excludedText,
  isReduced,
  offerKind,
  ownership,
  purchaseError,
  remainingTime,
  readIntent,
  saveIntent,
} from '../src/presentation/shop/presentation';
import type { CatalogOffer } from '../src/presentation/shop/api';
const bestiary = STORE_CATALOG.find((o) => o.id === 'pack_summoner_bestiary')!;
const offer: CatalogOffer = { ...bestiary, basePrice: bestiary.price, excluded: [], availability: { purchasable: true } };
afterEach(() => vi.unstubAllGlobals());
describe('store presentation uses real metadata', () => {
  it('shows the server-prorated price and names what was left out (Phase 4C)', () => {
    const reduced: CatalogOffer = {
      ...offer,
      price: 250,
      contents: offer.contents.filter((c) => c.kind === 'CARD' && c.cardId !== 'summon_turtle'),
      excluded: [{ kind: 'CARD', cardId: 'summon_turtle', copies: 1, owned: 2, cap: 2 }],
    };
    expect(isReduced(reduced)).toBe(true);
    expect(isReduced(offer)).toBe(false);
    expect(excludedText(reduced)).toEqual(['Invocar Tortuga (tienes 2/2)']);
    expect(offerKind(reduced)).toBe('Pack de cartas');
    expect(offerKind({ ...offer, type: 'COSMETIC' }, true)).toBe('Cosmético de perfil');
  });
  it('does not invent a countdown for permanent offers', () =>
    expect(remainingTime(null, 0)).toBeNull());
  it('uses supplied server time and detects expired rotation', () => {
    expect(remainingTime(3600000, 0)).toBe('Disponible por 0d 1h');
    expect(remainingTime(10, 11)).toContain('terminada');
  });
  it('explains a capped single card and a fully owned bundle', () => {
    const capped = {
      ...offer,
      availability: {
        purchasable: false,
        reason: { code: 'CARD_AT_CAP', cardId: 'summon_turtle', owned: 2, cap: 2 },
      },
    } as CatalogOffer;
    expect(availabilityText(capped)).toContain('máximo de copias');
    expect(
      availabilityText({ ...offer, availability: { purchasable: false, reason: { code: 'ALL_OWNED' } } }),
    ).toContain('No queda nada');
    expect(ownership(capped, 'summon_turtle', createProfile(DEFAULT_CONTENT))).toEqual({
      owned: 2,
      cap: 2,
    });
  });
  it('distinguishes purchased from card-cap states', () => {
    expect(
      availabilityText({
        ...offer,
        availability: { purchasable: false, reason: { code: 'PURCHASE_LIMIT', limit: 1 } },
      }),
    ).toContain('Ya adquiriste');
    expect(availabilityText(offer)).toBeNull();
  });
  for (const kind of ['NETWORK', 'TIMEOUT', 'SERVER'] as const)
    it(`${kind} explains safe recovery`, () =>
      expect(
        purchaseError({ kind, status: 0, code: 'ERROR', message: 'internal database trace' }),
      ).toContain('no se cobrará dos veces'));
  it('never shows raw server exceptions', () =>
    expect(
      purchaseError({
        kind: 'REJECTED',
        status: 409,
        code: 'UNKNOWN',
        message: 'secret internal database trace',
      }),
    ).not.toContain('database'));
  it('pending receipt survives reload but is scoped to account', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k),
      setItem: (k: string, v: string) => m.set(k, v),
      removeItem: (k: string) => m.delete(k),
    });
    const intent = { username: 'qa_a', offerId: offer.id, key: 'stable-retry-key' };
    saveIntent(intent);
    expect(readIntent('qa_a')).toEqual(intent);
    expect(readIntent('qa_b')).toBeNull();
    saveIntent(null, 'qa_a');
    expect(readIntent('qa_a')).toBeNull();
  });
});
