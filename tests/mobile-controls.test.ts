import { describe, it, expect } from 'vitest';
import { mobileEndTurnAllowed } from '../src/presentation/react/mobileCombat';
describe('Mobile 2 side control safety', () => {
  it('rejects every targeting and forced-discard activation, even after the release guard', () => {
    expect(mobileEndTurnAllowed(10000, 0, true, false)).toBe(false);
    expect(mobileEndTurnAllowed(10000, 0, false, true)).toBe(false);
    expect(mobileEndTurnAllowed(10000, 0, true, true)).toBe(false);
  });
  it('rejects repeated taps after confirm/cancel and permits a later intentional tap', () => {
    expect(mobileEndTurnAllowed(1599, 1000, false, false)).toBe(false);
    expect(mobileEndTurnAllowed(1600, 1000, false, false)).toBe(true);
    expect(mobileEndTurnAllowed(0, -Infinity, false, false)).toBe(true);
  });
});
