-- Story-only additive extension. Run atomically; leaves Story writes SEALED, not ACTIVE.
-- No wallet, collection, reward, purchase, deck or existing cohort DML.
CREATE TABLE IF NOT EXISTS tactics_story_rule_versions(engine TEXT PRIMARY KEY);
INSERT OR IGNORE INTO tactics_story_rule_versions VALUES('pre-winter-b0e18cc8'),('winter-dominion-1'),('universal-cards-1');
CREATE TABLE IF NOT EXISTS tactics_story_rule_transition(id INTEGER PRIMARY KEY CHECK(id=1),phase TEXT NOT NULL CHECK(phase IN('PREPARING','SEALED','ACTIVE')),engine TEXT NOT NULL REFERENCES tactics_story_rule_versions(engine));
INSERT OR IGNORE INTO tactics_story_rule_transition VALUES(1,'PREPARING','universal-cards-1');
CREATE TRIGGER IF NOT EXISTS tactics_story_rule_phase_guard BEFORE UPDATE ON tactics_story_rule_transition WHEN NEW.id<>OLD.id OR (NEW.phase='PREPARING' AND OLD.phase<>'PREPARING') OR (NEW.engine<>OLD.engine AND OLD.phase='ACTIVE') BEGIN SELECT RAISE(ABORT,'STORY_RULE_TRANSITION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS tactics_story_rule_no_delete BEFORE DELETE ON tactics_story_rule_transition BEGIN SELECT RAISE(ABORT,'STORY_RULE_TRANSITION_IMMUTABLE'); END;
-- Installed before capture: even a Winter request with an old server timestamp cannot write late.
CREATE TRIGGER IF NOT EXISTS tactics_story_version_writer BEFORE INSERT ON tactics_story_write_tickets BEGIN
 SELECT CASE WHEN json_extract(NEW.run_json,'$.storyWriter') IS NOT 'universal-cards-1' THEN RAISE(ABORT,'STORY_VERSION_WRITER_FENCED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_rule_transition WHERE id=1 AND phase='ACTIVE') THEN RAISE(ABORT,'STORY_RULE_TRANSITION_PAUSED') END;
END;
CREATE TABLE IF NOT EXISTS tactics_story_versioned_encounters(
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,campaign_id TEXT NOT NULL,hero_id TEXT NOT NULL,
 run_seed INTEGER NOT NULL,encounter_id TEXT NOT NULL,engine TEXT NOT NULL REFERENCES tactics_story_rule_versions(engine),
 run_json TEXT NOT NULL,snapshot_json TEXT,closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN(0,1)),
 PRIMARY KEY(user_id,campaign_id,hero_id)
);
-- Membership is the existing authoritative admission AND matching effective run, never client time.
INSERT OR IGNORE INTO tactics_story_versioned_encounters(user_id,campaign_id,hero_id,run_seed,encounter_id,engine,run_json,closed)
 SELECT a.user_id,a.campaign_id,a.hero_id,a.run_seed,a.encounter_id,a.engine,h.run_json,CASE WHEN json_extract(h.run_json,'$.run.status')='IN_BATTLE' THEN 0 ELSE 1 END
 FROM tactics_story_admissions a JOIN tactics_hero_campaign_runs h ON h.user_id=a.user_id AND h.campaign_id=a.campaign_id AND h.hero_id=a.hero_id
 WHERE (SELECT phase FROM tactics_story_rule_transition WHERE id=1)='PREPARING'
 AND json_extract(h.run_json,'$.run.seed')=a.run_seed AND json_extract(h.run_json,'$.run.currentEncounterId')=a.encounter_id;
INSERT OR IGNORE INTO tactics_story_versioned_encounters(user_id,campaign_id,hero_id,run_seed,encounter_id,engine,run_json,closed)
 SELECT c.user_id,c.campaign_id,c.hero_id,a.run_seed,a.encounter_id,a.engine,c.run_json,c.closed FROM tactics_story_legacy_cohort c JOIN tactics_story_admissions a ON a.user_id=c.user_id AND a.campaign_id=c.campaign_id AND a.hero_id=c.hero_id
 WHERE (SELECT phase FROM tactics_story_rule_transition WHERE id=1)='PREPARING' AND a.engine='pre-winter-b0e18cc8' AND c.closed=0 AND json_extract(c.run_json,'$.run.seed')=a.run_seed AND json_extract(c.run_json,'$.run.currentEncounterId')=a.encounter_id;
CREATE TABLE IF NOT EXISTS tactics_story_verified_proofs(
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,digest TEXT NOT NULL CHECK(length(digest)=64),engine TEXT NOT NULL REFERENCES tactics_story_rule_versions(engine),campaign_id TEXT NOT NULL,hero_id TEXT NOT NULL,run_seed INTEGER NOT NULL,encounter_id TEXT NOT NULL,
 PRIMARY KEY(user_id,digest)
);
CREATE TRIGGER IF NOT EXISTS tactics_story_versioned_insert BEFORE INSERT ON tactics_story_versioned_encounters BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_write_tickets t WHERE t.user_id=NEW.user_id AND t.campaign_id=NEW.campaign_id AND t.hero_id=NEW.hero_id AND t.run_json=NEW.run_json) THEN RAISE(ABORT,'STORY_VERSION_WRITER_FENCED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tactics_story_versioned_encounters e WHERE e.user_id=NEW.user_id AND e.campaign_id=NEW.campaign_id AND e.hero_id=NEW.hero_id AND e.run_seed=NEW.run_seed AND e.encounter_id=NEW.encounter_id AND e.engine=NEW.engine) AND NEW.engine IS NOT CASE WHEN EXISTS(SELECT 1 FROM tactics_story_legacy_cohort c WHERE c.user_id=NEW.user_id AND c.campaign_id=NEW.campaign_id AND c.hero_id=NEW.hero_id AND c.closed=0) THEN 'pre-winter-b0e18cc8' ELSE (SELECT engine FROM tactics_story_rule_transition WHERE id=1) END THEN RAISE(ABORT,'STORY_VERSION_NOT_ADMITTED') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_story_versioned_update BEFORE UPDATE ON tactics_story_versioned_encounters BEGIN
 SELECT CASE WHEN NEW.user_id<>OLD.user_id OR NEW.campaign_id<>OLD.campaign_id OR NEW.hero_id<>OLD.hero_id THEN RAISE(ABORT,'STORY_VERSION_IDENTITY') END;
 SELECT CASE WHEN NEW.run_seed=OLD.run_seed AND NEW.encounter_id=OLD.encounter_id AND (NEW.engine<>OLD.engine OR NEW.closed<OLD.closed OR (OLD.snapshot_json IS NOT NULL AND NEW.snapshot_json IS NOT OLD.snapshot_json)) THEN RAISE(ABORT,'STORY_VERSION_IMMUTABLE') END;
 SELECT CASE WHEN OLD.closed=0 AND OLD.engine<>(SELECT engine FROM tactics_story_rule_transition WHERE id=1) AND (NEW.run_seed<>OLD.run_seed OR NEW.encounter_id<>OLD.encounter_id) THEN RAISE(ABORT,'LEGACY_ENCOUNTER_PENDING') END;
 SELECT CASE WHEN (NEW.run_seed<>OLD.run_seed OR NEW.encounter_id<>OLD.encounter_id) AND NEW.engine<>(SELECT engine FROM tactics_story_rule_transition WHERE id=1) THEN RAISE(ABORT,'STORY_VERSION_NOT_ADMITTED') END;
 SELECT CASE WHEN NEW.run_json IS NOT OLD.run_json AND NOT EXISTS(SELECT 1 FROM tactics_story_write_tickets t WHERE t.user_id=NEW.user_id AND t.campaign_id=NEW.campaign_id AND t.hero_id=NEW.hero_id AND t.run_json=NEW.run_json) THEN RAISE(ABORT,'STORY_VERSION_WRITER_FENCED') END;
END;
CREATE TRIGGER IF NOT EXISTS tactics_story_versioned_delete BEFORE DELETE ON tactics_story_versioned_encounters WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'STORY_VERSION_IMMUTABLE'); END;
UPDATE tactics_story_rule_transition SET phase='SEALED' WHERE id=1 AND phase='PREPARING';
