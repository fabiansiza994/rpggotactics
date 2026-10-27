import type { Graphics } from 'pixi.js';
import type { CardDefinition, GameEngine, GameState, Pos, Unit } from '../../../game';
import { archerCardForecast } from '../../../game/domain/archer-view';
import type { GridProjection, Point } from '../../pixi/GridProjection';

/**
 * Archer board reading (presentation only). Every hint comes from the real rules: optimal tiles
 * from the champion's `optimalRange`, focus tiles from a dry run (`archerCardForecast`) of the
 * selected card on each legal target. Nothing here decides an outcome.
 */
export const HUNTER = { violet: 0xc8a6ff, deep: 0x7c58c9, gold: 0xe2c27a, moss: 0x6f9a52, bark: 0x6b4a2b, thorn: 0x9fbf6a } as const;

export interface ArcherBoardHints {
  /** Distancia Óptima tiles for the selected card (around the Archer for shots, legal ends near the Presa for moves). */
  optimalTiles: Pos[];
  /** Legal targets that would GAIN Concentración (dry run). */
  focusTiles: Pos[];
  /** The aimed target is a unit at Distancia Óptima for a card that rewards it. */
  optimalTarget: Pos | null;
  /** Flecha de Rebote aimed at a legal target: the exact path A → B → C from the rules (dry run). */
  reboundPath: Pos[];
}

const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const isArcherPrey = (unit: Pick<Unit, 'hp' | 'statuses'>): boolean =>
  unit.hp > 0 && unit.statuses.some((s) => s.id === 'PREY');
const preyOf = (state: Readonly<GameState>, archerId: string) =>
  state.units.find((u) => u.statuses.some((s) => s.id === 'PREY' && s.sourceId === archerId));

/** Which Distancia Óptima the card cares about (null: none). */
export function optimalMode(def: CardDefinition | undefined): 'shot' | 'prey' | null {
  if (!def) return null;
  const conds = def.effects.flatMap((fx) => [
    ...(fx.type === 'DAMAGE' ? [...[fx.bonus?.when ?? []].flat(), ...(fx.focusGain?.when ?? [])] : []),
    ...(fx.type === 'GAIN_FOCUS' ? fx.when ?? [] : []),
  ]);
  if (conds.some((c) => c.type === 'TARGET_IN_OPTIMAL_RANGE')) return 'shot';
  if (conds.some((c) => c.type === 'PREY_IN_OPTIMAL_RANGE')) return 'prey';
  return null;
}
const gainsFocus = (def: CardDefinition) =>
  def.effects.some((fx) => fx.type === 'GAIN_FOCUS' || (fx.type === 'DAMAGE' && !!fx.focusGain));

export function archerBoardHints(
  engine: GameEngine,
  state: Readonly<GameState>,
  selectedCardUid: string | null,
  targetTiles: readonly Pos[],
  hoverTile: Pos | null,
): ArcherBoardHints | undefined {
  const hero = state.units.find((u) => u.id === engine.heroId);
  if (!hero?.focus || !selectedCardUid) return undefined;
  const def = engine.content.cards[state.player.hand.find((c) => c.uid === selectedCardUid)?.cardId ?? ''];
  if (!def) return undefined;
  const range = engine.content.heroes[hero.defId]?.focus?.optimalRange;
  const mode = optimalMode(def);
  const inRange = (d: number) => !!range && d >= range.min && d <= range.max;
  const prey = preyOf(state, hero.id);
  let optimalTiles: Pos[] = [];
  if (mode === 'shot' && range) {
    for (let y = 0; y < state.board.height; y++)
      for (let x = 0; x < state.board.width; x++) if (inRange(manhattan(hero.pos, { x, y }))) optimalTiles.push({ x, y });
  } else if (mode === 'prey' && prey) optimalTiles = targetTiles.filter((p) => inRange(manhattan(p, prey.pos)));
  // Dry runs are cheap (≤ a dozen legal tiles) and say exactly where focus would be gained.
  const focusTiles = gainsFocus(def) && def.targeting.type === 'STEP'
    ? targetTiles.filter((p) => (archerCardForecast(state, engine.content, selectedCardUid, p)?.focus.gain ?? 0) > 0)
    : [];
  const aimedUnit = hoverTile && state.units.find((u) => u.pos.x === hoverTile.x && u.pos.y === hoverTile.y);
  const optimalTarget = mode === 'shot' && aimedUnit && aimedUnit.id !== hero.id && inRange(manhattan(hero.pos, aimedUnit.pos))
    && targetTiles.some((p) => p.x === hoverTile!.x && p.y === hoverTile!.y) ? hoverTile : null;
  const aimedLegal = !!hoverTile && targetTiles.some((p) => p.x === hoverTile.x && p.y === hoverTile.y);
  const rebound = aimedLegal && def.effects.some((fx) => fx.type === 'DAMAGE' && !!fx.rebound)
    ? archerCardForecast(state, engine.content, selectedCardUid, hoverTile)
    : null;
  const reboundPath = rebound?.targetId && hoverTile ? [hoverTile, ...rebound.rebound.map((r) => r.pos)] : [];
  return { optimalTiles, focusTiles, optimalTarget, reboundPath };
}

const flat = (points: readonly Point[]) => points.flatMap((p) => [p.x, p.y]);
function ring(g: Graphics, proj: GridProjection, u: number, v: number, r: number, n = 24): Graphics {
  const pts: Point[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(proj.project(u + Math.cos(a) * r, v + Math.sin(a) * r));
  }
  return g.poly(flat(pts));
}
function seg(g: Graphics, proj: GridProjection, a: [number, number], b: [number, number]): Graphics {
  const p = proj.project(a[0], a[1]), q = proj.project(b[0], b[1]);
  return g.moveTo(p.x, p.y).lineTo(q.x, q.y);
}

/** Hunter reticle on the ground: broken ring + four notches. */
function reticle(g: Graphics, proj: GridProjection, cell: Pos, r: number, color: number, alpha: number, width = 1.6): void {
  const u = cell.x + 0.5, v = cell.y + 0.5;
  for (let k = 0; k < 4; k++) {
    const a0 = k * (Math.PI / 2) + 0.22, a1 = a0 + Math.PI / 2 - 0.44;
    const pts: Point[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push(proj.project(u + Math.cos(a) * r, v + Math.sin(a) * r));
    }
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  }
  g.stroke({ color, alpha, width });
  for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
    seg(g, proj, [u + du * (r + 0.06), v + dv * (r + 0.06)], [u + du * (r - 0.07), v + dv * (r - 0.07)]);
  g.stroke({ color: HUNTER.gold, alpha, width: width + 0.4 });
}

/** Bramble trap: a dark thorn ring with roots — reads as "this tile is trapped" at a glance. */
function bramble(g: Graphics, proj: GridProjection, cell: Pos): void {
  const u = cell.x + 0.5, v = cell.y + 0.52;
  ring(g, proj, u, v, 0.3).fill({ color: 0x1b2a14, alpha: 0.55 }).stroke({ color: HUNTER.bark, width: 2.4, alpha: 0.95 });
  ring(g, proj, u, v, 0.22).stroke({ color: HUNTER.moss, width: 1.4, alpha: 0.85 });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r0 = 0.27, r1 = k % 2 ? 0.37 : 0.34;
    seg(g, proj, [u + Math.cos(a) * r0, v + Math.sin(a) * r0], [u + Math.cos(a + 0.18) * r1, v + Math.sin(a + 0.18) * r1]);
  }
  g.stroke({ color: HUNTER.thorn, width: 1.6, alpha: 0.9 });
  for (const [a, b] of [[0.7, 2.4], [2.9, 4.6], [5.0, 0.4]] as const)
    seg(g, proj, [u + Math.cos(a) * 0.2, v + Math.sin(a) * 0.2], [u + Math.cos(b) * 0.08, v + Math.sin(b) * 0.08]);
  g.stroke({ color: HUNTER.bark, width: 2, alpha: 0.9 });
  ring(g, proj, u, v, 0.035, 8).fill({ color: HUNTER.violet, alpha: 0.9 });
}

interface OverlayInput {
  state: Readonly<GameState>;
  interactive: boolean;
  archer?: ArcherBoardHints;
}

/** Ground layer (under actors): traps, the Presa reticle, then the selected card's hints. */
export function drawArcherOverlay(g: Graphics, proj: GridProjection, vm: OverlayInput): void {
  for (const trap of vm.state.traps ?? []) bramble(g, proj, trap.pos);
  for (const u of vm.state.units) if (isArcherPrey(u)) reticle(g, proj, u.pos, 0.4, HUNTER.violet, 0.85);
  const hints = vm.interactive ? vm.archer : undefined;
  if (!hints) return;
  for (const p of hints.optimalTiles) {
    g.poly(flat(proj.getInsetPolygon(p, 0.16))).stroke({ color: HUNTER.violet, alpha: 0.42, width: 1.1 });
    ring(g, proj, p.x + 0.5, p.y + 0.5, 0.03, 8).fill({ color: HUNTER.gold, alpha: 0.75 });
  }
  for (const p of hints.focusTiles) {
    const u = p.x + 0.5, v = p.y + 0.5;
    const a = proj.project(u, v - 0.13), b = proj.project(u + 0.09, v + 0.06), c = proj.project(u, v), d = proj.project(u - 0.09, v + 0.06);
    g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill({ color: HUNTER.violet, alpha: 0.85 }).stroke({ color: HUNTER.gold, width: 1, alpha: 0.8 });
  }
  if (hints.optimalTarget) reticle(g, proj, hints.optimalTarget, 0.3, HUNTER.gold, 1, 2.2);
  // Rebound preview (placeholder look until Codex's VFX): a gold line through every hit, a reticle on each bounce.
  const path = hints.reboundPath;
  for (let i = 1; i < path.length; i++) {
    seg(g, proj, [path[i - 1]!.x + 0.5, path[i - 1]!.y + 0.5], [path[i]!.x + 0.5, path[i]!.y + 0.5]).stroke({ color: HUNTER.gold, alpha: 0.9, width: 2.4 });
    reticle(g, proj, path[i]!, 0.26, HUNTER.gold, 0.95, 1.8);
  }
}
