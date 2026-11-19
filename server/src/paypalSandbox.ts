import type { Env } from './db';
import type { PayPalConfig } from './paypalLive';
export function sandboxConfig(env: Env, request: Request): PayPalConfig | null {
  if (env.PAYPAL_SANDBOX_ENABLED !== '1' || env.PAYPAL_ENVIRONMENT !== 'sandbox' || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID || !env.PAYPAL_RETURN_ORIGIN) return null;
  if (env.PAYPAL_LIVE_ENABLED === '1' || [env.PAYPAL_LIVE_CLIENT_ID, env.PAYPAL_LIVE_CLIENT_SECRET, env.PAYPAL_LIVE_WEBHOOK_ID].filter(Boolean).some(value => [env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET, env.PAYPAL_WEBHOOK_ID].includes(value))) return null;
  let origin: URL;
  try { origin = new URL(env.PAYPAL_RETURN_ORIGIN); }
  catch { return null; }
  if (origin.href !== origin.origin + '/') return null;
  const hosts = [new URL(request.url).hostname, origin.hostname];
  if (hosts.some(host => /(^|\.)rpg-go-tactics\.com$|^rpggo-tactics(?:-api)?\./.test(host))) return null;
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) return null;
  return { apiOrigin: 'https://api-m.sandbox.paypal.com', approvalOrigin: 'https://www.sandbox.paypal.com', orders: 'tactics_paypal_orders', events: 'tactics_paypal_events', ledgerPrefix: 'paypal:', root: '/api/tactics/store/paypal', merchant: undefined, client: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET, webhook: env.PAYPAL_WEBHOOK_ID, origin: origin.origin };
}
