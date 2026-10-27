import { expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  DEFAULT_CONTENT,
  DECK_RULES,
  GameEngine,
  createRun,
  createProfile,
  campaignBattleContent,
  currentEncounter,
  encounterOrder,
  replayBattle,
  verifyVictory,
} from '../src/game';
import { playBattle } from './support/bot';
import { readFileSync } from 'node:fs';

it('identifies the archived Worker as a historical catalog, before neutral Arcane Surge and 30-card starters', async () => {
  // This local artifact is not the currently deployed Worker. Its complete catalog is not
  // expected to equal today's after approved expansions, Multi-Deck and neutral-card changes.
  const path = new URL('../qa/campaign-bugfix/production-worker-before.js.txt', import.meta.url);
  const archived = (await import(
    /* @vite-ignore */ 'data:text/javascript;base64,' +
      Buffer.from(readFileSync(path, 'utf8').replace(/\/\/# sourceMappingURL=.*/g, '')).toString(
        'base64',
      )
  )) as { DEFAULT_CONTENT: typeof DEFAULT_CONTENT };
  expect(archived.DEFAULT_CONTENT.heroes.mage!.deck.reduce((n, e) => n + e.count, 0)).toBe(20);
  expect(DEFAULT_CONTENT.heroes.mage!.deck.reduce((n, e) => n + e.count, 0)).toBe(30);
  expect(archived.DEFAULT_CONTENT.cards.arcane_surge!.heroId).toBe('mage');
  const current = DEFAULT_CONTENT.cards.arcane_surge!;
  expect(current.heroId).toBeUndefined();
  // The approved reclassification did not change its cost, draw effect or targeting.
  expect(current.cost).toBe(1);
  expect(current.effects).toEqual([{ type: 'DRAW', count: 2 }]);
  expect(current.targeting).toEqual({ type: 'SELF' });
  for (const field of ['cost', 'effects', 'targeting'] as const)
    expect(current[field]).toEqual(archived.DEFAULT_CONTENT.cards.arcane_surge![field]);
});

it('the current authoritative verifier accepts encounter 3 objective victories and rejects incomplete or forged proofs', () => {
  // Client/Worker must use the same current rules/content, including hand limits and neutral
  // deck validation. Do not override gameplay with archived hand/deck rules to make this pass.
  const profile = createProfile(DEFAULT_CONTENT);
  const encounters = encounterOrder(ASCENT_CAMPAIGN);
  const run = {
    ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3, 'mage'),
    currentEncounterId: encounters[2]!.id,
    completedEncounterIds: encounters.slice(0, 2).map((e) => e.id),
  };
  const content = campaignBattleContent(DEFAULT_CONTENT, profile, run, DECK_RULES);
  const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
  expect(content.heroes.mage!.deck).toEqual(profile.heroes.mage!.decks[0]!.cards);
  let won = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const engine = new GameEngine(encounter, content, seed);
    playBattle(engine);
    if (engine.state.outcome?.result !== 'WON') continue;
    won++;
    const proof = JSON.parse(
      JSON.stringify({ encounterId: run.currentEncounterId, seed, commands: engine.history }),
    );
    const replay = replayBattle(encounter, content, seed, proof.commands);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(engine.state);
    expect(
      verifyVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, proof, DECK_RULES),
    ).toEqual({ ok: true });
    expect(
      verifyVictory(
        ASCENT_CAMPAIGN,
        DEFAULT_CONTENT,
        profile,
        run,
        { ...proof, commands: [] },
        DECK_RULES,
      ),
    ).toEqual({ ok: false, error: 'the battle was not won' });
    expect(
      verifyVictory(
        ASCENT_CAMPAIGN,
        DEFAULT_CONTENT,
        profile,
        run,
        { ...proof, encounterId: 'forged-encounter' },
        DECK_RULES,
      ),
    ).toEqual({ ok: false, error: 'not the current encounter' });
  }
  expect(won).toBeGreaterThan(0);
}, 60000);
