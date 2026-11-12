import { error } from './http';
import type { Env } from './db';

/** Reversible gate; never deletes inventory, downgrades a room or changes a combat rule. */
export function contentTransition(request: Request, env: Env, username?: string): Response | null {
  // Reconnect only: these endpoints validate existing room membership/tickets themselves.
  // They never create/ready a match or grant a Thunder card. Keep active games recoverable.
  const reconnect = ['/api/tactics/pvp/connect', '/api/tactics/pvp/socket'].includes(new URL(request.url).pathname);
  const qa = !!username && (env.RELEASE2_QA_USERS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(username);
  if (env.RELEASE2_MAINTENANCE === '1' && !reconnect && !qa)
    return error(503, 'CONTENT_MAINTENANCE', 'Actualización breve en curso. Conserva tu sesión y reintenta en unos momentos.');
  if (env.RELEASE2_CLIENT_REQUIRED === '1' && new URL(request.url).searchParams.get('clientRelease') !== 'thunder-release-2')
    return error(426, 'CLIENT_UPDATE_REQUIRED', 'Actualiza o recarga el juego antes de continuar. Tu cuenta y tus cartas se conservan.');
  return null;
}
