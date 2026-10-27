import { describe, expect, it, vi } from 'vitest';
import { activateHandCard } from '../src/presentation/react/handInteraction';
import { explainCardBlock } from '../src/presentation/react/cardBlock';
import { withArcher } from '../src/game/data/archer';
import { DEFAULT_CONTENT } from '../src/game/data';
import { makeEngine, mutable, p, setHand } from './helpers';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleCardFeature } from '../src/presentation/react/components/BattleCardFeature';

describe('blocked hand inspection is separate from playing', () => {
  it.each(['focus', 'energy', 'target'] as const)('%s opens read-only inspection without dispatch or costs', (reason) => {
    const e = makeEngine({ hero: { heroId: 'archer', pos: p(0, 2) },
      enemies: [{ id: 'orc', enemyId: 'orc_warrior', pos: p(6, 2) }] }, withArcher(DEFAULT_CONTENT));
    const [uid] = setHand(e, [reason === 'focus' ? 'heart_shot' : 'archer_shot']);
    if (reason === 'energy') mutable(e).player.energy = 0;
    if (reason === 'target') mutable(e).units.find(u => u.id === 'orc')!.hp = 0;
    const block = explainCardBlock(e, e.state, uid!)!;
    expect(block).not.toBeNull();
    expect(block.code).toBe(reason === 'focus' ? 'NOT_ENOUGH_FOCUS' : reason === 'energy' ? 'NOT_ENOUGH_ENERGY' : 'NO_VALID_TARGET');
    if (reason === 'focus') {
      expect(block.detail).toContain('Requiere 3 de Concentración');
      expect(block.detail).toContain('Concentración: 0/3');
    }
    const before = JSON.stringify(e.state);
    const dispatch = vi.spyOn(e, 'dispatch');
    const actions = { inspect: vi.fn(), select: vi.fn(), cancel: vi.fn() };
    activateHandCard(uid!, block, actions);
    expect(actions.inspect).toHaveBeenCalledWith(uid);
    expect(actions.cancel).toHaveBeenCalledOnce();
    expect(actions.select).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(e.state)).toBe(before);
    const detail = renderToStaticMarkup(createElement(BattleCardFeature, {
      state: e.state, engine: e, selectedCardUid: null, inspectedCardUid: uid!,
    }));
    expect(detail).toContain('<dialog');
    expect(detail).toContain('NO DISPONIBLE AHORA');
    expect(detail).toContain(block.detail);
    expect(detail).toContain('Cerrar detalle');
  });

  it('playable cards retain the existing selector, including repeated taps', () => {
    const actions = { inspect: vi.fn(), select: vi.fn(), cancel: vi.fn() };
    activateHandCard('playable', undefined, actions);
    activateHandCard('playable', undefined, actions);
    expect(actions.select).toHaveBeenCalledTimes(2);
    expect(actions.inspect).not.toHaveBeenCalled();
    expect(actions.cancel).not.toHaveBeenCalled();
  });
});
