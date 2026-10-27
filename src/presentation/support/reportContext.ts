import { Capacitor } from '@capacitor/core';
import type { BugCategory, BugReportContext } from '../../game/support/bugReport';
import { cloudEnabled } from '../cloud/config';
import { activeRun, useBattleStore } from '../store/battleStore';

/** Where the report button was pressed (App's top-level screen). */
export type ReportRoute = 'MENU' | 'BATTLE' | 'DECK' | 'CHAMPIONS' | 'STORE' | 'PVP' | 'SOCIAL';

/** The PvP room the player is in, published by PvpScreen (it keeps its snapshot locally). */
interface PvpReportContext {
  roomCode: string;
  mode: string;
  heroId: string | null;
  inMatch: boolean;
}
let pvp: PvpReportContext | null = null;
export function setPvpReportContext(next: PvpReportContext | null): void {
  pvp = next;
}

/** Opening the report modal from a specific place (e.g. a purchase), with a suggested category. */
export interface BugReportPreset {
  category?: BugCategory;
  /** Our real-money order id (safe to attach; no provider data). */
  orderId?: string;
}
const requests = new Set<(preset: BugReportPreset) => void>();
export function requestBugReport(preset: BugReportPreset): void {
  for (const listener of requests) listener(preset);
}
export function onBugReportRequest(listener: (preset: BugReportPreset) => void): () => void {
  requests.add(listener);
  return () => void requests.delete(listener);
}

/** Build id: set VITE_BUILD_VERSION at build time (e.g. a git sha); else the Vite mode. */
const BUILD_VERSION = ((import.meta.env.VITE_BUILD_VERSION as string | undefined) || `dev-${import.meta.env.MODE}`).slice(0, 64);

/** Public 0/1 build switches (VITE_*_ENABLED etc.): never URLs or keys, only "0"/"1" values. */
function buildFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(import.meta.env))
    if (key.startsWith('VITE_') && (value === '0' || value === '1')) flags[key.slice(5).slice(0, 40)] = value === '1';
  return flags;
}

const clip = (value: string | null | undefined, max = 80) => (value && value.length <= max ? value : undefined);

/**
 * Context attached to a report automatically. Only ids and counters: never the hand, the deck
 * order, the rival's hidden cards, chat, tokens or promo codes. The server re-validates it.
 */
export function collectReportContext(route: ReportRoute): BugReportContext {
  const s = useBattleStore.getState();
  const flags: Record<string, boolean> = {
    ...buildFlags(),
    CLOUD: cloudEnabled(),
    WARRIOR_AVAILABLE: s.warriorAvailable,
    WORLD_2_AVAILABLE: s.world2Available,
    QA_SUMMONER: s.qaSummonerCampaign,
  };
  const ctx: BugReportContext = {
    route,
    buildVersion: BUILD_VERSION,
    platform: Capacitor.getPlatform(),
    host: typeof location !== 'undefined' ? clip(location.host, 253) : undefined,
    viewport: typeof window !== 'undefined' ? `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}` : undefined,
    language: typeof navigator !== 'undefined' ? navigator.language : undefined,
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    clientTime: Date.now(),
    flags,
  };

  if (route === 'PVP' && pvp) {
    ctx.screen = pvp.inMatch ? 'PVP_MATCH' : 'PVP_LOBBY';
    ctx.matchId = clip(pvp.roomCode);
    ctx.pvpMode = pvp.mode;
    ctx.heroId = pvp.heroId ?? undefined;
    if (pvp.inMatch && s.state) {
      ctx.round = s.state.round;
      if (s.state.duel) ctx.turn = s.state.duel.turns;
    }
    return ctx;
  }

  if (route === 'BATTLE' && s.state) {
    const run = activeRun(s);
    ctx.screen = s.mode === 'SKIRMISH' ? 'SKIRMISH_BATTLE' : 'CAMPAIGN_BATTLE';
    ctx.scenarioId = clip(s.state.scenarioId);
    ctx.round = s.state.round;
    ctx.phase = s.state.phase;
    ctx.activeFaction = s.state.activeFaction;
    if (run) {
      const runId = `${run.campaignId}:${run.heroId}:${run.seed}`;
      ctx.heroId = run.heroId;
      ctx.campaignId = run.campaignId;
      ctx.encounterId = run.currentEncounterId;
      ctx.runId = clip(runId);
      ctx.battleId = s.mode === 'SKIRMISH' && s.skirmish ? `skirmish:${s.skirmish.id}` : clip(`${runId}:${run.currentEncounterId}`);
      ctx.deckId = clip(s.profile.heroes[run.heroId]?.activeDeckId);
    }
    if (s.mode === 'CAMPAIGN') ctx.worldId = clip(s.campaignWorldId);
    return ctx;
  }

  ctx.screen = route === 'MENU' ? 'HOME' : route;
  const heroId = route === 'DECK' ? s.deckHeroId : route === 'MENU' ? s.campaignHeroId : s.profile.selectedChampionId;
  ctx.heroId = clip(heroId);
  ctx.deckId = clip(s.profile.heroes[heroId]?.activeDeckId);
  if (route === 'MENU') ctx.worldId = clip(s.campaignWorldId);
  return ctx;
}
