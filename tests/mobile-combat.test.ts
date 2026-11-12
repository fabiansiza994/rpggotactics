import { describe, it, expect, vi, afterEach } from 'vitest';
import { GridProjection } from '../src/presentation/pixi/GridProjection';
import { cardHold, mobileTurnTapAllowed, mobileCameraTurn } from '../src/presentation/react/mobileCombat';
afterEach(() => vi.useRealTimers());
describe('Mobile 1 camera', () => {
  it.each([0, 1, 2, 3] as const)('picking and anchors preserve every logical cell at quarter turn %s', quarterTurn => {
    const p = new GridProjection({ cols: 9, rows: 6, tile: 96, perspective: 1.1, depth: .9, quarterTurn });
    for (let y=0; y<6; y++) for (let x=0; x<9; x++) {
      const cell = {x,y}, center = p.getUnitAnchor(cell);
      expect(p.screenToGrid(center)).toEqual(cell);
      expect(p.footprint(cell).w).toBeGreaterThan(0);
      expect(p.footprint(cell).h).toBeGreaterThan(0);
      const logical = p.unproject(p.project(x+.2,y+.7));
      expect(logical.u).toBeCloseTo(x+.2); expect(logical.v).toBeCloseTo(y+.7);
    }
  });
  it('puts either PvP seat at the bottom without changing logical coordinates', () => {
    const cfg = {cols:9,rows:6,tile:96,perspective:1.1,depth:.9};
    const left = new GridProjection({...cfg,quarterTurn:1});
    const right = new GridProjection({...cfg,quarterTurn:3});
    expect(left.getTileCenter({x:0,y:2}).y).toBeGreaterThan(left.getTileCenter({x:8,y:2}).y);
    expect(right.getTileCenter({x:8,y:2}).y).toBeGreaterThan(right.getTileCenter({x:0,y:2}).y);
  });
});
describe('Card hold safety', () => {
  it('inspects once at 400ms and consumes the release click, including a pointer released over a dialog', () => {
    vi.useFakeTimers(); const inspect = vi.fn(); const hold = cardHold(inspect);
    hold.start(10,10); vi.advanceTimersByTime(399); expect(inspect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); hold.end(); vi.advanceTimersByTime(1000);
    expect(inspect).toHaveBeenCalledTimes(1); expect(hold.consumeClick()).toBe(true);
    expect(hold.consumeClick()).toBe(false); hold.destroy();
  });
  it('preserves a short tap and cancels on drag, pointer cancellation, unmount or a replacement press', () => {
    vi.useFakeTimers();const inspect=vi.fn();const hold=cardHold(inspect);
    hold.start(0,0);vi.advanceTimersByTime(100);hold.end();expect(hold.consumeClick()).toBe(false);
    hold.start(0,0);hold.move(20,0);vi.advanceTimersByTime(500);expect(hold.consumeClick()).toBe(true);
    hold.start(0,0);hold.cancel();vi.advanceTimersByTime(500);
    hold.start(0,0);hold.destroy();vi.advanceTimersByTime(500);
    expect(inspect).not.toHaveBeenCalled();
  });
});

it('ignores fast repeated taps after Confirm or Cancel, then restores intentional end turn', () => {
  expect(mobileTurnTapAllowed(1000, 1000)).toBe(false);
  expect(mobileTurnTapAllowed(1599, 1000)).toBe(false);
  expect(mobileTurnTapAllowed(1600, 1000)).toBe(true);
  expect(mobileTurnTapAllowed(0, -Infinity)).toBe(true);
});

it('keeps both seats below their rival on side-entry and top/bottom maps, independent of current movement', () => {
  for(const [a,b] of [[{x:0,y:1},{x:8,y:4}],[{x:4,y:0},{x:4,y:6}]] as const){
    for(const [own,foe] of [[a,b],[b,a]] as const){
      const p = new GridProjection({cols:9,rows:7,tile:96,perspective:1.1,depth:.9,quarterTurn:mobileCameraTurn(own,9,7)});
      expect(p.getTileCenter(own).y).toBeGreaterThan(p.getTileCenter(foe).y);
      expect(p.screenToGrid(p.getTileCenter(foe))).toEqual(foe);
    }
  }
});
