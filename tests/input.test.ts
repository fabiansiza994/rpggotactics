import { beforeEach, describe, expect, it } from 'vitest';
import { samePos, type GameEngine, type Pos } from '../src/game';
import { decideTap, isActionableTile, resolveTapTarget } from '../src/presentation/input/aim';
import { useBattleStore } from '../src/presentation/store/battleStore';
import { makeEngine, setHand, unit } from './helpers';

/**
 * Input layer: mouse hover+click and touch tap→preview→tap share one aimed tile and the engine's
 * own validation. These drive the real store (no DOM); the canvas only supplies tile candidates.
 */
const store = () => useBattleStore.getState();
const engine = () => store().engine as GameEngine;
const hero = () => unit(engine(), 'mage');

function start(hand: string[]): string[] {
  store().startScenario('first_blood');
  useBattleStore.setState({ introLocked: false });
  return setHand(engine(), hand);
}

function allTiles(e: GameEngine): Pos[] {
  const { width, height } = e.state.board;
  return Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width) }));
}

const firstValid = (uid: string, skip = 0): Pos => engine().getValidTargets(uid)[skip]!;

describe('touch: tap previews, second tap confirms', () => {
  let burst: string;
  beforeEach(() => {
    [burst] = start(['arcane_burst', 'barrier']) as [string];
    store().selectCard(burst);
  });

  it('first tap previews and does not execute', () => {
    const target = firstValid(burst);
    const energy = engine().state.player.energy;
    store().tapTile([target]);
    expect(store().aim).toEqual({ pos: target, source: 'tap' });
    expect(store().selectedCardUid).toBe(burst);
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(true);
    expect(engine().state.player.energy).toBe(energy);
  });

  it('a second tap on the same tile executes once and clears targeting', () => {
    const target = firstValid(burst);
    store().tapTile([target]);
    store().tapTile([target]);
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(false);
    expect(store().selectedCardUid).toBeNull();
    expect(store().aim).toBeNull();
    const energy = engine().state.player.energy;
    store().tapTile([target]); // a stray third tap only previews a movement tile, never re-casts
    expect(engine().state.player.energy).toBe(energy);
  });

  it('tapping another tile moves the preview instead of executing the first', () => {
    const a = firstValid(burst, 0);
    const b = firstValid(burst, 1);
    store().tapTile([a]);
    store().tapTile([b]);
    expect(store().aim?.pos).toEqual(b);
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(true);
    store().tapTile([b]);
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(false);
  });

  it('invalid tiles never execute and keep the card selected', () => {
    const valid = engine().getValidTargets(burst);
    const invalid = allTiles(engine()).find((p) => !valid.some((v) => samePos(v, p)))!;
    store().tapTile([invalid]);
    store().tapTile([invalid]);
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(true);
    expect(store().selectedCardUid).toBe(burst);
    expect(store().notice).toBeTruthy();
  });

  it('Confirm acts on the armed preview exactly like a second tap', () => {
    store().confirmAim(); // nothing armed yet
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(true);
    store().tapTile([firstValid(burst)]);
    store().confirmAim();
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(false);
  });

  it('switching card clears the previous preview', () => {
    store().tapTile([firstValid(burst)]);
    const barrier = engine().state.player.hand[1]!.uid;
    store().selectCard(barrier);
    expect(store().selectedCardUid).toBe(barrier);
    expect(store().aim).toBeNull();
  });

  it('cancelling clears card and preview; tapping off-board clears only the preview', () => {
    store().tapTile([firstValid(burst)]);
    store().tapTile([]);
    expect(store().aim).toBeNull();
    expect(store().selectedCardUid).toBe(burst);
    store().tapTile([firstValid(burst)]);
    store().cancelAim();
    expect(store().aim).toBeNull();
    expect(store().selectedCardUid).toBeNull();
  });

  it('a mouse leaving the board never drops an armed touch preview', () => {
    store().tapTile([firstValid(burst)]);
    store().setHoverTile(null);
    expect(store().aim?.source).toBe('tap');
  });

  it('turn change clears selection and preview', () => {
    store().tapTile([firstValid(burst)]);
    store().endTurn();
    expect(store().selectedCardUid).toBeNull();
    expect(store().aim).toBeNull();
  });
});

describe('touch: movement and direct unit taps', () => {
  it('movement needs a second tap on the same destination', () => {
    start(['barrier']);
    const from = { ...hero().pos };
    const dest = engine().getLegalMoves()[0]!.pos;
    store().tapTile([dest]);
    expect(hero().pos).toEqual(from);
    expect(store().aim).toEqual({ pos: dest, source: 'tap' });
    store().tapTile([dest]);
    expect(hero().pos).toEqual(dest);
    expect(store().aim).toBeNull();
  });

  it('tapping an enemy body resolves its tile even when the finger is over the tile behind it', () => {
    const [missile] = start(['magic_missile']) as [string];
    unit(engine(), 'orc-1').pos = { x: 3, y: 2 };
    store().selectCard(missile);
    store().tapTile([{ x: 3, y: 1 }, { x: 3, y: 2 }]); // ground behind the head, then the orc's body
    expect(store().aim?.pos).toEqual({ x: 3, y: 2 });
    store().tapTile([{ x: 3, y: 1 }, { x: 3, y: 2 }]);
    expect(engine().state.player.hand.some((c) => c.uid === missile)).toBe(false);
  });

  it('tapping the hero body resolves a self-cast / ally target', () => {
    const [barrier] = start(['barrier']) as [string];
    store().selectCard(barrier);
    const behind = { x: hero().pos.x, y: hero().pos.y - 1 };
    store().tapTile([behind, hero().pos]);
    expect(store().aim?.pos).toEqual(hero().pos);
    store().tapTile([behind, hero().pos]);
    expect(hero().shield).toBeGreaterThan(0);
  });
});

describe('desktop: hover previews, click executes at once', () => {
  it('hover updates the shared aim and a click executes immediately', () => {
    const [burst] = start(['arcane_burst']) as [string];
    store().selectCard(burst);
    const a = firstValid(burst, 0);
    const b = firstValid(burst, 1);
    store().setHoverTile(a);
    expect(store().aim).toEqual({ pos: a, source: 'hover' });
    store().setHoverTile(b);
    expect(store().aim).toEqual({ pos: b, source: 'hover' });
    store().clickTile(b);
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(false);
    expect(store().selectedCardUid).toBeNull();
  });

  it('a hovered tile is never treated as an armed tap', () => {
    const [burst] = start(['arcane_burst']) as [string];
    store().selectCard(burst);
    const a = firstValid(burst);
    store().setHoverTile(a);
    store().tapTile([a]); // hybrid device: mouse hovered, then the finger taps the same tile
    expect(engine().state.player.hand.some((c) => c.uid === burst)).toBe(true);
    expect(store().aim?.source).toBe('tap');
  });
});

describe('shared targeting', () => {
  it('touch validity is exactly the engine targeting used by the desktop preview (5x7 and 6x9)', () => {
    const boards = [
      makeEngine(),
      makeEngine({ layout: Array.from({ length: 6 }, () => '.........'), enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 3, y: 2 } }] }),
    ];
    for (const e of boards) {
      for (const cardId of ['arcane_burst', 'magic_missile', 'fireball', 'blink', 'ice_wall']) {
        const [uid] = setHand(e, [cardId]) as [string];
        const valid = e.getValidTargets(uid);
        for (const p of allTiles(e)) {
          expect(isActionableTile(e, uid, p)).toBe(e.previewCard(uid, p).valid);
          if (isActionableTile(e, uid, p)) expect(valid.some((v) => samePos(v, p))).toBe(true);
        }
      }
      const moves = e.getLegalMoves();
      for (const p of allTiles(e))
        expect(isActionableTile(e, null, p)).toBe(moves.some((n) => samePos(n.pos, p)));
    }
  });

  it('tap decisions: aim, confirm on the same armed tile, clear off-board', () => {
    const a = { x: 1, y: 1 };
    expect(decideTap(null, a)).toEqual({ kind: 'aim', pos: a });
    expect(decideTap({ pos: a, source: 'tap' }, { x: 1, y: 1 })).toEqual({ kind: 'confirm', pos: a });
    expect(decideTap({ pos: a, source: 'hover' }, a)).toEqual({ kind: 'aim', pos: a });
    expect(decideTap({ pos: a, source: 'tap' }, { x: 2, y: 1 })).toEqual({ kind: 'aim', pos: { x: 2, y: 1 } });
    expect(decideTap({ pos: a, source: 'tap' }, null)).toEqual({ kind: 'clear' });
    expect(resolveTapTarget([a, { x: 2, y: 2 }], (p) => p.x === 2)).toEqual({ x: 2, y: 2 });
    expect(resolveTapTarget([a, { x: 2, y: 2 }], () => false)).toEqual(a);
    expect(resolveTapTarget([], () => true)).toBeNull();
  });
});
