-- Preserve every legacy row and the original table as an archival safety copy.
-- No user/account tables changed. No data deletion. Apply once through migration tooling.
ALTER TABLE tactics_bug_reports RENAME TO tactics_bug_reports_pre_public;
CREATE TABLE tactics_bug_reports (
  contact_email       TEXT,
  public_reason       TEXT,
  transaction_reference TEXT,
  consent_version     TEXT,
  requester_hash      TEXT,
  report_id           TEXT    PRIMARY KEY,
  user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO tactics_bug_reports (report_id, user_id, username_snapshot, category, description, reproduction_steps, route, screen_context, hero_id, world_id, encounter_id, battle_id, run_id, match_id, deck_id, build_version, client_platform, client_host, user_agent, client_context_json, server_flags_json, client_report_id, status, created_at, updated_at) SELECT report_id, user_id, username_snapshot, category, description, reproduction_steps, route, screen_context, hero_id, world_id, encounter_id, battle_id, run_id, match_id, deck_id, build_version, client_platform, client_host, user_agent, client_context_json, server_flags_json, client_report_id, status, created_at, updated_at FROM tactics_bug_reports_pre_public;
CREATE INDEX idx_support_user ON tactics_bug_reports(user_id, created_at);
CREATE INDEX idx_support_status ON tactics_bug_reports(status, created_at);
CREATE INDEX idx_support_category ON tactics_bug_reports(category, created_at);
CREATE INDEX idx_support_public_rate ON tactics_bug_reports(requester_hash, created_at);
