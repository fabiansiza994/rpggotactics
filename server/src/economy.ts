import { encounterOrder, PREMIUM_CURRENCY_ID, WORLD_CAMPAIGNS } from '../../src/game';
import {
  CAMPAIGN_CRYSTAL_MILESTONES,
  DAILY_FIRST_WIN_CRYSTALS,
} from '../../src/game/store/freeEconomy';
import type { D1Database, D1PreparedStatement } from './db';

export interface CrystalReward {
  transactionId: string;
  reason: 'DAILY_FIRST_WIN' | 'CAMPAIGN_MILESTONE';
  amount: number;
  referenceId: string;
}
/** Server clock only: the reward day is UTC. No client day, amount or claim endpoint. */
export const rewardDay = (now: number) => new Date(now).toISOString().slice(0, 10);
/** Called ONLY after replay verification; execute before the victory log in the SAME D1 batch. */
export function victoryCrystalStatements(
  db: D1Database,
  userId: number,
  now: number,
  victory: { heroId: string; campaignId: string; encounterId: string; skirmish?: boolean },
  newId: () => string,
): { statements: D1PreparedStatement[]; rewards: CrystalReward[] } {
  const rewards: CrystalReward[] = [
    {
      transactionId: newId(),
      reason: 'DAILY_FIRST_WIN',
      amount: DAILY_FIRST_WIN_CRYSTALS,
      referenceId: rewardDay(now),
    },
  ];
  const campaign = WORLD_CAMPAIGNS[victory.campaignId];
  const index = campaign ? encounterOrder(campaign).findIndex((e) => e.id === victory.encounterId) + 1 : 0;
  const milestone = CAMPAIGN_CRYSTAL_MILESTONES[victory.campaignId]?.[index];
  if (!victory.skirmish && campaign && milestone) {
    rewards.push({
      transactionId: newId(),
      reason: 'CAMPAIGN_MILESTONE',
      amount: milestone,
      referenceId: `${victory.heroId}:${victory.campaignId}:${victory.encounterId}`,
    });
  }
  const statements = rewards.map((reward) => {
    // Conditional INSERT handles concurrent different victories without rolling back the loser.
    // Historical verified clears suppress retroactive milestone payouts, including older runs.
    const history =
      reward.reason === 'CAMPAIGN_MILESTONE'
        ? ` AND NOT EXISTS (SELECT 1 FROM tactics_reward_log WHERE user_id = ? AND COALESCE(hero_id, 'mage') = ? AND campaign_id = ? AND encounter_id = ? AND event IN ('OFFERED','NO_DROP','CLAIMED'))`
        : '';
    return db
      .prepare(
        `INSERT INTO tactics_wallet_ledger (transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,note,created_at)
      SELECT ?,?,?,?,b,b+?,?,?,?,? FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id=? AND currency_id=?),0) AS b)
      WHERE NOT EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE user_id=? AND currency_id=? AND reason=? AND reference_id=?)${history}`,
      )
      .bind(
        reward.transactionId,
        userId,
        PREMIUM_CURRENCY_ID,
        reward.amount,
        reward.amount,
        reward.reason,
        reward.referenceId,
        reward.reason === 'DAILY_FIRST_WIN'
          ? 'Primera victoria del día (UTC)'
          : `Hito de ${campaign!.name}: ${index}`,
        now,
        userId,
        PREMIUM_CURRENCY_ID,
        userId,
        PREMIUM_CURRENCY_ID,
        reward.reason,
        reward.referenceId,
        ...(history ? [userId, victory.heroId, victory.campaignId, victory.encounterId] : []),
      );
  });
  return { statements, rewards };
}
export async function creditedRewards(db: D1Database, userId: number, rewards: CrystalReward[]) {
  const paid: CrystalReward[] = [];
  for (const r of rewards)
    if (
      await db
        .prepare('SELECT 1 FROM tactics_wallet_ledger WHERE user_id=? AND transaction_id=?')
        .bind(userId, r.transactionId)
        .first()
    )
      paid.push(r);
  return paid;
}
