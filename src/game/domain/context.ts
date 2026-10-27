import type { GameContent } from './content';
import type { GameEvent } from './events';
import type { GameState } from './state';

/**
 * Everything a rule function needs: the (mutable, engine-owned draft) state, the content
 * tables, and an event sink. Rule functions never touch anything else.
 */
export interface RuleContext {
  state: GameState;
  content: GameContent;
  emit(event: GameEvent): void;
}

/** Context for read-only queries (previews, legal moves). Events are discarded. */
export function queryContext(state: GameState, content: GameContent): RuleContext {
  return { state, content, emit: () => undefined };
}
