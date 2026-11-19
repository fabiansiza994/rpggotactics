import type { Env } from './db';

/** Fixed origins and table names: never derive either from browser input. */
export type PayPalConfig = {
  apiOrigin: string; approvalOrigin: string; orders: string; events: string;
  ledgerPrefix: string; root: string; merchant?: string;
  client: string; secret: string; webhook: string; origin: string;
};

export function liveConfig(env: Env, request: Request): PayPalConfig | null {
  if (env.PAYPAL_LIVE_ENABLED !== '1' || env.PAYPAL_LIVE_ACTIVATION !== 'paypal-live-v1-reviewed' ||
      env.PAYPAL_ENVIRONMENT !== 'live' || env.PAYPAL_SANDBOX_ENABLED === '1' ||
      !env.PAYPAL_LIVE_CLIENT_ID || !env.PAYPAL_LIVE_CLIENT_SECRET || !env.PAYPAL_LIVE_WEBHOOK_ID ||
      !env.PAYPAL_LIVE_MERCHANT_ID || !env.PAYPAL_LIVE_RETURN_ORIGIN) return null;
  // Reject accidental reuse of any configured Sandbox credential. Provider OAuth is
  // still the authority for opaque credentials: their environment cannot be inferred locally.
  if ([env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET, env.PAYPAL_WEBHOOK_ID].filter(Boolean)
      .some(value => [env.PAYPAL_LIVE_CLIENT_ID, env.PAYPAL_LIVE_CLIENT_SECRET, env.PAYPAL_LIVE_WEBHOOK_ID].includes(value))) return null;
  const origin = env.PAYPAL_LIVE_RETURN_ORIGIN;
  if (origin !== 'https://rpg-go-tactics.com' || new URL(request.url).protocol !== 'https:') return null;
  if (!['rpg-go-tactics.com', 'rpggo-tactics-api.fabiansiza994.workers.dev'].includes(new URL(request.url).hostname)) return null;
  return { apiOrigin: 'https://api-m.paypal.com', approvalOrigin: 'https://www.paypal.com',
    orders: 'tactics_paypal_live_orders', events: 'tactics_paypal_live_events', ledgerPrefix: 'paypal-live:',
    root: '/api/tactics/store/paypal/live', merchant: env.PAYPAL_LIVE_MERCHANT_ID,
    client: env.PAYPAL_LIVE_CLIENT_ID, secret: env.PAYPAL_LIVE_CLIENT_SECRET,
    webhook: env.PAYPAL_LIVE_WEBHOOK_ID, origin };
}
