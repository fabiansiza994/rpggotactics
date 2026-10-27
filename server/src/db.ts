/**
 * The slice of Cloudflare D1 this Worker uses. Declared here (instead of depending on
 * @cloudflare/workers-types) so tests can run the same code against node:sqlite.
 */
export interface D1Result<T> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs the statements in one transaction (all or nothing). */
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface Env {
  REAL_MONEY_PURCHASES_ENABLED?: string;
  SUPPORT_EMAIL_ENABLED?: string;
  SUPPORT_EMAIL_PROVIDER?: string;
  SUPPORT_EMAIL_FROM?: string;
  SUPPORT_EMAIL_TO?: string;
  SUPPORT_EMAIL?: import('./supportEmail').SupportEmailBinding;
  PUBLIC_SUPPORT_ENABLED?: string;
  PUBLIC_SUPPORT_TURNSTILE_SECRET?: string;
  PVP_ROOMS?: import('./pvp').RoomNamespace;
  /** One SocialHub per user (chat + notification sockets, approximate presence). */
  SOCIAL_HUBS?: import('./social').HubNamespace;
  /** The shared `rpggo-auth` database (RPG-GO accounts + Tactics tables). */
  DB: D1Database;
  /**
   * Comma-separated browser origins allowed by CORS (wrangler.toml [vars]). Requests without an
   * Origin header (native/curl) are unaffected; auth is the Bearer token either way.
   */
  ALLOWED_ORIGINS?: string;
  /** "1" lets players start the Summoner campaign (kept off until its balance pass is signed off). */
  SUMMONER_CAMPAIGN?: string;
  /** QA access is restricted to two immutable authenticated account names. */
  SUMMONER_CAMPAIGN_QA?: string;
  /** "1" releases the Warrior to every account (champion select, decks, campaign, PvP). Unset = locked. */
  ARCHER_ENABLED?: string;
  ARCHER_QA?: string;
  WARRIOR_ENABLED?: string;
  SHAPESHIFTER_ENABLED?: string;
  SHAPESHIFTER_QA?: string;
  /** "1" lets only the QA accounts use the Warrior while it is locked (gameplay QA before final art). */
  WARRIOR_QA?: string;
  /** "1" adds the Summoner ritual expansion to reward drops (QA-only content until then). */
  SUMMONER_RITUALS_ENABLED?: string;
  /** "1" adds the Dragón Primordial seals (set summoner_primordial) to reward drops. Unset = unobtainable. */
  PRIMORDIAL_DRAGON_ENABLED?: string;
  /** QA: "1" releases the «Vitrina I» showcase set (store offers + drops). Off by default. */
  STORE_SHOWCASE_ENABLED?: string;
  /** Public expansion acquisition; gameplay and replay definitions remain unchanged. */
  ARSENAL_CARDS_ENABLED?: string;
  TACTICAL_CARDS_ENABLED?: string;
  /**
   * "1" releases the free card catalog (data/free-catalog.ts): milestone grants (first clear,
   * Mastery 7, Act I), retroactive for existing accounts. Unset = no grants (cards unobtainable).
   */
  FREE_CATALOG_ENABLED?: string;
  /** "1" releases World 2 «Reino Infernal» to every account. Unset = hidden (not startable). */
  WORLD_2_ENABLED?: string;
  /** "1" opens World 2 to the QA accounts only (gameplay QA before its visual pass). */
  WORLD_2_QA?: string;
  /** "1" releases World 3 «El Templo del Umbral» (Act III) to every account. Unset = hidden. */
  WORLD_3_ENABLED?: string;
  /** "1" opens World 3 to the QA accounts only (before its visual pass). */
  WORLD_3_QA?: string;
  /** "1" releases the Archer campaign «Sendero del Cazador» (needs the Archer itself released). Unset = hidden. */
  ARCHER_CAMPAIGN_ENABLED?: string;
  /** "1" opens the Archer campaign to the QA accounts only (before its visual pass). */
  ARCHER_CAMPAIGN_QA?: string;
  /** "1" opens Ranked Preseason (queue + RP). Unset = off. */
  RANKED_PRESEASON_ENABLED?: string;
  /** "1" opens Ranked Preseason to the QA accounts only. */
  RANKED_PRESEASON_QA?: string;
  /** "1" opens Champion Mastery (XP grants + titles). Unset = off. */
  MASTERY_ENABLED?: string;
  /** "1" opens Champion Mastery to the QA accounts only. */
  MASTERY_QA?: string;
  /** "1" opens the Ranked Premium Track (600-crystal pass; needs Ranked and migration 0027). Unset = off. */
  RANKED_PREMIUM_ENABLED?: string;
  /** "1" opens the Ranked Premium Track to the QA accounts only (migration 0027 still required). */
  RANKED_PREMIUM_QA?: string;
}
