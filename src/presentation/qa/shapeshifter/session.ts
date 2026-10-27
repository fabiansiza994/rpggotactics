import {
  DEFAULT_CONTENT,
  DECK_RULES,
  GameEngine,
  createProfile,
  saveActiveDeck,
  serializeProfile,
  parseProfileSave,
  withHeroDeck,
  type GameContent,
  type ScenarioDef,
  type DeckEntry,
  type PlayerProfile,
} from '../../../game';
import { withShapeshifter2dQa } from '../../../game/data/shapeshifter-2d-qa';
import { createDrawPile } from '../../../game/domain/cards/deck';
import { parseCommand } from '../../../game/run/verify';
import {
  withShapeshifterQa,
  SHAPESHIFTER_QA_ID as ID,
  SHAPESHIFTER_QA_SCENARIO as SCENARIO,
} from '../../../game/data/shapeshifter-qa';
export const QA_CONTENT = withShapeshifter2dQa(DEFAULT_CONTENT);
export type OpeningPolicy = 'normal' | 'guaranteed';
type Revision = '2a' | '2d';
const metadata = new WeakMap<GameEngine, { opening: OpeningPolicy; revision: Revision }>();
/** Explicit local-lab setup rule. No seed search, RNG calls, extra draw or global rule change. */
export function createQaEngine(
  content: GameContent,
  deck: readonly DeckEntry[],
  seed: number,
  opening: OpeningPolicy,
  revision: Revision = '2d',
  scenario: ScenarioDef = SCENARIO,
): GameEngine {
  const configured = withHeroDeck(content, ID, deck);
  let engine = new GameEngine(scenario, configured, seed);
  const isTransform = (id: string) =>
    configured.cards[id]!.effects.some((e) => e.type === 'TRANSFORM');
  if (opening === 'guaranteed' && !engine.state.player.hand.some((c) => isTransform(c.cardId))) {
    const state = structuredClone(engine.state);
    const index = state.player.deck.findIndex((c) => isTransform(c.cardId));
    if (index < 0) throw Error('QA: el mazo no contiene transformación.');
    const handIndex = state.player.hand.length - 1;
    if (handIndex < 0) throw Error('QA: apertura vacía.');
    [state.player.hand[handIndex], state.player.deck[index]] = [
      state.player.deck[index]!,
      state.player.hand[handIndex]!,
    ];
    const events = engine.initialEvents;
    engine = GameEngine.fromSnapshot(state, configured, { ...scenario, defaultSeed: seed });
    let drawn = 0;
    engine.initialEvents = events.map(event => {
      if (event.type !== 'CARD_DRAWN') return event;
      const card = state.player.hand[drawn++];
      return card ? {...event, cardUid: card.uid, cardId: card.cardId} : event;
    });
  }
  metadata.set(engine, { opening, revision });
  return engine;
}
export const QA_STORAGE_KEY = 'rpg-go-tactics:shapeshifter-private-qa:v1';
export function saveQaDeck(profile: PlayerProfile, deck: readonly DeckEntry[]) {
  const saved = saveActiveDeck(profile, ID, deck, QA_CONTENT, DECK_RULES);
  if (!saved.ok) throw Error(saved.issues.map((i) => i.code).join(', '));
  for (const id of ['qa_bear_form', 'qa_minotaur_form'])
    if (!deck.some((e) => e.cardId === id && e.count > 0))
      throw Error('QA: incluye al menos una copia de cada transformación.');
  return saved.profile;
}
/** Legacy 2A/2C fixture helper only. The 2D lab never calls this seed search. */
export function openingSeed(deck: readonly DeckEntry[], requested = 42): number {
  for (let n = 0; n < 256; n++) {
    const seed = (requested + n) >>> 0;
    let uid = 0;
    const opening = createDrawPile({ rngState: seed }, deck, () => String(uid++)).slice(0, 5);
    if (['qa_bear_form', 'qa_minotaur_form'].every((id) => opening.some((c) => c.cardId === id)))
      return seed;
  }
  throw Error(
    'QA: no se encontró apertura consistente en 256 semillas; aumenta copias de transformación.',
  );
}
export function startQaBattle(
  profile: PlayerProfile,
  deck: readonly DeckEntry[],
  seed = 42,
  opening: OpeningPolicy = 'guaranteed',
) {
  saveQaDeck(profile, deck);
  return createQaEngine(QA_CONTENT, deck, seed, opening);
}
export function serializeQa(profile: PlayerProfile, engine: GameEngine | null) {
  return JSON.stringify({
    version: 2,
    profile: serializeProfile(profile),
    battle: engine
      ? {
          seed: engine.seed,
          deck: engine.content.heroes[ID]!.deck,
          commands: engine.history,
          ...(metadata.get(engine) ?? { opening: 'normal', revision: '2a' }),
        }
      : null,
  });
}
export function restoreQa(raw: string | null): {
  profile: PlayerProfile;
  engine: GameEngine | null;
} {
  if (!raw) return { profile: createProfile(QA_CONTENT), engine: null };
  const data = JSON.parse(raw);
  if (data.version !== 1 && data.version !== 2) throw Error('Versión QA desconocida');
  const profile = parseProfileSave(data.profile, QA_CONTENT);
  if (profile.status !== 'OK') throw Error('Perfil QA inválido');
  let engine: GameEngine | null = null;
  if (data.battle) {
    const b = data.battle;
    if (
      !Number.isInteger(b.seed) ||
      b.seed < 0 ||
      b.seed > 0xffffffff ||
      !Array.isArray(b.commands) ||
      b.commands.length > 2000
    )
      throw Error('Replay QA inválido');
    saveQaDeck(profile.profile, b.deck);
    const commands = b.commands.map((c: unknown) => {
      const parsed = parseCommand(c);
      if (!parsed) throw Error('Comando QA inválido');
      return parsed;
    });
    const revision: Revision = data.version === 1 ? '2a' : b.revision;
    const opening: OpeningPolicy = data.version === 1 ? 'normal' : b.opening;
    if (!['2a', '2d'].includes(revision) || !['normal', 'guaranteed'].includes(opening))
      throw Error('Configuración QA inválida');
    const content = revision === '2a' ? withShapeshifterQa(DEFAULT_CONTENT) : QA_CONTENT;
    engine = createQaEngine(content, b.deck, b.seed, opening, revision);
    for (const command of commands) {
      if (!engine.dispatch(command).ok) throw Error('Replay QA rechazado');
    }
  }
  return { profile: profile.profile, engine };
}
