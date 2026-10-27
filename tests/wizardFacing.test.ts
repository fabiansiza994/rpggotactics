import { describe, expect, it } from 'vitest';
import {
  resolvedFacingTarget,
  wizardFacing,
  wizardView,
} from '../src/presentation/pixi/wizardFacing';
const origin = { x: 0, y: 0 };
describe('visual wizard facing', () => {
  it.each([
    ['N', 0, -1],
    ['NE', 1, -1],
    ['E', 1, 0],
    ['SE', 1, 1],
    ['S', 0, 1],
    ['SW', -1, 1],
    ['W', -1, 0],
    ['NW', -1, -1],
  ] as const)('resolves %s from logical grid axes', (facing, x, y) => {
    expect(wizardFacing(origin, { x, y }, 'S')).toBe(facing);
  });
  it('holds the same sector and retains facing for no target or same tile', () => {
    expect(wizardFacing(origin, { x: 5, y: 1 }, 'E')).toBe('E');
    expect(wizardFacing(origin, null, 'N')).toBe('N');
    expect(wizardFacing(origin, origin, 'W')).toBe('W');
  });
  it('holds both sides of a sector boundary until crossing the tolerance', () => {
    const at = (deg: number) => ({
      x: Math.cos((deg * Math.PI) / 180),
      y: Math.sin((deg * Math.PI) / 180),
    });
    expect(wizardFacing(origin, at(24), 'E')).toBe('E');
    expect(wizardFacing(origin, at(21), 'SE')).toBe('SE');
    expect(wizardFacing(origin, at(31), 'E')).toBe('SE');
    expect(wizardFacing(origin, at(14), 'SE')).toBe('E');
    expect(wizardFacing(origin, at(-179), 'W')).toBe('W');
    expect(wizardFacing(origin, at(24), 'E', true)).toBe('SE');
  });
  it('shares attack > preview > in-arena pointer priority with touch', () => {
    const attack = { x: 1, y: 0 },
      preview = { x: 0, y: -1 },
      pointer = { x: -1, y: 0 };
    expect(resolvedFacingTarget({ attack, preview, pointer, inside: true })).toBe(attack);
    expect(resolvedFacingTarget({ preview, pointer, inside: true })).toBe(preview);
    expect(resolvedFacingTarget({ preview, inside: false })).toBe(preview);
    expect(resolvedFacingTarget({ pointer, inside: false })).toBeNull();
    expect(resolvedFacingTarget({ pointer, inside: true })).toBe(pointer);
  });
  it('uses five views and mirrors only left oblique/profile poses', () => {
    expect(wizardView('NW')).toEqual({ view: 'back3q', mirror: true });
    expect(wizardView('NE')).toEqual({ view: 'back3q', mirror: false });
    expect(wizardView('S').mirror).toBe(false);
  });
});
