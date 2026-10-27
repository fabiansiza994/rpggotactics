import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { replayBattle } from '../src/game/engine/replay';
import { encounterFor } from '../src/game/run/encounter';
import type { Command } from '../src/game/engine/commands';
import type { GameState } from '../src/game/domain/state';
const C = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
type V = { encounterId: string; heroId: string; seed: number; commands: Command[] };
/**
 * Opt-in (ACT3_RECORD=1, after the victories are recorded): writes the browser QA cases replayed by
 * qa/act3-interactive/victory-replay.mjs — full victories plus key mid-states (platform called,
 * champion rode across, Guardian exposed, relic carried, ASEGURAR at the entrance).
 */
describe.runIf(process.env.ACT3_RECORD)('Act III — browser QA cases', () => it('cases', () => {
  const vs: V[] = JSON.parse(readFileSync('tests/fixtures/act3-victories.json', 'utf8'));
  const get = (e: string, h: string) => vs.find((v) => v.encounterId === e && v.heroId === h)!;
  const firstWhere = (v: V, pred: (s: GameState) => boolean) => {
    for (let i = 1; i <= v.commands.length; i++) if (pred(replayBattle(encounterFor(TEMPLE_CAMPAIGN, v.encounterId, v.heroId), C, v.seed, v.commands.slice(0, i)).state)) return i;
    return v.commands.length;
  };
  const mech = (s: GameState, id: string) => s.mechanisms!.objects.find((o) => o.def.id === id)!;
  const cases: { name: string; hero: string; encounter: string; seed: number; commands: Command[]; expect: string; click?: string }[] = [];
  const full = (name: string, e: string, h: string) => { const v = get(e, h); cases.push({ name, hero: h, encounter: e, seed: v.seed, commands: v.commands, expect: 'WON' }); };
  full('xxi-mage-victory', 'w3_e01', 'mage');
  full('xxii-summoner-victory', 'w3_e02', 'summoner');
  full('xxiii-warrior-victory', 'w3_e03', 'warrior');
  full('xxi-shapeshifter-victory', 'w3_e01', 'shapeshifter');
  full('xxi-archer-victory', 'w3_e01', 'archer');
  // XXIII manual relic: everything but the last command, then the UI button does the pickup.
  { const v = get('w3_e03', 'mage'); cases.push({ name: 'xxiii-mage-relic-manual', hero: 'mage', encounter: 'w3_e03', seed: v.seed, commands: v.commands.slice(0, -1), expect: 'WON', click: 'RECOGER' }); }
  full('xxiv-mage-victory', 'w3_e04', 'mage');
  full('xxv-warrior-victory', 'w3_e05', 'warrior');
  full('xxvi-warrior-victory', 'w3_e06', 'warrior');
  { const v = get('w3_e04', 'warrior'); const i = firstWhere(v, (s) => mech(s, 'platform-a').stop === 'near'); cases.push({ name: 'xxiv-platform-called', hero: 'warrior', encounter: 'w3_e04', seed: v.seed, commands: v.commands.slice(0, i), expect: '' }); }
  { const v = get('w3_e04', 'warrior'); const i = firstWhere(v, (s) => mech(s, 'platform-a').stop === 'far' && s.units.some((u) => u.kind === 'HERO' && u.pos.x === 5 && u.pos.y === 4)); cases.push({ name: 'xxiv-champion-rode-across', hero: 'warrior', encounter: 'w3_e04', seed: v.seed, commands: v.commands.slice(0, i), expect: '' }); }
  { const v = get('w3_e05', 'warrior'); const i = firstWhere(v, (s) => !!s.mechanisms!.exposed && Object.values(s.mechanisms!.exposed).some((r) => r >= s.round)); cases.push({ name: 'xxv-guardian-exposed', hero: 'warrior', encounter: 'w3_e05', seed: v.seed, commands: v.commands.slice(0, i), expect: '' }); cases.push({ name: 'xxv-guardian-fortified', hero: 'warrior', encounter: 'w3_e05', seed: v.seed, commands: [], expect: '' }); }
  { const v = get('w3_e06', 'warrior'); const i = firstWhere(v, (s) => mech(s, 'relic').state === 'CARRIED'); cases.push({ name: 'xxvi-relic-carried', hero: 'warrior', encounter: 'w3_e06', seed: v.seed, commands: v.commands.slice(0, i), expect: '' }); const j = firstWhere(v, (s) => mech(s, 'relic').state === 'CARRIED' && s.units.some((u) => u.kind === 'HERO' && u.pos.x === 0)); cases.push({ name: 'xxvi-at-extraction-asegurar', hero: 'warrior', encounter: 'w3_e06', seed: v.seed, commands: v.commands.slice(0, j), expect: '' }); }
  writeFileSync('qa/act3-interactive/browser-cases.json', JSON.stringify(cases));
}, 300000));
