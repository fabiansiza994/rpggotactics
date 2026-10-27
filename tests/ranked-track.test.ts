import { describe, expect, it } from 'vitest';
import { RANKED_TIERS } from '../src/game/ranked/ranked';
import {
  RANKED_CARD_RELEASE_POLICY,
  RANKED_COSMETICS,
  RANKED_TITLES,
  RANKED_TRACK,
  RANKED_TRACK_ITEMS,
  rankedTrackGrantTable,
  rankedTrackView,
  type RankedTrackInput,
} from '../src/game/ranked/rewardTrack';
import { MASTERY_TITLES, titleName } from '../src/game/mastery/mastery';
import { RANKED_TRACK_CARDS } from '../src/game/data/ranked-cards';

const input = (over: Partial<RankedTrackInput> = {}): RankedTrackInput => ({
  rp: 0,
  peakRp: 0,
  firstValidRanked: false,
  granted: {},
  milestones: [],
  ...over,
});
const grantAll = (upTo: number) =>
  Object.fromEntries(
    RANKED_TRACK.filter((n) => n.requiredRp <= upTo)
      .flatMap((n) => n.items)
      .filter((i) => i.type !== 'CRYSTALS')
      .map((i) => [i.rewardId, { grantedAt: 1, copies: i.quantity }]),
  );

describe('Reward Track catalog', () => {
  it('one node per real division: 18 nodes, 100 RP apart, Hierro III 0 … Diamante I 1700', () => {
    expect(RANKED_TRACK).toHaveLength(18);
    expect(RANKED_TRACK.map((n) => n.requiredRp)).toEqual(Array.from({ length: 18 }, (_, i) => i * 100));
    expect(RANKED_TRACK[0]!.nodeId).toBe('IRON_III');
    expect(RANKED_TRACK.at(-1)!.nodeId).toBe('DIAMOND_I');
    expect(RANKED_TRACK.find((n) => n.nodeId === 'GOLD_II')!.requiredRp).toBe(1000);
    expect(RANKED_TRACK.every((n) => n.items.length > 0)).toBe(true); // something on every division
  });

  it('crystals: exactly the existing 0023 milestones (800), never granted by the track itself', () => {
    const crystals = RANKED_TRACK_ITEMS.filter((i) => i.type === 'CRYSTALS');
    expect(crystals.map((i) => [i.tierId, i.quantity])).toEqual(RANKED_TIERS.filter((t) => t.milestoneCrystals > 0).map((t) => [t.id, t.milestoneCrystals]));
    expect(crystals.reduce((n, i) => n + i.quantity, 0)).toBe(800);
    expect(rankedTrackGrantTable().some((r) => r.type === ('CRYSTALS' as string))).toBe(false);
  });

  it('the nine cards appear once each, full playset (UNCOMMON 2 / RARE 1), early access, permanent', () => {
    const cards = RANKED_TRACK_ITEMS.filter((i) => i.type === 'CARD');
    expect(cards.map((c) => c.cardId).sort()).toEqual(RANKED_TRACK_CARDS.map((c) => c.id).sort());
    for (const c of cards) {
      const def = RANKED_TRACK_CARDS.find((d) => d.id === c.cardId)!;
      expect(c.quantity).toBe(def.rarity === 'RARE' ? 2 - 1 : 2);
      expect(c).toMatchObject({ permanent: true, exclusive: false, availability: 'EARLY_ACCESS', heroId: def.heroId });
      expect(def.acquisition).toMatchObject({ source: 'RANKED_TRACK', rewardId: c.rewardId });
    }
    expect(cards.some((c) => c.cardId === 'unleashed_hunt')).toBe(false);
  });

  it('approved placement: Empalizada Hierro II … Intercambio Arcano Platino II; no card in Diamante', () => {
    const at = Object.fromEntries(RANKED_TRACK.flatMap((n) => n.items.filter((i) => i.type === 'CARD').map((i) => [i.cardId, n.nodeId])));
    expect(at).toEqual({
      palisade: 'IRON_II',
      wall_patience: 'IRON_I',
      pact_relay: 'BRONZE_II',
      wild_burst: 'BRONZE_I',
      ignition_rune: 'SILVER_II',
      altar_echo: 'SILVER_I',
      siege_leap: 'GOLD_II',
      tracking_arrow: 'GOLD_I',
      arcane_exchange: 'PLATINUM_II',
    });
  });

  it('reward ids are unique and stable-looking; every grant row is fully specified', () => {
    const ids = RANKED_TRACK_ITEMS.map((i) => i.rewardId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^rt\.preseason_0\.[A-Z]+_(I|II|III)\.[a-z]+$/);
    for (const r of rankedTrackGrantTable()) expect(r.itemId).toBeTruthy();
  });

  it('titles: the six approved names, distinct from every Mastery title; resolvable by the shared titleName()', () => {
    expect(RANKED_TITLES.map((t) => [t.nodeId, t.name])).toEqual([
      ['BRONZE_III', 'Retador de la Arena'],
      ['SILVER_III', 'Duelista de Plata'],
      ['GOLD_III', 'Estratega Dorado'],
      ['PLATINUM_III', 'Táctico de Platino'],
      ['DIAMOND_III', 'Filo de Diamante'],
      ['DIAMOND_I', 'Cima de la Pretemporada'],
    ]);
    const mastery = new Set(MASTERY_TITLES.map((t) => titleName(t.id)));
    for (const t of RANKED_TITLES) {
      expect(mastery.has(t.name)).toBe(false);
      expect(titleName(t.id)).toBe(t.name);
    }
    expect(titleName('mastery.mage.1')).toBe('Aprendiz Arcano');
  });

  it('cosmetics: approved ids/kinds, Preseason-exclusive; the emblem needs the first valid ranked', () => {
    const cos = RANKED_TRACK_ITEMS.filter((i) => i.type === 'COSMETIC');
    expect(cos.map((c) => c.cosmeticId).sort()).toEqual(Object.keys(RANKED_COSMETICS).sort());
    for (const c of cos) expect(c).toMatchObject({ exclusive: true, availability: 'SEASON_EXCLUSIVE', permanent: true });
    expect(cos.find((c) => c.cosmeticId === 'ranked_emblem_preseason_0')).toMatchObject({ condition: 'FIRST_VALID_RANKED' });
  });

  it('release policy is data (manual switch), no premium packs, no real money', () => {
    expect(RANKED_CARD_RELEASE_POLICY).toMatchObject({ phase: 'PRESEASON_EARLY_ACCESS', storeWeeksAfterPools: 4, storePrice: { UNCOMMON: 150, RARE: 250 }, premiumPacks: false, realMoney: false });
  });
});

describe('Reward Track view', () => {
  it('fresh account: everything locked; the emblem waits for the first valid match; next reward = emblem', () => {
    const v = rankedTrackView(input());
    expect(v.nodes.every((n) => n.status === 'LOCKED')).toBe(true);
    expect(v.nodes[0]!.current).toBe(true);
    expect(v.nextReward).toMatchObject({ nodeId: 'IRON_III', distance: 0 });
    expect(v.nextDivision).toEqual({ label: 'Hierro II', rp: 100, distance: 100 });
  });

  it('below a threshold nothing; at it UNLOCKED until granted, then CLAIMED', () => {
    expect(rankedTrackView(input({ rp: 99, peakRp: 99 })).nodes[1]!.status).toBe('LOCKED');
    const reached = rankedTrackView(input({ rp: 100, peakRp: 100, firstValidRanked: true }));
    expect(reached.nodes[1]!.status).toBe('UNLOCKED');
    const granted = rankedTrackView(input({ rp: 100, peakRp: 100, firstValidRanked: true, granted: grantAll(100) }));
    expect(granted.nodes.slice(0, 2).map((n) => n.status)).toEqual(['CLAIMED', 'CLAIMED']);
  });

  it('Oro III · 940 RP → Oro II · 1.000 RP; next reward Salto de Asedio (60 RP away)', () => {
    const v = rankedTrackView(input({ rp: 940, peakRp: 940, firstValidRanked: true, granted: grantAll(940), milestones: ['BRONZE', 'SILVER', 'GOLD'] }));
    expect(v.rank.label).toBe('Oro III');
    expect(v.nextDivision).toEqual({ label: 'Oro II', rp: 1000, distance: 60 });
    expect(v.nextReward).toMatchObject({ nodeId: 'GOLD_II', requiredRp: 1000, distance: 60 });
    expect(v.nextReward!.items[0]).toMatchObject({ type: 'CARD', cardId: 'siege_leap' });
    expect(v.nodes.find((n) => n.current)!.nodeId).toBe('GOLD_III');
  });

  it('demotion: peak keeps everything CLAIMED; current marker follows the real RP; distance from current RP', () => {
    const v = rankedTrackView(input({ rp: 640, peakRp: 1010, firstValidRanked: true, granted: grantAll(1010), milestones: ['BRONZE', 'SILVER', 'GOLD'] }));
    expect(v.nodes.filter((n) => n.requiredRp <= 1000).every((n) => n.status === 'CLAIMED')).toBe(true);
    expect(v.nodes.find((n) => n.current)!.nodeId).toBe('SILVER_III');
    expect(v.nextReward).toMatchObject({ nodeId: 'GOLD_I', distance: 460 });
  });

  it('peak can never be below the current RP; junk numbers are clamped', () => {
    expect(rankedTrackView(input({ rp: 300, peakRp: 10 })).peakRp).toBe(300);
    expect(rankedTrackView(input({ rp: -5, peakRp: Number.NaN })).rp).toBe(0);
  });

  it('top: Diamante I has no next division; with everything claimed there is no next reward', () => {
    const all = rankedTrackView(input({ rp: 1800, peakRp: 1800, firstValidRanked: true, granted: grantAll(1800), milestones: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] }));
    expect(all.nextDivision).toBeNull();
    expect(all.nextReward).toBeNull();
    expect(all.nodes.every((n) => n.status === 'CLAIMED')).toBe(true);
  });
});
