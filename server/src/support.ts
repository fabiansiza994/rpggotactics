import {
  BUG_REJECTION_LABEL,
  BUG_REPORT_RATE,
  parseBugReport,
  type BugReportContext,
} from '../../src/game/support/bugReport';
import type { Env } from './db';
import { error, json } from './http';
import type { Caller } from './index';

/**
 * In-game bug reports: POST /api/tactics/support/bug-reports. Needs a session (guests get the
 * Worker's 401 before reaching this), but not a Tactics profile. Identity is the session's; the
 * body's category/description/steps/context are validated by parseBugReport and the context is a
 * whitelist. From the request itself only User-Agent and Origin are kept — never Authorization,
 * cookies or other headers.
 */

const ROUTE = '/api/tactics/support/bug-reports';
const MAX_BODY_BYTES = 16 * 1024;
const USER_AGENT_MAX = 300;

/** Release switches worth knowing when triaging (public values from wrangler.toml [vars]). */
const SERVER_FLAGS = [
  'WARRIOR_ENABLED',
  'WARRIOR_QA',
  'SUMMONER_CAMPAIGN',
  'SUMMONER_CAMPAIGN_QA',
  'SUMMONER_RITUALS_ENABLED',
  'ARSENAL_CARDS_ENABLED',
  'TACTICAL_CARDS_ENABLED',
  'STORE_SHOWCASE_ENABLED',
  'WORLD_2_ENABLED',
  'WORLD_2_QA',
] as const satisfies readonly (keyof Env)[];

export interface SupportDeps {
  now: number;
  newId(): string;
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const oneLine = (value: string | null, max: number) =>
  // eslint-disable-next-line no-control-regex
  value ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) || null : null;

/** The Origin header's host (the page the report came from), when it is a plain http(s) origin. */
function originHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'capacitor:' ? url.host.slice(0, 253) || null : null;
  } catch {
    return null;
  }
}

/** Bug report route; null = not this route. */
export async function supportRoute(request: Request, env: Env, caller: Caller, deps: SupportDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path !== ROUTE) return null;
  if (request.method !== 'POST') return error(405, 'BAD_METHOD', 'Método no permitido.');
  const db = env.DB;
  const { now } = deps;

  const parsed = parseBugReport(await readBody(request));
  if (!parsed.ok) return error(400, parsed.reason, BUG_REJECTION_LABEL[parsed.reason]);
  const report = parsed.value;

  // A retry of the same submission (double click, lost response) answers with the stored report.
  // Checked before the rate limit so a retry never counts as a new report.
  if (report.clientReportId) {
    const previous = await db
      .prepare('SELECT report_id FROM tactics_bug_reports WHERE user_id = ? AND client_report_id = ?')
      .bind(caller.userId, report.clientReportId)
      .first<{ report_id: string }>();
    if (previous) return json({ success: true, reportId: previous.report_id, replayed: true });
  }

  const recent = await db
    .prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM tactics_bug_reports WHERE user_id = ? AND created_at > ?')
    .bind(caller.userId, now - BUG_REPORT_RATE.windowMs)
    .first<{ n: number; oldest: number | null }>();
  if ((recent?.n ?? 0) >= BUG_REPORT_RATE.reports) {
    const retryAfterMs = Math.max(1000, (recent?.oldest ?? now) + BUG_REPORT_RATE.windowMs - now);
    return error(429, 'RATE_LIMITED', 'Enviaste varios reportes seguidos. Intenta de nuevo más tarde.', { retryAfterMs });
  }

  const ctx: BugReportContext = report.context;
  const serverFlags: Record<string, string> = {};
  for (const flag of SERVER_FLAGS) if (env[flag] !== undefined) serverFlags[flag] = String(env[flag]);
  const reportId = `bug_${deps.newId()}`;
  try {
    await db
      .prepare(
        `INSERT INTO tactics_bug_reports (report_id, user_id, username_snapshot, category, description, reproduction_steps,
           route, screen_context, hero_id, world_id, encounter_id, battle_id, run_id, match_id, deck_id,
           build_version, client_platform, client_host, user_agent, client_context_json, server_flags_json,
           client_report_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
      )
      .bind(
        reportId,
        caller.userId,
        caller.username,
        report.category,
        report.description,
        report.reproductionSteps,
        ctx.route ?? null,
        ctx.screen ?? null,
        ctx.heroId ?? null,
        ctx.worldId ?? null,
        ctx.encounterId ?? null,
        ctx.battleId ?? null,
        ctx.runId ?? null,
        ctx.matchId ?? null,
        ctx.deckId ?? null,
        ctx.buildVersion ?? null,
        ctx.platform ?? null,
        originHost(request.headers.get('Origin')) ?? ctx.host ?? null,
        oneLine(request.headers.get('User-Agent'), USER_AGENT_MAX),
        JSON.stringify(ctx),
        JSON.stringify(serverFlags),
        report.clientReportId,
        now,
        now,
      )
      .run();
  } catch {
    // Same clientReportId raced in from a concurrent request: that one was stored.
    if (report.clientReportId) {
      const raced = await db
        .prepare('SELECT report_id FROM tactics_bug_reports WHERE user_id = ? AND client_report_id = ?')
        .bind(caller.userId, report.clientReportId)
        .first<{ report_id: string }>();
      if (raced) return json({ success: true, reportId: raced.report_id, replayed: true });
    }
    return error(500, 'SERVER_ERROR', 'No pudimos guardar el reporte.');
  }
  return json({ success: true, reportId });
}
