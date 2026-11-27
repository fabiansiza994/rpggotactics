import type { D1Database } from './db';

/**
 * Session resolution shared by HTTP routes and the Durable Objects (Security Hardening 1.0).
 *
 * - SEC-009: the opaque bearer is looked up by its SHA-256 digest (`sessions.token_digest`,
 *   migration 0037). Sessions created before the digest existed are found by the raw token once
 *   and backfilled, so no session is closed by the transition.
 * - SEC-002: the digest (`sid`) travels with connection tickets into the PvP room and the social
 *   hub, which re-check it at a bounded interval instead of on every WebSocket message.
 *
 * If the column is missing (migration 0037 not applied) HTTP degrades to the previous raw-token
 * query, but no socket ticket is issued (sid null → SESSION_BINDING_RETRY): a socket that could not
 * be re-checked never acts or receives private data (independent review B4/B5). 0037 is therefore
 * a hard prerequisite of this Worker for PvP and social, as it already is for the Auth candidate.
 */

/** Printable, no spaces, at most 200 chars, and never a ':' — so a stored `d:<digest>` (digest-only
 * rows) can never be replayed as a bearer. Real tokens are base64url (auth Worker). */
const BEARER = /^[!-9;-~]{1,200}$/;

/** How often a live socket re-checks that its session still exists (ms). */
export const SESSION_RECHECK_MS = 10_000;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return BEARER.test(token) ? token : null;
}

export async function sessionDigest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const missingColumn = (cause: unknown) => cause instanceof Error && /no such column|has no column/i.test(cause.message);

export interface ResolvedSession {
  userId: number;
  username: string;
  /**
   * SHA-256 hex of the bearer, ONLY when it is confirmed stored in `sessions.token_digest` (so a
   * later digest lookup that finds nothing really means revoked/expired). Null while migration 0037
   * is missing or when the one-time backfill could not be persisted (independent review B5): HTTP
   * keeps working, but no socket ticket is issued for that request (SESSION_BINDING_RETRY).
   */
  sid: string | null;
}

/**
 * Socket tickets are only issued for a session whose digest is persisted: every socket can then be
 * re-checked and revoked (SEC-002). Without it the client gets a retryable 503 — its normal
 * reconnect loop retries; no session is closed and no match result is produced by this refusal.
 */
export const SESSION_BINDING_RETRY = { code: 'SESSION_BINDING_RETRY', message: 'Conexión segura no disponible por un momento. Reintentando…' } as const;

type Row = { id: number; username: string; expires_at: number; token_digest?: string | null };

export async function resolveSession(db: D1Database, token: string, now: number): Promise<ResolvedSession | null> {
  const sid = await sessionDigest(token);
  let row: Row | null = null;
  let digestSupported = true;
  try {
    row = await db
      .prepare('SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.username = s.username WHERE s.token_digest = ?')
      .bind(sid)
      .first<Row>();
  } catch (cause) {
    if (!missingColumn(cause)) throw cause;
    digestSupported = false;
  }
  let bound = digestSupported && !!row;
  if (!row) {
    // Pre-digest session (or Worker before 0037): the raw token, exactly as before.
    row = await db
      .prepare('SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ?')
      .bind(token)
      .first<Row>();
    if (row && digestSupported && row.expires_at >= now) {
      try {
        await db.prepare('UPDATE sessions SET token_digest = ? WHERE token = ? AND token_digest IS NULL').bind(sid, token).run();
        // Confirm the binding is durable before handing out `sid` (a concurrent request may also
        // have written it): a failed or lost write must never look like a revocation later.
        bound = !!(await db.prepare('SELECT 1 AS ok FROM sessions WHERE token_digest = ?').bind(sid).first());
      } catch {
        bound = false; // transient: this request works over HTTP; the next one retries the backfill
      }
    }
  }
  if (!row || row.expires_at < now) return null;
  return { userId: row.id, username: row.username, sid: bound ? sid : null };
}

export type SessionCheck = 'VALID' | 'REVOKED' | 'UNKNOWN';

/**
 * Is the session behind `sid` still live? UNKNOWN (D1 error, column missing) never closes a
 * socket: availability for legitimate players wins over a transient infrastructure failure, and
 * the next due check retries.
 */
export async function checkSession(db: D1Database | undefined, sid: string | null | undefined, now: number): Promise<SessionCheck> {
  if (!db || !sid) return 'UNKNOWN';
  try {
    const row = await db.prepare('SELECT expires_at FROM sessions WHERE token_digest = ?').bind(sid).first<{ expires_at: number }>();
    return row && row.expires_at >= now ? 'VALID' : 'REVOKED';
  } catch {
    return 'UNKNOWN';
  }
}

export const recheckDue = (checkedAt: number | undefined, now: number, every = SESSION_RECHECK_MS) =>
  checkedAt === undefined || now - checkedAt >= every;

/** WebSocket close code sent when the session behind a socket was revoked or expired. */
export const SESSION_REVOKED_CLOSE = 4401;
/**
 * Close code for a socket without a verified session identity (legacy ticket/attachment from a
 * Worker before Security Hardening). Clients reconnect on any close, which obtains a new ticket
 * through an authenticated HTTP request — the match and its reconnection window are untouched.
 */
export const SESSION_RENEW_CLOSE = 4402;
