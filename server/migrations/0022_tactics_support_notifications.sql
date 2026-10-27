-- Notification metadata only. No new ticket store and no personal email address in schema.
CREATE TABLE tactics_support_notifications (
 report_id TEXT PRIMARY KEY REFERENCES tactics_bug_reports(report_id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','RETRY','ACCEPTED','FAILED','UNCERTAIN')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at INTEGER NOT NULL,
 claim_id TEXT,
 claimed_at INTEGER,
 accepted_at INTEGER,
 provider_message_id TEXT,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX idx_support_notification_due ON tactics_support_notifications(status,next_attempt_at);
CREATE TRIGGER tactics_support_notification_created AFTER INSERT ON tactics_bug_reports
BEGIN
 INSERT INTO tactics_support_notifications(report_id,next_attempt_at,created_at,updated_at)
 VALUES(NEW.report_id,NEW.created_at,NEW.created_at,NEW.created_at);
END;
CREATE TABLE tactics_support_notes (
 note_id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL REFERENCES tactics_bug_reports(report_id) ON DELETE CASCADE,
 actor TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('NOTE','EXTERNAL_REPLY_RECORDED')),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_support_note_report ON tactics_support_notes(report_id,created_at);
-- Records an operator-confirmed external reply; this never sends email or claims automatic delivery.
CREATE TRIGGER tactics_support_reply_recorded AFTER INSERT ON tactics_support_notes
WHEN NEW.kind='EXTERNAL_REPLY_RECORDED'
BEGIN
 UPDATE tactics_bug_reports SET status=CASE WHEN status='OPEN' THEN 'REVIEWING' ELSE status END,
 updated_at=NEW.created_at WHERE report_id=NEW.report_id;
END;
-- Public form retries share a stable random submission id and fingerprint, not a second ticket.
ALTER TABLE tactics_bug_reports ADD COLUMN public_submission_id TEXT;
ALTER TABLE tactics_bug_reports ADD COLUMN public_submission_hash TEXT;
CREATE UNIQUE INDEX uq_support_public_submission ON tactics_bug_reports(public_submission_id) WHERE public_submission_id IS NOT NULL;
