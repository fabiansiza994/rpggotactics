import { describe, expect, it } from 'vitest';
import { makeEngine, mutable, p, setHand, unit } from './helpers';
import type { GameEvent } from '../src/game/domain/events';

describe('Twisted Curse cancels the original effect', () => {
  for (const cardId of ['fireball', 'light_divine_inspiration', 'dark_the_reaper']) it(cardId, () => {
    const e = makeEngine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] }); const s = mutable(e); s.player.energy = 5;
    const [uid] = setHand(e, [cardId]); s.player.hand[0]!.twistedCurse = true;
    const caster = unit(e, e.heroId), hp = caster.hp;
    const deckBefore = JSON.stringify(s.player.deck), target = unit(e, 'orc-1'), enemyHp = target.hp;
    const events: GameEvent[] = [];
    e.subscribe(batch => events.push(...batch));
    const result = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: cardId === 'fireball' ? target.pos : cardId === 'dark_the_reaper' ? p(1, 2) : null });
    expect(result.ok).toBe(true);
    expect(unit(e, e.heroId).hp).toBe(hp - 5);
    expect(unit(e, 'orc-1').hp).toBe(enemyHp);
    expect(JSON.stringify(e.state.player.deck)).toBe(deckBefore);
    expect(e.state.units.some(u => u.defId === 'dark_the_reaper')).toBe(false);
    expect(events.some(event => event.type === 'CARD_PLAYED')).toBe(false);
    expect(events.filter(event => event.type === 'CARD_CURSE_TRIGGERED')).toHaveLength(1);
    expect(e.state.player.discard.find(card => card.uid === uid)?.twistedCurse).toBeUndefined();
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
  });
});
