export type ImmersionSettings = {
  vibration: boolean;
  intensity: "soft" | "normal" | "strong";
  visuals: boolean;
  subtle: boolean;
};
export const IMMERSION_KEY = "rpggo:combat-immersion:v1";
export const DEFAULT_IMMERSION: ImmersionSettings = {
  vibration: false,
  intensity: "normal",
  visuals: true,
  subtle: false,
};
export function normalizeImmersion(value: unknown): ImmersionSettings {
  const v = (
    value && typeof value === "object" ? value : {}
  ) as Partial<ImmersionSettings>;
  return {
    vibration: v.vibration === true,
    intensity:
      v.intensity === "soft" || v.intensity === "strong"
        ? v.intensity
        : "normal",
    visuals: v.visuals !== false,
    subtle: v.subtle === true,
  };
}
let current: ImmersionSettings | undefined;
const listeners = new Set<() => void>();
export function readImmersion(): ImmersionSettings {
  if (!current) {
    try {
      current = normalizeImmersion(
        JSON.parse(localStorage.getItem(IMMERSION_KEY) ?? "null"),
      );
    } catch {
      current = { ...DEFAULT_IMMERSION };
    }
  }
  return current;
}
export function writeImmersion(value: ImmersionSettings) {
  current = normalizeImmersion(value);
  try {
    localStorage.setItem(IMMERSION_KEY, JSON.stringify(current));
  } catch {
    /* Device preferences remain usable without storage. */
  }
  for (const notify of listeners) notify();
}
export function subscribeImmersion(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
