/** Opt-in diagnostics; never participates in gameplay or input locking. */
export function loadingMark(name: string, detail?: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf-audit')) {
    performance.mark(`rpggo:${name}`, {detail});
  }
}
