import {CONTENT_RELEASE,isSupportedContentRelease} from '../../src/game/pvp/content-release';
import { error } from './http';
import type { Env } from './db';
import { maintenanceGate } from './maintenance';

/** Reversible gate; never deletes inventory, downgrades a room or changes a combat rule. */
export function contentTransition(request: Request, env: Env, _username?: string): Response | null {
  // Identity is retained for call-site compatibility; no QA identity bypasses admission closures.
  void _username;
  // Reconnect only: these endpoints validate existing room membership/tickets themselves.
  // They never create/ready a match or grant a Thunder card. Keep active games recoverable.
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  // Payment orders use their own authenticated/versioned protocol, independent of card rules.
  const independentPayment = path.startsWith('/api/tactics/store/paypal/');
  const activeRoom = ['/api/tactics/pvp/connect','/api/tactics/pvp/socket','/api/tactics/pvp/state','/api/tactics/pvp/active','/api/tactics/pvp/leave'].includes(path);
  const maintenance = maintenanceGate(request, env);
  if (maintenance) return maintenance;
  if (env.RELEASE2_CLIENT_REQUIRED === '1' && !independentPayment && url.searchParams.get('clientRelease') !== CONTENT_RELEASE && !(activeRoom && isSupportedContentRelease(url.searchParams.get('clientRelease'))))
    return error(426, 'CLIENT_UPDATE_REQUIRED', 'Actualiza o recarga el juego antes de continuar. Tu cuenta y tus cartas se conservan.');
  return null;
}
