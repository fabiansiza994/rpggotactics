import type { GameEvent, GameState } from '../../game';

export type PresentationBatch = { key: string; live: boolean; before?: Readonly<GameState> };
const sourceKeys = new WeakMap<object,string>();
let sourceId=0;
export function presentationSourceKey(source:object):string{let key=sourceKeys.get(source);if(!key){key=`pve:${++sourceId}`;sourceKeys.set(source,key);}return key;}
export function resetPresentationSource(source:object):void{sourceKeys.delete(source);}
export type PresentationListener = (events: readonly GameEvent[], state: Readonly<GameState>, batch?: PresentationBatch) => void;

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

  publish(events: readonly GameEvent[], state: Readonly<GameState>, batch?: PresentationBatch): void {
    for (const listener of this.listeners) listener(events, state, batch);
  }
}

export const presentationBus = new PresentationBus();
