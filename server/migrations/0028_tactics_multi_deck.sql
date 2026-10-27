-- Multi-deck per champion (several saved decks, one default each). Additive (applied once by
-- wrangler): no deck, card or row is removed and no card list changes. Existing decks keep
-- their names ("Mazo principal"), their cards and their default flag.
--
-- tactics_decks (0001) already keys decks by (user_id, hero_id, deck_id), so a deck belongs to
-- exactly one account and one champion. `is_active` stays the column name; the API calls it
-- the champion's DEFAULT deck. The slot limit (DEFAULT_DECK_SLOTS_PER_CHAMPION) lives in code
-- and is enforced by the Worker's conditional INSERTs, so it can grow without a schema change.
--
-- Apply BEFORE the Worker that reads `created_at` / writes `deck_id` on ranked tickets.

-- Creation time: deterministic ordering (and the default fallback after a delete). Existing
-- decks (one per champion before this migration) take their last update as their creation time.
ALTER TABLE tactics_decks ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
UPDATE tactics_decks SET created_at = updated_at WHERE created_at = 0;

-- Never two defaults for one champion. Older Workers only ever wrote one, but normalise first so
-- the unique index cannot fail on unexpected data: keep the smallest deck_id among the actives.
UPDATE tactics_decks SET is_active = 0
WHERE is_active = 1 AND deck_id <> (
  SELECT MIN(d.deck_id) FROM tactics_decks d
  WHERE d.user_id = tactics_decks.user_id AND d.hero_id = tactics_decks.hero_id AND d.is_active = 1
);
-- A champion with stored decks but none marked default gets its oldest deck as default.
UPDATE tactics_decks SET is_active = 1
WHERE deck_id = (
  SELECT d.deck_id FROM tactics_decks d
  WHERE d.user_id = tactics_decks.user_id AND d.hero_id = tactics_decks.hero_id
  ORDER BY d.created_at, d.deck_id LIMIT 1
) AND NOT EXISTS (
  SELECT 1 FROM tactics_decks d
  WHERE d.user_id = tactics_decks.user_id AND d.hero_id = tactics_decks.hero_id AND d.is_active = 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tactics_decks_one_default
  ON tactics_decks(user_id, hero_id) WHERE is_active = 1;

-- Ranked: the deck chosen when queueing. NULL = the champion's default deck (older clients).
ALTER TABLE tactics_ranked_queue ADD COLUMN deck_id TEXT;
