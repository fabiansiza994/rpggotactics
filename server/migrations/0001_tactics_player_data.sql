-- RPG-GO Tactics player data. Lives in the EXISTING D1 database `rpggo-auth` next to the
-- RPG-GO account tables (`users`, `sessions`), which this migration never modifies.
--
-- Ownership: every row belongs to users(id) — the stable numeric account id, never the
-- username. ON DELETE CASCADE means RPG-GO's account deletion (DELETE FROM users, see the
-- auth Worker's /api/account) also removes all Tactics data; D1 enforces foreign keys.
--
-- Additive and idempotent (CREATE ... IF NOT EXISTS): safe to re-run.
-- Card / hero / encounter ids reference the static game content (src/game/data), not tables.

-- One row per player: identity-level settings.
CREATE TABLE IF NOT EXISTS tactics_profiles (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name            TEXT    NOT NULL,
  selected_champion_id    TEXT    NOT NULL,
  save_version            INTEGER NOT NULL,
  migrated_from_local_at  INTEGER,            -- set once if a device's local save was imported
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

-- Card ownership: copies a player owns per champion (collections are per champion).
-- Only server-side operations write here (starter set, validated rewards, one-time import).
CREATE TABLE IF NOT EXISTS tactics_player_cards (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id      TEXT    NOT NULL,
  card_id      TEXT    NOT NULL,
  copies       INTEGER NOT NULL CHECK (copies >= 0),
  acquired     INTEGER NOT NULL,              -- acquisition order per champion (0 = starter)
  source       TEXT    NOT NULL,              -- STARTER | CAMPAIGN_REWARD | LOCAL_IMPORT
  unlocked_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, hero_id, card_id)
);

-- Decks belong to user + champion; several per champion are allowed, one is active.
CREATE TABLE IF NOT EXISTS tactics_decks (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id     TEXT    NOT NULL,
  deck_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, hero_id, deck_id)
);

CREATE TABLE IF NOT EXISTS tactics_deck_cards (
  user_id  INTEGER NOT NULL,
  hero_id  TEXT    NOT NULL,
  deck_id  TEXT    NOT NULL,
  card_id  TEXT    NOT NULL,
  count    INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (user_id, hero_id, deck_id, card_id),
  FOREIGN KEY (user_id, hero_id, deck_id) REFERENCES tactics_decks(user_id, hero_id, deck_id) ON DELETE CASCADE
);

-- Campaign progression: the versioned RunState (same format as the local save), only ever
-- written by server-validated steps (start, replay-verified victory, offered reward).
CREATE TABLE IF NOT EXISTS tactics_campaign_runs (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   TEXT    NOT NULL,
  run_json      TEXT    NOT NULL,
  save_version  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, campaign_id)
);
