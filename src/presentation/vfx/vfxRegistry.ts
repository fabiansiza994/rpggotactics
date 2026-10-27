import type { Container } from 'pixi.js';
import type { CardDefinition, EventOfType, GameEvent, GameEventType, GameState, Pos } from '../../game';

/**
 * Everything a VFX handler may use. World coordinates come from the board layout; handlers
 * draw into `vfxLayer` / `projectileLayer` and clean up after themselves.
 */
export interface VfxContext {
  vfxLayer: Container;
  projectileLayer: Container;
  /** Centre of a tile in world (board-local) pixels. */
  tileCenter(pos: Pos): { x: number; y: number };
  tileSize: number;
  /** State AFTER the batch was applied (events describe how we got here). */
  state: Readonly<GameState>;
  card(cardId: string): CardDefinition | undefined;
  /** Frame hook: return true to stop. Uses the Pixi ticker; no real-time logic in the domain. */
  animate(step: (elapsedMs: number) => boolean): void;
  reducedMotion: boolean;
}

export type VfxHandler<T extends GameEventType> = (event: EventOfType<T>, ctx: VfxContext) => void;
type AnyHandler = (event: GameEvent, ctx: VfxContext) => void;

/**
 * Maps event types (and card visualKeys for CARD_PLAYED) to visual effects.
 * CODEX EXTENSION POINT: register handlers here — never in the domain.
 */
export class VfxRegistry {
  private readonly byType = new Map<GameEventType, AnyHandler[]>();
  private readonly byVisualKey = new Map<string, VfxHandler<'CARD_PLAYED'>[]>();

  on<T extends GameEventType>(type: T, handler: VfxHandler<T>): () => void {
    const list = this.byType.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.byType.set(type, list);
    return () => this.byType.set(type, (this.byType.get(type) ?? []).filter((h) => h !== handler));
  }

  /** Card-specific visuals keyed by `CardDefinition.presentation.visualKey`. */
  onCardVisual(visualKey: string, handler: VfxHandler<'CARD_PLAYED'>): () => void {
    const list = this.byVisualKey.get(visualKey) ?? [];
    list.push(handler);
    this.byVisualKey.set(visualKey, list);
    return () => this.byVisualKey.set(visualKey, (this.byVisualKey.get(visualKey) ?? []).filter((h) => h !== handler));
  }

  play(events: readonly GameEvent[], ctx: VfxContext): void {
    for (const event of events) {
      for (const handler of this.byType.get(event.type) ?? []) handler(event, ctx);
      if (event.type === 'CARD_PLAYED') {
        const key = ctx.card(event.cardId)?.presentation.visualKey;
        for (const handler of (key && this.byVisualKey.get(key)) || []) handler(event, ctx);
      }
    }
  }
}
