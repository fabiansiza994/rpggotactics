import type { GameContent } from '../domain/content';
import type { RuleContext } from '../domain/context';
import type { ScenarioDef } from '../domain/scenario';
import type { GameState } from '../domain/state';
import { executeCommand, type Command } from './commands';
import { createBattle } from './setup';

/**
 * Headless replay for verification (server). Same rules and order as GameEngine.dispatch, but
 * one mutable state instead of a structuredClone per command (2–3× cheaper). Equivalent for
 * every accepted command; it stops at the first rejected one (whose partial effects are then
 * irrelevant: the replay is invalid). Never use this for the interactive engine.
 */
export function replayBattle(
  scenario: ScenarioDef,
  content: GameContent,
  seed: number,
  commands: readonly Command[],
): { state: GameState; rejectedAt: number | null } {
  const { state } = createBattle(scenario, content, seed);
  const ctx: RuleContext = { state, content, emit: () => {} };
  for (let i = 0; i < commands.length; i++) {
    let ok: boolean;
    try {
      ok = executeCommand(ctx, commands[i]!).ok;
    } catch {
      ok = false;
    }
    if (!ok) return { state, rejectedAt: i };
  }
  return { state, rejectedAt: null };
}
