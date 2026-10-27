import type { DeckRules } from '../collection/deck-rules';
import { loadoutDeck, loadoutFor } from '../collection/loadout';
import { withHeroDeck, type PlayerProfile } from '../collection/profile';
import type { Pos } from '../domain/core/position';
import type { GameContent } from '../domain/content';
import type { Command } from '../engine/commands';
import { replayBattle } from '../engine/replay';
import type { CampaignDef } from './encounter';
import { currentEncounter, runContent, type RunState } from './run';

/**
 * Proof that a campaign battle was won: the engine is deterministic from (encounter, content,
 * seed, commands), so whoever holds the authoritative profile + run can replay the battle and
 * check the outcome instead of trusting a "I won" claim. Same idea a PvP server will use.
 */
export interface VictoryProof {
  encounterId: string;
  seed: number;
  commands: Command[];
}

/** Hard cap on a replay (a real battle is far below this). */
export const MAX_PROOF_COMMANDS = 3000;

/**
 * The exact content a campaign battle runs with: the run hero's validated active deck (starter
 * fallback) and the run's max HP bonus. Client and server both build battles through here.
 */
export function campaignBattleContent(content: GameContent, profile: PlayerProfile, run: RunState, rules: DeckRules): GameContent {
  const loadout = loadoutFor(profile, run.heroId, content);
  const deck = loadoutDeck(profile, loadout, content, rules);
  return runContent(withHeroDeck(content, run.heroId, deck.cards), run);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isPos = (v: unknown): v is Pos => isRecord(v) && isInt(v.x) && isInt(v.y);

/** Untrusted JSON → a well-formed command (nothing else reaches the engine). */
export function parseCommand(raw: unknown): Command | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'SEARCH_SUMMON' && typeof raw.cardUid === 'string' && typeof raw.choiceUid === 'string' && raw.cardUid.length > 0 && raw.cardUid.length < 100 && raw.choiceUid.length > 0 && raw.choiceUid.length < 100)
    return {type:'SEARCH_SUMMON',cardUid:raw.cardUid,choiceUid:raw.choiceUid};
  if (raw.type === 'END_TURN')
    return typeof raw.discardUid === 'string' ? { type: 'END_TURN', discardUid: raw.discardUid } : { type: 'END_TURN' };
  if (raw.type === 'MOVE_UNIT' && typeof raw.unitId === 'string' && isPos(raw.to))
    return { type: 'MOVE_UNIT', unitId: raw.unitId, to: { x: raw.to.x, y: raw.to.y } };
  if (raw.type === 'PLAY_CARD' && typeof raw.cardUid === 'string' && (raw.target === null || isPos(raw.target)))
    return { type: 'PLAY_CARD', cardUid: raw.cardUid, target: raw.target === null ? null : { x: raw.target.x, y: raw.target.y } };
  if ((raw.type === 'COMMIT_RITUAL_PIECE' || raw.type === 'RELEASE_RITUAL_PIECE') && typeof raw.cardUid === 'string')
    return { type: raw.type, cardUid: raw.cardUid };
  if (raw.type === 'INTERACT' && typeof raw.mechanismId === 'string' && raw.mechanismId.length > 0 && raw.mechanismId.length < 100)
    return { type: 'INTERACT', mechanismId: raw.mechanismId };
  if (raw.type === 'ACTIVATE_RITUAL' && typeof raw.ritualId === 'string' && (raw.target === null || isPos(raw.target)))
    return { type: 'ACTIVATE_RITUAL', ritualId: raw.ritualId, target: raw.target === null ? null : { x: raw.target.x, y: raw.target.y } };
  return null;
}

export type ProofResult = { ok: true } | { ok: false; error: string };

/**
 * Replays `proof` against the authoritative profile + run. Valid only if it is the run's
 * current encounter, every command is accepted by the rules, and the battle ends WON.
 */
export function verifyVictory(
  campaign: CampaignDef,
  content: GameContent,
  profile: PlayerProfile,
  run: RunState,
  proof: unknown,
  rules: DeckRules,
): ProofResult {
  if (run.status !== 'IN_BATTLE') return { ok: false, error: `run is ${run.status}` };
  if (!isRecord(proof) || typeof proof.encounterId !== 'string' || !isInt(proof.seed) || !Array.isArray(proof.commands))
    return { ok: false, error: 'malformed proof' };
  if (proof.encounterId !== run.currentEncounterId) return { ok: false, error: 'not the current encounter' };
  if (proof.commands.length > MAX_PROOF_COMMANDS) return { ok: false, error: 'proof too long' };

  const commands: Command[] = [];
  for (const raw of proof.commands) {
    const command = parseCommand(raw);
    if (!command) return { ok: false, error: 'malformed command' };
    commands.push(command);
  }
  const replay = replayBattle(currentEncounter(campaign, run), campaignBattleContent(content, profile, run, rules), proof.seed >>> 0, commands);
  if (replay.rejectedAt !== null) return { ok: false, error: 'a command was rejected by the rules' };
  return replay.state.outcome?.result === 'WON' ? { ok: true } : { ok: false, error: 'the battle was not won' };
}
