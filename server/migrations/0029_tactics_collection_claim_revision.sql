-- Server-only optimistic concurrency for campaign reward claims. No inventory backfill.
-- Every write (including older Workers) advances the revision; repeated seeds are distinct.
ALTER TABLE tactics_hero_campaign_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER tactics_campaign_revision AFTER UPDATE OF run_json ON tactics_hero_campaign_runs
BEGIN
  UPDATE tactics_hero_campaign_runs SET revision = OLD.revision + 1
  WHERE user_id = NEW.user_id AND campaign_id = NEW.campaign_id AND hero_id = NEW.hero_id;
END;
