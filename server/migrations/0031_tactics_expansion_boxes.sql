-- Additive. Old receipts and free-pack identity are deliberately untouched.
CREATE TABLE IF NOT EXISTS tactics_expansion_boxes (
 user_id INTEGER NOT NULL REFERENCES users(id), expansion_id TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0), version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 revision TEXT NOT NULL, initial_json TEXT NOT NULL CHECK(json_valid(initial_json)),
 remaining_json TEXT NOT NULL CHECK(json_valid(remaining_json)), updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,expansion_id)
);
CREATE TABLE IF NOT EXISTS tactics_box_resets (
 user_id INTEGER NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL,
 expansion_id TEXT NOT NULL, from_generation INTEGER NOT NULL, to_generation INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,idempotency_key), UNIQUE(user_id,expansion_id,to_generation)
);
