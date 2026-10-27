-- In-game bug / problem reports (POST /api/tactics/support/bug-reports). Additive only: one new
-- table; no existing table is touched. Rows are written by the Worker for signed-in accounts only
-- (user_id comes from the session, never from the request body).
--
-- Privacy: no session token, Authorization header, cookie, password, promo code or chat content is
-- ever stored. `client_context_json` is a whitelist built by server/src/support.ts (ids, round,
-- turn, flags), never the raw request. Review queries: qa/bug-reporting/REPORT.md.
CREATE TABLE IF NOT EXISTS tactics_bug_reports (
  report_id           TEXT    PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username_snapshot   TEXT    NOT NULL,
  category            TEXT    NOT NULL CHECK (category IN ('BATTLE', 'PROGRESS', 'STORE', 'PVP', 'CARDS', 'UI', 'ACCOUNT', 'OTHER')),
  description         TEXT    NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  reproduction_steps  TEXT    CHECK (reproduction_steps IS NULL OR length(reproduction_steps) <= 2000),
  route               TEXT,
  screen_context      TEXT,
  hero_id             TEXT,
  world_id            TEXT,
  encounter_id        TEXT,
  battle_id           TEXT,
  run_id              TEXT,
  -- PvP: the room code the client plays in (the server-internal match uuid is never sent to clients).
  match_id            TEXT,
  deck_id             TEXT,
  build_version       TEXT,
  client_platform     TEXT,
  client_host         TEXT,
  user_agent          TEXT,
  client_context_json TEXT    NOT NULL DEFAULT '{}',
  server_flags_json   TEXT    NOT NULL DEFAULT '{}',
  -- Client-generated id of one submission: a retried/double-sent report is stored once.
  client_report_id    TEXT,
  status              TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWING', 'RESOLVED', 'CLOSED')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (user_id, client_report_id)
);
CREATE INDEX IF NOT EXISTS idx_tactics_bug_reports_user ON tactics_bug_reports(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tactics_bug_reports_status ON tactics_bug_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tactics_bug_reports_category ON tactics_bug_reports(category, created_at);
