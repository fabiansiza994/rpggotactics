import type { GameContent, GameEvent } from "../../src/game";
import type { Command } from "../../src/game/engine/commands";
import { compileTimeline } from "../../src/presentation/vfx/spellTimeline";
/** Shared visual timeline is pure; no Pixi, timers, combat decisions or browser APIs execute here. */
export const BOT_PACING_CREDIT_MS = 30_000;
function fraction(seed: number, turn: number, action: number, domain: number) {
  let n =
    (seed ^
      Math.imul(turn + 1, 0x45d9f3b) ^
      Math.imul(action + 1, 0x27d4eb2d) ^
      domain) >>>
    0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function botPause(
  kind: "first" | "normal" | "end",
  seed: number,
  turn: number,
  action: number,
) {
  const [min, max, domain] =
    kind === "first"
      ? [1500, 2500, 31]
      : kind === "end"
        ? [800, 1200, 73]
        : [800, 1500, 119];
  return Math.round(
    min! + (max! - min!) * fraction(seed, turn, action, domain!),
  );
}
export function botActionTiming(
  command: Command,
  events: readonly GameEvent[],
  content: GameContent,
  seed: number,
  turn: number,
  action: number,
) {
  const visualMs = compileTimeline(
    events,
    (id) => content.cards[id]?.presentation.visualKey ?? id,
    false,
    true,
  ).duration;
  const summon = events.some(
    (e) => e.type === "UNIT_SPAWNED" && e.kind === "SUMMON",
  );
  const normal = botPause("normal", seed, turn, action);
  const readMs = summon
    ? 1500 + Math.round(fraction(seed, turn, action, 181) * 500)
    : normal;
  return {
    visualMs,
    delayMs: command.type === "END_TURN" ? 0 : Math.max(readMs, visualMs + 140),
  };
}
/** Only the bounded, intentional wait is credited; never replenishes nodes, CPU or actions. */
export function pacingCredit(waitMs: number, usedMs: number) {
  return Math.min(
    Math.max(0, waitMs),
    Math.max(0, BOT_PACING_CREDIT_MS - usedMs),
  );
}
