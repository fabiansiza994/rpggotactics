-- Social phase: friends, blocks, private 1:1 chat, PvP invites, reports, presence, rate limits.
-- Additive only: new tables; no existing table or RPG-GO table is modified.
--
-- Identity is always users(id). Usernames are only looked up at the API boundary (search,
-- "send request to <username>") and never stored here. Every row cascades when an RPG-GO
-- account is deleted (DELETE FROM users), except reports, which keep the reporter's evidence
-- with the reported account set to NULL.

-- One row per unordered pair (user_low < user_high): a pending request or a friendship.
-- requested_by says who sent the pending request. Blocks live in their own table (directional).
CREATE TABLE IF NOT EXISTS tactics_social_relationships (
  user_low      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED')),
  requested_by  INTEGER NOT NULL CHECK (requested_by IN (user_low, user_high)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);
CREATE INDEX IF NOT EXISTS idx_tactics_social_rel_high ON tactics_social_relationships(user_high, status);

-- Directional: blocker hides from blocked. Either direction blocks requests, chat and invites.
CREATE TABLE IF NOT EXISTS tactics_social_blocks (
  blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_tactics_social_blocks_blocked ON tactics_social_blocks(blocked_id);

-- Exactly one conversation per pair (canonical order). It outlives the friendship (history stays
-- readable; sending needs an ACCEPTED friendship and no block) and is reused if they re-friend.
CREATE TABLE IF NOT EXISTS tactics_conversations (
  conversation_id  TEXT    PRIMARY KEY,
  user_low         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       INTEGER NOT NULL,
  last_message_at  INTEGER,
  UNIQUE (user_low, user_high),
  CHECK (user_low < user_high)
);
CREATE INDEX IF NOT EXISTS idx_tactics_conversations_high ON tactics_conversations(user_high);

-- Plain text only (rendered escaped). Retention: the newest 200 per conversation (pruned on insert).
CREATE TABLE IF NOT EXISTS tactics_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT    NOT NULL REFERENCES tactics_conversations(conversation_id) ON DELETE CASCADE,
  sender_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at       INTEGER NOT NULL,
  read_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tactics_messages_conv ON tactics_messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_tactics_messages_sender ON tactics_messages(sender_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tactics_messages_unread ON tactics_messages(conversation_id, read_at) WHERE read_at IS NULL;

-- PvP challenges between friends. Short-lived (3 minutes); room_code is set on accept and points
-- at the ordinary private room (tactics_pvp_rooms). Rows older than a day are pruned.
CREATE TABLE IF NOT EXISTS tactics_pvp_invites (
  invite_id     TEXT    PRIMARY KEY,
  from_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode          TEXT    NOT NULL CHECK (mode IN ('DUEL', 'DOMINION')),
  map_id        TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  room_code     TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  responded_at  INTEGER,
  CHECK (from_user_id <> to_user_id)
);
-- At most one pending invite per direction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tactics_pvp_invites_pending ON tactics_pvp_invites(from_user_id, to_user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_tactics_pvp_invites_to ON tactics_pvp_invites(to_user_id, status);

-- Moderation MVP: stored for later review; nothing acts on them automatically.
-- message_body is a snapshot of the reported message (messages are pruned by retention).
CREATE TABLE IF NOT EXISTS tactics_social_reports (
  report_id       TEXT    PRIMARY KEY,
  reporter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message_id      INTEGER,
  message_body    TEXT,
  reason          TEXT    NOT NULL CHECK (reason IN ('SPAM', 'HARASSMENT', 'OFFENSIVE_CONTENT', 'OTHER')),
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tactics_social_reports_reporter ON tactics_social_reports(reporter_id, created_at);

-- Approximate presence: one overwritten row per user (no activity log). Written by the user's
-- social hub when its socket opens/closes and on a throttled heartbeat.
CREATE TABLE IF NOT EXISTS tactics_social_presence (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  online     INTEGER NOT NULL CHECK (online IN (0, 1)),
  last_seen  INTEGER NOT NULL
);

-- Sliding-window rate limits (search, request, message, invite, report). Rows older than an
-- hour are deleted on the next write by the same user.
CREATE TABLE IF NOT EXISTS tactics_social_rate_events (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tactics_social_rate ON tactics_social_rate_events(user_id, action, created_at);
