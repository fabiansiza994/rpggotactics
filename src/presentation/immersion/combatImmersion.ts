import type { GameEvent, GameState } from "../../game";
import { readImmersion, type ImmersionSettings } from "./settings";
export type HealthMood = "normal" | "alert" | "critical" | "extreme";
export function healthMood(hp: number, maxHp: number): HealthMood {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0 || hp <= 0)
    return "normal";
  const ratio = hp / maxHp;
  return ratio <= 0.1
    ? "extreme"
    : ratio <= 0.25
      ? "critical"
      : ratio <= 0.5
        ? "alert"
        : "normal";
}
/** Smooth severity is continuous at thresholds: oscillating HP cannot flicker a filter on/off. */
export function healthSeverity(hp: number, maxHp: number) {
  return !Number.isFinite(hp) ||
    !Number.isFinite(maxHp) ||
    hp <= 0 ||
    maxHp <= 0
    ? 0
    : Math.max(0, Math.min(1, (0.5 - hp / maxHp) / 0.49));
}
export type HapticKind =
  "block" | "normal" | "strong" | "critical" | "death" | "defeat";
export const HAPTIC_PATTERNS: Record<HapticKind, readonly number[]> = {
  block: [35],
  normal: [60],
  strong: [120],
  critical: [80, 50, 150],
  death: [200],
  defeat: [150, 80, 250],
};
const priority: Record<HapticKind, number> = {
  block: 0,
  normal: 1,
  strong: 2,
  critical: 3,
  death: 4,
  defeat: 5,
};
export function vibrationPattern(
  kind: HapticKind,
  settings: ImmersionSettings,
  reduced = false,
): number[] {
  const scale =
    settings.intensity === "soft"
      ? 0.55
      : settings.intensity === "strong"
        ? 1.25
        : 1;
  if (reduced)
    return [Math.min(35, Math.round(HAPTIC_PATTERNS[kind][0]! * scale))];
  return HAPTIC_PATTERNS[kind].map((n, i) =>
    Math.round(n * (i % 2 ? 1 : scale)),
  );
}
export type HapticPort = {
  allowed(): boolean;
  reduced(): boolean;
  vibrate(pattern: number | number[]): boolean;
  now(): number;
};
export function browserHapticPort(): HapticPort {
  return {
    allowed: () =>
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function" &&
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      matchMedia("(any-pointer: coarse)").matches &&
      (navigator.userActivation?.hasBeenActive ?? false),
    reduced: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    vibrate: (pattern) => {
      try {
        return navigator.vibrate(pattern);
      } catch {
        return false;
      }
    },
    now: () => performance.now(),
  };
}
/** Receives presentation commits, never raw snapshots/commands. One bounded burst, no interval. */
export class CombatHaptics {
  private seen = new WeakSet<GameEvent>();
  private registered = new Set<GameEvent>();
  private critical = new Map<string, string>();
  private pending: HapticKind | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = -Infinity;
  private lastPriority = -1;
  private owns = false;
  private disposed = false;
  constructor(
    private port: HapticPort,
    private settings: () => ImmersionSettings = readImmersion,
  ) {}
  register(events: readonly GameEvent[]) {
    for (const e of events) {
      if (!["UNIT_DAMAGED", "UNIT_DEFEATED", "BACKSTAB"].includes(e.type))
        continue;
      if (!this.port.allowed()) this.seen.add(e);
      else this.registered.add(e);
    }
  }
  present(event: GameEvent, state: Readonly<GameState>, heroId: string) {
    this.registered.delete(event);
    if (this.disposed || this.seen.has(event)) return;
    this.seen.add(event);
    const hero = state.units.find((u) => u.id === heroId);
    const ownFaction = hero?.faction ?? "PLAYER";
    if (event.type === "BACKSTAB") {
      this.critical.set(event.unitId, event.sourceId);
      return;
    }
    let kind: HapticKind | undefined;
    if (event.type === "UNIT_DAMAGED") {
      const target = state.units.find((u) => u.id === event.unitId);
      const critical = this.critical.get(event.unitId) === event.sourceId;
      this.critical.delete(event.unitId);
      if (target?.faction !== ownFaction) return;
      if (event.hpLost > 0)
        kind = critical
          ? "critical"
          : event.hpLost >= Math.max(4, target.maxHp * 0.2)
            ? "strong"
            : "normal";
      else if (
        event.rawAmount > 0 &&
        (event.shieldAbsorbed > 0 ||
          event.armorMitigated > 0 ||
          (event.coverMitigated ?? 0) > 0)
      )
        kind = "block";
    } else if (event.type === "UNIT_DEFEATED" && event.faction === ownFaction) {
      kind = event.unitId === heroId ? "defeat" : "death";
    }
    if (kind) this.queue(kind);
  }
  private queue(kind: HapticKind) {
    if (!this.settings().vibration || !this.port.allowed()) return;
    if (!this.pending || priority[kind] > priority[this.pending])
      this.pending = kind;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const selected = this.pending;
      this.pending = null;
      if (
        !selected ||
        this.disposed ||
        !this.settings().vibration ||
        !this.port.allowed()
      )
        return;
      const now = this.port.now();
      if (now - this.last < 180 && priority[selected] <= this.lastPriority)
        return;
      this.owns = this.port.vibrate(
        vibrationPattern(selected, this.settings(), this.port.reduced()),
      );
      this.last = now;
      this.lastPriority = priority[selected];
    }, 32);
  }
  cancel() {
    for (const e of this.registered) this.seen.add(e);
    this.registered.clear();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.critical.clear();
    if (this.owns) {
      try {
        this.port.vibrate(0);
      } catch {
        /* Unsupported drivers are optional. */
      }
      this.owns = false;
    }
  }
  destroy() {
    this.cancel();
    this.seen = new WeakSet();
    this.disposed = true;
  }
}
