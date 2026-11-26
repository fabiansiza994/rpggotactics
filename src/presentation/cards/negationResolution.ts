import type {CardDefinition, GameEvent} from '../../game';
import type {PresentationBatch} from '../events/presentationBus';
import {VisualQueue} from '../vfx/VisualQueue';

export const NEGATION_DURATION_MS = 2500;
export const NEGATION_IMPACT_MS = 900;
export type NegationResolution = {
  id: string;
  sourceCardId: string;
  sourceCardUid: string;
  targetCardId: string;
  targetCardUid: string;
  sourceCasterId: string;
  targetCasterId: string;
};
export type NegationFrame = NegationResolution & {progress: number; reduced: boolean; dismiss(): void};
type Negated = Extract<GameEvent, {type: 'CARD_NEGATED'}>;
const remember = <T>(map: Map<string, T>, key: string, value: T) => {
  map.set(key, value);
  while (map.size > 512) map.delete(map.keys().next().value!);
};

/** Public event identities only. Never reads a hand, discard, log text or chooses an outcome. */
export class NegationLedger {
  private readonly seen = new Map<string, true>();
  private readonly windows = new Map<string, string>();
  claim(events: readonly GameEvent[], batch: PresentationBatch | undefined, card: (id: string) => CardDefinition | undefined): Map<GameEvent, NegationResolution> {
    const plans = new Map<GameEvent, NegationResolution>();
    if (!batch?.key) return plans;
    const scope = batch.key.slice(0, batch.key.lastIndexOf(':')) || batch.key;
    const targetKey = (caster: string, cardId: string) => `${scope}:${caster}:${cardId}`;
    const pending = batch.before?.responseWindow ?? batch.before?.pendingCast;
    if (pending) remember(this.windows, targetKey(pending.casterId, pending.cardId), pending.id);
    events.forEach((event, index) => {
      if (event.type === 'CARD_CAST_PENDING') remember(this.windows, targetKey(event.casterId, event.cardId), event.windowId);
      if (event.type !== 'CARD_NEGATED') return;
      // Sello is the first registered source. The frame/lane/surface are source-independent.
      const source = events.slice(0, index).reverse().find((e): e is Extract<GameEvent, {type: 'CARD_PLAYED'}> =>
        e.type === 'CARD_PLAYED' && e.casterId === event.responderId && e.cardId === 'dark_silence_seal');
      if (!source || !card(source.cardId) || !card(event.cardId)) return;
      if (events.some(e => e.type === 'CARD_CURSE_TRIGGERED' && e.cardUid === source.cardUid)) return;
      const windowId = this.windows.get(targetKey(event.casterId, event.cardId));
      const id = `${windowId ? scope + ':window:' + windowId : batch.key}:${source.cardUid}:${event.cardUid}`;
      if (this.seen.has(id)) return;
      remember(this.seen, id, true);
      if (!batch.live) return; // Recovery consumes identity without replaying the resolution.
      plans.set(event, this.resolution(id, source, event));
    });
    return plans;
  }
  private resolution(id: string, source: Extract<GameEvent, {type: 'CARD_PLAYED'}>, target: Negated): NegationResolution {
    return {id, sourceCardId: source.cardId, sourceCardUid: source.cardUid, targetCardId: target.cardId,
      targetCardUid: target.cardUid, sourceCasterId: source.casterId, targetCasterId: target.casterId};
  }
}
export const negationLedger = new NegationLedger();
let frame: NegationFrame | null = null;
const listeners = new Set<(frame: NegationFrame | null) => void>();
export const readNegationFrame = () => frame;
export function subscribeNegation(listener: (frame: NegationFrame | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: NegationFrame | null) { frame = next; for (const listener of listeners) listener(next); }

/** A nonblocking lane on the director's existing clock, never included in gameplay busy. */
export class NegationLane {
  private readonly queue = new VisualQueue();
  constructor(private readonly impact: () => void = () => {}) {}
  show(plan: NegationResolution, reduced: boolean) {
    this.clear(); // A newer resolution supersedes the surface, never accumulates a combat delay.
    let sounded = false;
    const dismiss = () => this.clear();
    const finish = () => { if (frame?.id === plan.id) publish(null); };
    this.queue.enqueue({
      duration: NEGATION_DURATION_MS,
      begin() {},
      update: elapsed => {
        if (!sounded && elapsed >= (reduced ? 0 : NEGATION_IMPACT_MS)) { sounded = true; this.impact(); }
        publish({...plan, progress: elapsed / NEGATION_DURATION_MS, reduced, dismiss});
      },
      finish,
      cancel: finish,
    });
  }
  tick(ms: number) { this.queue.tick(ms); }
  clear() { this.queue.clear(); }
}
