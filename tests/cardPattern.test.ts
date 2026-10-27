import { expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game';
import { cardPattern } from '../src/presentation/react/card/cardPattern';

it('derives directional and area footprints from the actual card targeting metadata', () => {
  const pattern = (id: string) => cardPattern(DEFAULT_CONTENT.cards[id]!.targeting);
  expect(pattern('fireball').cells).toEqual([1, 2, 3, 4].map((x) => ({ x, y: 2 })));
  expect(pattern('ice_wall').cells).toEqual([1, 2, 3].map((y) => ({ x: 2, y })));
  expect(pattern('arcane_burst').cells).toHaveLength(5);
  const nova = pattern('frost_nova');
  expect(nova.cells).toHaveLength(8);
  expect(nova.cells).not.toContainEqual({ x: 2, y: 2 });
  expect(pattern('barrier').cells).toEqual([{ x: 2, y: 2 }]);
});
