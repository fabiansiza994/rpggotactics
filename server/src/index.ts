import { contentTransition } from './contentTransition';
import {profileAvatarRoute} from './profileAvatar';
import { creditedRewards, victoryCrystalStatements, type CrystalReward } from './economy';
import { walletView } from './store';
import {
  ASCENT_CAMPAIGN,
  CAMPAIGN_HERO_IDS,
  CAMPAIGNS_BY_ID,
  defaultCampaignFor,
  worldCompleted,
  worldOfCampaign,
  worldReleased,
  worldUnlocked,
  battleDeck,
  skirmishRewardContext,
  rewardContextFor,
  withHeroDeck,
  claimReward,
  asNewPlayer,
  createProfile,
  createRun,
  DECK_RULES,
  copyLimit,
  defaultCampaignHero,
  supportsHero,
  DEFAULT_CONTENT,
  encounterById,
  heroProfile,
  settleVictory,
  selectChampion,
  verifyVictory,
  collectionOwner,
  chooseStartingChampion,
  claimChampionUnlock,
  isChampionUnlocked,
  type PlayerProfile,
  type GameContent,
} from '../../src/game';
import type { D1Database, Env } from './db';
import { error, json } from './http';
import { summonerQaAllowed, qaCampaignSetup } from './campaignQa';
import { releasedContent } from './ritualRelease';
import { championAllowed, warriorAllowed } from './warriorRelease';
import { sanitizeLocalImport } from './importLocal';
import { deckRoute } from './decks';
import { pvpRoute } from './pvp';
import { pvpHistoryRoute } from './pvpHistory';
import { rankedAllowed, rankedRoute } from './ranked';
import { reconcileRankedTrack } from './rankedTrack';
import { premiumAllowed, reconcilePremium } from './rankedPremium';
import { masteryAllowed, masteryRoute, pveVictoryMastery } from './mastery';
import { freeCatalogBody, reconcileFreeCatalog } from './freeCatalog';
import { defaultStoreDeps, storeRoute, type StoreDeps, type StoreRequest } from './store';
import { promoRoute } from './promo';
import { giftRoute } from './gifts';
import { archerCampaignAllowed, championRuns, world2Allowed, worldsBody, worldsFor } from './worlds';
export { PvPMatchRoom } from './pvp';
import { socialRoute } from './social';
import { supportRoute } from './support';
import { epaycoWebhookRoute, realMoneyPublicRoute, realMoneyRoute, type EpaycoClient } from './epayco';
export { SocialHub } from './social';
import {
  createPlayer,
  prepareSummonerQa,
  loadPlayer,
  saveChampionUnlock,
  saveStartingChampion,
  saveCampaignStep,
  worldCompletionStatements,
  startSkirmish,
  setChampion,
  type CardSource,
  type PlayerRecord,
} from './repo';

/**
 * RPG-GO Tactics API (Cloudflare Worker). Accounts are the existing RPG-GO accounts: the
 * client signs in against the auth Worker (dark-recipe-a184) and sends its Bearer token here.
 * This Worker only READS `sessions`/`users` to resolve WHO is calling — the user id always
 * comes from the token, never from the request body or URL.
 *
 * The server is authoritative for ownership: cards are only granted by validated steps
 * (starter set, a reward the server itself offered after a replay-verified victory, or the
 * one-time local import), and every deck is validated against the stored collection.
 */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * CORS: only listed browser origins get an Allow-Origin header. Auth is a Bearer header (no
 * cookies), so this is defence in depth, not the access control itself.
 */
export function corsHeaders(
  origin: string | null,
  allowed: string | undefined,
): Record<string, string> {
  const list = (allowed ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    ...(origin && list.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
}

export interface Caller {
  userId: number;
  username: string;
}

/** Bearer token → the account behind it (via the RPG-GO session table). Null = not signed in. */
export async function resolveCaller(
  request: Request,
  db: D1Database,
  now: number,
): Promise<Caller | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 200) return null;
  const row = await db
    .prepare(
      'SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ?',
    )
    .bind(token)
    .first<{ id: number; username: string; expires_at: number }>();
  if (!row || row.expires_at < now) return null;
  return { userId: row.id, username: row.username };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stateBody(caller: Caller, record: PlayerRecord | null, env: Env, deps: Deps) {
  return {
    user: { id: caller.userId, username: caller.username },
    qaSummonerCampaign: summonerQaAllowed(env, caller.username),
    warriorAvailable: warriorAllowed(env, caller.username),
    /** Champions released to this account (onboarding choices and milestone unlocks come from here). */
    championsAvailable: availableChampions(env, deps, caller.username),
    hasProfile: record !== null,
    meta: record?.meta ?? null,
    profile: record?.profile ?? null,
    run: record?.run ?? null,
    runs: record?.runs ?? null,
    /** Runs of the worlds after World 1 (campaign id → champion → run). World 1 stays in `runs`. */
    worldRuns: record?.worldRuns ?? null,
    /** World selector contract per champion (released worlds only; see src/game/run/worlds.ts). */
    worlds: record ? worldsBody(record, worldsFor(env, caller.username, deps.world2, deps.archerCampaign, deps.world3), CAMPAIGN_HERO_IDS) : null,
    world2Available: world2Allowed(env, caller.username, deps.world2),
    /** The Archer campaign «Sendero del Cazador» is released to this account. */
    archerCampaignAvailable: archerCampaignAllowed(env, caller.username, deps.archerCampaign),
    skirmish: record?.skirmish ?? null,
  };
}

/**
 * Champions a NEW campaign run can be started with. The Summoner stays locked until its
 * balance pass is signed off (wrangler var SUMMONER_CAMPAIGN = "1" unlocks it).
 */
function campaignReleased(heroId: string, env: Env, deps: Deps, username: string): boolean {
  if (!CAMPAIGN_HERO_IDS.includes(heroId) || !championAllowed(heroId, env, username)) return false;
  return heroId !== 'summoner' || (deps.summonerCampaign ?? env.SUMMONER_CAMPAIGN === '1') || summonerQaAllowed(env, username);
}

/**
 * Champions a player can start with or unlock: the campaign champions whose release flags are
 * on for this account. A flag that turns on later simply adds a champion to this list.
 */
function availableChampions(env: Env, deps: Deps, username: string): string[] {
  return [...ASCENT_CAMPAIGN.heroIds.filter((id) => deps.content.heroes[id] && campaignReleased(id, env, deps, username)),
    ...(deps.content.heroes.archer && championAllowed('archer', env, username) ? ['archer'] : [])];
}

/** Released for this account AND owned by it (legacy profiles own every champion). */
const championUsable = (profile: PlayerProfile, heroId: unknown, env: Env, username: string): heroId is string =>
  typeof heroId === 'string' && championAllowed(heroId, env, username) && isChampionUnlocked(profile, heroId);

const LOCKED_MESSAGE = 'Todavía no has desbloqueado este campeón.';

/** Local campaign saves per champion; clients from before multi-champion campaigns send only the Mage's. */
function localCampaigns(body: Record<string, unknown>): Record<string, unknown> {
  const campaigns = body.campaigns;
  if (typeof campaigns === 'object' && campaigns !== null && !Array.isArray(campaigns)) return { ...campaigns };
  return { [defaultCampaignHero(ASCENT_CAMPAIGN)]: body.campaign };
}

interface Deps {
  waitUntil?(task:Promise<unknown>):void;
  content: GameContent;
  /** Overrides the SUMMONER_CAMPAIGN switch (tests). */
  summonerCampaign?: boolean;
  /** Overrides the WORLD_2_ENABLED / WORLD_2_QA switches (tests). */
  world2?: boolean;
  /** Overrides the WORLD_3_ENABLED / WORLD_3_QA switches (tests). */
  world3?: boolean;
  /** Overrides the ARCHER_CAMPAIGN_ENABLED / _QA switches (tests; the Archer must still be released). */
  archerCampaign?: boolean;
  now(): number;
  /** Seed for a new campaign run (server-chosen so reward offers cannot be rerolled by the client). */
  seed(): number;
  /** Store catalog + id source (tests inject their own). */
  store?: StoreDeps;
  /** ePayco Apify client (tests inject a fake; default calls apify.epayco.co). */
  epayco?: EpaycoClient;
}

const defaultDeps: Deps = {
  content: DEFAULT_CONTENT,
  now: () => Date.now(),
  seed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
};

/** Routes the request and adds the CORS headers for its origin. */
export async function handle(
  request: Request,
  env: Env,
  deps: Deps = defaultDeps,
): Promise<Response> {
  const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
  const socketUrl = new URL(request.url);
  if (socketUrl.pathname === '/api/tactics/pvp/socket') {
    const blocked = contentTransition(request, env);
    if (blocked) return blocked;
    const origin = request.headers.get('Origin');
    if (origin && !(env.ALLOWED_ORIGINS ?? '').split(',').includes(origin)) return error(403, 'FORBIDDEN', 'Origen no permitido.');
    const code = (socketUrl.searchParams.get('code') ?? '').toUpperCase();
    if (!env.PVP_ROOMS || !/^[A-Z2-9]{8}$/.test(code) || request.headers.get('Upgrade') !== 'websocket') return error(400, 'BAD_REQUEST', 'Conexión inválida.');
    return env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(code)).fetch(new Request('https://room/socket?ticket=' + encodeURIComponent(socketUrl.searchParams.get('ticket') ?? '') + '&clientRelease=' + encodeURIComponent(socketUrl.searchParams.get('clientRelease') ?? ''), request));
  }
  if (socketUrl.pathname === '/api/tactics/social/socket') {
    // The user's own social hub (chat/notifications). Separate from every PvP room.
    const origin = request.headers.get('Origin');
    if (origin && !(env.ALLOWED_ORIGINS ?? '').split(',').includes(origin)) return error(403, 'FORBIDDEN', 'Origen no permitido.');
    const hub = socketUrl.searchParams.get('hub') ?? '';
    if (!env.SOCIAL_HUBS || !/^[1-9][0-9]{0,15}$/.test(hub) || request.headers.get('Upgrade') !== 'websocket') return error(400, 'BAD_REQUEST', 'Conexión inválida.');
    return env.SOCIAL_HUBS.get(env.SOCIAL_HUBS.idFromName('user:' + hub)).fetch(new Request('https://hub/socket?ticket=' + encodeURIComponent(socketUrl.searchParams.get('ticket') ?? ''), request));
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let res: Response;
  try {
    res = await route(request, env, deps);
  } catch {
    res = error(500, 'SERVER_ERROR', 'Error interno.');
  }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/tactics')) return error(404, 'NOT_FOUND', 'Not found');
  if (path === '/api/tactics/health') return json({ ok: true });

  const content = releasedContent(deps.content, env);
  deps = { ...deps, content };
  const now = deps.now();
  const newId = (deps.store ?? defaultStoreDeps).newId;
  // Public: ePayco's confirmation webhook (trust = signature + order checks) and the package list.
  const publicPayment = (await epaycoWebhookRoute(request, env, { now, newId })) ?? (await realMoneyPublicRoute(request, env));
  if (publicPayment) return publicPayment;
  const caller = await resolveCaller(request, env.DB, now);
  const transition = contentTransition(request, env, caller?.username);
  if (transition) return transition;
  if (!caller) return error(401, 'UNAUTHENTICATED', 'Sesión inválida o vencida.');
  if (path === '/api/tactics/qa/summoner/setup' && !summonerQaAllowed(env, caller.username)) return error(403, 'FORBIDDEN', 'Acceso QA no autorizado.');
  const avatarResponse = await profileAvatarRoute(request, env.DB, caller.userId, now);
  if (avatarResponse) return avatarResponse;
  // PvP history/stats: read-only views of the caller's own finished matches (no profile needed).
  const pvpHistory = await pvpHistoryRoute(request, env, caller);
  if (pvpHistory) return pvpHistory;
  // Ranked Preseason: queue + own RP (behind RANKED_PRESEASON_*; matches run in PvP rooms).
  const ranked = await rankedRoute(request, env, caller, now);
  if (ranked) return ranked;
  // Champion Mastery: own XP per champion + equip an unlocked title (behind MASTERY_*).
  const mastery = await masteryRoute(request, env, caller, now);
  if (mastery) return mastery;
  if (path.startsWith('/api/tactics/pvp/')) {
    if (!['create','join','loadout','ready','connect','leave','rematch','active','state'].includes(path.split('/').pop()!)) return error(404, 'NOT_FOUND', 'Not found');
    if (request.method !== (path.endsWith('/active') || path.endsWith('/state') ? 'GET' : 'POST')) return error(405, 'BAD_METHOD', 'Método no permitido.');
    return pvpRoute(request, env, caller);
  }
  // Social (friends, chat, invites): needs an account, not a Tactics profile, except invites.
  const social = await socialRoute(request, env, caller, now);
  if (social) return social;
  // Bug reports: any signed-in account (no Tactics profile needed).
  const support = await supportRoute(request, env, caller, { now, newId});
  if (support) return support;
  // Real-money Cristales (account only; sandbox-only in phase 1).
  const realMoney = await realMoneyRoute(request, env, caller.userId, { now, newId, epayco: deps.epayco });
  if (realMoney) return realMoney;
  const db = env.DB;
  const route = `${request.method} ${path}`;
  // Free catalog: milestone cards (incl. retroactive ones) are granted before any state is read.
  const loadReconciled = async () => {
    const loaded = await loadPlayer(db, caller.userId, content);
    const granted = await reconcileFreeCatalog(db, caller.userId, content, loaded, now, masteryAllowed(env, caller.username));
    return granted ? loadPlayer(db, caller.userId, content) : loaded;
  };

  if (route === 'GET /api/tactics/me') {
    const record = await loadPlayer(db, caller.userId, content);
    return json({
      user: { id: caller.userId, username: caller.username },
      qaSummonerCampaign: summonerQaAllowed(env, caller.username),
      warriorAvailable: warriorAllowed(env, caller.username),
    hasProfile: record !== null,
    });
  }
  if (route === 'GET /api/tactics/state') {
    // Ranked Reward Track catch-up before the collection is read (idempotent; legacy peaks too).
    if (rankedAllowed(env, caller.username)) await reconcileRankedTrack(db, caller.userId, now);
    // Ranked Premium catch-up (pass holders only; 0027) so its cards are in the collection read.
    if (rankedAllowed(env, caller.username) && premiumAllowed(env, caller.username)) await reconcilePremium(db, caller.userId, now);
    return json(stateBody(caller, await loadReconciled(), env, deps));
  }

  // ── Player creation: fresh, or one-time import of a device's local progress ──────────
  if (route === 'POST /api/tactics/profile' || route === 'POST /api/tactics/import') {
    if (await loadPlayer(db, caller.userId, content))
      return error(409, 'ALREADY_EXISTS', 'Esta cuenta ya tiene progreso en la nube.');
    const body = await readJson(request);
    if (!body) return error(400, 'BAD_REQUEST', 'Cuerpo inválido.');
    const imported =
      route === 'POST /api/tactics/import'
        ? sanitizeLocalImport(body.profile, localCampaigns(body), content, DECK_RULES, availableChampions(env, deps, caller.username))
        : null;
    if (imported?.runs.some(run => !campaignReleased(run.heroId, env, deps, caller.username))) return error(403, 'CHAMPION_LOCKED', 'Este campeón todavía no está disponible en la campaña.');
    try {
      await createPlayer(
        db,
        caller.userId,
        caller.username,
        // A new account starts with onboarding (first-time champion choice); an import keeps
        // the device's own unlock state, re-validated by sanitizeLocalImport.
        imported?.profile ?? asNewPlayer(createProfile(content)),
        imported?.runs ?? [],
        {
          source: imported ? 'LOCAL_IMPORT' : 'STARTER',
          importedAt: imported ? now : null,
          now,
        },
      );
    } catch {
      // A concurrent creation (two devices) lost the race: the other one's save stands.
      return error(409, 'ALREADY_EXISTS', 'Esta cuenta ya tiene progreso en la nube.');
    }
    return json({
      ...stateBody(caller, await loadReconciled(), env, deps),
      importNotes: imported?.notes ?? [],
    });
  }

  const record = await loadPlayer(db, caller.userId, content);
  if (!record) return error(404, 'NO_PROFILE', 'Esta cuenta todavía no tiene progreso en la nube.');
  const body = request.method === 'GET' ? {} : await readJson(request);
  if (!body) return error(400, 'BAD_REQUEST', 'Cuerpo inválido.');
  const economyRewards: CrystalReward[] = [];
  const respond = async (extra: Record<string, unknown> = {}) => json({ ...stateBody(caller, await loadReconciled(), env, deps), wallet: await walletView(db, caller.userId), crystalRewards: await creditedRewards(db, caller.userId, economyRewards), ...extra });

  // «Descubre las rarezas»: one row per rarity per champion, owned or locked, with progress.
  if (route === 'GET /api/tactics/free-catalog')
    return json(await freeCatalogBody(db, caller.userId, content, (await loadReconciled()) ?? record, masteryAllowed(env, caller.username)));

  if (route === 'POST /api/tactics/qa/summoner/setup') {
    const setup = qaCampaignSetup(content, body.encounterId, body.tier, body.seed);
    if (!setup) return error(422, 'BAD_QA_SETUP', 'Encuentro, mazo o semilla QA inválidos.');
    await prepareSummonerQa(db, caller.userId, setup.run, heroProfile(record.profile, 'summoner', content).activeDeckId, setup.cards, now);
    return respond();
  }

  const storeRequest: StoreRequest = {
    db,
    userId: caller.userId,
    record,
    body,
    now,
    content,
    store: deps.store ?? defaultStoreDeps,
    heroAllowed: (heroId) => championAllowed(heroId, env, caller.username),
    state: async () => stateBody(caller, await loadReconciled(), env, deps),
  };
  const storeResponse =
    (await storeRoute(route, storeRequest)) ??
    (await promoRoute(route, storeRequest)) ??
    (await giftRoute(route, storeRequest, { env, username: caller.username }));
  if (storeResponse) return storeResponse;

  // ── Champion ownership: first-time choice and milestone unlocks (account-wide) ──────────
  if (route === 'POST /api/tactics/champions/start' || route === 'POST /api/tactics/champions/unlock') {
    const heroId = String(body.heroId);
    const available = availableChampions(env, deps, caller.username);
    const start = route.endsWith('/start');
    const result = start
      ? chooseStartingChampion(record.profile, heroId, available)
      : claimChampionUnlock(record.profile, heroId, available);
    if (!result.ok) {
      const status = result.error === 'NOT_AVAILABLE' ? 403 : result.error === 'NOT_AN_OPTION' ? 422 : 409;
      return error(status, result.error, start ? 'No se pudo elegir ese campeón.' : 'Ese campeón no se puede desbloquear ahora.');
    }
    if (result.unlock) {
      try {
        if (start) await saveStartingChampion(db, caller.userId, heroId, now);
        else await saveChampionUnlock(db, caller.userId, result.unlock, now);
      } catch {
        // A concurrent request consumed the same choice/milestone first: its result stands.
        const fresh = await loadPlayer(db, caller.userId, content);
        if (!fresh || !isChampionUnlocked(fresh.profile, heroId))
          return error(409, start ? 'ALREADY_CHOSEN' : 'NO_UNLOCK_PENDING', 'Esa elección ya se registró.');
      }
    }
    return respond();
  }

  if (route === 'PUT /api/tactics/champion') {
    const result = selectChampion(record.profile, String(body.championId), content);
    if (!result.ok) return error(422, 'UNKNOWN_CHAMPION', 'Campeón desconocido.');
    if (!championAllowed(body.championId, env, caller.username)) return error(403, 'CHAMPION_LOCKED', 'Este campeón todavía no está disponible.');
    if (!championUsable(record.profile, body.championId, env, caller.username)) return error(403, 'CHAMPION_LOCKED', LOCKED_MESSAGE);
    await setChampion(db, caller.userId, result.profile.selectedChampionId, now);
    return respond();
  }

  // Multi-deck per champion: list / create / edit / rename / duplicate / default / delete.
  const decks = await deckRoute(request.method, path, {
    db,
    userId: caller.userId,
    profile: record.profile,
    content,
    now,
    body,
    usable: (heroId) =>
      !championAllowed(heroId, env, caller.username)
        ? error(403, 'CHAMPION_LOCKED', 'Este campeón todavía no está disponible.')
        : // A locked champion's cards stay owned and viewable, but no deck can be built for play.
          !championUsable(record.profile, heroId, env, caller.username)
          ? error(403, 'CHAMPION_LOCKED', LOCKED_MESSAGE)
          : null,
    respond,
    reload: async () => (await loadPlayer(db, caller.userId, content))?.profile ?? null,
  });
  if (decks) return decks;

  if (route === 'POST /api/tactics/skirmish/start') {
    if (record.skirmish?.run.status === 'CHOOSING_REWARD')
      return error(409, 'REWARD_PENDING', 'Elige la recompensa pendiente primero.');
    if (body.heroId !== 'summoner' || typeof body.scenarioId !== 'string')
      return error(422, 'INVALID_SKIRMISH', 'Escaramuza no válida.');
    if (!championUsable(record.profile, body.heroId, env, caller.username)) return error(403, 'CHAMPION_LOCKED', LOCKED_MESSAGE);
    let context;
    try {
      context = skirmishRewardContext(body.scenarioId, body.heroId);
    } catch {
      return error(422, 'INVALID_SKIRMISH', 'Escaramuza no válida.');
    }
    // Optional deck choice (one of this champion's own decks); omitted = the default deck.
    if (body.deckId !== undefined && !heroProfile(record.profile, body.heroId, content).decks.some((d) => d.id === body.deckId))
      return error(404, 'UNKNOWN_DECK', 'Ese mazo no existe.');
    const run = createRun(context, content, deps.seed());
    const deck = battleDeck(record.profile, run.heroId, content, DECK_RULES, body.deckId as string | undefined);
    await startSkirmish(db, caller.userId, run, deck.cards, now);
    return respond();
  }
  if (
    route === 'POST /api/tactics/skirmish/victory' ||
    route === 'POST /api/tactics/skirmish/reward'
  ) {
    const battle = record.skirmish;
    if (!battle || body.battleId !== battle.id)
      return error(409, 'STALE_BATTLE', 'La escaramuza ya no está activa.');
    const context = rewardContextFor(battle.run);
    const encounter = encounterById(context, battle.run.currentEncounterId);
    if (route.endsWith('/victory')) {
      if (battle.run.status !== 'IN_BATTLE') return respond(); // lost response retry returns the durable offer
      const proof = body.proof as Record<string, unknown> | undefined;
      if (proof?.seed !== battle.run.seed)
        return error(422, 'INVALID_VICTORY', 'Semilla no válida.');
      const frozenContent = withHeroDeck(content, battle.run.heroId, battle.deck);
      // Reconstruct a frozen loadout for the shared verifier; ownership was validated at start.
      const hero = heroProfile(record.profile, battle.run.heroId, content);
      const frozenProfile = {
        ...record.profile,
        heroes: {
          ...record.profile.heroes,
          [hero.heroId]: {
            ...hero,
            activeDeckId: 'battle',
            decks: [{ id: 'battle', name: 'Battle', cards: battle.deck }],
          },
        },
      };
      const checked = verifyVictory(
        context,
        frozenContent,
        frozenProfile,
        battle.run,
        body.proof,
        DECK_RULES,
      );
      if (!checked.ok)
        return error(422, 'INVALID_VICTORY', 'La victoria no pudo verificarse.', {
          reason: checked.error,
        });
      const won = settleVictory(
        context,
        content,
        record.profile,
        battle.run,
        encounter.id,
        DECK_RULES,
      );
      if (!won.ok) return error(409, 'INVALID_STEP', won.error);
      const economy = victoryCrystalStatements(db, caller.userId, now, { heroId: battle.run.heroId, campaignId: 'skirmish', encounterId: encounter.id, skirmish: true }, newId);
      economyRewards.push(...economy.rewards);
      const masteryXp = masteryAllowed(env, caller.username)
        ? pveVictoryMastery(db, caller.userId, now, {
            heroId: battle.run.heroId, campaignId: 'skirmish', story: false, encounterId: encounter.id, tier: encounter.tier,
            runRef: String(battle.id), skirmish: true,
            dailyFirstWinTransactionId: economy.rewards.find((r) => r.reason === 'DAILY_FIRST_WIN')?.transactionId,
          })
        : [];
      try {
        await saveCampaignStep(db, caller.userId, now, {
          run: won.run,
          beforeLog: [...economy.statements, ...masteryXp],
          skirmish: { id: battle.id, step: 'VICTORY' },
          pity: won.roll.options.length
            ? undefined
            : { heroId: battle.run.heroId, value: won.pity.after },
          log: {
            campaignId: 'skirmish',
            heroId: battle.run.heroId,
            runSeed: battle.run.seed,
            encounterId: encounter.id,
            pool: encounter.rewards.pool,
            event: won.roll.options.length ? 'OFFERED' : 'NO_DROP',
            offered: won.roll.options,
            chosen: null,
            pityBefore: won.pity.before,
            pityAfter: won.pity.after,
          },
        });
      } catch {
        return error(409, 'INVALID_STEP', 'Victoria ya registrada.');
      }
    } else {
      if (battle.run.status === 'COMPLETED') return respond();
      const claim = claimReward(
        context,
        content,
        record.profile,
        battle.run,
        String(body.optionId),
      );
      if (!claim.ok) return error(409, 'INVALID_STEP', claim.error);
      try {
        await saveCampaignStep(db, caller.userId, now, {
          run: claim.run,
          skirmish: { id: battle.id, step: 'CLAIM' },
          grant: claim.granted
            ? {
                ...claim.granted,
                ownerId: collectionOwner(content, battle.run.heroId, claim.granted.cardId),
                source: `${encounter.rewards.pool}_DROP` as CardSource,
              }
            : undefined,
          pity: { heroId: battle.run.heroId, value: claim.pity.after },
          log: {
            campaignId: 'skirmish',
            heroId: battle.run.heroId,
            runSeed: battle.run.seed,
            encounterId: encounter.id,
            pool: encounter.rewards.pool,
            event: 'CLAIMED',
            offered: null,
            chosen: claim.reward,
            pityBefore: claim.pity.before,
            pityAfter: claim.pity.after,
          },
        });
      } catch {
        return error(409, 'INVALID_STEP', 'Recompensa ya registrada.');
      }
    }
    return respond();
  }

  // ── Campaign: every step is checked by the same rules the client runs ─────────────────
  // Each champion has its own run per world; a step names the champion (older clients: the
  // Mage) and the world's campaign (older clients: World 1, 'ascent').
  if (route.startsWith('POST /api/tactics/campaign/')) {
    const heroId = body.heroId === undefined ? defaultCampaignHero(ASCENT_CAMPAIGN) : body.heroId;
    if (typeof heroId !== 'string' || !CAMPAIGN_HERO_IDS.includes(heroId)) return error(422, 'UNKNOWN_CHAMPION', 'Campeón desconocido.');
    if (!campaignReleased(heroId, env, deps, caller.username)) return error(403, 'CHAMPION_LOCKED', 'Este campeón todavía no está disponible en la campaña.');
    if (!isChampionUnlocked(record.profile, heroId)) return error(403, 'CHAMPION_LOCKED', LOCKED_MESSAGE);
    const worlds = worldsFor(env, caller.username, deps.world2, deps.archerCampaign, deps.world3);
    // Older clients send no campaign: the champion's first world (World 1; the Archer's own act).
    const campaignId = body.campaignId === undefined ? defaultCampaignFor(heroId).id : body.campaignId;
    const world = typeof campaignId === 'string' ? worldOfCampaign(worlds, campaignId) : undefined;
    const campaign = world ? CAMPAIGNS_BY_ID[world.campaignId] : undefined;
    if (!world || !campaign || !supportsHero(campaign, heroId)) return error(422, 'UNKNOWN_CAMPAIGN', 'Campaña desconocida.');
    if (!worldReleased(worlds, world)) return error(403, 'WORLD_LOCKED', 'Este mundo todavía no está disponible.');
    const runs = championRuns(record, heroId);
    const history = record.worldHistory[heroId] ?? {};
    if (route === 'POST /api/tactics/campaign/start') {
      // Unlocks are durable: replaying World 1 never closes World 2 again.
      if (!worldUnlocked(worlds, world, runs, history))
        return error(403, 'WORLD_LOCKED', 'Completa el mundo anterior con este campeón para entrar aquí.');
      // Replaying a completed world overwrites its COMPLETED run: if that run is the only proof
      // of completion (legacy), record it durably first so the next world never relocks.
      const keep = worldCompleted(worlds, world, runs, history) && history[world.id]?.completedAt == null;
      // A run always starts at the world's first encounter (the server never skips encounters).
      await saveCampaignStep(db, caller.userId, now, {
        run: createRun(campaign, content, deps.seed(), heroId),
        extra: keep
          ? worldCompletionStatements(db, caller.userId, { heroId, worldId: world.id, crystals: 0, payReward: false, transactionId: '', now })
          : undefined,
      });
      return respond();
    }
    const run = runs[campaign.id] ?? null;
    if (route === 'POST /api/tactics/campaign/victory') {
      if (!run) return error(409, 'NO_RUN', 'No hay campaña en curso.');
      // A lost success response must recover the durable result, not replay against
      // the next encounter. This only reads completion already verified by the server.
      const previous = body.proof as { encounterId?: unknown } | null;
      if (typeof previous?.encounterId === 'string' && run.completedEncounterIds.includes(previous.encounterId))
        return respond();
      // The proof must be the run's current encounter of THIS world: an encounter of another
      // world, a locked one or a forged id never replays (verifyVictory).
      const proof = verifyVictory(campaign, content, record.profile, run, body.proof, DECK_RULES);
      if (!proof.ok)
        return error(422, 'INVALID_VICTORY', 'La victoria no pudo verificarse.', {
          reason: proof.error,
        });
      // The offer is rolled once, here, from the server's collection + pity, and stored in the
      // run: later reads return it unchanged (no reroll by reloading).
      const won = settleVictory(campaign, content, record.profile, run, run.currentEncounterId, DECK_RULES);
      if (!won.ok) return error(409, 'INVALID_STEP', won.error);
      const encounter = encounterById(campaign, run.currentEncounterId);
      const noDrop = won.roll.options.length === 0;
      // Defeating the world's boss completes the world for this champion (once; its one-time
      // reward is paid in the same transaction, never again on a replay).
      const bossDefeated = encounter.id === world.bossEncounterId;
      const reward = world.completionReward;
      const rewardCardId = reward?.championCards?.[run.heroId];
      const rewardCard = rewardCardId ? content.cards[rewardCardId] : undefined;
      const economy = victoryCrystalStatements(db, caller.userId, now, { heroId: run.heroId, campaignId: campaign.id, encounterId: encounter.id }, newId);
      economyRewards.push(...economy.rewards);
      // Mastery XP for THIS champion: victory + first clear by tier (+ story bonus) + daily first win.
      const masteryXp = masteryAllowed(env, caller.username)
        ? pveVictoryMastery(db, caller.userId, now, {
            heroId: run.heroId, campaignId: campaign.id, story: campaign.kind === 'CHAMPION_STORY', encounterId: encounter.id,
            tier: encounter.tier, runRef: String(run.seed),
            dailyFirstWinTransactionId: economy.rewards.find((r) => r.reason === 'DAILY_FIRST_WIN')?.transactionId,
          })
        : [];
      try {
        await saveCampaignStep(db, caller.userId, now, {
          run: won.run,
          beforeLog: [...economy.statements, ...masteryXp],
          // Champion milestones count World 1 only (their thresholds are World 1 encounters).
          campaignBest: campaign.id === ASCENT_CAMPAIGN.id ? won.run.completedEncounterIds.length : undefined,
          pity: noDrop ? { heroId: run.heroId, value: won.pity.after } : undefined,
          log: {
            campaignId: run.campaignId,
            heroId: run.heroId,
            runSeed: run.seed,
            encounterId: encounter.id,
            pool: encounter.rewards.pool,
            event: noDrop ? 'NO_DROP' : 'OFFERED',
            offered: noDrop
              ? null
              : { options: won.roll.options, pityTriggered: won.roll.pityTriggered },
            chosen: null,
            pityBefore: won.pity.before,
            pityAfter: won.pity.after,
          },
          extra: bossDefeated
            ? worldCompletionStatements(db, caller.userId, {
                heroId: run.heroId,
                worldId: world.id,
                crystals: reward?.crystals ?? 0,
                payReward: !!reward && history[world.id]?.rewardGrantedAt == null,
                transactionId: (deps.store ?? defaultStoreDeps).newId(),
                now,
                card: rewardCard
                  ? {
                      cardId: rewardCard.id,
                      acquired: heroProfile(record.profile, run.heroId, content).acquisitions + 1,
                      cap: copyLimit(rewardCard, DECK_RULES),
                    }
                  : undefined,
              })
            : undefined,
        });
      } catch {
        // A concurrent submission of the same victory won the race: its result stands.
        const fresh = await loadPlayer(db, caller.userId, content);
        const freshRun = fresh ? championRuns(fresh, heroId)[campaign.id] : null;
        if (freshRun?.completedEncounterIds.includes(encounter.id)) return respond();
        return error(409, 'INVALID_STEP', 'Victoria ya registrada.');
      }
      return respond();
    }
    if (route === 'POST /api/tactics/campaign/reward') {
      if (!run) return error(409, 'NO_RUN', 'No hay campaña en curso.');
      if (typeof body.encounterId === 'string') {
        if (run.chosenRewards.some((c) => c.encounterId === body.encounterId && c.reward.id === body.optionId)) return respond();
        if (body.encounterId !== run.currentEncounterId) return error(409, 'INVALID_STEP', 'La recompensa pertenece a otro encuentro.');
      }
      // Only an option the server stored can be claimed; grant + pity + advance + log are one transaction.
      const claim = claimReward(campaign, content, record.profile, run, String(body.optionId));
      if (!claim.ok) return error(409, 'INVALID_STEP', claim.error);
      const encounter = encounterById(campaign, run.currentEncounterId);
      const source = `${encounter.rewards.pool}_DROP` as CardSource;
      await saveCampaignStep(db, caller.userId, now, {
        run: claim.run,
        grant: claim.granted
          ? {
              ownerId: collectionOwner(content, run.heroId, claim.granted.cardId),
              cardId: claim.granted.cardId,
              copies: claim.granted.copies,
              acquired: claim.granted.acquired,
              source,
            }
          : undefined,
        pity: { heroId: run.heroId, value: claim.pity.after },
        log: {
          campaignId: run.campaignId,
          heroId: run.heroId,
          runSeed: run.seed,
          encounterId: encounter.id,
          pool: encounter.rewards.pool,
          event: 'CLAIMED',
          offered: null,
          chosen: { reward: claim.reward, isNew: claim.granted?.isNew ?? null },
          pityBefore: claim.pity.before,
          pityAfter: claim.pity.after,
        },
      });
      return respond();
    }
  }

  return error(404, 'NOT_FOUND', 'Not found');
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
