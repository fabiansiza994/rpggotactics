import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN, TEMPLE_ENCOUNTERS } from '../src/game/data/temple-encounters';
import { GameEngine } from '../src/game/engine/GameEngine';
import type { Command } from '../src/game/engine/commands';
import { replayBattle } from '../src/game/engine/replay';
import { encounterFor } from '../src/game/run/encounter';
import { LOOPS, playCombatRoute, ROUTES } from './support/act3-pilot';

/**
 * FULL VICTORIES with enemies on (Act III QA). A recorded victory is the exact command log of a
 * real battle — every enemy, wave, card and mechanism — played by the encounter's human route
 * (route step, then the regular combat bot for the rest of the turn; the Shapeshifter takes a form
 * first). The default run REPLAYS the recorded logs (milliseconds): they must still be legal and
 * still WIN under the current rules. Re-record after a rule/data change:
 *   ACT3_RECORD=1 npx vitest run tests/act3-victories.test.ts
 * which also writes the playtest table (qa/act3-completion/playtest.json).
 * The browser lab replays the same logs (qa/act3-interactive/victory-replay.ts).
 */
const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const FIXTURE = 'tests/fixtures/act3-victories.json';
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

interface Victory {
  encounterId: string;
  heroId: string;
  seed: number;
  rounds: number;
  commands: Command[];
}

const scenarioOf = (encounterId: string, heroId: string) => encounterFor(TEMPLE_CAMPAIGN, encounterId, heroId);

describe.runIf(process.env.ACT3_RECORD)('Act III — record victories + playtest table', () => {
  it('plays every encounter × champion × seed and stores the first win of each', () => {
    const victories: Victory[] = [];
    const table: Record<string, string> = {};
    for (const enc of TEMPLE_ENCOUNTERS)
      for (const heroId of TEMPLE_CAMPAIGN.heroIds) {
        let row = '';
        for (const seed of SEEDS) {
          const engine = new GameEngine(scenarioOf(enc.id, heroId), CONTENT, seed);
          const state = playCombatRoute(engine, ROUTES[enc.id]!, LOOPS[enc.id] ?? [], 30, 'bot');
          const won = state.outcome?.result === 'WON';
          row += won ? 'W' : state.outcome?.reason === 'ROUND_LIMIT_REACHED' ? 'T' : 'L';
          if (won && !victories.some((v) => v.encounterId === enc.id && v.heroId === heroId))
            victories.push({ encounterId: enc.id, heroId, seed, rounds: state.round, commands: JSON.parse(JSON.stringify(engine.history)) });
        }
        table[`${enc.id} ${heroId}`] = `${row} (${[...row].filter((c) => c === 'W').length}/${row.length})`;
      }
    if (!existsSync('tests/fixtures')) mkdirSync('tests/fixtures');
    writeFileSync(FIXTURE, JSON.stringify(victories));
    if (!existsSync('qa/act3-completion')) mkdirSync('qa/act3-completion');
    writeFileSync('qa/act3-completion/playtest.json', JSON.stringify(table, null, 1));
    expect(victories.length).toBeGreaterThan(0);
  }, 900000);
});

describe('Act III — recorded full victories replay and still win', () => {
  const victories: Victory[] = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : [];

  it('has a real victory for Mage, Summoner and Warrior in every encounter XXI–XXX', () => {
    for (const enc of TEMPLE_ENCOUNTERS)
      for (const heroId of ['mage', 'summoner', 'warrior'])
        expect(victories.some((v) => v.encounterId === enc.id && v.heroId === heroId), `${enc.id} ${heroId}`).toBe(true);
  });

  it('every recorded log replays (no rejected command) and ends WON', () => {
    for (const v of victories) {
      const { state, rejectedAt } = replayBattle(scenarioOf(v.encounterId, v.heroId), CONTENT, v.seed, v.commands);
      expect(rejectedAt, `${v.encounterId} ${v.heroId}`).toBeNull();
      expect(state.outcome, `${v.encounterId} ${v.heroId}`).toMatchObject({ result: 'WON' });
    }
  });

  it('XXIII victories end on a MANUAL relic pickup: the chamber opening alone never wins', () => {
    for (const v of victories.filter((x) => x.encounterId === 'w3_e03')) {
      const last = v.commands.at(-1)!;
      expect(last, v.heroId).toEqual({ type: 'INTERACT', mechanismId: 'relic' });
      const before = replayBattle(scenarioOf(v.encounterId, v.heroId), CONTENT, v.seed, v.commands.slice(0, -1)).state;
      expect(before.outcome, v.heroId).toBeNull();
      expect(before.mechanisms!.objects.find((o) => o.def.id === 'gate')!.state).toBe('OPEN');
    }
  });

  it('XXVI victories end on ASEGURAR at the entrance, after the relic was carried home', () => {
    for (const v of victories.filter((x) => x.encounterId === 'w3_e06')) {
      expect(v.commands.at(-1), v.heroId).toEqual({ type: 'INTERACT', mechanismId: 'relic' });
      const before = replayBattle(scenarioOf(v.encounterId, v.heroId), CONTENT, v.seed, v.commands.slice(0, -1)).state;
      expect(before.mechanisms!.objects.find((o) => o.def.id === 'relic')!.state, v.heroId).toBe('CARRIED');
    }
  });
});
