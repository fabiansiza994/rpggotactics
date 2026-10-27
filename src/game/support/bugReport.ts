/**
 * In-game bug reports: the rules shared by the report modal and the API Worker
 * (server/src/support.ts). Plain text only; the context is a fixed whitelist of small ids and
 * numbers, so nothing the client adds outside it (tokens, cookies, hands, chat) is ever stored.
 */

export const BUG_CATEGORIES = ['BATTLE', 'PROGRESS', 'STORE', 'PVP', 'CARDS', 'UI', 'ACCOUNT', 'OTHER'] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];

export const BUG_CATEGORY_LABEL: Record<BugCategory, string> = {
  BATTLE: 'Batalla',
  PROGRESS: 'Progreso',
  STORE: 'Tienda',
  PVP: 'PvP',
  CARDS: 'Cartas / Deck Builder',
  UI: 'Visual / interfaz',
  ACCOUNT: 'Cuenta / login',
  OTHER: 'Otro',
};

export const BUG_LIMITS = { descriptionMin: 10, descriptionMax: 2000, stepsMax: 2000 } as const;

/** Per-account submissions allowed per sliding window (never a permanent block). */
export const BUG_REPORT_RATE = { reports: 5, windowMs: 60 * 60 * 1000 } as const;

export type BugReportRejection = 'BAD_CATEGORY' | 'DESCRIPTION_LENGTH' | 'STEPS_LENGTH' | 'HTML_NOT_ALLOWED' | 'BAD_REQUEST';

export const BUG_REJECTION_LABEL: Record<BugReportRejection, string> = {
  BAD_CATEGORY: 'Elige una categoría válida.',
  DESCRIPTION_LENGTH: `La descripción debe tener entre ${BUG_LIMITS.descriptionMin} y ${BUG_LIMITS.descriptionMax} caracteres.`,
  STEPS_LENGTH: `Los pasos para reproducir admiten hasta ${BUG_LIMITS.stepsMax} caracteres.`,
  HTML_NOT_ALLOWED: 'Escribe el reporte como texto simple, sin etiquetas HTML.',
  BAD_REQUEST: 'El reporte no es válido.',
};

/**
 * Normalises user text: CRLF → LF, control characters removed (tab/newline kept), trimmed.
 * Non-strings become ''.
 */
export function cleanReportText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, '').trim();
}

/** Markup-like text (`<b>`, `</div>`, `<!--`, `<?php`). "<3" or "a < b" are not markup. */
export const containsHtml = (text: string): boolean => /<\s*[/!?]?\s*[a-z]/i.test(text) || /<!--/.test(text);

/** Whitelisted context the client may attach. Every field is optional and small. */
export interface BugReportContext {
  route?: string;
  screen?: string;
  heroId?: string;
  worldId?: string;
  campaignId?: string;
  encounterId?: string;
  scenarioId?: string;
  battleId?: string;
  runId?: string;
  matchId?: string;
  pvpMode?: string;
  deckId?: string;
  /** Real-money order the report is about (our id, never provider data). */
  orderId?: string;
  round?: number;
  turn?: number;
  phase?: string;
  activeFaction?: string;
  buildVersion?: string;
  platform?: string;
  host?: string;
  viewport?: string;
  language?: string;
  clientTime?: number;
  online?: boolean;
  flags?: Record<string, boolean>;
}

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const VERSION = /^[A-Za-z0-9_.+-]{1,64}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;
const VIEWPORT = /^\d{1,5}x\d{1,5}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const FLAG = /^[A-Z0-9_]{1,40}$/;
const MAX_FLAGS = 24;

const ID_FIELDS = ['route', 'screen', 'heroId', 'worldId', 'campaignId', 'encounterId', 'scenarioId', 'battleId', 'runId', 'matchId', 'pvpMode', 'deckId', 'orderId', 'phase', 'activeFaction', 'platform'] as const;

const pick = (value: unknown, pattern: RegExp): string | undefined =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;
const int = (value: unknown, max: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : undefined;

/** Keeps only whitelisted, well-formed fields; anything else (or malformed) is dropped silently. */
export function sanitizeBugContext(raw: unknown): BugReportContext {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: BugReportContext = {};
  for (const key of ID_FIELDS) {
    const v = pick(src[key], ID);
    if (v !== undefined) out[key] = v;
  }
  const extras = {
    round: int(src.round, 100_000),
    turn: int(src.turn, 100_000),
    clientTime: int(src.clientTime, 9_999_999_999_999),
    buildVersion: pick(src.buildVersion, VERSION),
    host: pick(src.host, HOST),
    viewport: pick(src.viewport, VIEWPORT),
    language: pick(src.language, LANGUAGE),
    online: typeof src.online === 'boolean' ? src.online : undefined,
  };
  for (const [k, v] of Object.entries(extras)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  if (typeof src.flags === 'object' && src.flags !== null && !Array.isArray(src.flags)) {
    const flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(src.flags as Record<string, unknown>).slice(0, MAX_FLAGS))
      if (FLAG.test(k) && typeof v === 'boolean') flags[k] = v;
    if (Object.keys(flags).length) out.flags = flags;
  }
  return out;
}

export interface BugReportInput {
  category: BugCategory;
  description: string;
  reproductionSteps: string | null;
  context: BugReportContext;
  /** Client-generated id of this submission (a retry with the same id is stored once). */
  clientReportId: string | null;
}

const CLIENT_REPORT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Validates a request body. Only category/description/reproductionSteps/context/clientReportId are read. */
export function parseBugReport(body: unknown): { ok: true; value: BugReportInput } | { ok: false; reason: BugReportRejection } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'BAD_REQUEST' };
  const b = body as Record<string, unknown>;
  if (typeof b.category !== 'string' || !(BUG_CATEGORIES as readonly string[]).includes(b.category)) return { ok: false, reason: 'BAD_CATEGORY' };
  if (typeof b.description !== 'string') return { ok: false, reason: 'DESCRIPTION_LENGTH' };
  const description = cleanReportText(b.description);
  if (description.length < BUG_LIMITS.descriptionMin || description.length > BUG_LIMITS.descriptionMax) return { ok: false, reason: 'DESCRIPTION_LENGTH' };
  if (b.reproductionSteps !== undefined && b.reproductionSteps !== null && typeof b.reproductionSteps !== 'string') return { ok: false, reason: 'STEPS_LENGTH' };
  const steps = cleanReportText(b.reproductionSteps);
  if (steps.length > BUG_LIMITS.stepsMax) return { ok: false, reason: 'STEPS_LENGTH' };
  if (containsHtml(description) || containsHtml(steps)) return { ok: false, reason: 'HTML_NOT_ALLOWED' };
  return {
    ok: true,
    value: {
      category: b.category as BugCategory,
      description,
      reproductionSteps: steps || null,
      context: sanitizeBugContext(b.context),
      clientReportId: typeof b.clientReportId === 'string' && CLIENT_REPORT_ID.test(b.clientReportId) ? b.clientReportId : null,
    },
  };
}
