import { shapeshifterQaEnabled } from '../qa/shapeshifter/access';
/**
 * Where accounts and cloud saves live. Accounts are the existing RPG-GO accounts (auth Worker
 * dark-recipe-a184); player data is the Tactics API Worker (server/). Without
 * VITE_TACTICS_API_URL the build is local-only: everything works as guest.
 */
const env = import.meta.env;

export const CLOUD_CONFIG = {
  authUrl: (env.VITE_AUTH_API_URL as string | undefined) || 'https://dark-recipe-a184.fabiansiza994.workers.dev',
  apiUrl: shapeshifterQaEnabled ? '' : (env.VITE_TACTICS_API_URL as string | undefined) || '',
  /** Public Turnstile site key (same widget as RPG-GO's register form). Not a secret. */
  turnstileSiteKey: (env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '0x4AAAAAAEGAbfUF8CNjCJyd',
  timeoutMs: 10_000,
};

export const cloudEnabled = (): boolean => CLOUD_CONFIG.apiUrl !== '';
