import type { GameEvent, GameState } from '../../game';

export type PresentationListener = (events: readonly GameEvent[], state: Readonly<GameState>) => void;

/**
 * Fan-out of engine event batches to presentation consumers (Pixi board, VFX registry,
 * combat log, sound…). Consumers must treat events as read-only facts: they can animate,
 * never decide outcomes.
 */
class PresentationBus {
  private readonly listeners = new Set<PresentationListener>();

  subscribe(listener: PresentationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(events: readonly GameEvent[], state: Readonly<GameState>): void {
    for (const listener of this.listeners) listener(events, state);
  }
}

export const presentationBus = new PresentationBus();
