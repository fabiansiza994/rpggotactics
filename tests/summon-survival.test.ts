import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, replayBattle } from '../src/game';
import { spawnSummon, summonUsage } from '../src/game/domain/summons/summons';
import { dealDamage } from '../src/game/domain/combat/damage';
import { makeEngine, mutable, ctxFor, p, setHand, scenario } from './helpers';

const setup = (id: string) => {
  const e = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } });
  const u = spawnSummon(ctxFor(e), mutable(e).units[0]!, id, p(1, 2))!;
  return { e, u };
};
describe('persistent summon survival versus real enemy damage', () => {
  it.each([
    ['chicken', 1, 1],
    ['fox', 4, 3],
    ['raven', 3, 2],
    ['wolf', 5, 4],
    ['turtle', 8, 6],
  ] as const)('%s takes %i orc / %i shadow wolf hits to defeat', (id, orcHits, wolfHits) => {
    for (const [enemy, hits] of [
      ['orc_warrior', orcHits],
      ['shadow_wolf', wolfHits],
    ] as const) {
      const { e, u } = setup(id);
      const damage = DEFAULT_CONTENT.enemies[enemy]!.behavior.damage;
      for (let i = 1; i < hits; i++) {
        expect(dealDamage(ctxFor(e), u, damage, enemy, 'PHYSICAL').defeated).toBe(false);
        expect(summonUsage(e.state, e.heroId)).toBe(u.summon!.capacityCost);
      }
      expect(dealDamage(ctxFor(e), u, damage, enemy, 'PHYSICAL').defeated).toBe(true);
      expect(summonUsage(e.state, e.heroId)).toBe(0);
    }
  });

  it.each(['fox', 'raven', 'wolf', 'turtle'])(
    '%s healing buys another orc exchange and shield absorbs the next hit',
    (id) => {
      const { e, u } = setup(id);
      const damage = DEFAULT_CONTENT.enemies.orc_warrior!.behavior.damage;
      while (u.hp > damage - u.armor) dealDamage(ctxFor(e), u, damage, 'orc', 'PHYSICAL');
      const [heal] = setHand(e, ['nurture']);
      expect(e.dispatch({ type: 'PLAY_CARD', cardUid: heal!, target: u.pos }).ok).toBe(true);
      expect(dealDamage(ctxFor(e), u, damage, 'orc', 'PHYSICAL').defeated).toBe(false);
      const hp = u.hp;
      const [shield] = setHand(e, ['familiar_aegis']);
      expect(e.dispatch({ type: 'PLAY_CARD', cardUid: shield!, target: u.pos }).ok).toBe(true);
      dealDamage(ctxFor(e), u, damage, 'orc', 'PHYSICAL');
      expect(u.hp).toBe(hp);
    },
  );

  it.each(['chicken', 'fox', 'raven', 'wolf', 'turtle'])(
    '%s persists across 12 rounds and replay; death and recall free capacity',
    (id) => {
      const content = { ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes } };
      content.heroes.summoner = {
        ...content.heroes.summoner!,
        startingHandSize: 1,
        drawPerTurn: 0,
        deck: [{ cardId: `summon_${id}`, count: 1 }],
      };
      const encounter = scenario({
        hero: { heroId: 'summoner', pos: p(0, 2) },
        enemies: [],
        objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 30 }],
      });
      const e = new GameEngine(encounter, content, 42);
      const commands = [
        { type: 'PLAY_CARD', cardUid: e.state.player.hand[0]!.uid, target: p(1, 2) } as const,
        ...Array.from({ length: 12 }, () => ({ type: 'END_TURN' }) as const),
      ];
      for (const c of commands) expect(e.dispatch(c).ok).toBe(true);
      expect(e.state.units.filter((u) => u.kind === 'SUMMON')).toHaveLength(1);
      const replay = replayBattle(encounter, content, 42, commands);
      expect(replay.rejectedAt).toBeNull();
      expect(replay.state).toEqual(e.state);
      const u = mutable(e).units.find((u) => u.kind === 'SUMMON')!;
      const [recall] = setHand(e, ['recall_familiar']);
      expect(e.dispatch({ type: 'PLAY_CARD', cardUid: recall!, target: u.pos }).ok).toBe(true);
      expect(summonUsage(e.state, e.heroId)).toBe(0);
    },
  );
});
