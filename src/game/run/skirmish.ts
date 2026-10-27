import { SCENARIOS_BY_ID } from '../data/scenarios';
import type { CampaignDef } from './encounter';
import type { RunState } from './run';

/** One battle's progression adapter. This never joins or replaces the Mage campaign. */
export function skirmishRewardContext(scenarioId: string, heroId: string): CampaignDef {
  const base = SCENARIOS_BY_ID[scenarioId];
  if (!base || heroId !== 'summoner') throw new Error('Unsupported reward skirmish');
  // Authored tiers; the client cannot request a better pool for an easier battle.
  const tier =
    scenarioId === 'escape' ? 'BOSS' : scenarioId === 'crystal_guard' ? 'ELITE' : 'NORMAL';
  return {
    id: 'skirmish',
    name: 'Escaramuza',
    heroIds: [heroId],
    start: base.id,
    encounters: [
      {
        ...base,
        hero: { ...base.hero, heroId },
        // Higher reward tiers have authored elite/boss threats, not just richer drops.
        enemies: base.enemies.map((enemy) => ({
          ...enemy,
          enemyId:
            scenarioId === 'crystal_guard' && enemy.enemyId === 'dark_shaman'
              ? 'shaman_elder'
              : scenarioId === 'escape' && enemy.enemyId === 'stone_brute'
                ? 'stone_colossus'
                : enemy.enemyId,
        })),
        tier,
        board: { rows: base.layout.length, columns: base.layout[0]!.length },
        focus: base.description,
        rewards: { pool: tier, choices: 3, favorTags: ['summon', 'support'] },
        next: null,
      },
    ],
  };
}
export const rewardContextFor = (run: RunState) =>
  skirmishRewardContext(run.currentEncounterId, run.heroId);
