import type { Env } from './db';

/** Champions behind a release switch. Every other champion in the content is always available. */
export const WARRIOR_ID = 'warrior';

/**
 * The Warrior stays QA-only until gameplay and final art pass review: WARRIOR_ENABLED="1"
 * releases it; WARRIOR_QA="1" opens it to the two QA accounts only. Identity comes from the
 * authenticated session, never from request data.
 */
export function warriorAllowed(env: Env, username: string): boolean {
  return env.WARRIOR_ENABLED === '1' || (env.WARRIOR_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username));
}

export const championAllowed = (heroId: unknown, env: Env, username: string): boolean =>
  (heroId !== 'archer' || archerAllowed(env, username)) && (heroId !== 'shapeshifter' || shapeshifterAllowed(env, username)) && (heroId !== WARRIOR_ID || warriorAllowed(env, username));

export const shapeshifterAllowed = (env: Env, username: string): boolean => env.SHAPESHIFTER_ENABLED === '1' || (env.SHAPESHIFTER_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username));

export const archerAllowed = (env: Env, username: string): boolean => env.ARCHER_ENABLED === '1' || (env.ARCHER_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username));
