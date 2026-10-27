/** Explicit QA battle setup shared by client and headless validation. Never a global draw rule. */
import { GameEngine } from '../engine/GameEngine';
import { executeCommand, type Command } from '../engine/commands';
import type { GameContent } from '../domain/content';
import type { ScenarioDef } from '../domain/scenario';
export type ShapeshifterOpening = 'normal' | 'guaranteed';
export const SHAPESHIFTER_OPENING_VERSION = 1;
export function createShapeshifterBattle(
  scenario: ScenarioDef,
  content: GameContent,
  seed: number,
  opening: ShapeshifterOpening,
): GameEngine {
  if (scenario.hero.heroId !== 'shapeshifter' || !content.heroes.shapeshifter)
    throw Error('Solo contenido QA Cambiaformas');
  let engine = new GameEngine(scenario, content, seed);
  const transform = (id: string) => content.cards[id]!.effects.some((e) => e.type === 'TRANSFORM');
  if (opening === 'guaranteed' && !engine.state.player.hand.some((c) => transform(c.cardId))) {
    const state = structuredClone(engine.state),
      index = state.player.deck.findIndex((c) => transform(c.cardId));
    if (index < 0 || !state.player.hand.length)
      throw Error('El mazo necesita una transformación para esta apertura QA');
    const slot = state.player.hand.length - 1;
    [state.player.hand[slot], state.player.deck[index]] = [
      state.player.deck[index]!,
      state.player.hand[slot]!,
    ];
    const events = engine.initialEvents;
    engine = GameEngine.fromSnapshot(state, content, { ...scenario, defaultSeed: seed });
    let drawn = 0;
    engine.initialEvents = events.map((event) => {
      if (event.type !== 'CARD_DRAWN') return event;
      const card = state.player.hand[drawn++];
      return card ? { ...event, cardUid: card.uid, cardId: card.cardId } : event;
    });
  }
  return engine;
}
/** Server receives scenario, validated deck/content and opening from its own QA configuration,
 * never from a public client's claimed final state or opening preference. Public routes stay closed. */
export function replayShapeshifterBattle(
  scenario: ScenarioDef,
  content: GameContent,
  seed: number,
  opening: ShapeshifterOpening,
  commands: readonly Command[],
) {
  const state = structuredClone(createShapeshifterBattle(scenario, content, seed, opening).state);
  const ctx = { state, content, emit: () => {} };
  for (let i = 0; i < commands.length; i++) {
    try {
      if (!executeCommand(ctx, commands[i]!).ok) return { state, rejectedAt: i };
    } catch {
      return { state, rejectedAt: i };
    }
  }
  return { state, rejectedAt: null };
}
