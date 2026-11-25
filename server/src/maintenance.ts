import type { Env } from './db';
import { error } from './http';

/** Existing release flags remain the only source of truth. No new control plane. */
export function maintenanceState(env: Env) {
  const maintenance = env.RELEASE2_MAINTENANCE === '1';
  const draining = env.CONTENT_RELEASE_DRAIN === '1';
  return { phase: maintenance ? 'MAINTENANCE' : draining ? 'DRAINING' : 'OPEN',
    admissionsBlocked: maintenance || draining, purchasesBlocked: maintenance } as const;
}

export function maintenanceGate(request: Request, env: Env): Response | null {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const state = maintenanceState(env);
  const admission = /^\/api\/tactics\/ranked\/(queue|bot)$/.test(path)
    || (request.method === 'POST' && [
      '/api/tactics/pvp/create', '/api/tactics/pvp/join', '/api/tactics/pvp/ready', '/api/tactics/pvp/rematch',
      '/api/tactics/campaign/start', '/api/tactics/skirmish/start', '/api/tactics/champions/start',
    ].includes(path));
  const purchase = request.method === 'POST' && (
    /^\/api\/tactics\/store\/paypal\/(live\/)?orders$/.test(path)
    || ['/api/tactics/store/purchase', '/api/tactics/store/box/reset',
      '/api/tactics/store/real-money/checkout', '/api/tactics/ranked/premium/purchase'].includes(path));
  if ((state.admissionsBlocked && admission) || (state.purchasesBlocked && purchase))
    return error(503, state.phase === 'DRAINING' ? 'CONTENT_DRAINING' : 'CONTENT_MAINTENANCE',
      'Actualización en curso. Los combates activos y las operaciones de pago ya iniciadas se conservan.');
  // In-flight capture, status/recovery, webhooks, reconciliation and result settlement
  // deliberately continue through their existing authorization/idempotency handlers.
  return null;
}

/** Cancel only an unassigned searching ticket; never touch matched rooms or rewards. */
export async function cancelWaitingAdmission(request: Request, env: Env, userId: number) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (!maintenanceState(env).admissionsBlocked || !/^\/api\/tactics\/ranked\/(queue|bot)$/.test(path)) return;
  await env.DB.prepare('DELETE FROM tactics_ranked_queue WHERE user_id = ? AND room_code IS NULL').bind(userId).run();
}
