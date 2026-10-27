-- Additive Dominion metadata; existing records default to their original Duel mode.
ALTER TABLE tactics_pvp_matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'DUEL';
ALTER TABLE tactics_pvp_matches ADD COLUMN score_a INTEGER;
ALTER TABLE tactics_pvp_matches ADD COLUMN score_b INTEGER;
ALTER TABLE tactics_pvp_matches ADD COLUMN rounds INTEGER;
