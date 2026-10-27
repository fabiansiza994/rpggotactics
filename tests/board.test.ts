import { describe, expect, it } from 'vitest';
import { createBoard, inBounds, tileAt } from '../src/game/domain/board/board';
import { hasLineOfSight, tilesBetween } from '../src/game/domain/board/line-of-sight';
import {
  alignedDirection,
  dominantDirection,
  manhattan,
  posKey,
  step,
} from '../src/game/domain/core/position';
import { ctxFor, makeEngine, p } from './helpers';

describe('coordinates', () => {
  it('steps orthogonally with y growing downward', () => {
    expect(step(p(2, 2), 'UP')).toEqual(p(2, 1));
    expect(step(p(2, 2), 'RIGHT', 3)).toEqual(p(5, 2));
  });

  it('computes manhattan distance and alignment', () => {
    expect(manhattan(p(0, 0), p(3, 4))).toBe(7);
    expect(alignedDirection(p(1, 1), p(1, 4))).toBe('DOWN');
    expect(alignedDirection(p(1, 1), p(2, 2))).toBeNull();
    expect(dominantDirection(p(1, 1), p(4, 2))).toBe('RIGHT');
    expect(posKey(p(3, 1))).toBe('3,1');
  });
});

describe('board', () => {
  it('builds a 7x5 grid and respects bounds', () => {
    const board = createBoard(7, 5);
    expect(board.tiles).toHaveLength(35);
    expect(inBounds(board, p(6, 4))).toBe(true);
    expect(inBounds(board, p(7, 0))).toBe(false);
    expect(inBounds(board, p(0, -1))).toBe(false);
    expect(tileAt(board, p(9, 9))).toBeUndefined();
  });

  it('loads terrain and obstacles from a scenario layout', () => {
    const engine = makeEngine({ layout: ['..#....', '.......', '...I...', '.....x.', 'r......'] });
    const s = engine.state;
    expect(s.board.width).toBe(7);
    expect(s.board.height).toBe(5);
    expect(tileAt(s.board, p(3, 2))?.terrain).toBe('ICE');
    expect(tileAt(s.board, p(5, 3))?.terrain).toBe('BLOCKED');
    expect(s.obstacles.map((o) => [o.defId, o.pos])).toEqual([
      ['pillar', p(2, 0)],
      ['rubble', p(0, 4)],
    ]);
  });

  it('rejects ragged layouts', () => {
    expect(() => makeEngine({ layout: ['....', '...'] })).toThrow(/ragged/);
  });
});

describe('line of sight (data-driven)', () => {
  it('is blocked by pillars but not by rubble or units', () => {
    const engine = makeEngine({ layout: ['.......', '.......', '..#.r..', '.......', '.......'] });
    const ctx = ctxFor(engine);
    expect(tilesBetween(p(0, 2), p(3, 2))).toEqual([p(1, 2), p(2, 2)]);
    expect(hasLineOfSight(ctx, p(0, 2), p(3, 2))).toBe(false); // pillar at (2,2)
    expect(hasLineOfSight(ctx, p(3, 2), p(6, 2))).toBe(true); // rubble at (4,2) does not block LoS
    expect(hasLineOfSight(ctx, p(0, 0), p(6, 0))).toBe(true);
  });
});
