import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN, TEMPLE_ENCOUNTERS } from '../src/game/data/temple-encounters';
import { GameEngine } from '../src/game/engine/GameEngine';
import { encounterFor } from '../src/game/run/encounter';
import { KEY_MECHANISM, pilotWithBot, ROUTES, type PilotResult } from './support/act3-pilot';

/**
 * Light playtest under real enemy pressure: the human-written route + best-damage card play, every
 * champion, 6 seeds. Asserts the puzzle unlocks under pressure; win rate is a signal, not a bar.
 * Writes qa/act3-interactive/playtest.json when ACT3_PLAYTEST_OUT=1.
 */
const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const SEEDS = [1, 2, 3, 4, 5, 6];
/** Phase 1 encounters (phase 2 is played by tests/act3-victories.test.ts). */
const PHASE_1 = TEMPLE_ENCOUNTERS.filter((e) => KEY_MECHANISM[e.id]);

describe('Act III playtest (route pilot, enemies on)', () => {
  it('every champion unlocks XXI–XXIII under enemy pressure (bot win rate reported, not asserted)', () => {
    const rows: (PilotResult & { encounter: string; heroId: string; seed: number })[] = [];
    for (const enc of PHASE_1)
      for (const heroId of TEMPLE_CAMPAIGN.heroIds)
        for (const seed of SEEDS) {
          const engine = new GameEngine(encounterFor(TEMPLE_CAMPAIGN, enc.id, heroId), CONTENT, seed);
          rows.push({ encounter: enc.id, heroId, seed, ...pilotWithBot(engine, ROUTES[enc.id]!, 16, KEY_MECHANISM[enc.id]) });
        }
    if (process.env.ACT3_PLAYTEST_OUT) writeFileSync('qa/act3-interactive/playtest.json', JSON.stringify(rows, null, 1));
    const summary: Record<string, string> = {};
    for (const enc of PHASE_1)
      for (const heroId of TEMPLE_CAMPAIGN.heroIds) {
        const mine = rows.filter((r) => r.encounter === enc.id && r.heroId === heroId);
        const unlocked = mine.filter((r) => r.unlockedRound !== null);
        const won = mine.filter((r) => r.result === 'WON').length;
        const avg = unlocked.length ? (unlocked.reduce((n, r) => n + r.unlockedRound!, 0) / unlocked.length).toFixed(1) : '-';
        summary[`${enc.id} ${heroId}`] = `unlock ${unlocked.length}/${mine.length} (avg r${avg}) · bot win ${won}/${mine.length}`;
        // The Shapeshifter is excluded from the bar: the greedy bot cannot pilot its forms (it
        // also loses Act I «ascent_01» 4/4). Its puzzle solvability is proven by the known routes.
        if (heroId !== 'shapeshifter') expect(unlocked.length, `${enc.id} ${heroId} unlocks under pressure`).toBeGreaterThanOrEqual(4);
      }
    if (process.env.ACT3_PLAYTEST_OUT) writeFileSync('qa/act3-interactive/playtest-summary.json', JSON.stringify(summary, null, 1));
  }, 60000);
});
