import type { ChampionDeckSummary, DeckEntry, PlayerProfile, RunState, VictoryProof, WorldView } from '../../game';
import { CLOUD_CONFIG } from './config';
import { request, type CloudResult } from './http';

/** What the Tactics API returns after every call: the authoritative player state. */
export interface CloudState {
  wallet?: { balance: number };
  crystalRewards?: { transactionId: string; reason: 'DAILY_FIRST_WIN' | 'CAMPAIGN_MILESTONE'; amount: number }[];
  user: { id: number; username: string };
  hasProfile: boolean;
  qaSummonerCampaign?: boolean;
  /** The server lets this account play the (QA-only) Warrior. */
  warriorAvailable?: boolean;
  /** Champions released to this account (first-time choice + unlocks). Older servers omit it. */
  championsAvailable?: string[];
  meta: {
    displayName: string;
    saveVersion: number;
    createdAt: number;
    updatedAt: number;
    migratedFromLocalAt: number | null;
  } | null;
  profile: PlayerProfile | null;
  /** The Mage run (kept for clients from before multi-champion campaigns). */
  run: RunState | null;
  /** Every champion's campaign run (World 1 «El Ascenso»). */
  runs?: Record<string, RunState | null>;
  /** Runs of the worlds after World 1: campaign id → champion → run. Older servers omit it. */
  worldRuns?: Record<string, Record<string, RunState | null>> | null;
  /** Authoritative world selector contract per champion (released worlds only). */
  worlds?: Record<string, { worlds: WorldView[]; total: { completedEncounters: number; totalEncounters: number; completedWorlds: number } }> | null;
  /** The server released World 2 to this account (WORLD_2_ENABLED / WORLD_2_QA). */
  world2Available?: boolean;
  /** The Archer campaign «Sendero del Cazador» is released to this account (older servers: absent). */
  archerCampaignAvailable?: boolean;
  skirmish?: { id: number; run: RunState; deck: DeckEntry[] } | null;
  importNotes?: string[];
  /** Deck operations only: the deck created/changed (after a delete: the champion's default). */
  deckId?: string;
  /** Deck operations only: that champion's decks after the change. */
  decks?: ChampionDeckSummary[];
}

const auth = <T>(path: string, body: unknown, token?: string) =>
  request<T>(CLOUD_CONFIG.authUrl, `/api${path}`, {
    method: 'POST',
    body,
    token,
    timeoutMs: CLOUD_CONFIG.timeoutMs,
  });

export const authApi = {
  login: (username: string, password: string) =>
    auth<{ token: string; username: string }>('/login', { username, password }),
  register: (username: string, password: string, turnstileToken: string) =>
    auth<{ token: string; username: string; recoveryCode: string }>('/register', {
      username,
      password,
      turnstileToken,
    }),
  recover: (username: string, recoveryCode: string, newPassword: string) =>
    auth<{ token: string; username: string; recoveryCode: string }>('/recover', {
      username,
      recoveryCode,
      newPassword,
    }),
  logout: (token: string) => auth<{ ok: true }>('/logout', {}, token),
};

const api = (
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<CloudResult<CloudState>> =>
  request<CloudState>(CLOUD_CONFIG.apiUrl, `/api/tactics${path}`, {
    method,
    body,
    token,
    timeoutMs: CLOUD_CONFIG.timeoutMs,
  });

/** Every call is scoped by the token: there is no way to name another player's data. */
export const tacticsApi = {
  prepareSummonerQa: (token: string, encounterId: string, tier: string, seed: number) => api(token, 'POST', '/qa/summoner/setup', {encounterId,tier,seed}),
  state: (token: string) => api(token, 'GET', '/state'),
  createProfile: (token: string) => api(token, 'POST', '/profile', {}),
  /** Raw local save strings; the server re-validates everything. */
  importLocal: (token: string, local: { profile: string | null; campaign: string | null; campaigns?: Record<string, string | null> }) =>
    api(token, 'POST', '/import', local),
  /** First-time champion choice (once per account; a repeat of the same choice is a no-op). */
  chooseStartingChampion: (token: string, heroId: string) => api(token, 'POST', '/champions/start', { heroId }),
  /** Claim the champion a reached milestone offers (the server checks the milestone and the option). */
  unlockChampion: (token: string, heroId: string) => api(token, 'POST', '/champions/unlock', { heroId }),
  setChampion: (token: string, championId: string) =>
    api(token, 'PUT', '/champion', { championId }),
  saveDeck: (token: string, heroId: string, deckId: string, cards: readonly DeckEntry[]) =>
    api(token, 'PUT', `/decks/${encodeURIComponent(heroId)}/${encodeURIComponent(deckId)}`, {
      cards,
    }),
  /**
   * Multi-deck (server/src/decks.ts). Mutations return the full state plus `deckId` (the deck
   * created/changed; after a delete, the champion's default) and `decks` (ChampionDeckSummary[]).
   * `requestId` makes a retried create/duplicate idempotent: same id → one deck.
   */
  listDecks: (token: string, heroId: string) =>
    request<{ decks: ChampionDeckSummary[]; slots: number }>(CLOUD_CONFIG.apiUrl, `/api/tactics/decks/${encodeURIComponent(heroId)}`, {
      method: 'GET',
      token,
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
  createDeck: (token: string, heroId: string, input: { name?: string; cards?: readonly DeckEntry[]; requestId?: string }) =>
    api(token, 'POST', `/decks/${encodeURIComponent(heroId)}`, input),
  renameDeck: (token: string, heroId: string, deckId: string, name: string) =>
    api(token, 'PATCH', deckPath(heroId, deckId), { name }),
  duplicateDeck: (token: string, heroId: string, deckId: string, requestId?: string) =>
    api(token, 'POST', `${deckPath(heroId, deckId)}/duplicate`, requestId === undefined ? {} : { requestId }),
  setDefaultDeck: (token: string, heroId: string, deckId: string) =>
    api(token, 'PUT', `${deckPath(heroId, deckId)}/default`, {}),
  deleteDeck: (token: string, heroId: string, deckId: string) => api(token, 'DELETE', deckPath(heroId, deckId)),
  /** `deckId` omitted = the champion's default deck. */
  startSkirmish: (token: string, scenarioId: string, heroId: string, deckId?: string) =>
    api(token, 'POST', '/skirmish/start', deckId === undefined ? { scenarioId, heroId } : { scenarioId, heroId, deckId }),
  skirmishVictory: (token: string, battleId: number, proof: VictoryProof) =>
    api(token, 'POST', '/skirmish/victory', { battleId, proof }),
  skirmishReward: (token: string, battleId: number, optionId: string) =>
    api(token, 'POST', '/skirmish/reward', { battleId, optionId }),
  /**
   * Campaign steps name the champion whose run they change (each champion has its own run per
   * world) and the world's campaign; World 1 ('ascent') omits it, as clients always did.
   */
  startCampaign: (token: string, heroId: string, campaignId = 'ascent') => api(token, 'POST', '/campaign/start', { heroId, ...world(campaignId) }),
  victory: (token: string, proof: VictoryProof, heroId: string, campaignId = 'ascent') =>
    api(token, 'POST', '/campaign/victory', { proof, heroId, ...world(campaignId) }),
  reward: (token: string, optionId: string, encounterId: string, heroId: string, campaignId = 'ascent') =>
    api(token, 'POST', '/campaign/reward', { optionId, encounterId, heroId, ...world(campaignId) }),
};

const deckPath = (heroId: string, deckId: string) => `/decks/${encodeURIComponent(heroId)}/${encodeURIComponent(deckId)}`;
const world = (campaignId: string) => (campaignId === 'ascent' ? {} : { campaignId });
