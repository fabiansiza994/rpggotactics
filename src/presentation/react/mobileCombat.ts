/** Shared CSS/renderer boundary; presentation only, including mouse emulation for QA. */
export const MOBILE_COMBAT_QUERY = '(orientation: portrait) and (max-width: 600px)';
export const mobileCombat = () => window.matchMedia(MOBILE_COMBAT_QUERY).matches;

/** A held or dragged card never leaks a compatibility click into gameplay. */
export function cardHold(inspect: () => void, delay = 400) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number } | null = null;
  let suppressed = false;
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
  return {
    start(x: number, y: number) {
      cancelTimer(); origin = { x, y }; suppressed = false;
      timer = setTimeout(() => { timer = undefined; suppressed = true; inspect(); }, delay);
    },
    move(x: number, y: number) {
      if (origin && Math.hypot(x - origin.x, y - origin.y) > 10) { cancelTimer(); suppressed = true; }
    },
    end() { cancelTimer(); origin = null; },
    cancel() { cancelTimer(); origin = null; suppressed = true; },
    consumeClick() { const held = suppressed; suppressed = false; return held; },
    destroy() { cancelTimer(); origin = null; },
  };
}

/** Prevent a second tap on controls that replace Confirm/Cancel from ending a turn. */
export const MOBILE_AIM_RELEASE_GUARD_MS = 600;
export const mobileTurnTapAllowed = (now: number, releasedAt: number) => now - releasedAt >= MOBILE_AIM_RELEASE_GUARD_MS;

/** Align the authored entry edge with the bottom; square/top-bottom arenas need no quarter turn. */
export function mobileCameraTurn(origin: {x:number;y:number}, width: number, height: number): 0 | 1 | 2 | 3 {
  const x = origin.x / Math.max(1,width-1) - .5, y = origin.y / Math.max(1,height-1) - .5;
  return Math.abs(x) >= Math.abs(y) ? x >= 0 ? 3 : 1 : y >= 0 ? 0 : 2;
}

/** UI-only gate: side control never ends a turn during targeting or forced discard. */
export function mobileEndTurnAllowed(now: number, releasedAt: number, aiming: boolean, discarding: boolean) {
  return !aiming && !discarding && mobileTurnTapAllowed(now, releasedAt);
}
