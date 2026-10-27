-- Additive cosmetic preference only. No wallet, auth or gameplay changes.
CREATE TABLE IF NOT EXISTS tactics_profile_avatars (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 avatar_id TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
