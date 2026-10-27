-- Social phase: lets presence (IN_PVP) and invites (busy check) tell a started match from an open
-- lobby. Additive: one nullable column; existing rows stay NULL (= not started).
ALTER TABLE tactics_pvp_rooms ADD COLUMN started_at INTEGER;
