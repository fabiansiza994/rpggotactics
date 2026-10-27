import { expect, it } from 'vitest';
import { BattleCanvas } from '../src/presentation/pixi/BattleCanvas';
it.each([
  { ready: false, destroyed: false },
  { ready: true, destroyed: true },
])('QA sampling ignores unavailable renderer lifecycle state %j', (state) => {
  // No ticker or layers exist here: sampling must not touch either before mount/after teardown.
  expect(BattleCanvas.prototype.qaFeelSnapshot.call(state as unknown as BattleCanvas)).toBeNull();
});
