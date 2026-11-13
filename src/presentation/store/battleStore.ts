import {drawRitual,classifyDraws} from '../cards/drawRitual';
import { pairTargets, planCardSelection, type PairSelection } from '../input/pairSelection';
import { saveQaCampaignTransition } from './campaignStorage';
import { ASCENT_CAMPAIGN, campaignForRun, WORLD_CAMPAIGNS, worldContext } from "../qa/shapeshifter/campaigns";
import { shapeshifterQaEnabled } from '../qa/shapeshifter/access';
import { realQaEngine, persistRealQaBattle, loadRealQaBattle, qaOpening, qaDepthRules, bindQaCampaign, qaBattleRun, qaBattleMatches, encodeRealQaBattle, decodeRealQaBattle } from '../qa/shapeshifter/realBattle';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT, withQaCatalogCopies } from '../qa/shapeshifter/runtime';
import { create } from 'zustand';
import {
  discardRequired,
  ARCHER_CAMPAIGN_FLAG,
  defaultCampaignFor,
  WORLD_2_FLAG,
  WORLD_3_FLAG,
  worldsView,
  worldById,
  worldOfCampaign,
  type CampaignDef,
  type WorldHistory,
  type WorldView,
  defaultCampaignHero,
  skirmishRewardContext,
  campaignBattleContent,
  starterHeroProfile,
  loadoutDeck,
  loadoutFor,
  selectChampion as applyChampion,
  selectedLoadout,
  claimReward,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  encounterById,
  encounterOrder,
  GameEngine,
  grantCard,
  legacyCardRewards,
  settleVictory,
  samePos,
  updateDeck,
  createDeck as createDeckOp,
  renameDeck as renameDeckOp,
  duplicateDeck as duplicateDeckOp,
  deleteDeck as deleteDeckOp,
  setDefaultDeck as setDefaultDeckOp,
  type DeckOpError,
  type DeckOpResult,
  SCENARIOS_BY_ID,
  validateDeck,
  heroProfile,
  ownedFor,
  sharedPool,
  starterShared,
  activeDeck,
  withHeroDeck,
  asNewPlayer,
  isChampionUnlocked,
  chooseStartingChampion as applyStartingChampion,
  claimChampionUnlock as applyChampionUnlock,
  guestMayFight,
  recordCampaignBest,
  type BattleLoadout,
  type DeckEntry,
  type DeckIssue,
  type GameContent,
  type PlayerProfile,
  type RunState,
  type Command,
  type GameEvent,
  type GameState,
  type Pos,
} from '../../game';
import { applyCatalogGrants, catalogFactsFrom } from '../../game/collection/free-catalog';
import { presentationBus } from '../events/presentationBus';
import { decideTap, isActionableTile, resolveTapTarget, type Aim } from '../input/aim';
import { clearVictory, keepVictory, pendingVictory } from './pendingVictory';
import type { IntroBeat, IntroVariant } from '../motion/introTimeline';
import { describeEvent, ERROR_LABEL, rememberUnits } from '../react/format';
import { explainCardBlock } from '../react/cardBlock';
import { tacticsApi, authApi, type CloudState } from '../cloud/api';
import { cloudEnabled } from '../cloud/config';
import { accountError } from '../cloud/accountErrors';
import type { CloudResult } from '../cloud/http';
import { loadSession, saveSession, type CloudSession } from '../cloud/session';
import { archerCampaignBuildEnabled, campaignHeroes, championReleased, guestRewardContent, openProgressionBuild, releasedCampaignHero, warriorBuildEnabled, withPrimordialQaSeals, world2BuildEnabled, world3BuildEnabled } from '../campaignRelease';
import { freshBattleSeed } from './battleSeed';
import {
  loadCampaigns,
  loadWorldHistory,
  loadWorldRuns,
  saveWorldHistory,
  readCampaignHero,
  loadProfile,
  readLocalSaves,
  saveCampaign,
  writeCampaignHero,
  saveProfile,
} from './campaignStorage';

/** Guest progress found on this device when an account has no cloud save yet. */
export interface LocalSummary {
  completedEncounters: number;
  campaignStatus: RunState['status'] | null;
  /** Card copies beyond the starter sets (earned rewards). */
  earnedCards: number;
}

/**
 * Account state. READY = signed in and the cloud is authoritative (profile/run come from the
 * server). Every other state plays with this device's guest saves, which an account never
 * overwrites. OFFLINE keeps the session but could not reach the server.
 */
export type AccountState =
  | { status: 'DISABLED' }
  | { status: 'GUEST'; message?: string }
  | { status: 'CONNECTING'; username: string }
  | { status: 'NEEDS_IMPORT'; username: string; local: LocalSummary }
  | { status: 'READY'; username: string; userId: number }
  | { status: 'OFFLINE'; username: string; message: string };

/** A cloud write in flight (busy) or failed (error). Failures are always shown, never assumed saved. */
export interface CloudStatus {
  busy: string | null;
  error: string | null;
  canRetry: boolean;
}

/** Idempotency key for deck create/duplicate (server REQUEST_ID: [a-z0-9-]{8,30}). */
// getRandomValues (not randomUUID): also available outside secure contexts (LAN dev hosts).
const newRequestId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

export type SaveDeckResult = { ok: true } | { ok: false; issues: DeckIssue[]; error?: string };
/** Multi-deck actions: `deckId` = the deck created/changed (after a delete: the new default). */
export type DeckActionResult =
  | { ok: true; deckId: string }
  | { ok: false; error: DeckOpError | 'CHAMPION_LOCKED' | 'CLOUD'; issues?: DeckIssue[]; message?: string };

export interface TurnBanner {
  id: number;
  faction: 'PLAYER' | 'ENEMY';
  round: number;
}

export interface LogEntry {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'turn';
}

/**
 * UI state only: which screen, which card is selected, which tile is aimed (hovered or tapped), the log.
 * The GameState itself is owned by the engine; `state` here is just the latest snapshot for
 * React to render. Every rule goes through `engine.dispatch(Command)`.
 */
interface BattleStore {
  onlineCommand: ((command: Command) => void) | null;
  screen: 'MENU' | 'BATTLE' | 'DECK' | 'CHAMPIONS';
  playbackBusy: boolean;
  handPulse: number;
  setPlaybackBusy(busy: boolean): void;
  pulseHand(count: number): void;
  /**
   * Battle intro (presentation only). Input stays locked from `begin`/`restart` until the
   * intro director reaches `unlock`; the engine state is final and untouched meanwhile.
   */
  introLocked: boolean;
  introVariant: IntroVariant;
  /** Beats already reached by the current intro, in order. The DOM reveals itself from these. */
  introReached: IntroBeat[];
  introBeat(beat: IntroBeat): void;
  /** Current turn banner ("Tu turno" / "Turno del enemigo"); `id` replays it on every turn. */
  turnBanner: TurnBanner | null;
  showTurnBanner(faction: TurnBanner['faction'], round: number): void;
  engine: GameEngine | null;
  state: Readonly<GameState> | null;
  selectedMechanismId: string | null;
  selectMechanism(id: string | null): void;
  interactMechanism(id: string): void;
  selectedCardUid: string | null;
  pairSelection: PairSelection | null;
  cancelPairTarget(): void;
  confirmPairWithChampion(): void;
  /**
   * End-of-turn hand limit (presentation state DISCARD_TO_HAND_LIMIT): non-null while the player
   * picks the card to discard after pressing Finalizar turno with 6 cards. `uid` = current pick.
   * The board takes no input meanwhile; the engine only sees the final END_TURN { discardUid }.
   */
  handDiscard: { uid: string | null } | null;
  /** Discard picker: confirm (DESCARTAR Y FINALIZAR) or back out and keep playing. */
  confirmHandDiscard(): void;
  cancelHandDiscard(): void;
  /** The tile feeding the board preview. Mouse hover and touch taps share it (see `input/aim`). */
  wallOrientation: 'HORIZONTAL' | 'VERTICAL';
  rotateIceWall(): void;
  aim: Aim | null;
  notice: string | null;
  log: LogEntry[];

  /**
   * Persistent campaign progression of `campaignHeroId` (= `runs[campaignHeroId]`). Kept across
   * menu ↔ battle and skirmishes; null when that champion never started the campaign.
   */
  run: RunState | null;
  /** Every champion's own World 1 («El Ascenso») run: progress never moves between champions. */
  runs: Record<string, RunState | null>;
  /** Runs of the worlds after World 1: campaign id → champion → run (World 1 stays in `runs`). */
  worldRuns: Record<string, Record<string, RunState | null>>;
  /** Guest world achievements (champion → world → record). Accounts use `cloudWorlds`. */
  worldHistory: Record<string, WorldHistory>;
  /** Server world contract per champion (accounts; null = guest or an older server). */
  cloudWorlds: CloudState['worlds'] | null;
  /** Server grant for World 2 (accounts). Use `world2ReleasedIn`. */
  world2Available: boolean;
  /** Server grant for the Archer campaign «Sendero del Cazador» (accounts). Use `archerCampaignReleasedIn`. */
  archerCampaignAvailable: boolean;
  /** World the campaign card shows / plays (`run` is its run for `campaignHeroId`). */
  campaignWorldId: string;
  /** Show another world (menu only; only an unlocked, released world). */
  selectWorld(worldId: string): void;
  /** Champion the campaign card shows / plays (only released champions, see campaignRelease). */
  campaignHeroId: string;
  qaSummonerCampaign: boolean;
  /** Server grant for the QA-only Warrior (cloud accounts). Use `warriorReleasedIn`. */
  warriorAvailable: boolean;
  /** Server list of champions released to the account (null = guest or older server). Use `availableChampionsIn`. */
  championsAvailable: string[] | null;
  /** First-time champion choice: unlocks it, selects it and points the campaign at it. */
  chooseStartingChampion(heroId: string): Promise<boolean>;
  /** Claim the champion a reached milestone offers (choice or reveal). */
  claimChampionUnlock(heroId: string): Promise<boolean>;
  /** The guest reached the end of the free encounters: the account invitation is open. */
  guestGate: boolean;
  closeGuestGate(): void;
  /** The guest chose to create/sign in to an account from the invitation (its progress is imported). */
  beginConversion(): void;
  /** One-off information for the menu (e.g. the account already had cloud progress). */
  accountNotice: string | null;
  dismissAccountNotice(): void;
  prepareSummonerQa(encounterId: string, tier: string, seed: number): Promise<boolean>;
  /** Show another champion's campaign (menu only; ignored during a battle or for unreleased champions). */
  selectCampaignHero(heroId: string): void;
  skirmish: NonNullable<CloudState['skirmish']> | null;
  /** What the current battle belongs to; null on the menu. Use `activeRun` in battle UI. */
  mode: 'CAMPAIGN' | 'SKIRMISH' | null;
  /**
   * Card collections and decks per hero (persisted, independent of any run). Every battle —
   * campaign or skirmish — fights with the hero's validated active deck (`battleDeck`).
   */
  profile: PlayerProfile;
  deckHeroId: string;
  /** Screen the Deck Builder returns to (it can be opened from the menu or from Champions). */
  deckReturn: 'MENU' | 'CHAMPIONS';
  openDeckBuilder(heroId?: string): void;
  closeDeckBuilder(): void;
  openChampions(): void;
  closeChampions(): void;
  /** Persist the champion for selectable modes (Skirmish, future PvP). Campaign keeps its own hero. */
  selectChampion(championId: string): void;
  /** Validate and persist one of the hero's decks (default deck when `deckId` is omitted). */
  saveDeck(heroId: string, cards: readonly DeckEntry[], deckId?: string): Promise<SaveDeckResult>;
  /**
   * "Mis Mazos" (max DEFAULT_DECK_SLOTS_PER_CHAMPION per champion). Guest: local profile;
   * account: the server decides (limits hold across devices). List with `deckSummaries`.
   */
  createDeck(heroId: string, input?: { name?: string; cards?: readonly DeckEntry[] }): Promise<DeckActionResult>;
  renameDeck(heroId: string, deckId: string, name: string): Promise<DeckActionResult>;
  duplicateDeck(heroId: string, deckId: string): Promise<DeckActionResult>;
  deleteDeck(heroId: string, deckId: string): Promise<DeckActionResult>;
  setDefaultDeck(heroId: string, deckId: string): Promise<DeckActionResult>;

  account: AccountState;
  cloud: CloudStatus;
  /** Resolves to an error message, or null when signed in. */
  signIn(username: string, password: string): Promise<string | null>;
  register(
    username: string,
    password: string,
    turnstileToken: string,
  ): Promise<{ error: string } | { recoveryCode: string }>;
  recoverAccount(
    username: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<{ error: string } | { recoveryCode: string }>;
  finishAccountSetup(): Promise<void>;
  sessionExpired(): void;
  signOut(): Promise<void>;
  /** Account without cloud save + guest progress on this device: import it once, or start fresh. */
  resolveImport(choice: 'IMPORT' | 'FRESH'): Promise<void>;
  /** Re-run the failed cloud step (or reconnect when OFFLINE). */
  retryCloud(): void;
  dismissCloudError(): void;

  /** Skirmish with the selected champion's loadout; `heroId` overrides it (QA / e2e). */
  /** `deckId`: one of the champion's decks for this battle (default deck when omitted). */
  startScenario(scenarioId: string, seed?: number, heroId?: string, deckId?: string): Promise<boolean>;
  /**
   * Fresh campaign for `campaignHeroId` (overwrites only that champion's progress). `startAt`
   * jumps to an encounter with the base loadout (QA / e2e, guest only). Resolves false when the
   * start failed (e.g. cloud error).
   */
  startRun(seed?: number, startAt?: string): Promise<boolean>;
  /** Resume the saved campaign at its current encounter (a pending reward is chosen from the menu). */
  continueRun(): void;
  /** Take exactly one offered reward; the run advances and the player returns to the route. */
  chooseReward(optionId: string): void;
  resumeQaBattle(): boolean;
  restart(): void;
  backToMenu(): void;
  /** Select a hand card or a ritual activation (`ritualSelection(id)`) for targeting. */
  selectCard(cardUid: string | null): void;
  confirmSummonSearch(cardUid: string, choiceUid: string): void;
  /** Seal a ritual piece from the hand onto the altar (the rules validate it). */
  commitRitualPiece(cardUid: string): void;
  /** Abandon a sealed piece (altar → discard). */
  releaseRitualPiece(cardUid: string): void;
  /** Fine pointer hover (desktop). Never clears an armed touch preview. */
  setHoverTile(pos: Pos | null): void;
  /** Mouse click: act on the tile immediately (the hover already showed the preview). */
  clickTile(pos: Pos): void;
  /**
   * Touch/pen tap. `candidates` = ground tile first, then tiles of unit bodies under the finger.
   * First tap previews, a second tap on the same tile acts, another tile moves the preview.
   */
  tapTile(candidates: readonly Pos[]): void;
  /** Act on the armed touch preview (Confirm button), same as tapping it again. */
  confirmAim(): void;
  /** Leave targeting/preview entirely: deselect the card and drop any armed preview. */
  cancelAim(): void;
  endTurn(): void;
}

let unsubscribeEngine: (() => void) | null = null;
/** The signed-in session (token) while an account is attached; never part of React state. */
let session: CloudSession | null = null;
/** Re-runs the last failed cloud step, including what happens after it succeeds. */
let retryAction: (() => void) | null = null;
/**
 * The battle whose victory was last submitted, per engine (one proof per battle). `restart()`
 * reuses the engine with a new seed and history, so the key is the battle, not the engine.
 */
const submitted = new WeakMap<GameEngine, string>();

const IDLE: CloudStatus = { busy: null, error: null, canRetry: false };

export const cloudActive = (s: { account: AccountState }): boolean => s.account.status === 'READY';

/** Whether the QA-only Warrior is offered: the server decides for accounts, the build flag for guests. */
export const warriorReleasedIn = (s: { account: AccountState; warriorAvailable: boolean }): boolean =>
  cloudActive(s) ? s.warriorAvailable : warriorBuildEnabled();

type ReleaseView = { account: AccountState; warriorAvailable: boolean; qaSummonerCampaign: boolean; championsAvailable: string[] | null; archerCampaignAvailable?: boolean };

/** Whether the Archer campaign is released to this player: the server decides for accounts, the build flag for guests. */
export const archerCampaignReleasedIn = (s: { account: AccountState; archerCampaignAvailable?: boolean }): boolean =>
  cloudActive(s) ? s.archerCampaignAvailable === true : archerCampaignBuildEnabled();

/**
 * Champions released to this player: what the first-time choice and the milestone unlocks
 * offer. The server decides for accounts; the build flags for guests.
 */
import { archerPresentationEnabled } from '../archerRelease';

export const availableChampionsIn = (s: ReleaseView): string[] =>
  cloudActive(s) && s.championsAvailable ? s.championsAvailable : [...new Set([...campaignHeroes(s.qaSummonerCampaign, warriorReleasedIn(s)), ...(archerPresentationEnabled ? ['archer'] : [])])];

/** Released AND unlocked: who may play any mode (skirmish, decks, PvP). */
export const championUsableIn = (s: ReleaseView & { profile: PlayerProfile }, heroId: string): boolean =>
  !!DEFAULT_CONTENT.heroes[heroId] && championReleased(heroId, warriorReleasedIn(s)) && (shapeshifterQaEnabled && heroId === 'shapeshifter' || isChampionUnlocked(s.profile, heroId)) && (heroId !== 'shapeshifter' || shapeshifterQaEnabled || availableChampionsIn(s).includes(heroId)) && (heroId !== 'archer' || availableChampionsIn(s).includes(heroId));

/** Campaign champions this player can play right now (released for the campaign and unlocked). */
export const campaignChampionsIn = (s: ReleaseView & { profile: PlayerProfile }): string[] =>
  campaignHeroes(s.qaSummonerCampaign, warriorReleasedIn(s), archerCampaignReleasedIn(s)).filter((id) => championUsableIn(s, id));

/**
 * Guests on a build with accounts stop after the free encounters (GUEST_ENCOUNTER_LIMIT).
 * Builds without accounts have nowhere to convert, and the dev bypass lifts it for e2e.
 */
export const guestLimited = (s: { account: AccountState }): boolean =>
  !cloudActive(s) && s.account.status !== 'DISABLED' && !openProgressionBuild();

/**
 * Whether `profile` may drive first-time onboarding / unlock prompts: only when it is the
 * authoritative profile. A signed-in account is decided by the SERVER: while its cloud state is
 * loading, unreachable (OFFLINE — e.g. a new domain the API refuses) or waiting for an import
 * choice, the store holds this device's guest profile, which says nothing about the account.
 */
export const championPromptsAllowed = (s: { account: AccountState }): boolean =>
  s.account.status === 'READY' || s.account.status === 'GUEST' || s.account.status === 'DISABLED';

/** Whether World 2 is released to this player: the server decides for accounts, the build flag for guests. */
export const world2ReleasedIn = (s: { account: AccountState; world2Available: boolean }): boolean =>
  cloudActive(s) ? s.world2Available : world2BuildEnabled();

type WorldsView = { account: AccountState; world2Available: boolean; archerCampaignAvailable?: boolean; runs: Record<string, RunState | null>; worldRuns: Record<string, Record<string, RunState | null>>; worldHistory: Record<string, WorldHistory>; cloudWorlds: CloudState['worlds'] | null };

/**
 * The released worlds for one champion, with unlock and progress. Accounts read the server's
 * authoritative contract; guests derive it from their own saves with the same rules.
 */
export function worldsIn(s: WorldsView, heroId: string): WorldView[] {
  if (cloudActive(s) && s.cloudWorlds) return s.cloudWorlds[heroId]?.worlds ?? [];
  const ctx = worldContext((flag) =>
    flag === WORLD_2_FLAG
      ? world2ReleasedIn(s) || (shapeshifterQaEnabled && heroId === 'shapeshifter')
      : flag === WORLD_3_FLAG
        ? !cloudActive(s) && world3BuildEnabled()
        : flag === ARCHER_CAMPAIGN_FLAG && archerCampaignReleasedIn(s),
  );
  const runs: Record<string, RunState | null> = { [ASCENT_CAMPAIGN.id]: s.runs[heroId] ?? null };
  for (const [campaignId, byHero] of Object.entries(s.worldRuns)) runs[campaignId] = byHero[heroId] ?? null;
  return worldsView(ctx, runs, s.worldHistory[heroId] ?? {}, heroId);
}

/** The world a champion's campaign card opens first (World 1; the Archer's own act). */
export const homeWorldId = (heroId: string): string =>
  worldOfCampaign(worldContext(), defaultCampaignFor(heroId).id)?.id ?? 'world_1';

/** The campaign of a world id (World 1 when unknown). */
export const campaignOfWorld = (worldId: string): CampaignDef =>
  WORLD_CAMPAIGNS[worldById(worldContext(), worldId)?.campaignId ?? ASCENT_CAMPAIGN.id] ?? ASCENT_CAMPAIGN;

/** The campaign the campaign card shows (its route, encounters and name). */
export const selectedCampaign = (s: { campaignWorldId: string }): CampaignDef => campaignOfWorld(s.campaignWorldId);

/** One champion's run in one world. */
const runIn = (s: Pick<WorldsView, 'runs' | 'worldRuns'>, heroId: string, campaignId: string): RunState | null =>
  campaignId === ASCENT_CAMPAIGN.id ? (s.runs[heroId] ?? null) : (s.worldRuns[campaignId]?.[heroId] ?? null);

/**
 * The saved profile, or a starter one. When no profile exists yet but a campaign does (a save
 * from before collections existed), the card rewards it already earned join the collection.
 */
function bootProfile(runs: Record<string, RunState | null>): PlayerProfile {
  // Dev QA mode only (`vite --mode primordialqa`): the guest owns the Dragón Primordial seals.
  const profile = withQaCatalogCopies(withPrimordialQaSeals(bootSavedOrStarterProfile(runs)));
  // Free catalog: milestones already met on this device grant their missing card (retroactive).
  const synced = guestCatalogGrants(profile, runs, loadWorldRuns(), loadWorldHistory());
  if (synced !== profile) saveProfile(synced);
  return synced;
}

/** Guest free-catalog grants from this device's runs and world history (cards only; idempotent). */
function guestCatalogGrants(
  profile: PlayerProfile,
  runs: Readonly<Record<string, RunState | null>>,
  worldRuns: Readonly<Record<string, Readonly<Record<string, RunState | null>>>>,
  worldHistory: Readonly<Record<string, WorldHistory>>,
): PlayerProfile {
  const facts = catalogFactsFrom({ runs: (heroId) => [runs[heroId], ...Object.values(worldRuns).map((byHero) => byHero[heroId])], worldHistory });
  return applyCatalogGrants(profile, guestRewardContent(), facts).profile;
}

function bootSavedOrStarterProfile(runs: Record<string, RunState | null>): PlayerProfile {
  const saved = loadProfile();
  if (saved) {
    const restored = recordCampaignBest(saved, Math.max(saved.champions?.campaignBest ?? 0, ...Object.entries(runs).filter(([id]) => id !== 'shapeshifter').map(([,r]) => r?.completedEncounterIds.length ?? 0), openProgressionBuild() ? 6 : 0));
    if (!openProgressionBuild() && restored !== saved) saveProfile(restored);
    return restored;
  }
  const run = runs[defaultCampaignHero(ASCENT_CAMPAIGN)];
  // Nothing saved on this device = a new player: first-time champion choice. Any older save
  // (a run without a profile) is a legacy player and keeps the open roster.
  const fresh = !Object.values(runs).some(Boolean);
  let profile = fresh && !openProgressionBuild() && !shapeshifterQaEnabled ? asNewPlayer(createProfile(DEFAULT_CONTENT)) : createProfile(DEFAULT_CONTENT);
  const legacy = run ? legacyCardRewards(run) : [];
  for (const cardId of legacy) {
    const granted = grantCard(profile, run!.heroId, cardId, DEFAULT_CONTENT);
    if (granted.ok) profile = granted.profile;
  }
  if (legacy.length) saveProfile(profile);
  return recordCampaignBest(profile, Math.max(profile.champions?.campaignBest ?? 0, ...Object.entries(runs).filter(([id]) => id !== 'shapeshifter').map(([,r]) => r?.completedEncounterIds.length ?? 0), openProgressionBuild() ? 6 : 0));
}

/** The campaign run the current battle belongs to (null in skirmish or on the menu). */
export const activeRun = (s: {
  run: RunState | null;
  mode: BattleStore['mode'];
  skirmish?: CloudState['skirmish'];
}): RunState | null =>
  s.mode === 'CAMPAIGN' ? s.run : s.mode === 'SKIRMISH' ? (s.skirmish?.run ?? null) : null;

/** Any presentation sequence that must finish before the player acts again. */
export const inputLocked = (s: { playbackBusy: boolean; introLocked: boolean }): boolean =>
  s.playbackBusy || s.introLocked;
let logId = 0;

/**
 * END_TURN resolves the whole enemy phase instantly, so a double click (or a held key) would
 * end the NEXT turn too. Ignore repeats inside this window. Presentation-only input guard.
 */
const END_TURN_GUARD_MS = 600;
let lastEndTurnAt = Number.NEGATIVE_INFINITY;

function toLog(events: readonly GameEvent[], state: Readonly<GameState>): LogEntry[] {
  return events.flatMap((e) => {
    const described = describeEvent(e, state);
    return described ? [{ id: logId++, ...described }] : [];
  });
}

export const useBattleStore = create<BattleStore>((set, get) => {
  // The one-time code stays in the overlay only. No session is persisted before acknowledgement.
  let pendingAccount: CloudSession | null = null;
  /** Set when the guest chose "create account / I have an account" from the invitation. */
  let converting = false;
  function attach(engine: GameEngine): void {
    unsubscribeEngine?.();
    unsubscribeEngine = engine.subscribe((events, state) => {
      const previous = get().state;
      if(events.some(e=>e.type==='BATTLE_STARTED')||state.outcome)drawRitual.reset();

      if (previous) rememberUnits(previous);
      set((s) => ({
        state,
        log: [...s.log, ...toLog(events, state)].slice(-80),
        ...(s.aim?.source === 'tap' ? { aim: null } : {}),
      }));

      persistRealQaBattle(engine);
      settleRunVictory(state);
      presentationBus.publish(events, state);
      if(!state.outcome)drawRitual.enqueue(classifyDraws({events,state,previous,content:engine.content,revision:`${engine.scenario.id}:${engine.history.length}`}));
    });
  }

  /**
   * Guest progression writes: one per meaningful step, never per frame. Never used while an
   * account is attached (the server already persisted the step), so guest saves stay intact.
   */
  function commitRun(run: RunState): void {
    set((s) => {
      const shown = run.heroId === s.campaignHeroId && run.campaignId === selectedCampaign(s).id ? { run } : {};
      if (run.campaignId === ASCENT_CAMPAIGN.id) return { runs: { ...s.runs, [run.heroId]: run }, ...shown };
      return { worldRuns: { ...s.worldRuns, [run.campaignId]: { ...s.worldRuns[run.campaignId], [run.heroId]: run } }, ...shown };
    });
    if (!cloudActive(get())) saveCampaign(run);
  }

  /** The run the campaign card shows: this champion in the selected world. */
  function shownRun(heroId = get().campaignHeroId, worldId = get().campaignWorldId): RunState | null {
    return runIn(get(), heroId, campaignOfWorld(worldId).id);
  }

  /** Replace every champion's runs (boot, account switch) keeping the shown run in sync. */
  function setRuns(runs: Record<string, RunState | null>, worldRuns: Record<string, Record<string, RunState | null>>): Partial<BattleStore> {
    return { runs, worldRuns, run: runIn({ runs, worldRuns }, get().campaignHeroId, selectedCampaign(get()).id) };
  }

  /** The selected world must stay visible and unlocked for the shown champion (else its first world). */
  function keepWorldUsable(): void {
    const s = get();
    const views = worldsIn(s, s.campaignHeroId);
    if (views.some((w) => w.id === s.campaignWorldId && w.unlocked)) return;
    const home = homeWorldId(s.campaignHeroId);
    set({ campaignWorldId: home, run: runIn(s, s.campaignHeroId, campaignOfWorld(home).id) });
  }

  /** Guest: a world's boss was defeated (durable; unlocks the next world for this champion). */
  function recordWorldCompleted(run: RunState): void {
    const world = worldOfCampaign(worldContext(), run.campaignId);
    if (!world || !run.completedEncounterIds.includes(world.bossEncounterId)) return;
    const history = get().worldHistory;
    if (history[run.heroId]?.[world.id]?.completedAt != null) return;
    // Guests have no wallet (no crystals); the champion's exclusive card goes to the collection.
    const cardId = world.completionReward?.championCards?.[run.heroId];
    const granted = cardId ? grantCard(get().profile, run.heroId, cardId, DEFAULT_CONTENT) : null;
    const now = Date.now();
    const next = { ...history, [run.heroId]: { ...history[run.heroId], [world.id]: { completedAt: now, rewardGrantedAt: granted?.ok ? now : null } } };
    set({ worldHistory: next });
    saveWorldHistory(next);
    if (granted?.ok) commitProfile(granted.profile);
  }

  function commitProfile(profile: PlayerProfile): void {
    set({ profile });
    if (!cloudActive(get())) saveProfile(profile);
  }

  // ── Cloud ────────────────────────────────────────────────────────────────────────────

  function applyCloud(data: CloudState): void {
    if (!data.profile) return;
    // Older servers only send the Mage run (and no worlds).
    const runs = data.runs ?? { [defaultCampaignHero(ASCENT_CAMPAIGN)]: data.run };
    set({
      qaSummonerCampaign: data.qaSummonerCampaign === true,
      warriorAvailable: data.warriorAvailable === true,
      world2Available: data.world2Available === true,
      archerCampaignAvailable: data.archerCampaignAvailable === true,
      cloudWorlds: data.worlds ?? null,
      championsAvailable: Array.isArray(data.championsAvailable) ? data.championsAvailable : null,
      profile: data.profile,
      ...setRuns(runs, data.worldRuns ?? {}),
      skirmish: data.skirmish ?? null,
      account: { status: 'READY', username: data.user.username, userId: data.user.id },
    });
    keepCampaignHeroUsable();
    keepWorldUsable();
  }

  /** The campaign card never shows a champion this player cannot play (locked or unreleased). */
  function keepCampaignHeroUsable(): void {
    const choices = campaignChampionsIn(get());
    const current = get().campaignHeroId;
    if (choices.includes(current) || !choices.length) return;
    const next = choices.includes(get().profile.selectedChampionId) ? get().profile.selectedChampionId : choices[0]!;
    set({ campaignHeroId: next, run: shownRun(next) });
    keepWorldUsable();
  }

  /** Back to this device's guest progress (signed out, or the account could not be loaded). */
  function restoreGuest(account: AccountState): void {
    const runs = loadCampaigns();
    set({ account, qaSummonerCampaign: false, warriorAvailable: false, world2Available: false, archerCampaignAvailable: false, cloudWorlds: null, championsAvailable: null, guestGate: false, campaignHeroId: defaultCampaignHero(ASCENT_CAMPAIGN), campaignWorldId: 'world_1', runs, worldRuns: loadWorldRuns(), worldHistory: loadWorldHistory(), run: runs[defaultCampaignHero(ASCENT_CAMPAIGN)] ?? null, skirmish: null, profile: bootProfile(runs), cloud: IDLE });
    retryAction = null;
    keepCampaignHeroUsable();
  }

  function expireSession(): void {
    session = null;
    saveSession(null);
    // Never let an interrupted cloud PvE battle write its rewards into the guest save.
    // An active PvP socket remains under the existing authoritative reconnect flow.
    if (!get().onlineCommand) get().backToMenu();
    restoreGuest({
      status: 'GUEST',
      message: 'Tu sesión venció. Tu progreso guardado sigue en la nube. Vuelve a iniciar sesión.',
    });
  }

  /**
   * One authoritative cloud step. Success → the server's state replaces ours and `then` runs.
   * Failure → shown with a retry (network/server) — never treated as saved.
   */
  async function cloudStep(
    label: string,
    call: (token: string) => Promise<CloudResult<CloudState>>,
    then?: (data: CloudState) => void,
  ): Promise<CloudState | null> {
    if (!session) return null;
    set({ cloud: { busy: label, error: null, canRetry: false } });
    const currentSession = session;
    const result = await call(currentSession.token);
    if (session !== currentSession) return null;
    if (result.ok) {
      retryAction = null;
      set({ cloud: IDLE });
      applyCloud(result.data);
      if (result.data.crystalRewards?.length) set({ notice: result.data.crystalRewards.map(r => `+${r.amount} 💎 · ${r.reason === 'DAILY_FIRST_WIN' ? 'Primera victoria del día' : 'Hito de campaña'}`).join(' · ') });
      then?.(result.data);
      return result.data;
    }
    if (result.error.kind === 'AUTH') {
      expireSession();
      return null;
    }
    const transient = result.error.kind !== 'REJECTED' || result.error.code === 'INVALID_VICTORY';
    retryAction = transient ? () => void cloudStep(label, call, then) : null;
    set({ cloud: { busy: null, error: `${label}: ${result.error.message}`, canRetry: transient } });
    return null;
  }

  function localSummary(): LocalSummary | null {
    const raw = readLocalSaves();
    if (!raw.profile && !Object.values(raw.campaigns).some(Boolean)) return null;
    const { profile, runs } = get(); // guest state loaded from those saves
    const started = Object.values(runs).filter((r): r is RunState => r !== null);
    const run = runs[defaultCampaignHero(ASCENT_CAMPAIGN)] ?? started[0] ?? null;
    let earned = 0;
    // Copies beyond the starter set, card by card (starter copies — the starter deck plus the
    // owned-by-default `starterCollection` — are always owned, never "earned").
    for (const [heroId, hero] of Object.entries(profile.heroes)) {
      const starter = DEFAULT_CONTENT.heroes[heroId];
      const base = starter ? starterHeroProfile(starter, DEFAULT_CONTENT).collection : {};
      for (const [cardId, owned] of Object.entries(hero.collection))
        earned += Math.max(0, owned.copies - (base[cardId]?.copies ?? 0));
    }
    for (const [cardId, owned] of Object.entries(sharedPool(profile, DEFAULT_CONTENT).collection))
      earned += Math.max(0, owned.copies - (starterShared(DEFAULT_CONTENT).collection[cardId]?.copies ?? 0));
    return {
      completedEncounters: run?.completedEncounterIds.length ?? 0,
      campaignStatus: run?.status ?? null,
      earnedCards: earned,
    };
  }

  /** Load the account's cloud save (or offer importing this device's progress when it has none). */
  async function connect(next: CloudSession): Promise<void> {
    session = next;
    set({ account: { status: 'CONNECTING', username: next.username }, cloud: IDLE });
    const result = await tacticsApi.state(next.token);
    if (session !== next) return; // signed out meanwhile
    if (!result.ok) {
      if (result.error.kind === 'AUTH') return expireSession();
      retryAction = () => void connect(next);
      set({
        account: {
          status: 'OFFLINE',
          username: next.username,
          message: `${result.error.message} Jugando con el progreso local de este dispositivo.`,
        },
        cloud: IDLE,
      });
      return;
    }
    if (result.data.hasProfile) {
      // Signing in from the guest invitation to an account that already has cloud progress:
      // the cloud save is used and the guest save stays on this device, untouched (no merge).
      if (converting && localSummary())
        set({ accountNotice: 'Tu cuenta ya tenía progreso en la nube y es el que se usa. El progreso de invitado de este dispositivo no se mezcló: sigue guardado aquí.' });
      converting = false;
      applyCloud(result.data);
      if (result.data.crystalRewards?.length) set({ notice: result.data.crystalRewards.map(r => `+${r.amount} 💎 · ${r.reason === 'DAILY_FIRST_WIN' ? 'Primera victoria del día' : 'Hito de campaña'}`).join(' · ') });
      const pending = pendingVictory(next.username);
      const run = pending ? runIn(get(), pending.heroId, pending.campaignId) : null;
      if (pending && run?.seed === pending.runSeed) {
        if (run.completedEncounterIds.includes(pending.proof.encounterId)) clearVictory(next.username);
        else if (run.status === 'IN_BATTLE' && run.currentEncounterId === pending.proof.encounterId) {
          const engine = new GameEngine(currentEncounter(campaignForRun(run), run), campaignBattleContent(DEFAULT_CONTENT, result.data.profile!, run, DECK_RULES), pending.proof.seed);
          const accepted = pending.proof.commands.every((command) => engine.dispatch(command).ok);
          if (accepted && engine.state.outcome?.result === 'WON') {
            const worldId = worldOfCampaign(worldContext(), run.campaignId)?.id ?? 'world_1';
            set({ mode: 'CAMPAIGN', campaignHeroId: run.heroId, campaignWorldId: worldId, run });
            begin(engine);
            settleRunVictory(engine.state);
          } else set({ cloud: { busy: null, error: 'No pudimos reconstruir el resultado pendiente. Conservamos el registro para revisarlo.', canRetry: false } });
        }
      }
      return;
    }
    const local = localSummary();
    const fromInvitation = converting;
    converting = false;
    // From the guest invitation the intent is explicit: carry this device's progress over (the
    // same one-time, server-validated import). Otherwise the player decides in ImportDialog.
    if (local && fromInvitation) {
      await cloudStep('Importar progreso', (t) => tacticsApi.importLocal(t, readLocalSaves()));
      return;
    }
    if (local) return set({ account: { status: 'NEEDS_IMPORT', username: next.username, local } });
    await cloudStep('Crear perfil en la nube', (t) => tacticsApi.createProfile(t));
  }

  /** Same validation the server runs, before even trying (instant feedback, no round trip). */
  /** One multi-deck operation: the pure rule locally (guest), the server's answer when signed in. */
  async function deckAction(
    heroId: string,
    label: string,
    local: () => DeckOpResult,
    remote: (token: string) => Promise<CloudResult<CloudState>>,
  ): Promise<DeckActionResult> {
    if (!championUsableIn(get(), heroId)) return { ok: false, error: 'CHAMPION_LOCKED', message: 'Todavía no has desbloqueado este campeón.' };
    if (!cloudActive(get())) {
      const result = local();
      if (!result.ok) return { ok: false, error: result.error, issues: result.issues };
      commitProfile(result.profile);
      return { ok: true, deckId: result.deckId };
    }
    const data = await cloudStep(label, remote);
    return data?.deckId
      ? { ok: true, deckId: data.deckId }
      : { ok: false, error: 'CLOUD', message: get().cloud.error ?? 'No se pudo guardar en la nube.' };
  }

  function localDeckIssues(heroId: string, cards: readonly DeckEntry[]): DeckIssue[] {
    return validateDeck(
      cards,
      heroId,
      ownedFor(get().profile, heroId, DEFAULT_CONTENT),
      DEFAULT_CONTENT,
      DECK_RULES,
    );
  }

  /** Classification changes keep saved decks intact, but never silently substitute a starter. */
  function neutralDeckBlocked(heroId: string, deckId?: string): boolean {
    const hero = heroProfile(get().profile, heroId, DEFAULT_CONTENT);
    const deck = deckId === undefined ? activeDeck(hero) : hero.decks.find(d => d.id === deckId);
    const issue = deck && localDeckIssues(heroId, deck.cards).find(i => i.code === 'NEUTRAL_LIMIT');
    if (!issue || issue.code !== 'NEUTRAL_LIMIT') return false;
    set({notice:`Tu mazo contiene ${issue.count} cartas neutrales; el máximo es ${issue.limit}. Corrígelo en Colección/Mazo antes de iniciar una partida.`});
    return true;
  }

  /**
   * Base content with the loadout's champion fighting its validated active deck (starter if the
   * saved one is not legal). Every mode goes through here: the deck can never come from another champion.
   */
  function battleContent(loadout: BattleLoadout): GameContent {
    const deck = loadoutDeck(get().profile, loadout, DEFAULT_CONTENT, DECK_RULES);
    if (deck.source === 'STARTER')
      console.warn(
        `[deck] saved ${loadout.championId} deck is not legal (${deck.issues.map((i) => i.code).join(', ')}); using the starter deck.`,
      );
    return withHeroDeck(DEFAULT_CONTENT, loadout.championId, deck.cards);
  }

  /**
   * Victory → reward offer. Guest: settleVictory rejects repeats, so this is safe on every
   * update. Account: the battle's seed + command history go to the server, which replays them
   * and only then records the victory (one submission per battle).
   */
  function settleRunVictory(state: Readonly<GameState>): void {
    const current = get();
    if (shapeshifterQaEnabled && current.engine?.scenario.hero.heroId === 'shapeshifter') {
      const run = activeRun(current);
      if (current.mode !== 'CAMPAIGN' || !run || !qaBattleMatches(current.engine, run)) return;
      if (state.outcome?.result !== 'WON') return;
      try {
        const verified = decodeRealQaBattle(encodeRealQaBattle(current.engine));
        if (verified.state.outcome?.result !== 'WON' || JSON.stringify(verified.state) !== JSON.stringify(state)) return;
      } catch { set({ notice: 'No se pudo verificar la victoria QA.' }); return; }
    }
    if (
      current.mode === 'SKIRMISH' &&
      current.skirmish &&
      cloudActive(current) &&
      state.outcome?.result === 'WON'
    ) {
      const engine = current.engine,
        battle = current.skirmish;
      if (!engine || battle.run.status !== 'IN_BATTLE' || submitted.has(engine)) return;
      submitted.set(engine, `${battle.id}`);
      void cloudStep('Guardar victoria', (t) =>
        tacticsApi.skirmishVictory(t, battle.id, {
          encounterId: state.scenarioId,
          seed: engine.seed,
          commands: [...engine.history],
        }),
      );
      return;
    }
    const run = activeRun(get());
    if (!run || state.outcome?.result !== 'WON') return;
    if (!cloudActive(get())) {
      const result = settleVictory(
        campaignForRun(run),
        guestRewardContent(),
        get().profile,
        run,
        state.scenarioId,
        DECK_RULES,
      );
      if (!result.ok) return;
      if (run.heroId === 'shapeshifter' && !saveQaCampaignTransition(result.run, result.profile)) {
        set({ notice: 'No se pudo guardar el progreso QA; conserva esta sesión.' }); return;
      }
      commitRun(result.run);
      // Account-wide milestones count World 1's best run of any champion (pity also changes on a win without a card).
      const profile = run.heroId !== 'shapeshifter' && run.campaignId === ASCENT_CAMPAIGN.id ? recordCampaignBest(result.profile, result.run.completedEncounterIds.length) : result.profile;
      if (profile !== get().profile) commitProfile(profile);
      // Last: the world reward card is granted on top of the profile just committed.
      recordWorldCompleted(result.run);
      const s = get();
      const synced = guestCatalogGrants(s.profile, s.runs, s.worldRuns, s.worldHistory);
      if (synced !== s.profile) commitProfile(synced);
      return;
    }
    const engine = get().engine;
    if (!engine || run.status !== 'IN_BATTLE') return;
    const battleKey = `${engine.seed}:${engine.history.length}`;
    if (submitted.get(engine) === battleKey) return;
    submitted.set(engine, battleKey);
    const proof = {
      encounterId: state.scenarioId,
      seed: engine.seed,
      commands: [...engine.history],
    };
    const username = session!.username;
    keepVictory(username, run, proof);
    void cloudStep('Confirmar victoria', (t) => tacticsApi.victory(t, proof, run.heroId, run.campaignId), () => clearVictory(username));
  }

  /** Fresh engine for an encounter (or scenario), wired to the store and the canvas. */
  function begin(engine: GameEngine): void {
    persistRealQaBattle(engine);
    attach(engine);
    set({
      screen: 'BATTLE',
      playbackBusy: false,
      handPulse: 0,
      introLocked: true,
      introVariant: 'FULL',
      introReached: [],
      turnBanner: null,
      engine,
      state: engine.state,
      selectedCardUid: null, pairSelection: null,
      handDiscard: null,
      aim: null,
      notice: null,
      log: toLog(engine.initialEvents, engine.state),
    });
    drawRitual.reset();
    presentationBus.publish(engine.initialEvents, engine.state);
  }

  /**
   * Every campaign battle starts here, so this is where locks are enforced (not in the
   * buttons): a locked champion never fights, and a guest never starts an encounter past the
   * free ones — whatever the run, route or UI state says. The invitation opens instead.
   */
  function beginEncounter(run: RunState): boolean {
    if (neutralDeckBlocked(run.heroId)) return false;
    if (!campaignChampionsIn(get()).includes(run.heroId)) {
      set({ notice: 'Todavía no has desbloqueado este campeón.' });
      return false;
    }
    const campaign = campaignForRun(run);
    if (guestLimited(get()) && !guestMayFight(campaign, run.currentEncounterId)) {
      set({ guestGate: true });
      return false;
    }
    // A world that is hidden or still locked for this champion never starts a battle.
    const world = worldOfCampaign(worldContext(), campaign.id);
    if (world && !worldsIn(get(), run.heroId).some((w) => w.id === world.id && w.unlocked)) {
      set({ notice: 'Completa el mundo anterior con este campeón para entrar aquí.' });
      return false;
    }
    const encounter = currentEncounter(campaign, run);
    set({ mode: 'CAMPAIGN' });
    // Fresh shuffle every time. Reward offers stay tied to the run (battleSeed), not to this seed.
    // Same content the server replays a victory with (campaignBattleContent).
    const content = campaignBattleContent(DEFAULT_CONTENT, get().profile, run, DECK_RULES);
    if (shapeshifterQaEnabled && run.heroId === 'shapeshifter' && qaOpening() === 'guaranteed' && !content.heroes.shapeshifter!.deck.some(e => e.count > 0 && content.cards[e.cardId]?.effects.some(f => f.type === 'TRANSFORM'))) {
      set({notice:'QA: añade una transformación al mazo o usa apertura normal.'}); return false;
    }
    begin(shapeshifterQaEnabled && run.heroId === 'shapeshifter'
      ? bindQaCampaign(realQaEngine(encounter, content, freshBattleSeed(), qaOpening(), qaDepthRules()), run)
      : new GameEngine(encounter, content, freshBattleSeed()));
    return true;
  }

  /** Drop a touch-armed preview; a mouse hover stays because the pointer is still there. */
  const withoutTapAim = (aim: Aim | null) => (aim?.source === 'tap' ? null : aim);

  /** Act on a tile with the current selection. Shared by mouse click, second tap and Confirm. */
  function selectObject(pos: Pos): boolean {
    const {engine,selectedCardUid}=get();
    if(!engine||selectedCardUid||inputLocked(get()))return false;
    const object=engine.getMechanismView()?.objects.find(o=>samePos(o.pos,pos));
    if(!object)return false;
    if(!object.solid&&!object.interactable)return false;
    set({selectedMechanismId:object.id,aim:null});return true;
  }
  function actOnTile(pos: Pos): void {
    const { engine, selectedCardUid } = get();
    if (!engine || engine.state.phase !== 'PLAYER' || get().handDiscard || inputLocked(get())) return;
    if (selectedCardUid) {
      // A hand card or a ritual activation: the engine knows the targeting of both.
      const targeting = engine.selectionTargeting(selectedCardUid);
      const target = targeting?.type === 'SELF' ? null : pos;
      if (
        targeting?.type === 'SELF' &&
        !samePos(pos, engine.state.units.find((u) => u.id === engine.heroId)?.pos ?? pos)
      ) {
        return set({
          notice: 'Esta carta se lanza sobre ti: elige al Mago o la carta otra vez.',
        });
      }
      const plan = planCardSelection(engine, selectedCardUid, target, get().pairSelection);
      if (plan.kind === 'invalid') { set({ notice: ERROR_LABEL.INVALID_TARGET }); return; }
      if (plan.kind === 'first') {
        set({ pairSelection: plan.pair, aim: null, notice: 'Elige otra invocación o intercambia con tu campeón.' });
        return;
      }
      if (run(plan.command)) set({ selectedCardUid: null, pairSelection: null });
      return;
    }
    const legal = engine.getLegalMoves().some((n) => samePos(n.pos, pos));
    if (legal) run({ type: 'MOVE_UNIT', unitId: engine.heroId, to: pos });
  }

  function run(command: Command): boolean {
    drawRitual.complete();
    const { engine } = get();
    if (!engine || inputLocked(get())) return false;
    if (get().onlineCommand) {
      get().onlineCommand!(command);
      return true;
    }
    const result = engine.dispatch(command);
    if (!result.ok) set({ notice: ERROR_LABEL[result.error] });
    else set({ notice: null });
    return result.ok;
  }

  const bootRuns = loadCampaigns();
  const bootHero = releasedCampaignHero(readCampaignHero());
  const bootWorldRuns = loadWorldRuns();
  const bootWorldId = homeWorldId(bootHero);
  const bootGuestProfile = bootProfile(bootRuns);
  // A signed-in device reconnects to its account once the store exists (guest saves stay untouched).
  const bootSession = cloudEnabled() ? loadSession() : null;
  if (bootSession) queueMicrotask(() => void connect(bootSession));
  queueMicrotask(keepCampaignHeroUsable);

  return {
    selectedMechanismId: null,
    selectMechanism: (id) => set({ selectedMechanismId:id, selectedCardUid:null,pairSelection:null, aim:null }),
    interactMechanism: (id) => { if(get().engine?.getMechanismView() && !get().selectedCardUid) run({type:"INTERACT",mechanismId:id}); },
    onlineCommand: null,
    screen: 'MENU',
    playbackBusy: false,
    handPulse: 0,
    setPlaybackBusy: (playbackBusy) => set({ playbackBusy }),
    pulseHand: (count) => set((s) => ({ handPulse: s.handPulse + count })),
    introLocked: false,
    introVariant: 'FULL',
    introReached: [],
    introBeat: (beat) => {
      set((s) => ({
        introReached: [...s.introReached, beat],
        ...(beat === 'unlock' ? { introLocked: false } : {}),
      }));
      if (beat === 'banner') get().showTurnBanner('PLAYER', get().state?.round ?? 1);
    },
    turnBanner: null,
    showTurnBanner: (faction, round) =>
      set((s) => s.turnBanner?.faction === faction && s.turnBanner.round === round
        ? s
        : { turnBanner: { id: (s.turnBanner?.id ?? 0) + 1, faction, round } }),
    engine: null,
    state: null,
    selectedCardUid: null, pairSelection: null,
    handDiscard: null,
    wallOrientation: 'HORIZONTAL',
    rotateIceWall() { const s=get(); if(!s.engine || inputLocked(s) || s.state?.player.hand.find(c=>c.uid===s.selectedCardUid)?.cardId!=='ice_wall') return; const wallOrientation=s.wallOrientation==='HORIZONTAL'?'VERTICAL':'HORIZONTAL'; s.engine.wallOrientation=wallOrientation; set({wallOrientation,aim:s.aim?{...s.aim}:null}); },
    aim: null,
    notice: null,
    log: [],
    run: runIn({ runs: bootRuns, worldRuns: bootWorldRuns }, bootHero, campaignOfWorld(bootWorldId).id),
    runs: bootRuns,
    worldRuns: bootWorldRuns,
    worldHistory: loadWorldHistory(),
    cloudWorlds: null,
    world2Available: false,
    archerCampaignAvailable: false,
    campaignWorldId: bootWorldId,
    selectWorld(worldId) {
      const { screen, cloud } = get();
      if (screen === 'BATTLE' || cloud.busy) return;
      if (!worldsIn(get(), get().campaignHeroId).some((w) => w.id === worldId && w.unlocked)) return;
      set({ campaignWorldId: worldId, run: shownRun(get().campaignHeroId, worldId) });
    },
    campaignHeroId: bootHero,
    qaSummonerCampaign: false,
    warriorAvailable: false,
    championsAvailable: null,
    guestGate: false,
    closeGuestGate: () => set({ guestGate: false }),
    beginConversion() {
      converting = true;
      set({ guestGate: false });
    },
    accountNotice: null,
    dismissAccountNotice: () => set({ accountNotice: null }),

    async chooseStartingChampion(heroId) {
      const { screen, cloud } = get();
      if (screen === 'BATTLE' || cloud.busy) return false;
      if (cloudActive(get())) {
        const data = await cloudStep('Elegir campeón', (t) => tacticsApi.chooseStartingChampion(t, heroId));
        if (!data) return false;
      } else {
        const result = applyStartingChampion(get().profile, heroId, availableChampionsIn(get()));
        if (!result.ok) return false;
        if (result.profile !== get().profile) commitProfile(result.profile);
      }
      if (!campaignChampionsIn(get()).includes(heroId)) return false;
      writeCampaignHero(heroId);
      set({ campaignHeroId: heroId, campaignWorldId: 'world_1', run: shownRun(heroId, 'world_1') });
      return true;
    },

    async claimChampionUnlock(heroId) {
      const { screen, cloud } = get();
      if (screen === 'BATTLE' || cloud.busy) return false;
      if (cloudActive(get())) return (await cloudStep('Desbloquear campeón', (t) => tacticsApi.unlockChampion(t, heroId))) !== null;
      if (heroId === 'shapeshifter' && !shapeshifterQaEnabled) { set({ notice: 'Inicia sesión para reclamar al Cambiaformas.' }); return false; }
      const result = applyChampionUnlock(get().profile, heroId, availableChampionsIn(get()));
      if (!result.ok) return false;
      if (result.profile !== get().profile) commitProfile(result.profile);
      return true;
    },

    async prepareSummonerQa(encounterId, tier, seed) {
      if (!get().qaSummonerCampaign || get().cloud.busy || !cloudActive(get())) return false;
      const data = await cloudStep('Preparar prueba QA', t => tacticsApi.prepareSummonerQa(t, encounterId, tier, seed));
      if (!data) return false;
      if (session) clearVictory(session.username);
      set({ campaignHeroId: 'summoner', campaignWorldId: 'world_1', run: get().runs.summoner ?? null });
      return true;
    },
    selectCampaignHero(heroId) {
      const { screen, cloud } = get();
      if (screen === 'BATTLE' || cloud.busy || !campaignChampionsIn(get()).includes(heroId)) return;
      writeCampaignHero(heroId);
      set({ campaignHeroId: heroId, run: shownRun(heroId) });
      keepWorldUsable();
    },
    skirmish: null,
    mode: null,
    profile: bootGuestProfile,
    account: bootSession
      ? { status: 'CONNECTING', username: bootSession.username }
      : cloudEnabled()
        ? { status: 'GUEST' }
        : { status: 'DISABLED' },
    cloud: IDLE,

    async signIn(username, password) {
      const result = await authApi.login(username, password);
      if (!result.ok) return accountError(result.error, 'login');
      saveSession(result.data);
      await connect(result.data);
      return null;
    },

    async register(username, password, turnstileToken) {
      const result = await authApi.register(username, password, turnstileToken);
      if (!result.ok) return { error: accountError(result.error, 'register') };
      pendingAccount = { token: result.data.token, username: result.data.username };
      return { recoveryCode: result.data.recoveryCode };
    },

    async recoverAccount(username, recoveryCode, newPassword) {
      const result = await authApi.recover(username, recoveryCode, newPassword);
      if (!result.ok) return { error: accountError(result.error, 'recover') };
      pendingAccount = { token: result.data.token, username: result.data.username };
      return { recoveryCode: result.data.recoveryCode };
    },

    async finishAccountSetup() {
      if (!pendingAccount) return;
      const next = pendingAccount;
      pendingAccount = null;
      saveSession(next);
      await connect(next);
    },

    sessionExpired: expireSession,

    async signOut() {
      const old = session;
      pendingAccount = null;
      get().backToMenu();
      set({ onlineCommand: null, notice: null });
      session = null;
      saveSession(null);
      restoreGuest({ status: 'GUEST' });
      if (old) await authApi.logout(old.token); // best effort: the token is forgotten locally anyway
    },

    async resolveImport(choice) {
      if (get().account.status !== 'NEEDS_IMPORT') return;
      const local = readLocalSaves();
      await cloudStep(choice === 'IMPORT' ? 'Importar progreso' : 'Crear perfil en la nube', (t) =>
        choice === 'IMPORT' ? tacticsApi.importLocal(t, local) : tacticsApi.createProfile(t),
      );
    },

    retryCloud() {
      if (get().cloud.busy) return;
      retryAction?.();
    },

    dismissCloudError() {
      if (get().mode === 'CAMPAIGN' && get().state?.outcome?.result === 'WON' && get().cloud.canRetry) {
        set({ cloud: { busy: null, error: null, canRetry: true } });
        return; // Closing the banner must not discard an unconfirmed victory's recovery action.
      }
      retryAction = null;
      const { account } = get();
      set({
        cloud: IDLE,
        ...(account.status === 'GUEST' && account.message ? { account: { status: 'GUEST' } } : {}),
      });
    },

    deckHeroId: 'mage',
    deckReturn: 'MENU',
    openDeckBuilder(heroId = get().profile.selectedChampionId) {
      const { screen } = get();
      // A locked champion has no deck to build yet (its owned cards are kept, never removed).
      if ((screen === 'MENU' || screen === 'CHAMPIONS') && DEFAULT_CONTENT.heroes[heroId] && championUsableIn(get(), heroId))
        set({ screen: 'DECK', deckHeroId: heroId, deckReturn: screen });
    },

    closeDeckBuilder() {
      if (get().screen === 'DECK') set({ screen: get().deckReturn });
    },

    openChampions() {
      if (get().screen === 'MENU') set({ screen: 'CHAMPIONS' });
    },

    closeChampions() {
      if (get().screen === 'CHAMPIONS') set({ screen: 'MENU' });
    },

    selectChampion(championId) {
      if (!championUsableIn(get(), championId)) return;
      const result = applyChampion(get().profile, championId, DEFAULT_CONTENT);
      if (!result.ok || result.profile.selectedChampionId === get().profile.selectedChampionId)
        return;
      if (cloudActive(get()))
        void cloudStep('Guardar campeón', (t) => tacticsApi.setChampion(t, championId));
      else commitProfile(result.profile);
    },

    async saveDeck(heroId, cards, chosenDeckId) {
      if (!championUsableIn(get(), heroId)) return { ok: false, issues: [], error: 'Todavía no has desbloqueado este campeón.' };
      const issues = localDeckIssues(heroId, cards);
      if (issues.length) return { ok: false, issues };
      const deckId = chosenDeckId ?? activeDeck(heroProfile(get().profile, heroId, DEFAULT_CONTENT)).id;
      if (!cloudActive(get())) {
        const result = updateDeck(get().profile, heroId, deckId, cards, DEFAULT_CONTENT, DECK_RULES, Date.now());
        if (!result.ok) return { ok: false, issues: result.issues ?? [], error: result.error === 'UNKNOWN_DECK' ? 'Ese mazo no existe.' : undefined };
        commitProfile(result.profile);
        return { ok: true };
      }
      const saved = await cloudStep('Guardar mazo', (t) =>
        tacticsApi.saveDeck(t, heroId, deckId, cards),
      );
      return saved
        ? { ok: true }
        : { ok: false, issues: [], error: get().cloud.error ?? 'No se pudo guardar en la nube.' };
    },

    createDeck(heroId, input = {}) {
      // A retried request (cloud retry button) reuses its id: the server makes one deck, never two.
      const requestId = newRequestId();
      return deckAction(
        heroId,
        'Crear mazo',
        () => createDeckOp(get().profile, heroId, input, DEFAULT_CONTENT, DECK_RULES, Date.now()),
        (t) => tacticsApi.createDeck(t, heroId, { ...input, requestId }),
      );
    },
    renameDeck: (heroId, deckId, name) =>
      deckAction(
        heroId,
        'Renombrar mazo',
        () => renameDeckOp(get().profile, heroId, deckId, name, DEFAULT_CONTENT, Date.now()),
        (t) => tacticsApi.renameDeck(t, heroId, deckId, name),
      ),
    duplicateDeck(heroId, deckId) {
      const requestId = newRequestId();
      return deckAction(
        heroId,
        'Duplicar mazo',
        () => duplicateDeckOp(get().profile, heroId, deckId, DEFAULT_CONTENT, Date.now()),
        (t) => tacticsApi.duplicateDeck(t, heroId, deckId, requestId),
      );
    },
    deleteDeck: (heroId, deckId) =>
      deckAction(
        heroId,
        'Eliminar mazo',
        () => deleteDeckOp(get().profile, heroId, deckId, DEFAULT_CONTENT),
        (t) => tacticsApi.deleteDeck(t, heroId, deckId),
      ),
    setDefaultDeck: (heroId, deckId) =>
      deckAction(
        heroId,
        'Mazo predeterminado',
        () => setDefaultDeckOp(get().profile, heroId, deckId, DEFAULT_CONTENT),
        (t) => tacticsApi.setDefaultDeck(t, heroId, deckId),
      ),

    async startScenario(scenarioId, seed, heroId, deckId) {
      const base = SCENARIOS_BY_ID[scenarioId];
      if (!base) throw new Error(`Unknown scenario "${scenarioId}"`);
      const { profile } = get();
      // Only an unlocked, released champion fights (an explicit QA hero too). A selection that is
      // no longer usable (e.g. the QA-only Warrior) falls back to the first usable champion.
      const usable = Object.keys(DEFAULT_CONTENT.heroes).filter((id) => championUsableIn(get(), id));
      const championId = heroId ?? (usable.includes(profile.selectedChampionId) ? profile.selectedChampionId : usable[0]);
      if (!championId || !usable.includes(championId)) {
        set({ notice: 'Todavía no has desbloqueado este campeón.' });
        return false;
      }
      if (deckId !== undefined && !heroProfile(profile, championId, DEFAULT_CONTENT).decks.some((d) => d.id === deckId)) {
        set({ notice: 'Ese mazo no existe.' });
        return false;
      }
      const loadout =
        deckId !== undefined
          ? loadoutFor(profile, championId, DEFAULT_CONTENT, deckId)
          : championId === profile.selectedChampionId
            ? selectedLoadout(profile, DEFAULT_CONTENT)
            : loadoutFor(profile, championId, DEFAULT_CONTENT);
      if (neutralDeckBlocked(loadout.championId, loadout.deckId)) return false;
      const scenario =
        loadout.championId === 'summoner'
          ? skirmishRewardContext(scenarioId, 'summoner').encounters[0]!
          : { ...base, hero: { ...base.hero, heroId: loadout.championId } };
      if (cloudActive(get()) && loadout.championId === 'summoner') {
        if (get().cloud.busy) return false;
        const prepared = await cloudStep(
          'Preparar escaramuza',
          (t) => tacticsApi.startSkirmish(t, scenarioId, loadout.championId, deckId),
          (data) => {
            const battle = data.skirmish;
            if (!battle) return;
            set({ mode: 'SKIRMISH' });
            const context = skirmishRewardContext(battle.run.currentEncounterId, battle.run.heroId);
            begin(
              new GameEngine(
                context.encounters[0]!,
                withHeroDeck(DEFAULT_CONTENT, battle.run.heroId, battle.deck),
                battle.run.seed,
              ),
            );
          },
        );
        return prepared !== null;
      }
      set({ mode: 'SKIRMISH', skirmish: null });
      // An explicit seed (QA / e2e) replays a known battle; otherwise every start reshuffles.
      if (shapeshifterQaEnabled && championId === 'shapeshifter' && qaOpening() === 'guaranteed' &&
        !battleContent(loadout).heroes.shapeshifter!.deck.some(e => e.count > 0 &&
          DEFAULT_CONTENT.cards[e.cardId]?.effects.some(f => f.type === 'TRANSFORM'))) {
        set({notice:'QA: añade una transformación al mazo o usa apertura normal.'});
        return false;
      }
      begin(shapeshifterQaEnabled && championId === 'shapeshifter'
        ? realQaEngine(scenario, battleContent(loadout), seed ?? freshBattleSeed(), qaOpening(), qaDepthRules())
        : new GameEngine(scenario, battleContent(loadout), seed ?? freshBattleSeed()));
      return true;
    },

    async startRun(seed = 1, startAt) {
      const heroId = get().campaignHeroId;
      if (neutralDeckBlocked(heroId)) return false;
      if (!campaignChampionsIn(get()).includes(heroId)) {
        set({ notice: 'Todavía no has desbloqueado este campeón.' });
        return false;
      }
      const campaign = selectedCampaign(get());
      const world = worldOfCampaign(worldContext(), campaign.id);
      if (world && !worldsIn(get(), heroId).some((w) => w.id === world.id && w.unlocked)) {
        set({ notice: 'Completa el mundo anterior con este campeón para entrar aquí.' });
        return false;
      }
      if (cloudActive(get())) {
        // The server picks the run seed (reward offers derive from it) and never skips encounters.
        if (startAt) {
          set({ notice: 'Saltar encuentros solo está disponible como invitado.' });
          return false;
        }
        const data = await cloudStep('Nueva campaña', (t) => tacticsApi.startCampaign(t, heroId, campaign.id));
        const run = data ? runIn(get(), heroId, campaign.id) : null;
        if (!run || run.heroId !== heroId) return false;
        return beginEncounter(run);
      }
      // Replaying a completed world keeps it completed (its run is about to be replaced).
      const previous = runIn(get(), heroId, campaign.id);
      if (previous?.status === 'COMPLETED') recordWorldCompleted(previous);
      const fresh = createRun(campaign, DEFAULT_CONTENT, seed, heroId);
      // A QA jump marks the skipped encounters completed so the run stays a valid save.
      const order = encounterOrder(campaign).map((e) => e.id);
      const at = startAt ? order.indexOf(encounterById(campaign, startAt).id) : 0;
      const run = {
        ...fresh,
        currentEncounterId: order[at]!,
        completedEncounterIds: order.slice(0, at),
      };
      // A QA jump never creates a guest run past the free encounters.
      if (guestLimited(get()) && !guestMayFight(campaign, run.currentEncounterId)) {
        set({ guestGate: true });
        return false;
      }
      commitRun(run);
      return beginEncounter(run);
    },

    continueRun() {
      const { run, screen, state, cloud } = get();
      if (cloud.busy || run?.status !== 'IN_BATTLE') return;
      if (screen === 'BATTLE' && (!state?.outcome || !run.completedEncounterIds.includes(state.scenarioId) || run.currentEncounterId === state.scenarioId)) return;
      if (run.heroId === 'shapeshifter') {
        const saved = loadRealQaBattle();
        if (saved && qaBattleMatches(saved, run) && !saved.state.outcome) {
          set({mode: 'CAMPAIGN'}); begin(saved); return;
        }
      }
      beginEncounter(run);
    },

    chooseReward(optionId) {
      const battle = get().skirmish;
      if (
        battle?.run.status === 'CHOOSING_REWARD' &&
        battle.run.rewardOptions.some((o) => o.id === optionId) &&
        (get().mode === 'SKIRMISH' || get().screen === 'MENU')
      ) {
        if (get().cloud.busy || get().playbackBusy) return;
        void cloudStep(
          'Guardar recompensa',
          (t) => tacticsApi.skirmishReward(t, battle.id, optionId),
          () => get().backToMenu(),
        );
        return;
      }
      const { run } = get();
      if (!run || get().playbackBusy) return;
      // Keep the confirmed result visible; continuing is a separate explicit action.
      if (cloudActive(get())) {
        if (get().cloud.busy) return;
        // The server checks the option was offered and grants the card in the same transaction.
        void cloudStep(
          'Guardar recompensa',
          (t) => tacticsApi.reward(t, optionId, run.currentEncounterId, run.heroId, run.campaignId),
        );
        return;
      }
      // A card joins the collection (the player decides in the Deck Builder whether to equip it).
      const result = claimReward(campaignForRun(run), DEFAULT_CONTENT, get().profile, run, optionId);
      if (!result.ok) return set({ notice: result.error });
      if (run.heroId === 'shapeshifter' && !saveQaCampaignTransition(result.run, result.profile)) {
        set({ notice: 'No se pudo guardar la recompensa QA.' }); return;
      }
      commitRun(result.run);
      commitProfile(result.profile);
    },

    resumeQaBattle() {
      const engine = loadRealQaBattle();
      if (!engine || !shapeshifterQaEnabled) return false;
      const savedRun = qaBattleRun(engine);
      if (savedRun) {
        const currentRun = runIn(get(), savedRun.heroId, savedRun.campaignId);
        if (!currentRun || !qaBattleMatches(engine, currentRun)) return false;
        const worldId = worldOfCampaign(worldContext(), savedRun.campaignId)?.id ?? 'world_1';
        writeCampaignHero(savedRun.heroId);
        set({ mode: 'CAMPAIGN', campaignHeroId: savedRun.heroId, campaignWorldId: worldId, run: currentRun });
      } else set({mode:'SKIRMISH', skirmish:null});
      begin(engine);
      return true;
    },
    restart() {
      if (shapeshifterQaEnabled && get().engine?.scenario.hero.heroId === 'shapeshifter') {
        const old = get().engine!;
        const run = qaBattleRun(old);
        if (run && !qaBattleMatches(old, activeRun(get()) ?? run)) return;
        const next = realQaEngine(old.scenario, old.content, old.seed, qaOpening(), old.content.qaCombatDepth ?? false);
        begin(run ? bindQaCampaign(next, run) : next);
        return;
      }
      const { engine } = get();
      if (!engine) return;
      set({
        selectedCardUid: null, pairSelection: null,
        handDiscard: null,
        aim: null,
        notice: null,
        log: [],
        handPulse: 0,
        introLocked: true,
        introVariant: 'QUICK',
        introReached: [],
        turnBanner: null,
      });
      engine.restart(
        get().mode === 'SKIRMISH' && get().skirmish ? get().skirmish!.run.seed : freshBattleSeed(),
      ); // fresh draw pile + shuffle; listeners receive the new initial events
    },

    backToMenu() {
      unsubscribeEngine?.();
      unsubscribeEngine = null;
      set({
        screen: 'MENU',
        mode: null,
        engine: null,
        state: null,
        selectedCardUid: null, pairSelection: null,
        handDiscard: null,
        aim: null,
        log: [],
        playbackBusy: false,
        handPulse: 0,
        introLocked: false,
        introReached: [],
        turnBanner: null,
      });
    },

    confirmSummonSearch(cardUid, choiceUid) {
      if (run({type:'SEARCH_SUMMON',cardUid,choiceUid})) set(s => ({selectedCardUid:null,pairSelection:null,aim:withoutTapAim(s.aim)}));
    },
    selectCard(cardUid) {
      set({selectedMechanismId:null});
      const { engine, selectedCardUid } = get();
      if (inputLocked(get()) && cardUid !== null) return;
      // Discard picker: a click picks the card to discard (any hand card is eligible).
      if (get().handDiscard) return set({ handDiscard: { uid: cardUid } });
      // Any selection change invalidates a touch preview made for the previous selection.
      const aim = withoutTapAim(get().aim);
      if (!engine || cardUid === null) return set({ selectedCardUid: null, pairSelection: null, aim });
      engine.wallOrientation=get().wallOrientation;
      // Clicking an already-selected SELF card (or ritual) casts it.
      const searchCard = engine.content.cards[engine.state.player.hand.find(c=>c.uid===cardUid)?.cardId ?? ''];
      // Search cards (Rastreo: deck, Eco del Altar: discard) resolve only through their choice dialog.
      if (engine.selectionTargeting(cardUid)?.type === 'SELF' && !searchCard?.deckSearch && !searchCard?.discardSearch && selectedCardUid === cardUid) {
        if (run(engine.selectionCommand(cardUid, null))) set({ selectedCardUid: null, pairSelection: null, aim });
        return;
      }
      const playability = engine.getCardPlayability(cardUid);
      // A ritual piece whose secondary play is not possible can still be selected to seal it.
      const piece = engine.state.player.hand.find((c) => c.uid === cardUid);
      if (!playability.playable && piece && engine.content.cards[piece.cardId]?.ritualPiece && engine.getCommitPlayability(cardUid).playable)
        return set({ notice: 'Ahora solo puedes sellarla en el altar.', selectedCardUid: cardUid, aim });
      // Tap/click on a blocked card explains why in player language (same text as the hand chip).
      const block = explainCardBlock(engine, engine.state, cardUid);
      if (!playability.playable)
        return set({ notice: block?.detail ?? ERROR_LABEL[playability.reason], selectedCardUid: null, pairSelection: null, aim });
      // Playable by the rules but with no legal target right now: still selectable (the preview /
      // mobile zoom reads the card), and the notice says why no tile lights up.
      const selecting = selectedCardUid !== cardUid;
      set({
        selectedCardUid: selecting ? cardUid : null,
        pairSelection: null,
        notice: selecting && block?.code === 'NO_VALID_TARGET' ? block.detail : null,
        aim,
      });
    },

    commitRitualPiece(cardUid) {
      if (run({ type: 'COMMIT_RITUAL_PIECE', cardUid })) set((s) => ({ selectedCardUid: null, pairSelection: null, aim: withoutTapAim(s.aim) }));
    },

    releaseRitualPiece(cardUid) {
      run({ type: 'RELEASE_RITUAL_PIECE', cardUid });
    },

    setHoverTile(pos) {
      const current = get().aim;
      if (!pos) {
        if (current?.source === 'hover') set({ aim: null });
        return;
      }
      if (current?.source === 'hover' && samePos(pos, current.pos)) return;
      set({ aim: { pos, source: 'hover' } });
    },

    clickTile(pos) {
      if(selectObject(pos)) return;
      actOnTile(pos);
    },

    tapTile(candidates) {
      const { engine, selectedCardUid, aim } = get();
      if (!engine || engine.state.phase !== 'PLAYER' || inputLocked(get())) return;
      const objectTile=candidates.find(p=>engine.getMechanismView()?.objects.some(o=>samePos(o.pos,p)));
      if(objectTile && selectObject(objectTile)) return;
      const actionable = (p: Pos) => get().pairSelection && selectedCardUid
        ? pairTargets(engine, selectedCardUid, get().pairSelection).some(t => samePos(t,p))
        : isActionableTile(engine, selectedCardUid, p);
      const pos = resolveTapTarget(candidates, actionable);
      const decision = decideTap(aim, pos);
      if (decision.kind === 'clear') return set({ aim: withoutTapAim(aim), notice: null });
      if (decision.kind === 'confirm' && actionable(decision.pos)) return actOnTile(decision.pos);
      // Preview only. An invalid tile keeps the card selected and says why (no execution).
      const invalid = !actionable(decision.pos);
      set({
        aim: { pos: decision.pos, source: 'tap' },
        notice: invalid && selectedCardUid ? ERROR_LABEL.INVALID_TARGET : null,
      });
    },

    confirmAim() {
      const { engine, selectedCardUid, aim } = get();
      if (!engine || aim?.source !== 'tap') return;
      if (get().pairSelection ? pairTargets(engine, selectedCardUid, get().pairSelection).some(p => samePos(p,aim.pos)) : isActionableTile(engine, selectedCardUid, aim.pos)) actOnTile(aim.pos);
    },

    cancelPairTarget() { set({ pairSelection: null, aim: null, notice: null }); },
    confirmPairWithChampion() {
      const { engine } = get();
      const hero = engine?.state.units.find(u => u.id === engine.heroId);
      if (hero && !inputLocked(get())) actOnTile(hero.pos);
    },
    cancelAim() {
      set({ selectedMechanismId:null, selectedCardUid: null, pairSelection: null, aim: withoutTapAim(get().aim), notice: null });
    },

    endTurn() {
      if (inputLocked(get())) return;
      // Already picking: Finalizar turno / E confirms the picked card (nothing if none yet).
      if (get().handDiscard) return get().confirmHandDiscard();
      const now = performance.now();
      if (now - lastEndTurnAt < END_TURN_GUARD_MS) return;
      lastEndTurnAt = now;
      set((s) => ({ selectedCardUid: null, pairSelection: null, aim: withoutTapAim(s.aim) }));
      // Over the hand size: never close the turn now and never pick for the player.
      const { engine } = get();
      if (engine && discardRequired(engine.state)) return set({ handDiscard: { uid: null }, notice: null });
      run({ type: 'END_TURN' });
    },

    confirmHandDiscard() {
      const pick = get().handDiscard?.uid;
      if (!pick || inputLocked(get())) return;
      if (run({ type: 'END_TURN', discardUid: pick })) set({ handDiscard: null });
    },

    cancelHandDiscard() {
      set({ handDiscard: null });
    },
  };
});
