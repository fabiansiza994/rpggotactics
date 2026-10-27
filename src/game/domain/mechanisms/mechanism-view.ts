import type { Pos } from '../core/position';
import type { GameState } from '../state';
import type { MechanismActionType, MechanismKind, MechanismStateValue, Orientation } from './mechanism';
import { INTERACTABLE_KINDS } from './mechanism';
import { footprint, mechanismIsSolid } from './mechanism-board';
import { cycleKey, mechanismLinks, onSchedule } from './mechanism-rules';
import { allowedOrientations, orientationOf } from './mechanism-transform';

/**
 * VISUAL TELEGRAPH CONTRACT (Act III). Everything the presentation needs to answer, per object:
 * is it interactable, is it active, did it change, what controls what. Derived from state only,
 * never stored. Codex owns how each value looks (qa/act3-interactive/CODEX_HANDOFF.md).
 */
export type MechanismVisualState =
  /** Plate not pressed, switch OFF, gate CLOSED, bridge RAISED, relic on its pedestal, trap DISABLED. */
  | 'inactive'
  /** Plate pressed, switch ON, gate OPEN, bridge LOWERED, relic taken, trap ENABLED (armed). */
  | 'active'
  /** Frozen by a DISABLE rule (sealed plate, jammed lever). */
  | 'locked'
  /** A close/raise/reset waits for its tile to be free (show "held open"). */
  | 'pending';

export interface MechanismVisual {
  id: string;
  kind: MechanismKind;
  pos: Pos;
  state: MechanismStateValue;
  visualState: MechanismVisualState;
  /** Blocks movement right now (closed gate, raised bridge, statue, pedestals). */
  solid: boolean;
  /** The champion can INTERACT with it (from an adjacent tile). */
  interactable: boolean;
  /** Something else drives it (it is an action target of some rule). */
  targeted: boolean;
  /** Ids linked to it by rules, both directions (draw rune lines between them). */
  connected: string[];
  label?: string;
  /** PLATFORM: tiles it covers now, current stop and every stop's footprint (draw rails/grooves). */
  tiles?: Pos[];
  stop?: string;
  stops?: { name: string; tiles: Pos[] }[];
  /** RELIC (carry): who carries it (draw it on that unit) and where it can be secured. */
  carrier?: string;
  extraction?: Pos[];
  /** REGION: the rotating section (draw its rim, seams and pivot; animate SECTION_ROTATED). */
  region?: { cells: Pos[]; pivot: Pos; orientation: Orientation; allowed: Orientation[] };
}

/** A mechanism that drives a unit's plating (FORTIFY / EXPOSE rules): draw source → guardian. */
export interface UnitLink {
  from: string;
  unitId: string;
  ruleId: string;
  live: boolean;
}

/** Guardian plating as the presentation should show it. */
export interface GuardianVisual {
  unitId: string;
  state: 'FORTIFIED' | 'EXPOSED';
  /** Last exposed round (EXPOSED only). */
  untilRound?: number;
}

export interface MechanismLink {
  from: string;
  to: string;
  ruleId: string;
  /** The source is active now (energy flowing along the link). */
  live: boolean;
}

/**
 * A board change the clock (a boss) will make: TELEGRAPH it. `round` is the round at whose END it
 * happens; `round === state.round` means "after the enemy turn of this round".
 */
export interface ScheduledBoardChange {
  ruleId: string;
  round: number;
  label?: string;
  /** The unit driving it (`whileAlive`): the change stops when it falls. */
  actorId?: string;
  actions: { type: MechanismActionType; targets: string[]; turns?: number }[];
}

/** A CYCLE ring (relocating control): which control is live and how many windows have closed. */
export interface ControlRing {
  ids: string[];
  live: string;
  /** Closed exposure windows of the ring's units (XXV: the Guardian's exposure cycle). */
  cycle: number;
}

export interface MechanismView {
  objects: MechanismVisual[];
  links: MechanismLink[];
  unitLinks: UnitLink[];
  guardians: GuardianVisual[];
  scheduled: ScheduledBoardChange[];
  rings: ControlRing[];
}

export function mechanismView(state: Readonly<GameState>): MechanismView | null {
  const b = state.mechanisms;
  if (!b || state.duel) return null;
  const raw = mechanismLinks(b);
  const active = new Map(b.objects.map((o) => [o.def.id, o.active]));
  const links: MechanismLink[] = raw.map((l) => ({ ...l, live: !!active.get(l.from) }));
  const objects = b.objects.map((o): MechanismVisual => ({
    id: o.def.id,
    kind: o.def.kind,
    pos: { ...o.pos },
    state: o.state,
    visualState: o.locked ? 'locked' : o.pending ? 'pending' : o.active ? 'active' : 'inactive',
    solid: mechanismIsSolid(o),
    interactable: INTERACTABLE_KINDS.includes(o.def.kind) && !o.locked && !(o.def.kind === 'RELIC' && (o.state === 'COLLECTED' || o.state === 'EXTRACTED')),
    targeted: raw.some((l) => l.to === o.def.id),
    connected: [...new Set(raw.flatMap((l) => (l.from === o.def.id ? [l.to] : l.to === o.def.id ? [l.from] : [])))],
    ...(o.def.label ? { label: o.def.label } : {}),
    ...(o.def.kind === 'PLATFORM'
      ? {
          tiles: footprint(o),
          ...(o.stop ? { stop: o.stop } : {}),
          stops: Object.entries(o.def.stops ?? {}).map(([name, anchor]) => ({
            name,
            tiles: (o.def.shape ?? [{ x: 0, y: 0 }]).map((d) => ({ x: anchor.x + d.x, y: anchor.y + d.y })),
          })),
        }
      : {}),
    ...(o.carrier ? { carrier: o.carrier } : {}),
    ...(o.def.carry ? { extraction: o.def.carry.extraction.map((t) => ({ ...t })) } : {}),
    ...(o.def.region
      ? {
          region: {
            cells: o.def.region.cells.map((c) => ({ ...c })),
            pivot: { ...o.def.region.pivot },
            orientation: orientationOf(o.state),
            allowed: [...allowedOrientations(o.def.region)],
          },
        }
      : {}),
  }));
  const unitLinks: UnitLink[] = [];
  for (const rule of b.rules)
    for (const action of rule.actions)
      if (action.type === 'EXPOSE' || action.type === 'FORTIFY')
        for (const from of [...(rule.trigger.sources ?? []), ...(rule.condition?.all ?? [])])
          for (const unitId of action.unitIds ?? [])
            if (!unitLinks.some((l) => l.from === from && l.unitId === unitId)) unitLinks.push({ from, unitId, ruleId: rule.id, live: !!active.get(from) });
  const guardians: GuardianVisual[] = (b.armored ?? [])
    .filter((id) => state.units.some((u) => u.id === id))
    .map((unitId) => {
      const until = b.exposed?.[unitId];
      return until !== undefined && until >= state.round ? { unitId, state: 'EXPOSED', untilRound: until } : { unitId, state: 'FORTIFIED' };
    });
  const scheduled: ScheduledBoardChange[] = [];
  for (const rule of b.rules) {
    if (rule.trigger.type !== 'ON_ROUND_END' || (rule.trigger.every === undefined && !rule.whileAlive)) continue;
    if ((rule.once && b.fired.includes(rule.id)) || rule.whileAlive?.some((id) => !state.units.some((u) => u.id === id))) continue;
    let round = state.round;
    while (!onSchedule(rule, round) && round < state.round + 64) round++;
    scheduled.push({
      ruleId: rule.id,
      round,
      ...(rule.label ? { label: rule.label } : {}),
      ...(rule.whileAlive?.[0] ? { actorId: rule.whileAlive[0] } : {}),
      actions: rule.actions.map((a) => ({ type: a.type, targets: [...(a.targets ?? [])], ...(a.turns !== undefined ? { turns: a.turns } : {}) })),
    });
  }
  scheduled.sort((x, y) => x.round - y.round);
  const rings: ControlRing[] = [];
  for (const rule of b.rules)
    for (const action of rule.actions) {
      if (action.type !== 'CYCLE' || !action.targets?.length || rings.some((r) => cycleKey(r.ids) === cycleKey(action.targets!))) continue;
      const ids = [...action.targets];
      const units = b.rules.flatMap((r) => r.actions.flatMap((a) => (a.type === 'EXPOSE' ? [...(a.unitIds ?? [])] : [])));
      rings.push({ ids, live: ids[(b.cycles?.[cycleKey(ids)] ?? 0) % ids.length]!, cycle: Math.max(0, ...units.map((u) => b.exposureCycles?.[u] ?? 0)) });
    }
  return { objects, links, unitLinks, guardians, scheduled, rings };
}
