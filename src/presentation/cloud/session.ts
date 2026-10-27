/** The signed-in account on this device (opaque Bearer token from the auth Worker). */
export interface CloudSession {
  token: string;
  username: string;
}

export const SESSION_KEY = 'rpg-go-tactics:session';

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(): CloudSession | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value === 'object' && value !== null) {
      const { token, username } = value as Record<string, unknown>;
      if (typeof token === 'string' && token && typeof username === 'string') return { token, username };
    }
  } catch {
    /* unreadable: treated as signed out */
  }
  return null;
}

export function saveSession(session: CloudSession | null): void {
  try {
    if (session) storage()?.setItem(SESSION_KEY, JSON.stringify(session));
    else storage()?.removeItem(SESSION_KEY);
  } catch {
    /* best effort: the session then lasts for this page only */
  }
}
