import { CHARACTER_PAINTINGS } from '../src/presentation/assets/paintedAssets';
import { characterSpec } from '../src/presentation/pixi/renderContract';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { existsSync, statSync } from 'node:fs';
import { TEMPLE_REWARD_CARDS } from '../src/game/data/temple-rewards';
import { TEMPLE_REWARD_ART } from '../src/presentation/assets/templeRewards';
import { describe, it, expect } from 'vitest';
import { GameEngine, DEFAULT_CONTENT, encounterFor } from '../src/game';
import { TEMPLE_CAMPAIGN, TEMPLE_ENCOUNTERS } from '../src/game/data/temple-encounters';
import { mechanismView } from '../src/game/domain/mechanisms/mechanism-view';
import { guardianWindow, mechanismCallout } from '../src/presentation/mechanisms/finalReadability';
import { templeComposition } from '../src/presentation/pixi/TempleComposition';
import { TEMPLE_PLACES } from '../src/presentation/pixi/Act3Environment';
import {
  presentPublicAction,
  usePublicCast,
  ENEMY_ACTION_LABELS,
} from '../src/presentation/cards/publicCast';
describe('Act III final visual contracts', () => {
  it('gives the elite and boss their own artwork and normalized ground anchors',()=>{
    for(const id of ['heart_warden','temple_architect']) {
      expect(CHARACTER_PAINTINGS[id]).toBe(`/art/temple/characters/${id}.webp`);
      expect(existsSync(`public${CHARACTER_PAINTINGS[id]}`)).toBe(true);
      expect(characterSpec(id).anchorY).toBe(720/768);
    }
  });
  it('closes the public action preview before the next enemy starts',()=>{
    const timeline=compileTimeline([
      {type:'ENEMY_ACTION_STARTED',enemyId:'a',intent:{kind:'MELEE_ATTACK',enemyId:'a',targetUnitId:'mage',damage:2}},
      {type:'ENEMY_ACTION_ENDED',enemyId:'a'},
      {type:'ENEMY_ACTION_STARTED',enemyId:'b',intent:{kind:'IDLE',enemyId:'b',reason:'NO_TARGET'}},
    ],id=>id,false);
    const ended=timeline.cues.find(c=>c.event.type==='ENEMY_ACTION_ENDED')!;
    const next=timeline.cues.find(c=>c.event.type==='ENEMY_ACTION_STARTED' && c.event.enemyId==='b')!;
    expect(ended).toBeDefined(); expect(ended.at).toBeLessThanOrEqual(next.at);
  });
  it('assigns distinct optimized illustrations to the eight authored rewards', () => {
    expect(TEMPLE_REWARD_CARDS).toHaveLength(8);
    for (const card of TEMPLE_REWARD_CARDS) {
      const path = TEMPLE_REWARD_ART[card.id]!;
      expect(path).toBe(`/art/temple/cards/${card.id}.webp`);
      expect(existsSync(`public${path}`)).toBe(true);
      expect(statSync(`public${path}`).size).toBeLessThan(180000);
    }
    expect(new Set(Object.values(TEMPLE_REWARD_ART)).size).toBe(8);
  });
  it('covers all ten authored layouts without decorating playable cells or mutating state', () => {
    expect(TEMPLE_ENCOUNTERS).toHaveLength(10);
    for (const encounter of TEMPLE_ENCOUNTERS) {
      const state = new GameEngine(
        encounterFor(TEMPLE_CAMPAIGN, encounter.id, 'mage'),
        DEFAULT_CONTENT,
      ).state;
      const before = JSON.stringify(state),
        c = templeComposition(state)!;
      expect(c).not.toBeNull();
      expect(TEMPLE_PLACES[encounter.id]).toBeDefined();
      expect(c.walls).toHaveLength(0);
      expect(c.dressing).toHaveLength(2);
      expect(c.dressing.every((d) => d.asset === 'brazier' && d.at.y < 0)).toBe(true);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
  it('shows exact remaining rounds and closing warning from the displayed snapshot', () => {
    const s = new GameEngine(encounterFor(TEMPLE_CAMPAIGN, 'w3_e05', 'mage'), DEFAULT_CONTENT)
      .state;
    const view = mechanismView(s)!;
    expect(guardianWindow(s, view)?.exposed).toBe(false);
    const g = view.guardians[0]!;
    const exposed = {
      ...view,
      guardians: [{ ...g, state: 'EXPOSED' as const, untilRound: s.round }],
    };
    expect(guardianWindow(s, exposed)).toMatchObject({
      exposed: true,
      remaining: 1,
      closing: true,
    });
    expect(
      guardianWindow(s, {
        ...exposed,
        guardians: [{ ...g, state: 'EXPOSED', untilRound: s.round + 2 }],
      }),
    ).toMatchObject({ remaining: 3, closing: false });
  });
  it('uses actual linked sections for the rotation callout', () => {
    const s = new GameEngine(encounterFor(TEMPLE_CAMPAIGN, 'w3_e08', 'mage'), DEFAULT_CONTENT)
      .state;
    const view = mechanismView(s)!;
    const control = view.objects.find(
      (o) =>
        o.kind === 'SWITCH' &&
        view.links.some(
          (l) => l.from === o.id && view.objects.some((t) => t.id === l.to && t.kind === 'REGION'),
        ),
    )!;
    expect(mechanismCallout(control, view)).toContain('giro');
  });
  it('presents public enemy actions without inventing cards or exposing a hand', () => {
    presentPublicAction({
      enemyId: 'foe',
      intent: { kind: 'MELEE_ATTACK', enemyId: 'foe', targetUnitId: 'mage', damage: 2 },
    });
    expect(usePublicCast.getState().action?.enemyId).toBe('foe');
    expect(ENEMY_ACTION_LABELS.MELEE_ATTACK).toContain('cuerpo');
    expect(Object.keys(usePublicCast.getState().action!)).toEqual(['enemyId', 'intent']);
    presentPublicAction(null);
    expect(usePublicCast.getState().action).toBeNull();
  });
});
