import type { CardBlock } from './cardBlock';

/** Inspection is presentation-only; blocked taps never reach the gameplay selector. */
export function activateHandCard(uid: string, block: CardBlock | undefined,
  actions: { inspect(uid: string): void; select(uid: string): void; cancel(): void }) {
  if (block) {
    actions.cancel();
    actions.inspect(uid);
  } else actions.select(uid);
}
