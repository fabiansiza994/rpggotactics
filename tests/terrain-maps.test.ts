import { describe, it, expect } from 'vitest';
import { endTurn } from './helpers';
import { DEFAULT_CONTENT, createProfile, type GameState } from '../src/game';
import { createDuel, applyDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { PVP_MAPS, pvpMap, mapScenario } from '../src/game/pvp/maps';
import { canEnter } from '../src/game/domain/board/occupancy';
import { tileAt } from '../src/game/domain/board/board';
import { computeReachable } from '../src/game/domain/board/pathfinding';
import { getValidTargets, traceLine } from '../src/game/domain/cards/targeting';
import { dealDamage } from '../src/game/domain/combat/damage';
import { pushUnit, teleportUnit } from '../src/game/domain/combat/movement';
import { endFactionTurn, restoreTurnEnergy } from '../src/game/domain/turn/turn-flow';
import {
  createTerrain,
  removeHazard,
  tickBoardDurations,
} from '../src/game/domain/terrain/terrain-rules';
import { spawnSummon, retreatSummon } from '../src/game/domain/summons/summons';
import { validateScenario } from '../src/game/domain/scenario-validation';
const profile = createProfile(DEFAULT_CONTENT);
const loads = [validateLoadout(profile, 'mage'), validateLoadout(profile, 'summoner')] as const;
const battle = (map = 'shattered_sanctum') => createDuel([...loads], 7, 'DOMINION', map);
const ctx = (state: GameState) => ({ state, content: DEFAULT_CONTENT, emit: () => {} });
const hero = (s: GameState) => s.units.find((u) => u.id === s.player.heroId)!;
function ground(
  s: GameState,
  x: number,
  y: number,
  terrain: 'VOID' | 'HAZARD' | 'COVER' | 'ARCANE',
) {
  const t = tileAt(s.board, { x, y })!;
  t.terrain = t.baseTerrain = terrain;
}

describe('shared terrain and PvP maps', () => {
  it('valid symmetric definitions have reachable normal nodes and spawn separation', () => {
    for (const map of PVP_MAPS)
      for (const mode of map.allowedModes) {
        const s = createDuel([...loads], 7, mode, map.id);
        expect(validateScenario(mapScenario(map, mode), DEFAULT_CONTENT)).toEqual([]);
        const all = computeReachable(ctx(s), s.units[0]!);
        if (mode === 'DOMINION')
          for (const node of s.dominion!.nodes) {
            expect(all.has(`${node.pos.x},${node.pos.y}`)).toBe(true);
            expect(tileAt(s.board, node.pos)!.terrain).toBe('NORMAL');
          }
        if (map.id !== 'classic')
          for (let y = 0; y < s.board.height; y++)
            for (let x = 0; x < s.board.width; x++)
              expect(tileAt(s.board, { x, y })!.terrain).toBe(
                tileAt(s.board, { x, y: s.board.height - 1 - y })!.terrain,
              );
      }
    expect(() => pvpMap('forged')).toThrow('INVALID_MAP');
  });
  it('VOID prevents entry, teleport, spawning and temporary terrain creation', () => {
    const s = battle(),
      c = ctx(s),
      h = hero(s),
      p = { x: 0, y: 0 };
    expect(canEnter(c, p, h.id)).toBe(false);
    expect(teleportUnit(c, h, p, h.id)).toBe(false);
    const summoner = s.units.find((u) => u.defId === 'summoner')!;
    expect(spawnSummon(c, summoner, 'chicken', p)).toBeNull();
    expect(createTerrain(c, p, 'FIRE', 2, h.id)).toBe(false);
    expect(computeReachable(c, h).has('0,0')).toBe(false);
  });
  it('routes around holes and respects walls and isolated destinations', () => {
    const s = battle('broken_bridge'),
      h = hero(s),
      c = ctx(s);
    h.pos = { x: 2, y: 2 };
    const n = computeReachable(c, h).get('2,4')!;
    expect(n.path.length).toBeGreaterThan(2);
    expect(n.path.every((p) => tileAt(s.board, p)!.terrain !== 'VOID')).toBe(true);
    for (let x = 0; x < s.board.width; x++) ground(s, x, 3, 'VOID');
    expect(computeReachable(c, h).has('2,4')).toBe(false);
    s.obstacles.push({ id: 'wall', defId: 'ice_wall', pos: { x: 1, y: 2 }, turnsLeft: 2 });
    expect(canEnter(c, { x: 1, y: 2 })).toBe(false);
  });
  it('all targeting types exclude VOID selections; projectiles cross gaps without new LOS blockers', () => {
    const s = battle('broken_bridge'),
      h = hero(s),
      c = ctx(s);
    h.pos = { x: 2, y: 2 };
    for (const def of Object.values(DEFAULT_CONTENT.cards))
      for (const p of getValidTargets(c, h, def.targeting))
        expect(tileAt(s.board, p)!.terrain).not.toBe('VOID');
    const trace = traceLine(c, h.pos, 'DOWN', 4, true);
    expect(trace.tiles).toContainEqual({ x: 2, y: 3 });
    expect(trace.tiles).toContainEqual({ x: 2, y: 4 });
  });
  it('push stops before VOID with existing collision damage; hazard and cover are legal landing tiles', () => {
    const s = battle('broken_bridge'),
      c = ctx(s),
      h = hero(s);
    h.pos = { x: 2, y: 2 };
    h.armor = 0;
    h.shield = 0;
    pushUnit(c, h, 'DOWN', 2, 1, 'test');
    expect(h.pos).toEqual({ x: 2, y: 2 });
    expect(h.hp).toBe(h.maxHp - 1);
    h.pos = { x: 4, y: 2 };
    ground(s, 4, 3, 'HAZARD');
    pushUnit(c, h, 'DOWN', 1, 1, 'test');
    expect(h.pos).toEqual({ x: 4, y: 3 });
    expect(h.hp).toBe(h.maxHp - 1);
    ground(s, 4, 4, 'COVER');
    pushUnit(c, h, 'DOWN', 1, 1, 'test');
    expect(h.pos).toEqual({ x: 4, y: 4 });
  });
  it('Cover reduces qualifying ranged damage before armor/shield, with existing zero minimum', () => {
    const s = battle(),
      h = hero(s),
      c = ctx(s);
    ground(s, h.pos.x, h.pos.y, 'COVER');
    h.armor = 0;
    h.shield = 0;
    expect(dealDamage(c, h, 3, 'projectile', 'ARCANE', 'RANGED').hpLost).toBe(2);
    expect(dealDamage(c, h, 1, 'projectile', 'ARCANE', 'RANGED').hpLost).toBe(0);
    expect(dealDamage(c, h, 3, 'melee', 'PHYSICAL').hpLost).toBe(3);
    expect(dealDamage(c, h, 1, 'self', 'ARCANE').hpLost).toBe(1);
  });
  it('Tortuga armor and Cover combine only for ranged attacks', () => {
    const s = battle(),
      c = ctx(s),
      owner = s.units.find((u) => u.defId === 'summoner')!;
    const t = spawnSummon(c, owner, 'turtle', { x: 2, y: 2 })!;
    expect(t).toBeTruthy();
    ground(s, 2, 2, 'COVER');
    expect(dealDamage(c, t, 3, 'projectile', 'ARCANE', 'RANGED').hpLost).toBe(1);
    expect(dealDamage(c, t, 3, 'melee', 'PHYSICAL').hpLost).toBe(2);
  });
  it('static hazard is not cleansed/overwritten and deals one damage per owner end turn to champion and summon', () => {
    const s = battle(),
      c = ctx(s),
      h = hero(s);
    h.armor = 0;
    h.shield = 0;
    ground(s, h.pos.x, h.pos.y, 'HAZARD');
    const owner = s.units.find((u) => u.defId === 'summoner')!;
    const chicken = spawnSummon(c, owner, 'chicken', { x: 2, y: 2 })!;
    ground(s, 2, 2, 'HAZARD');
    expect(removeHazard(c, { x: 2, y: 2 })).toBe(false);
    expect(createTerrain(c, { x: 2, y: 2 }, 'FIRE', 2, h.id)).toBe(false);
    const before = chicken.hp;
    endFactionTurn(c, h.faction);
    expect(h.hp).toBe(h.maxHp - 1);
    expect(chicken.hp).toBe(before - (chicken.faction === h.faction ? 1 : 0));
    const copy = structuredClone(s);
    expect(duelView(s, s.duel!.active).board).toEqual(s.board);
    expect(s).toEqual(copy);
  });
  it('Arcane restores max+1 per turn without accumulating or changing max; summons gain no energy', () => {
    const s = battle(),
      c = ctx(s),
      h = hero(s),
      max = s.player.maxEnergy;
    ground(s, h.pos.x, h.pos.y, 'ARCANE');
    restoreTurnEnergy(c);
    expect(s.player.energy).toBe(max + 1);
    restoreTurnEnergy(c);
    expect(s.player.energy).toBe(max + 1);
    expect(s.player.maxEnergy).toBe(max);
    h.pos = { x: 4, y: 2 };
    restoreTurnEnergy(c);
    expect(s.player.energy).toBe(max);
  });
  it('Pollo retreat prefers legal safe paths and never walks through VOID or hazard', () => {
    const s = battle('broken_bridge'),
      c = ctx(s),
      owner = s.units.find((u) => u.defId === 'summoner')!;
    owner.pos = { x: 4, y: 4 };
    const enemy = s.units.find((u) => u !== owner)!;
    enemy.pos = { x: 4, y: 1 };
    const pollo = spawnSummon(c, owner, 'chicken', { x: 4, y: 2 })!;
    ground(s, 5, 2, 'HAZARD');
    retreatSummon(c, pollo, 2);
    expect(tileAt(s.board, pollo.pos)!.terrain).not.toBe('HAZARD');
    expect(tileAt(s.board, pollo.pos)!.terrain).not.toBe('VOID');
  });
  it('temporary terrain and existing PvE fire rules remain unchanged', () => {
    const s = battle(),
      c = ctx(s),
      h = hero(s);
    h.armor = 0;
    h.shield = 0;
    expect(createTerrain(c, h.pos, 'FIRE', 1, h.id)).toBe(true);
    endFactionTurn(c, h.faction);
    expect(h.hp).toBe(h.maxHp - 2);
    tickBoardDurations(c);
    expect(tileAt(s.board, h.pos)!.terrain).toBe('NORMAL');
  });
  it('real commands replay identically on both new maps with hazards and arcane energy', () => {
    for (const map of ['broken_bridge', 'shattered_sanctum']) {
      const initial = battle(map);
      let a = structuredClone(initial),
        b = structuredClone(initial);
      for (let i = 0; i < 8; i++) {
        a = applyDuel(a, endTurn(a)).state;
        b = applyDuel(b, endTurn(b)).state;
        expect(a).toEqual(b);
      }
    }
  });
  it('static ground hazard affects armored Tortuga too, while shields can absorb it', () => {
    const s = battle(),
      c = ctx(s),
      owner = s.units.find((u) => u.defId === 'summoner')!;
    const t = spawnSummon(c, owner, 'turtle', { x: 2, y: 2 })!;
    ground(s, 2, 2, 'HAZARD');
    endFactionTurn(c, t.faction);
    expect(t.hp).toBe(t.maxHp - 1);
    t.shield = 1;
    endFactionTurn(c, t.faction);
    expect(t.hp).toBe(t.maxHp - 1);
    expect(t.shield).toBe(0);
  });
  it('actual card effect taxonomy protects from direct/projectile hits but not AoE or collision', () => {
    const cards = Object.values(DEFAULT_CONTENT.cards);
    const direct = cards.filter(
      (d) =>
        d.targeting.type === 'LINE' || (d.targeting.type === 'UNIT' && d.category === 'ATTACK'),
    );
    expect(
      direct.filter((d) => d.effects.some((f) => f.type === 'DAMAGE' && f.attackKind === 'RANGED'))
        .length,
    ).toBeGreaterThanOrEqual(3);
    for (const d of cards.filter((d) => ['SELF', 'CROSS', 'AREA'].includes(d.targeting.type)))
      for (const f of d.effects) if (f.type === 'DAMAGE') expect(f.attackKind).toBeUndefined();
  });
  it('turn initialization applies Arcane only to the incoming champion and Hazard once to the outgoing side', () => {
    let s = battle();
    const h = hero(s),
      other = s.units.find((u) => u.id !== h.id)!;
    h.armor = 0;
    h.shield = 0;
    ground(s, h.pos.x, h.pos.y, 'HAZARD');
    ground(s, other.pos.x, other.pos.y, 'ARCANE');
    s = applyDuel(s, endTurn(s)).state;
    expect(s.units.find((u) => u.id === h.id)!.hp).toBe(h.maxHp - 1);
    expect(s.player.energy).toBe(s.player.maxEnergy + 1);
    const snapshot = duelView(s, s.duel!.active);
    expect(snapshot.units.find((u) => u.id === h.id)!.hp).toBe(h.maxHp - 1);
    s = applyDuel(s, endTurn(s)).state;
    expect(s.units.find((u) => u.id === h.id)!.hp).toBe(h.maxHp - 1);
    expect(s.player.maxEnergy).toBe(h.defId === 'mage' ? 5 : 5);
  });
});
