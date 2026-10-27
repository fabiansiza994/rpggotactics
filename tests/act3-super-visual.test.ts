import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { TEMPLE_ENV_ASSETS, TEMPLE_PLACES } from '../src/presentation/pixi/Act3Environment';
import { VISUAL_CHECKPOINTS, visualCheckpoint } from '../src/presentation/qa/act3/checkpoints';
import { GameEngine, DEFAULT_CONTENT, encounterFor } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import {
  puzzlePresentation,
  PUZZLE_AUDIO_CUES,
} from '../src/presentation/mechanisms/puzzlePresentation';
describe('Act III environment-first visual contracts', () => {
  it('ships a bounded modular kit and only the authored places (XXI–XXX)', () => {
    // XXVIII reuses an existing material: no new environment art for the rotating board.
    expect(Object.keys(TEMPLE_PLACES)).toHaveLength(10);
    let bytes = 0;
    for (const id of TEMPLE_ENV_ASSETS) {
      const path = `public/art/temple/environment/${id}.webp`;
      expect(existsSync(path)).toBe(true);
      bytes += statSync(path).size;
    }
    expect(bytes).toBeLessThan(2_000_000);
    expect(new Set(Object.values(TEMPLE_PLACES).map((p) => p.material)).size).toBe(3);
  });
  it('derives a legend from the actual encounter mechanisms', () => {
    for (let i = 1; i <= 6; i++) {
      const engine = new GameEngine(
        encounterFor(TEMPLE_CAMPAIGN, `w3_e0${i}`, 'mage'),
        DEFAULT_CONTENT,
      );
      const ui = puzzlePresentation(engine.state)!;
      expect(ui.mechanismLegend.length).toBeGreaterThan(0);
      for (const item of ui.mechanismLegend) {
        expect(item.name).toBeTruthy();
        expect(item.hint).toBeTruthy();
      }
    }
    expect(PUZZLE_AUDIO_CUES).toHaveLength(12);
  });
  for (const c of VISUAL_CHECKPOINTS)
    it(`reaches ${c.label} through real replay commands`, () => {
      const save = visualCheckpoint(c.id);
      expect(save, c.id).not.toBeNull();
      const e = new GameEngine(
        encounterFor(TEMPLE_CAMPAIGN, save!.encounter, 'mage'),
        DEFAULT_CONTENT,
        save!.seed,
      );
      for (const command of save!.commands) expect(e.dispatch(command).ok).toBe(true);
      expect(e.history).toEqual(save!.commands);
    });
});
