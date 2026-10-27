import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT, TACTICAL_CARDS, NEUTRAL_CARDS } from '../src/game';
import { FINAL_CARD_ART, TACTICAL_CARD_ART_IDS } from '../src/presentation/assets/paintedAssets';
import { CARD_IDENTITY } from '../src/presentation/assets/visualIdentity';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';
import {
  markedPrey,
  bondCompanion,
  attackingMarkedPrey,
} from '../src/presentation/cards/tacticalPresentation';
import { makeEngine, unit, p } from './helpers';

describe('tactical visual assets', () => {
  it('has eight distinct bounded portrait WebPs and keeps definitions intact', () => {
    expect(TACTICAL_CARD_ART_IDS).toHaveLength(8);
    const hashes = new Set<string>();
    for (const card of TACTICAL_CARDS) {
      const before = JSON.stringify(card),
        path = 'public' + FINAL_CARD_ART[card.id];
      expect(existsSync(path), card.id).toBe(true);
      const data = readFileSync(path);
      expect(data.subarray(0, 4).toString()).toBe('RIFF');
      expect(statSync(path).size).toBeLessThan(220000);
      hashes.add(createHash('sha256').update(data).digest('hex'));
      expect(CARD_IDENTITY[card.presentation.visualKey]).toBeDefined();
      premiumIdentity(card);
      expect(JSON.stringify(card)).toBe(before);
    }
    expect(hashes.size).toBe(8);
  });
  it('neutral common cards remain non-holographic', () => {
    for (const card of NEUTRAL_CARDS) {
      expect(premiumIdentity(card).treatment).toBe('none');
      expect(CARD_IDENTITY[card.presentation.visualKey]?.family).toBe('neutral');
    }
    expect(premiumIdentity(DEFAULT_CONTENT.cards.mark_prey!).treatment).toBe('subtle');
  });
  it('keeps functional files byte-for-byte unchanged during this pass', () => {
    const manifest = JSON.parse(
      readFileSync('qa/neutral-summoner-visual/functional-before.json', 'utf8'),
    ) as Record<string, string>;
    for (const [path, hash] of Object.entries(manifest))
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), path).toBe(hash);
  });
});
describe('derived bond/prey display only', () => {
  it('clears marks at zero HP and after expiry without state mutation', () => {
    const engine = makeEngine();
    const enemy = unit(engine, 'orc-1');
    enemy.statuses = [{ id: 'MARKED_PREY', turnsLeft: 1, sourceId: engine.heroId }];
    const before = JSON.stringify(engine.state);
    expect(markedPrey(enemy)).toBe(true);
    expect(JSON.stringify(engine.state)).toBe(before);
    expect(markedPrey({ ...enemy, hp: 0 })).toBe(false);
    expect(markedPrey({ ...enemy, statuses: [] })).toBe(false);
  });
  it('reads only an alive adjacent ally and the matching mark owner', () => {
    const engine = makeEngine(),
      hero = engine.state.units.find((u) => u.kind === 'HERO')!,
      enemy = unit(engine, 'orc-1');
    const summon = {
      ...hero,
      id: 'visual-summon',
      kind: 'SUMMON' as const,
      summon: { ownerId: hero.id, capacityCost: 1, lastActedRound: 0, readyRound: 1 },
      pos: p(enemy.pos.x - 1, enemy.pos.y),
    };
    const units = [hero, enemy, summon];
    enemy.statuses = [{ id: 'MARKED_PREY', turnsLeft: 1, sourceId: hero.id }];
    const before = JSON.stringify(units);
    expect(bondCompanion(units, hero.id, enemy.pos)?.id).toBe(summon.id);
    expect(attackingMarkedPrey(units, summon.id, enemy.id)).toBe(true);
    expect(JSON.stringify(units)).toBe(before);
    expect(bondCompanion([hero, enemy, { ...summon, hp: 0 }], hero.id, enemy.pos)).toBeUndefined();
    expect(
      attackingMarkedPrey([hero, { ...enemy, statuses: [] }, summon], summon.id, enemy.id),
    ).toBe(false);
  });
});
