import { describe, it, expect } from 'vitest';
import { GameEngine, DEFAULT_CONTENT, encounterFor, type GameEvent } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { projectEvent } from '../src/presentation/vfx/visualProjection';
import { TemporaryHint } from '../src/presentation/mechanisms/TemporaryHint';
import {
  guardianOpening,
  GUARDIAN_FLOOR,
  tacticalTileStyle,
  TACTICAL_LAYER_ORDER,
} from '../src/presentation/pixi/tacticalLayers';
import { accessSlide } from '../src/presentation/pixi/SlidingAccess';
import { templeComposition } from '../src/presentation/pixi/TempleComposition';
const state = (id: string) =>
  new GameEngine(encounterFor(TEMPLE_CAMPAIGN, id, 'mage'), DEFAULT_CONTENT).state;
describe('consolidated Act III presentation', () => {
  it('keeps tactical terrain and objective markers above floor and below actors', () => {
    expect(TACTICAL_LAYER_ORDER.indexOf('floor')).toBeLessThan(
      TACTICAL_LAYER_ORDER.indexOf('terrain'),
    );
    expect(TACTICAL_LAYER_ORDER.indexOf('terrain')).toBeLessThan(
      TACTICAL_LAYER_ORDER.indexOf('objectives'),
    );
    expect(TACTICAL_LAYER_ORDER.indexOf('objectives')).toBeLessThan(
      TACTICAL_LAYER_ORDER.indexOf('actors'),
    );
    for (const type of ['FIRE', 'ICE', 'SMOKE'])
      expect(tacticalTileStyle(type)?.alpha).toBeGreaterThan(0.4);
    expect(tacticalTileStyle('VOID')).toBeUndefined();
  });
  for (const reduced of [false, true])
    it(`presents a triggered gate only after arrival (reduced=${reduced})`, () => {
      const s = state('w3_e01'),
        hero = s.units.find((u) => u.faction === 'PLAYER')!;
      const move: GameEvent = {
        type: 'UNIT_MOVED',
        unitId: hero.id,
        from: hero.pos,
        to: { x: 3, y: 2 },
        path: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
        ],
        mode: 'WALK',
        cost: 2,
      };
      const gate: GameEvent = {
        type: 'MECHANISM_CHANGED',
        mechanismId: 'gate',
        kind: 'GATE',
        cue: 'GATE_OPENED',
        state: 'OPEN',
        pos: { x: 5, y: 2 },
      };
      const plan = compileTimeline([move, gate], (id) => id, reduced);
      const motion = plan.cues.find((c) => c.kind === 'move')!;
      expect(plan.cues.find((c) => c.event === gate)!.at).toBeGreaterThanOrEqual(
        motion.at + motion.duration,
      );
      const final = structuredClone(s);
      final.mechanisms!.objects.find((o) => o.def.id === 'gate')!.state = 'OPEN';
      const arrival = projectEvent(s, move, final);
      expect(arrival.mechanisms!.objects.find((o) => o.def.id === 'gate')!.state).toBe('CLOSED');
      expect(
        projectEvent(arrival, gate, final).mechanisms!.objects.find((o) => o.def.id === 'gate')!
          .state,
      ).toBe('OPEN');
      expect(s.mechanisms!.objects.find((o) => o.def.id === 'gate')!.state).toBe('CLOSED');
    });
  it('expires onboarding independently of gameplay and can dismiss immediately', () => {
    const h = new TemporaryHint();
    h.tick(6400);
    expect(h.visible).toBe(true);
    h.tick(100);
    expect(h.visible).toBe(false);
    const other = new TemporaryHint();
    other.dismiss();
    expect(other.visible).toBe(false);
  });
  it('uses one floor anchor and real exposure rounds for progressive closure', () => {
    expect(GUARDIAN_FLOOR).toEqual({ x: 5.5, y: 2.5, radius: 2.05 });
    expect(guardianOpening({ round: 4 }, { state: 'EXPOSED', untilRound: 5 })).toBe(1);
    expect(guardianOpening({ round: 5 }, { state: 'EXPOSED', untilRound: 5 })).toBe(0.5);
    expect(guardianOpening({ round: 6 }, { state: 'FORTIFIED' })).toBe(0);
  });
  it('registers authored opposing gate views; no wall kits around the floating board', () => {
    expect(accessSlide(0)).toBe(0);
    expect(accessSlide(1)).toBe(1);
    for (const id of ['w3_e03', 'w3_e06']) expect(templeComposition(state(id))!.walls).toEqual([]);
  });
});
