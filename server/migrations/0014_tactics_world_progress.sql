-- Campaign worlds: durable per-champion world achievements. Additive only.
--
-- A world's runs keep living in tactics_hero_campaign_runs (campaign_id 'ascent' = World 1,
-- 'infernal' = World 2): no run is rewritten or moved. This table only records what a run
-- cannot keep once the world is replayed: "this champion defeated this world's boss", and when
-- its one-time completion reward was paid.
--
-- No backfill: World 1 completion for existing accounts is DERIVED at read time (a COMPLETED
-- 'ascent' run, or a replay-verified victory of ascent_10_colossus in tactics_reward_log), so
-- legacy players see World 2 unlocked without any data change, and the row is written the next
-- time a boss is defeated.
--
-- Rollback: the previous Worker never reads this table; World 2 runs it cannot parse are simply
-- ignored by it (its loadPlayer only reads campaign_id 'ascent').

CREATE TABLE IF NOT EXISTS tactics_world_progress (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id            TEXT    NOT NULL,
  world_id           TEXT    NOT NULL,
  completed_at       INTEGER NOT NULL,
  -- One-time completion reward (crystals via the wallet ledger, reason ACHIEVEMENT_REWARD,
  -- reference 'world:<world_id>:<hero_id>' — that ledger UNIQUE key is the hard idempotency
  -- guarantee). NULL = the world has no reward or it has not been paid.
  reward_granted_at  INTEGER,
  PRIMARY KEY (user_id, hero_id, world_id)
);
