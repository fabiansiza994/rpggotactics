import { contentReleaseUrl } from './contentRelease';
/** Why a cloud call failed. NETWORK/TIMEOUT = try again later; AUTH = sign in again. */
export type CloudErrorKind = 'NETWORK' | 'TIMEOUT' | 'AUTH' | 'REJECTED' | 'SERVER';

export interface CloudError {
  kind: CloudErrorKind;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type CloudResult<T> = { ok: true; data: T } | { ok: false; error: CloudError };

const fail = (kind: CloudErrorKind, status: number, code: string, message: string, details?: Record<string, unknown>) =>
  ({ ok: false, error: { kind, status, code, message, details } }) as const;

/** JSON request with a timeout. Never throws: every failure becomes a typed CloudError. */
export async function request<T>(
  base: string,
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; timeoutMs: number },
): Promise<CloudResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let res: Response;
  try {
    res = await fetch(contentReleaseUrl(`${base}${path}`), {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    return controller.signal.aborted
      ? fail('TIMEOUT', 0, 'TIMEOUT', 'El servidor tardó demasiado en responder.')
      : fail('NETWORK', 0, 'NETWORK', 'Sin conexión con el servidor.');
  } finally {
    clearTimeout(timer);
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (res.ok) return { ok: true, data: payload as T };
  // Auth Worker: { error: "mensaje" }. Tactics API: { error: { code, message, ... } }.
  const raw = (payload as { error?: unknown } | null)?.error;
  const detail = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined;
  const message = typeof raw === 'string' ? raw : typeof detail?.message === 'string' ? detail.message : `Error ${res.status}`;
  const code = typeof detail?.code === 'string' ? detail.code : `HTTP_${res.status}`;
  const kind: CloudErrorKind = res.status === 401 ? 'AUTH' : res.status >= 500 ? 'SERVER' : 'REJECTED';
  return fail(kind, res.status, code, message, detail);
}
