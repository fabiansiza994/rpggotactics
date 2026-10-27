/** Public presentation-only build flag. Never used by rules, account ownership or PvP. */
export function premiumVfxEnabled(): boolean {
  const configured = import.meta.env.VITE_PREMIUM_VFX_ENABLED;
  // Explicit 0 (or invalid value) also disables local QA. Only exact 1 opts production in.
  if (configured !== undefined) return configured === '1';
  // Preserve the approved local laboratory default without enabling public builds implicitly.
  return import.meta.env.DEV && typeof location !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}
