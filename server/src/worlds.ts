import {
  ARCHER_CAMPAIGN_FLAG,
  ASCENT_CAMPAIGN,
  WORLD_2_FLAG,
  WORLD_3_FLAG,
  worldContext,
  worldsView,
  totalProgress,
  type ChampionRuns,
  type WorldContext,
  type WorldView,
} from '../../src/game';
import type { Env } from './db';
import type { PlayerRecord } from './repo';
import { archerAllowed } from './warriorRelease';

/**
 * World 2 stays hidden until its visual pass: WORLD_2_ENABLED="1" releases it to everyone;
 * WORLD_2_QA="1" opens it to the two QA accounts only. Identity comes from the authenticated
 * session, never from request data. A hidden world cannot be started, won or claimed.
 */
export function world2Allowed(env: Env, username: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  return env.WORLD_2_ENABLED === '1' || (env.WORLD_2_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username));
}

/**
 * The Archer campaign «Sendero del Cazador» stays hidden until its visual pass:
 * ARCHER_CAMPAIGN_ENABLED="1" releases it, ARCHER_CAMPAIGN_QA="1" opens it to the QA accounts
 * only. Either way the Archer itself must be released to the account.
 */
export function archerCampaignAllowed(env: Env, username: string, override?: boolean): boolean {
  if (override !== undefined) return override && archerAllowed(env, username);
  return archerAllowed(env, username) &&
    (env.ARCHER_CAMPAIGN_ENABLED === '1' || (env.ARCHER_CAMPAIGN_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username)));
}

/**
 * World 3 «El Templo del Umbral» (Act III) stays hidden until its visual pass: WORLD_3_ENABLED="1"
 * releases it, WORLD_3_QA="1" opens it to the QA accounts only. Needs a Worker that knows INTERACT.
 */
export function world3Allowed(env: Env, username: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  return env.WORLD_3_ENABLED === '1' || (env.WORLD_3_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username));
}

export const worldsFor = (env: Env, username: string, override?: boolean, archerOverride?: boolean, world3Override?: boolean): WorldContext =>
  worldContext((flag) =>
    flag === WORLD_2_FLAG
      ? world2Allowed(env, username, override)
      : flag === WORLD_3_FLAG
        ? world3Allowed(env, username, world3Override)
        : flag === ARCHER_CAMPAIGN_FLAG && archerCampaignAllowed(env, username, archerOverride),
  );

/** One champion's runs in every world campaign (World 1 = `runs`, the others = `worldRuns`). */
export function championRuns(record: PlayerRecord, heroId: string): ChampionRuns {
  const out: Record<string, PlayerRecord['run']> = { [ASCENT_CAMPAIGN.id]: record.runs[heroId] ?? null };
  for (const [campaignId, byHero] of Object.entries(record.worldRuns)) out[campaignId] = byHero[heroId] ?? null;
  return out;
}

/** Frontend contract: per champion, the released worlds with unlock/progress, plus totals. */
export function worldsBody(record: PlayerRecord, ctx: WorldContext, heroIds: readonly string[]) {
  const byHero: Record<string, { worlds: WorldView[]; total: ReturnType<typeof totalProgress> }> = {};
  for (const heroId of heroIds) {
    const worlds = worldsView(ctx, championRuns(record, heroId), record.worldHistory[heroId] ?? {}, heroId);
    byHero[heroId] = { worlds, total: totalProgress(worlds) };
  }
  return byHero;
}
