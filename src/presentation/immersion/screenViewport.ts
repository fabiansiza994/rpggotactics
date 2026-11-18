/** Shared event-driven viewport store. Never follows the battlefield camera or runs a frame loop. */
export type ScreenViewport = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  hidden: boolean;
}>;
export const SERVER_VIEWPORT: ScreenViewport = Object.freeze({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  hidden: true,
});
export function measureScreenViewport(host: Window): ScreenViewport {
  const v = host.visualViewport;
  const positive = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  const offset = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
  return {
    left: offset(v?.offsetLeft),
    top: offset(v?.offsetTop),
    width: positive(v?.width, host.innerWidth),
    height: positive(v?.height, host.innerHeight),
    hidden: host.document.hidden,
  };
}
export function createScreenViewportStore(host: Window) {
  let current = measureScreenViewport(host);
  const listeners = new Set<() => void>();
  const update = () => {
    const next = measureScreenViewport(host);
    if (
      Object.keys(next).every(
        (k) =>
          next[k as keyof ScreenViewport] ===
          current[k as keyof ScreenViewport],
      )
    )
      return;
    current = next;
    for (const notify of listeners) notify();
  };
  const subscribe = (notify: () => void) => {
    if (!listeners.size) {
      host.addEventListener("resize", update);
      host.visualViewport?.addEventListener("resize", update);
      host.visualViewport?.addEventListener("scroll", update);
      host.document.addEventListener("visibilitychange", update);
    }
    listeners.add(notify);
    update();
    return () => {
      listeners.delete(notify);
      if (!listeners.size) {
        host.removeEventListener("resize", update);
        host.visualViewport?.removeEventListener("resize", update);
        host.visualViewport?.removeEventListener("scroll", update);
        host.document.removeEventListener("visibilitychange", update);
      }
    };
  };
  return {
    subscribe,
    getSnapshot: () => {
      if (!listeners.size) update();
      return current;
    },
  };
}
let shared: ReturnType<typeof createScreenViewportStore> | undefined;
const store = () => (shared ??= createScreenViewportStore(window));
export const subscribeScreenViewport = (notify: () => void) =>
  typeof window === "undefined" ? () => {} : store().subscribe(notify);
export const screenViewportSnapshot = () =>
  typeof window === "undefined" ? SERVER_VIEWPORT : store().getSnapshot();
