import { expect, it } from 'vitest';
import { wizardSpriteScale } from '../src/presentation/pixi/wizardSpriteScale';
it('keeps the original atlas scale and maps full-resolution directional art to the same visible size', () => {
  const atlas = wizardSpriteScale(256),
    directional = wizardSpriteScale(512);
  expect(atlas).toBeCloseTo(96 / 143);
  expect(directional).toBeCloseTo(atlas / 2);
  expect(180 * atlas).toBeCloseTo(360 * directional);
  expect(141.5 * atlas).toBeCloseTo(283 * directional);
});
