import { Container, Graphics } from 'pixi.js';
import { SECTION_SPIN_MS } from '../motion/sectionTiming';
export { SECTION_SPIN_MS } from '../motion/sectionTiming';
import type { GameEvent, GameState, Pos } from '../../game';
import { mechanismById } from '../../game/domain/mechanisms/mechanism-board';
import { rotateCell, rotationPreview } from '../../game/domain/mechanisms/mechanism-transform';
import type { GridProjection, Point } from './GridProjection';
import type { BoardViewModel } from './viewModel';

/**
 * Act III phase 3: rotating board sections (REGION mechanisms). Presentation only — the grid in
 * GameState is the truth and already holds the turned layout when SECTION_ROTATED arrives.
 *
 * - The section is always drawn by this layer as one mechanical plate (dark stone slabs, brass rim
 *   with gear teeth, teal rune line, pivot medallion with an orientation notch), so the animated
 *   plate and the resting plate look identical.
 * - Selecting a control linked to a section previews the turn: the section glows, an arrow shows
 *   the direction and amber outlines show where its walls will land.
 * - SECTION_ROTATED animates lift → rotate → lock (~0.9 s): the plate turns about its pivot in
 *   grid space (each frame re-projected, so the perspective stays correct) and every rider —
 *   units and low blocks — travels along its arc. Reduced motion: no travel, a short lock flash.
 */

const LIFT_MS = 160;
const TURN_MS = 560;
const LOCK_MS = 180;

const LIFT_PX = 9;

const BRASS = 0xc2a15e;
const RUNE = 0x6fd8cf;
const SLAB = [0x2b3537, 0x303b3d, 0x283133] as const;

type Rider = { kind: 'unit' | 'obstacle' | 'mechanism'; id: string; from: Pos };
type Spin = {
  id: string;
  cells: Pos[];
  pivot: Pos;
  turns: number;
  elapsed: number;
  riders: Rider[];
  walkable: boolean[];
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

/** Continuous rotation of a grid point about `pivot` by `deg` clockwise (x right, y down). */
function turn(p: { x: number; y: number }, pivot: Pos, deg: number) {
  const a = (deg * Math.PI) / 180,
    dx = p.x - pivot.x,
    dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

function bounds(cells: readonly Pos[]) {
  const xs = cells.map((c) => c.x),
    ys = cells.map((c) => c.y);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs) + 1,
    y1: Math.max(...ys) + 1,
  };
}

export class RotatingSections {
  /** Floor layer: above the board surface, below tactical marks, ranges and actors. */
  readonly floor = new Container({ eventMode: 'none' });
  private readonly plate = new Graphics();
  private readonly chrome = new Graphics();
  private vm: BoardViewModel | null = null;
  private proj: GridProjection | null = null;
  private spins: Spin[] = [];
  private flash = new Map<string, { ms: number; color: number }>();
  private owned = new Set<string>();
  private clock = 0;

  constructor(
    private readonly unitRoot: (id: string) => Container | undefined,
    private readonly obstacleRoot: (id: string) => Container | undefined,
    private readonly onLock: (points: Point[], reduced: boolean) => void = () => {},
    private readonly mechanismRoot: (id: string) => Container | undefined = () => undefined,
  ) {
    this.floor.addChild(this.plate, this.chrome);
  }

  get busy(): boolean {
    return this.spins.length > 0;
  }

  ownsPosition(id: string): boolean {
    return this.owned.has(id);
  }

  update(vm: BoardViewModel, proj: GridProjection): void {
    this.vm = vm;
    this.proj = proj;
    if (!this.spins.length) this.draw();
  }

  playEvents(events: readonly GameEvent[], state: Readonly<GameState>, reduced: boolean): void {
    for (const event of events) {
      if (event.type !== 'MECHANISM_CHANGED' || event.kind !== 'REGION' || !event.rotation)
        continue;
      if (event.cue === 'SECTION_ROTATION_BLOCKED') {
        this.flash.set(event.mechanismId, { ms: 450, color: 0xf08855 });
        continue;
      }
      if (event.cue !== 'SECTION_ROTATED') continue;
      const { cells, pivot, turns } = event.rotation;
      const q = ((turns % 4) + 4) % 4;
      // The tile now at rotate(c) is the one that stood on c before the turn.
      const walkable = cells.map((c) => {
        const now = rotateCell(c, pivot, q);
        const t = state.board.tiles[now.y * state.board.width + now.x]?.terrain;
        return t !== 'BLOCKED' && t !== 'VOID';
      });
      const riders: Rider[] = [];
      for (const id of event.carriedIds ?? []) {
        const unit = state.units.find((u) => u.id === id);
        if (unit) {
          const tp = events.find((e) => e.type === 'UNIT_TELEPORTED' && e.unitId === id);
          riders.push({
            kind: 'unit',
            id,
            from: tp?.type === 'UNIT_TELEPORTED' ? tp.from : rotateCell(unit.pos, pivot, -q),
          });
          continue;
        }
        const ob = state.obstacles.find((o) => o.id === id);
        if (ob) riders.push({ kind: 'obstacle', id, from: rotateCell(ob.pos, pivot, -q) });
        const mechanism = state.mechanisms?.objects.find(o => o.def.id === id);
        if (mechanism) riders.push({kind: 'mechanism', id, from: rotateCell(mechanism.pos, pivot, -q)});
      }
      if (reduced) {
        this.flash.set(event.mechanismId, { ms: 260, color: RUNE });
        this.onLock([], true);
        continue;
      }
      const spin: Spin = {
        id: event.mechanismId,
        cells,
        pivot,
        turns,
        elapsed: 0,
        riders,
        walkable,
      };
      this.spins = this.spins.filter((s) => s.id !== spin.id);
      this.spins.push(spin);
      for (const r of riders) if (r.kind === 'unit') this.owned.add(r.id);
    }
    // Establish the pre-turn pose before the next browser paint.
    if (this.spins.length) this.tick(0, reduced);
  }

  tick(ms: number, reduced: boolean): void {
    this.clock += ms;
    for (const [id, f] of this.flash) {
      f.ms -= ms;
      if (f.ms <= 0) this.flash.delete(id);
    }
    if (!this.spins.length) {
      if (this.vm && this.proj) this.draw();
      return;
    }
    const proj = this.proj;
    for (const spin of [...this.spins]) {
      spin.elapsed = Math.min(SECTION_SPIN_MS, spin.elapsed + (reduced ? SECTION_SPIN_MS : ms));
      const { deg, lift } = this.pose(spin);
      if (proj)
        for (const r of spin.riders) {
          const root = r.kind === 'unit' ? this.unitRoot(r.id) : r.kind === 'obstacle' ? this.obstacleRoot(r.id) : this.mechanismRoot(r.id);
          if (!root) continue;
          const c = turn({ x: r.from.x + 0.5, y: r.from.y + 0.5 }, spin.pivot, deg);
          const p = proj.project(c.x, c.y);
          root.position.set(p.x, p.y - lift);
          if (r.kind === 'obstacle') root.scale.set(proj.scaleAtY(p.y));
          root.zIndex = proj.depthAtPoint(p);
        }
      if (spin.elapsed >= SECTION_SPIN_MS) this.finish(spin);
    }
    if (this.vm && this.proj) this.draw();
  }

  clear(): void {
    this.spins = [];
    this.owned.clear();
    this.flash.clear();
    if (this.vm && this.proj) this.draw();
  }

  destroy(): void {
    this.clear();
    this.vm = null;
    this.proj = null;
    this.floor.destroy({ children: true });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Angle (degrees, clockwise) and lift (px) of a spin at its current time. */
  private pose(spin: Spin) {
    const t = spin.elapsed;
    const total = spin.turns * 90;
    if (t < LIFT_MS) return { deg: 0, lift: LIFT_PX * easeInOut(t / LIFT_MS) };
    if (t < LIFT_MS + TURN_MS)
      return { deg: total * easeInOut((t - LIFT_MS) / TURN_MS), lift: LIFT_PX };
    const k = (t - LIFT_MS - TURN_MS) / LOCK_MS;
    // Drops into its seat with a small bounce.
    return { deg: total, lift: LIFT_PX * (1 - k) - Math.sin(k * Math.PI) * 2.5 };
  }

  private finish(spin: Spin): void {
    this.spins = this.spins.filter((s) => s !== spin);
    const proj = this.proj,
      state = this.vm?.state;
    if (proj && state)
      for (const r of spin.riders) {
        const root = r.kind === 'unit' ? this.unitRoot(r.id) : r.kind === 'obstacle' ? this.obstacleRoot(r.id) : this.mechanismRoot(r.id);
        const now =
          r.kind === 'unit'
            ? state.units.find((u) => u.id === r.id)?.pos
            : r.kind === 'obstacle' ? state.obstacles.find((o) => o.id === r.id)?.pos
              : state.mechanisms?.objects.find(o => o.def.id === r.id)?.pos;
        if (!root || !now) continue;
        const p = proj.getUnitAnchor(now);
        root.position.set(p.x, p.y);
        if (r.kind === 'obstacle') root.scale.set(proj.scaleAtY(p.y));
        root.zIndex = proj.depthAtPoint(p);
      }
    for (const r of spin.riders)
      if (r.kind === 'unit' && !this.spins.some((s) => s.riders.some((o) => o.id === r.id)))
        this.owned.delete(r.id);
    this.flash.set(spin.id, { ms: 380, color: RUNE });
    if (proj) {
      const b = bounds(spin.cells);
      const rim = [
        [b.x0, b.y0],
        [b.x1, b.y0],
        [b.x1, b.y1],
        [b.x0, b.y1],
        [(b.x0 + b.x1) / 2, b.y0],
        [b.x1, (b.y0 + b.y1) / 2],
        [(b.x0 + b.x1) / 2, b.y1],
        [b.x0, (b.y0 + b.y1) / 2],
      ].map(([u, v]) => proj.project(u!, v!));
      this.onLock(rim, false);
    }
  }

  private draw(): void {
    const vm = this.vm,
      proj = this.proj;
    const plate = this.plate.clear(),
      chrome = this.chrome.clear();
    if (!vm || !proj || !vm.mechanisms) return;
    const regions = vm.mechanisms.objects.filter((o) => o.region);
    if (!regions.length) return;
    const pts = (list: readonly Point[]) => list.flatMap((p) => [p.x, p.y]);
    for (const o of regions) {
      const r = o.region!;
      const spin = this.spins.find((s) => s.id === o.id);
      const { deg, lift } = spin ? this.pose(spin) : { deg: 0, lift: 0 };
      const P = (u: number, v: number) => {
        const t = turn({ x: u, y: v }, r.pivot, deg);
        const p = proj.project(t.x, t.y);
        return { x: p.x, y: p.y - lift };
      };
      const b = bounds(r.cells);
      // Seat: the abyss under the section (also hides the board surface while the plate turns).
      plate
        .poly(
          pts([
            proj.project(b.x0, b.y0),
            proj.project(b.x1, b.y0),
            proj.project(b.x1, b.y1),
            proj.project(b.x0, b.y1),
          ]),
        )
        .fill({ color: 0x04090d, alpha: 1 });
      if (spin)
        plate
          .poly(
            pts([
              proj.project(b.x0, b.y0),
              proj.project(b.x1, b.y0),
              proj.project(b.x1, b.y1),
              proj.project(b.x0, b.y1),
            ]),
          )
          .stroke({ color: RUNE, width: 2, alpha: 0.35 });
      // Slabs. At rest they follow the live grid; while turning, the pre-turn layout (spin.walkable).
      r.cells.forEach((c, i) => {
        const floor = spin
          ? spin.walkable[i]
          : !['BLOCKED', 'VOID'].includes(
              vm.state.board.tiles[c.y * vm.state.board.width + c.x]?.terrain ?? 'BLOCKED',
            );
        if (!floor) return;
        const inset = 0.035;
        const quad = [
          P(c.x + inset, c.y + inset),
          P(c.x + 1 - inset, c.y + inset),
          P(c.x + 1 - inset, c.y + 1 - inset),
          P(c.x + inset, c.y + 1 - inset),
        ];
        // While lifted, a dark lip under each slab gives the plate thickness.
        if (lift > 0.5)
          plate
            .poly(pts(quad.map((p) => ({ x: p.x, y: p.y + lift + 2 }))))
            .fill({ color: 0x010304, alpha: 0.55 });
        plate
          .poly(pts(quad))
          .fill({ color: SLAB[hash(c.x, c.y) % SLAB.length]!, alpha: 1 })
          .stroke({ color: 0x8a7445, width: 1.4, alpha: 0.55 });
        // Engraved rune dot, brighter while the section is moving.
        const m = P(c.x + 0.5, c.y + 0.5);
        if (hash(c.x, c.y) % 3 === 0)
          plate.circle(m.x, m.y, 2.2).fill({ color: RUNE, alpha: spin ? 0.7 : 0.22 });
      });
      // Brass rim with gear teeth (they slide along the rim as the plate turns).
      const corners = [P(b.x0, b.y0), P(b.x1, b.y0), P(b.x1, b.y1), P(b.x0, b.y1)];
      chrome.poly(pts(corners)).stroke({ color: BRASS, width: 3, alpha: 0.9 });
      const inner = [
        P(b.x0 + 0.08, b.y0 + 0.08),
        P(b.x1 - 0.08, b.y0 + 0.08),
        P(b.x1 - 0.08, b.y1 - 0.08),
        P(b.x0 + 0.08, b.y1 - 0.08),
      ];
      const flash = this.flash.get(o.id);
      chrome
        .poly(pts(inner))
        .stroke({
          color: flash?.color ?? RUNE,
          width: flash ? 3 : 1.5,
          alpha: flash ? 0.95 : spin ? 0.8 : 0.4,
        });
      const n = Math.round((b.x1 - b.x0) * 2);
      for (let side = 0; side < 4; side++)
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          const [ax, ay, bx, by] = (
            [
              [b.x0, b.y0, b.x1, b.y0],
              [b.x1, b.y0, b.x1, b.y1],
              [b.x1, b.y1, b.x0, b.y1],
              [b.x0, b.y1, b.x0, b.y0],
            ] as const
          )[side as 0 | 1 | 2 | 3];
          const u = ax + (bx - ax) * f,
            v = ay + (by - ay) * f;
          const out = { x: (u - r.pivot.x) * 0.035, y: (v - r.pivot.y) * 0.035 };
          const a = P(u, v),
            c = P(u + out.x, v + out.y);
          chrome.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: BRASS, width: 2, alpha: 0.6 });
        }
      // Pivot medallion: ring, cardinal ticks, and a notch pointing at the section's "north".
      const ring = Array.from({ length: 36 }, (_, k) =>
        P(
          r.pivot.x + Math.cos((k * Math.PI) / 18) * 0.62,
          r.pivot.y + Math.sin((k * Math.PI) / 18) * 0.62,
        ),
      );
      chrome.poly(pts(ring)).stroke({ color: BRASS, width: 2, alpha: 0.75 });
      const north = spin ? orientationBefore(spin, r.orientation) + deg : r.orientation;
      const tip = turn({ x: r.pivot.x, y: r.pivot.y - 0.86 }, r.pivot, north);
      const left = turn({ x: r.pivot.x - 0.16, y: r.pivot.y - 0.6 }, r.pivot, north);
      const right = turn({ x: r.pivot.x + 0.16, y: r.pivot.y - 0.6 }, r.pivot, north);
      const pr = (t: { x: number; y: number }) => {
        const p = proj.project(t.x, t.y);
        return { x: p.x, y: p.y - lift };
      };
      chrome.poly(pts([pr(tip), pr(left), pr(right)])).fill({ color: 0xf2c76c, alpha: 0.95 });
    }
    this.drawPreview(chrome, proj, vm);
  }

  /**
   * Telegraph of a selected control: direction arrow + where the section's walls will land. With no
   * control selected, a turn the board itself has scheduled for the end of THIS round (XXX: the
   * Architect) is previewed the same way, so it is never a surprise.
   */
  private drawPreview(g: Graphics, proj: GridProjection, vm: BoardViewModel): void {
    const control = vm.selectedMechanismId;
    const state = vm.state;
    if (!state.mechanisms || this.spins.length) return;
    const turnsOf = (action: { type: string; turns?: number }) =>
      action.type === 'ROTATE' ? (action.turns ?? 1) : 1;
    const plans: { id: string; turns: number }[] = [];
    if (control) {
      for (const rule of state.mechanisms.rules)
        if (rule.trigger.type === 'ON_INTERACT' && rule.trigger.sources?.includes(control))
          for (const action of rule.actions)
            if (action.type === 'ROTATE' || action.type === 'ADVANCE')
              for (const id of action.targets ?? []) plans.push({ id, turns: turnsOf(action) });
    } else
      for (const change of vm.mechanisms?.scheduled ?? [])
        if (change.round === state.round)
          for (const action of change.actions)
            if (action.type === 'ROTATE')
              for (const id of action.targets) plans.push({ id, turns: turnsOf(action) });
    for (const { id, turns } of plans) {
      const region = mechanismById(state, id);
      if (!region?.def.region) continue;
      const preview = rotationPreview(state as GameState, region, turns);
      const r = region.def.region;
      const b = bounds(r.cells);
      const pts = (list: readonly Point[]) => list.flatMap((p) => [p.x, p.y]);
      g.poly(
        pts([
          proj.project(b.x0, b.y0),
          proj.project(b.x1, b.y0),
          proj.project(b.x1, b.y1),
          proj.project(b.x0, b.y1),
        ]),
      ).fill({ color: RUNE, alpha: 0.07 });
      for (const w of preview.walls)
        g.poly(pts(proj.getInsetPolygon(w, 0.14))).stroke({
          color: 0xf2c76c,
          width: 2.5,
          alpha: 0.9,
        });
      // Walkways after the turn (solid slabs = now, teal outline = after).
      for (const tile of preview.floor)
        g.poly(pts(proj.getInsetPolygon(tile, 0.12))).stroke({
          color: RUNE,
          width: 2,
          alpha: 0.75,
        });
      for (const u of preview.units) {
        const c = proj.getTileCenter(u.to);
        g.circle(c.x, c.y, 5).stroke({ color: 0xe9f6f3, width: 2, alpha: 0.75 });
      }
      // Direction arc around the pivot with an arrowhead.
      const radius = Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2 - 0.35;
      const sweep = Math.sign(turns) * Math.min(Math.abs(turns), 2) * 70;
      const start = -90 - sweep / 2;
      const arc = Array.from({ length: 25 }, (_, k) => {
        const a = ((start + (sweep * k) / 24) * Math.PI) / 180;
        return proj.project(r.pivot.x + Math.cos(a) * radius, r.pivot.y + Math.sin(a) * radius);
      });
      g.poly(pts(arc), false).stroke({ color: 0xf2c76c, width: 3, alpha: 0.85 });
      const endA = ((start + sweep) * Math.PI) / 180;
      const tangent = Math.sign(turns);
      const tipG = {
        x: r.pivot.x + Math.cos(endA) * radius,
        y: r.pivot.y + Math.sin(endA) * radius,
      };
      const back = { x: -Math.sin(endA) * tangent * 0.28, y: Math.cos(endA) * tangent * 0.28 };
      const radial = { x: Math.cos(endA) * 0.16, y: Math.sin(endA) * 0.16 };
      const head = [
        proj.project(tipG.x + back.x * 0.4, tipG.y + back.y * 0.4),
        proj.project(tipG.x - back.x + radial.x, tipG.y - back.y + radial.y),
        proj.project(tipG.x - back.x - radial.x, tipG.y - back.y - radial.y),
      ];
      g.poly(pts(head)).fill({ color: 0xf2c76c, alpha: 0.95 });
    }
  }
}

/** Orientation (degrees) the section had when `spin` started, given its orientation now. */
function orientationBefore(spin: Spin, now: number): number {
  return now - spin.turns * 90;
}

/** Low mechanical block (temple_block): dark stone, brass band, teal rune slit. Height ≈ 0.4 tile. */
export function drawTempleBlock(tile: number): Container {
  const out = new Container();
  const g = new Graphics();
  const w = tile * 0.36,
    h = tile * 0.3,
    d = tile * 0.12;
  g.ellipse(0, 2, w * 1.2, d * 1.1).fill({ color: 0x000000, alpha: 0.45 });
  g.poly([-w, 0, w, 0, w, -h, -w, -h]).fill(0x313b3e).stroke({ color: 0x0b1215, width: 1.5 });
  g.poly([-w, -h, w, -h, w - 4, -h - d, -w + 4, -h - d])
    .fill(0x56625f)
    .stroke({ color: 0x0b1215, width: 1.2 });
  g.rect(-w, -h * 0.55, w * 2, h * 0.16).fill({ color: BRASS, alpha: 0.75 });
  g.rect(-w * 0.35, -h * 0.82, w * 0.7, 2.5).fill({ color: RUNE, alpha: 0.85 });
  out.addChild(g);
  return out;
}
