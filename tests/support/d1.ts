import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement } from '../../server/src/db';

/** The RPG-GO auth tables this API reads (same columns as RPG-GO/worker-auth/schema.sql). */
const AUTH_SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  salt TEXT NOT NULL, created_at INTEGER NOT NULL, recovery_code_hash TEXT, recovery_code_salt TEXT);
CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`;

/**
 * In-memory D1 stand-in: real SQLite, foreign keys enforced like D1, batch = one transaction.
 * `legacyProfiles` makes every created profile behave like an account from before champion
 * unlocks (migration 0012 backfill: open roster) — for suites about other features.
 */
export function memoryD1(options: { legacyProfiles?: boolean } = {}): D1Database & { sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON;');
  sql.exec(AUTH_SCHEMA);
  for (const file of ['0001_tactics_player_data.sql', '0002_tactics_card_progression.sql', '0003_tactics_skirmishes.sql', '0007_tactics_store_economy.sql', '0008_tactics_cosmetic_equip.sql', '0011_tactics_campaign_runs_per_hero.sql', '0012_tactics_champion_unlocks.sql', '0013_tactics_promo_codes.sql', '0014_tactics_world_progress.sql', '0023_tactics_ranked_preseason.sql', '0024_tactics_champion_mastery.sql', '0025_tactics_ranked_reward_track.sql', '0026_tactics_profile_avatar.sql', '0028_tactics_multi_deck.sql'])
    sql.exec(readFileSync(new URL(`../../server/migrations/${file}`, import.meta.url), 'utf8'));
  if (options.legacyProfiles)
    sql.exec(`CREATE TRIGGER legacy_profiles AFTER INSERT ON tactics_profiles BEGIN
      UPDATE tactics_profiles SET champion_mode = 'LEGACY', starting_champion_id = NULL WHERE user_id = NEW.user_id;
      DELETE FROM tactics_champion_unlocks WHERE user_id = NEW.user_id; END;`);
  const statement = (query: string, values: unknown[] = []): D1PreparedStatement & { exec(): void } => ({
    bind: (...next: unknown[]) => statement(query, next),
    first: async <T,>() => (sql.prepare(query).get(...(values as SQLInputValue[])) as T | undefined) ?? null,
    all: async <T,>() => ({ results: sql.prepare(query).all(...(values as SQLInputValue[])) as T[] }),
    run: async () => sql.prepare(query).run(...(values as SQLInputValue[])),
    exec: () => void sql.prepare(query).run(...(values as SQLInputValue[])),
  });
  return {
    sql,
    prepare: (query) => statement(query),
    batch: async (statements) => {
      sql.exec('BEGIN');
      try {
        for (const s of statements) (s as ReturnType<typeof statement>).exec();
        sql.exec('COMMIT');
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}

/** Creates an RPG-GO account with a live session (what /api/register does) and returns its token. */
export function addAccount(db: ReturnType<typeof memoryD1>, username: string, opts: { expiresAt?: number } = {}) {
  const info = db.sql.prepare("INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, 'h', 's', 0)").run(username);
  const token = `token-${username}`;
  db.sql.prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, 0, ?)').run(token, username, opts.expiresAt ?? 4_000_000_000_000);
  return { id: Number(info.lastInsertRowid), token };
}
