import {
  currentEncounter,
  runContent,
  parseRunSave,
  serializeRun,
  type RunState,
} from '../../../game';
import { campaignForRun, WORLD_CAMPAIGNS } from './campaigns';
import {
  SCENARIOS_BY_ID,
  type GameContent,
  type GameEngine,
  type ScenarioDef,
} from '../../../game';
import { parseCommand } from '../../../game/run/verify';
import type { OpeningPolicy } from './session';
import {
  createShapeshifterBattle,
  SHAPESHIFTER_OPENING_VERSION,
} from '../../../game/qa/shapeshifter-battle';
import { DEFAULT_CONTENT } from '../../../game';
import { PRESENTATION_CONTENT, realFlow2eContent } from './runtime';
import { shapeshifterQaEnabled } from './access';
const SAVE = 'shapeshifter-2e:battle:v1';
const OPENING = 'shapeshifter-2e:opening';
const runs = new WeakMap<GameEngine, RunState>();
export const qaBattleRun = (engine: GameEngine) => runs.get(engine);
export function bindQaCampaign(engine: GameEngine, run: RunState): GameEngine {
  runs.set(engine, structuredClone(run));
  return engine;
}
export function qaBattleMatches(engine: GameEngine, run: RunState): boolean {
  const saved = runs.get(engine);
  return !!saved && JSON.stringify(saved) === JSON.stringify(run);
}
const modes = new WeakMap<GameEngine, OpeningPolicy>();
const revisions = new WeakMap<GameEngine, '2e' | '3'>();
export function qaOpening(): OpeningPolicy {
  try {
    return localStorage.getItem(OPENING) === 'normal' ? 'normal' : 'guaranteed';
  } catch {
    return 'guaranteed';
  }
}
export function setQaOpening(opening: OpeningPolicy): void {
  if (shapeshifterQaEnabled)
    try {
      localStorage.setItem(OPENING, opening);
    } catch {
      /* optional preference */
    }
}
export function qaDepthRules(): GameContent['qaCombatDepth'] | false {
  if (!shapeshifterQaEnabled) return false;
  let preference: string | null = null;
  try {
    preference = localStorage.getItem('shapeshifter:combat-depth');
  } catch {
    /* optional preference */
  }
  return preference === 'off'
    ? false
    : {
        version: 1,
        backstab: true,
        formCounter: preference === 'oncePerRound' ? 'oncePerRound' : 'perHit',
      };
}
export function setQaDepth(mode: 'off' | 'perHit' | 'oncePerRound'): void {
  if (shapeshifterQaEnabled)
    try {
      localStorage.setItem('shapeshifter:combat-depth', mode);
    } catch {
      /* optional preference */
    }
}
export function realQaEngine(
  scenario: ScenarioDef,
  content: GameContent,
  seed: number,
  opening = qaOpening(),
  depth: GameContent['qaCombatDepth'] | false = false,
): GameEngine {
  if (!shapeshifterQaEnabled || scenario.hero.heroId !== 'shapeshifter')
    throw Error('Campeón privado QA');
  const engine = createShapeshifterBattle(
    scenario,
    depth ? { ...content, qaCombatDepth: depth } : content,
    seed,
    opening,
  );
  revisions.set(engine, '3');
  modes.set(engine, opening);
  return engine;
}
export function encodeRealQaBattle(engine: GameEngine): string {
  return JSON.stringify({
    version: 4,
    depth: engine.content.qaCombatDepth ?? null,
    run: runs.get(engine),
    contentRevision: revisions.get(engine) ?? '3',
    openingVersion: SHAPESHIFTER_OPENING_VERSION,
    scenarioId: engine.scenario.id,
    seed: engine.seed,
    deck: engine.content.heroes.shapeshifter!.deck,
    opening: modes.get(engine) ?? 'normal',
    commands: engine.history,
  });
}
export function decodeRealQaBattle(raw: string): GameEngine {
  if (!shapeshifterQaEnabled) throw Error('Solo QA local');
  const data = JSON.parse(raw);
  const run: RunState | undefined = data.version >= 3 ? data.run : undefined;
  if (
    run &&
    (run.heroId !== 'shapeshifter' ||
      run.status !== 'IN_BATTLE' ||
      !WORLD_CAMPAIGNS[run.campaignId] ||
      !Number.isInteger(run.maxHpBonus) ||
      run.maxHpBonus < 0)
  )
    throw Error('Campaña QA inválida');
  const base = run ? currentEncounter(campaignForRun(run), run) : SCENARIOS_BY_ID[data.scenarioId];
  if (
    ![1, 2, 3, 4].includes(data.version) ||
    (data.version >= 2 &&
      (data.openingVersion !== SHAPESHIFTER_OPENING_VERSION ||
        !['2e', '3'].includes(data.contentRevision))) ||
    !base ||
    !Number.isInteger(data.seed) ||
    data.seed < 0 ||
    data.seed > 0xffffffff ||
    !['normal', 'guaranteed'].includes(data.opening) ||
    !Array.isArray(data.commands) ||
    data.commands.length > 2000
  )
    throw Error('Replay QA inválido');
  // Validate the pinned deck through the same normal deck validator before reconstruction.
  const revision = data.version === 1 ? '2e' : data.contentRevision;
  const restoredContent =
    revision === '2e' ? realFlow2eContent(DEFAULT_CONTENT) : PRESENTATION_CONTENT;
  if (run && parseRunSave(serializeRun(run), campaignForRun(run), restoredContent).status !== 'OK')
    throw Error('Progreso QA inválido');
  if (base.id !== data.scenarioId) throw Error('Encuentro QA inválido');
  const profile = createProfile(restoredContent);
  const issues = validateDeck(
    data.deck,
    'shapeshifter',
    ownedFor(profile, 'shapeshifter', restoredContent),
    restoredContent,
    DECK_RULES,
  );
  if (issues.length) throw Error('Mazo QA inválido');
  const pinned = withHeroDeck(restoredContent, 'shapeshifter', data.deck);
  const content = run ? runContent(pinned, run) : pinned;
  const depth = data.version === 4 ? data.depth : null;
  if (
    depth &&
    (depth.version !== 1 ||
      typeof depth.backstab !== 'boolean' ||
      !['perHit', 'oncePerRound'].includes(depth.formCounter))
  )
    throw Error('Reglas QA desconocidas');
  const engine = realQaEngine(
    { ...base, hero: { ...base.hero, heroId: 'shapeshifter' } },
    content,
    data.seed,
    data.opening,
    depth ?? false,
  );
  revisions.set(engine, revision);
  if (run) bindQaCampaign(engine, run);
  for (const value of data.commands) {
    const command = parseCommand(value);
    if (!command || !engine.dispatch(command).ok) throw Error('Replay QA rechazado');
  }
  return engine;
}
import { createProfile, validateDeck, ownedFor, DECK_RULES, withHeroDeck } from '../../../game';
export function persistRealQaBattle(engine: GameEngine): void {
  if (!shapeshifterQaEnabled || engine.scenario.hero.heroId !== 'shapeshifter') return;
  try {
    localStorage.setItem(SAVE, encodeRealQaBattle(engine));
  } catch {
    /* keep live battle */
  }
}
export function loadRealQaBattle(): GameEngine | null {
  if (!shapeshifterQaEnabled) return null;
  try {
    const raw = localStorage.getItem(SAVE);
    return raw ? decodeRealQaBattle(raw) : null;
  } catch {
    return null;
  }
}
