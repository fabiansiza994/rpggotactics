import { afterEach, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
const art = vi.hoisted(() => ({ master: vi.fn(), frame: vi.fn() }));
vi.mock('../src/presentation/pixi/paintedTextures', () => ({
  paintedCharacter: art.master, paintedAnimationFrame: art.frame,
  wizardTexture: vi.fn(), paintedVerticalFrame: vi.fn(),
}));
import { unitArt, PaintedFigure } from '../src/presentation/pixi/unitArt';
afterEach(() => { vi.clearAllMocks(); });
it.each(['mage', 'summoner', 'qa_form_humanoid', 'qa_form_bear', 'qa_form_minotaur'])(
  'uses the loaded authored idle atlas for %s when its master request failed', (id) => {
    art.master.mockReturnValue(undefined);
    art.frame.mockReturnValue(Texture.WHITE);
    const body = unitArt(id);
    expect(body).toBeInstanceOf(PaintedFigure);
    body.destroy({ children: true });
  },
);
it('keeps the master as first choice', () => {
  art.master.mockReturnValue(Texture.WHITE);
  art.frame.mockReturnValue(undefined);
  const body = unitArt('mage');
  expect(body).toBeInstanceOf(PaintedFigure);
  expect(art.frame).not.toHaveBeenCalled();
  body.destroy({ children: true });
});
it('retains the emergency fallback only when neither authored source is available', () => {
  art.master.mockReturnValue(undefined);
  art.frame.mockReturnValue(undefined);
  const body = unitArt('qa_form_humanoid');
  expect(body).not.toBeInstanceOf(PaintedFigure);
  body.destroy();
});
