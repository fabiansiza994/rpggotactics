-- 0035: Story-only sealed cohort and transactional writer fence. No economic DML.
-- Re-runnable. Install all fences BEFORE capture; incomplete execution fails closed.
CREATE TABLE IF NOT EXISTS tactics_winter_transition (
 id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT NOT NULL CHECK(phase IN ('PREPARING','SEALED','ACTIVE')),
 engine TEXT NOT NULL CHECK(engine='winter-dominion-1')
);
INSERT OR IGNORE INTO tactics_winter_transition VALUES(1,'PREPARING','winter-dominion-1');
CREATE TRIGGER IF NOT EXISTS tactics_winter_phase_guard BEFORE UPDATE ON tactics_winter_transition WHEN NEW.id<>OLD.id OR NEW.engine<>OLD.engine OR NEW.phase='PREPARING' AND OLD.phase<>'PREPARING' BEGIN SELECT RAISE(ABORT,'STORY_TRANSITION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS tactics_winter_no_delete BEFORE DELETE ON tactics_winter_transition BEGIN SELECT RAISE(ABORT,'STORY_TRANSITION_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS tactics_story_legacy_cohort (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, campaign_id TEXT NOT NULL, hero_id TEXT NOT NULL,
 engine TEXT NOT NULL DEFAULT 'pre-winter-b0e18cc8' CHECK(engine='pre-winter-b0e18cc8'),
 run_json TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),
 snapshot_json TEXT, proof_digest TEXT,
 PRIMARY KEY(user_id,campaign_id,hero_id),
 CHECK((closed=0 AND proof_digest IS NULL) OR (closed=1 AND length(proof_digest)=64))
);
CREATE TABLE IF NOT EXISTS tactics_story_admissions (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, campaign_id TEXT NOT NULL, hero_id TEXT NOT NULL,
 run_seed INTEGER NOT NULL, encounter_id TEXT NOT NULL,
 engine TEXT NOT NULL CHECK(engine IN ('pre-winter-b0e18cc8','winter-dominion-1')),
 PRIMARY KEY(user_id,campaign_id,hero_id)
);
-- A ticket exists ONLY inside a single atomic db.batch. It authorizes exact JSON, never a client version.
CREATE TABLE IF NOT EXISTS tactics_story_write_tickets (
 token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, campaign_id TEXT NOT NULL, hero_id TEXT NOT NULL, run_json TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS tactics_story_ticket_phase BEFORE INSERT ON tactics_story_write_tickets BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_winter_transition WHERE id=1 AND phase='ACTIVE') THEN RAISE(ABORT,'STORY_TRANSITION_PAUSED') END;
 SELECT CASE WHEN json_extract(NEW.run_json,'$.run.campaignId') IS NOT NEW.campaign_id OR json_extract(NEW.run_json,'$.run.heroId') IS NOT NEW.hero_id OR json_extract(NEW.run_json,'$.winterWrite') IS NOT NEW.token THEN RAISE(ABORT,'STORY_TICKET_IDENTITY') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tactics_story_legacy_cohort c WHERE c.user_id=NEW.user_id AND c.campaign_id=NEW.campaign_id AND c.hero_id=NEW.hero_id AND c.closed=0 AND json_extract(c.run_json,'$.run') IS NOT json_extract(NEW.run_json,'$.run')) THEN RAISE(ABORT,'LEGACY_ENCOUNTER_PENDING') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_hero_campaign_runs_winter_insert BEFORE INSERT ON tactics_hero_campaign_runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_write_tickets t WHERE t.token=json_extract(NEW.run_json,'$.winterWrite') AND t.user_id=NEW.user_id AND t.campaign_id=NEW.campaign_id AND t.hero_id=NEW.hero_id AND t.run_json=NEW.run_json) THEN RAISE(ABORT,'STORY_WRITER_FENCED') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_hero_campaign_runs_winter_update BEFORE UPDATE OF run_json, save_version, updated_at, user_id, campaign_id, hero_id ON tactics_hero_campaign_runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_write_tickets t WHERE t.token=json_extract(NEW.run_json,'$.winterWrite') AND t.user_id=NEW.user_id AND t.campaign_id=NEW.campaign_id AND t.hero_id=NEW.hero_id AND t.run_json=NEW.run_json) THEN RAISE(ABORT,'STORY_WRITER_FENCED') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_hero_campaign_runs_winter_delete BEFORE DELETE ON tactics_hero_campaign_runs WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'STORY_WRITER_FENCED'); END;
CREATE TRIGGER IF NOT EXISTS tactics_campaign_runs_winter_insert BEFORE INSERT ON tactics_campaign_runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_write_tickets t WHERE t.token=json_extract(NEW.run_json,'$.winterWrite') AND t.user_id=NEW.user_id AND t.campaign_id=NEW.campaign_id AND t.hero_id='mage' AND t.run_json=NEW.run_json) THEN RAISE(ABORT,'STORY_WRITER_FENCED') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_campaign_runs_winter_update BEFORE UPDATE OF run_json, save_version, updated_at, user_id, campaign_id ON tactics_campaign_runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_write_tickets t WHERE t.token=json_extract(NEW.run_json,'$.winterWrite') AND t.user_id=NEW.user_id AND t.campaign_id=NEW.campaign_id AND t.hero_id='mage' AND t.run_json=NEW.run_json) THEN RAISE(ABORT,'STORY_WRITER_FENCED') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_campaign_runs_winter_delete BEFORE DELETE ON tactics_campaign_runs WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'STORY_WRITER_FENCED'); END;
CREATE TRIGGER IF NOT EXISTS tactics_story_cohort_no_insert BEFORE INSERT ON tactics_story_legacy_cohort WHEN (SELECT phase FROM tactics_winter_transition WHERE id=1)<>'PREPARING' BEGIN SELECT RAISE(ABORT,'STORY_COHORT_SEALED'); END;
CREATE TRIGGER IF NOT EXISTS tactics_story_cohort_no_delete BEFORE DELETE ON tactics_story_legacy_cohort WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'STORY_COHORT_SEALED'); END;
CREATE TRIGGER IF NOT EXISTS tactics_story_cohort_identity BEFORE UPDATE ON tactics_story_legacy_cohort WHEN NEW.user_id<>OLD.user_id OR NEW.campaign_id<>OLD.campaign_id OR NEW.hero_id<>OLD.hero_id OR NEW.run_json<>OLD.run_json OR NEW.engine<>OLD.engine OR NEW.closed<OLD.closed OR (OLD.proof_digest IS NOT NULL AND NEW.proof_digest IS NOT OLD.proof_digest) OR (OLD.snapshot_json IS NOT NULL AND NEW.snapshot_json IS NOT OLD.snapshot_json) BEGIN SELECT RAISE(ABORT,'STORY_COHORT_IMMUTABLE'); END;
-- Effective Mage row follows the published loadPlayer precedence; no timestamp cutoff infers membership.
INSERT OR IGNORE INTO tactics_story_legacy_cohort(user_id,campaign_id,hero_id,run_json)
 SELECT h.user_id,h.campaign_id,h.hero_id,CASE WHEN h.hero_id='mage' AND h.campaign_id='ascent' AND l.updated_at>h.updated_at THEN l.run_json ELSE h.run_json END
 FROM tactics_hero_campaign_runs h LEFT JOIN tactics_campaign_runs l ON l.user_id=h.user_id AND l.campaign_id=h.campaign_id
 WHERE (SELECT phase FROM tactics_winter_transition WHERE id=1)='PREPARING'
 AND json_extract(CASE WHEN h.hero_id='mage' AND h.campaign_id='ascent' AND l.updated_at>h.updated_at THEN l.run_json ELSE h.run_json END,'$.run.status')='IN_BATTLE';
INSERT OR IGNORE INTO tactics_story_legacy_cohort(user_id,campaign_id,hero_id,run_json)
 SELECT l.user_id,l.campaign_id,'mage',l.run_json FROM tactics_campaign_runs l
 WHERE (SELECT phase FROM tactics_winter_transition WHERE id=1)='PREPARING' AND l.campaign_id='ascent' AND json_extract(l.run_json,'$.run.status')='IN_BATTLE'
 AND NOT EXISTS(SELECT 1 FROM tactics_hero_campaign_runs h WHERE h.user_id=l.user_id AND h.campaign_id=l.campaign_id AND h.hero_id='mage');
INSERT OR IGNORE INTO tactics_story_admissions(user_id,campaign_id,hero_id,run_seed,encounter_id,engine)
 SELECT user_id,campaign_id,hero_id,json_extract(run_json,'$.run.seed'),json_extract(run_json,'$.run.currentEncounterId'),'pre-winter-b0e18cc8' FROM tactics_story_legacy_cohort
 WHERE (SELECT phase FROM tactics_winter_transition WHERE id=1)='PREPARING';
UPDATE tactics_winter_transition SET phase='SEALED' WHERE id=1 AND phase='PREPARING';
