/** Private client QA is deliberately offline, DEV-only and loopback-only. */
export function localShapeshifterQa(dev: boolean, mode: string, hostname: string): boolean {
  return dev && mode === 'shapeshifterqa' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
export const shapeshifterQaEnabled = localShapeshifterQa(
  import.meta.env.DEV,
  import.meta.env.MODE,
  typeof location === 'undefined' ? '' : location.hostname,
);
export const qaStorageKey = (key: string) =>
  shapeshifterQaEnabled ? `shapeshifter-2e:${key}` : key;
