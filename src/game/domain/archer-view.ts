import { hasLineOfSight } from './board/line-of-sight';
import { getHero, unitAt, unitById } from './board/occupancy';
import type { CardDefinition, EffectCondition, EffectDef } from './cards/card';
import { conditionsHold } from './cards/effects';
import { checkPlayability, playCard } from './cards/play-card';
import { resolveTarget } from './cards/targeting';
import { isOptimalDistance, optimalRangeOf, preyOf } from './combat/archery';
import { reboundChain } from './combat/rebound';
import type { GameContent } from './content';
import { queryContext, type RuleContext } from './context';
import { manhattan, type Pos } from './core/position';
import type { Unit } from './entities/unit';
import type { GameEvent } from './events';
import type { GameState } from './state';

/**
 * Archer UI contract (functional only, no visuals). Pure reads of the authoritative state, so a
 * PvP client computes them from its own wire view (statuses, positions and focus are public).
 */

export interface PreyView {
  /** Unit id of the marked unit (public state; safe to send to both seats). */
  targetId: string;
  name: string;
  pos: Pos;
  hp: number;
  maxHp: number;
  /** Manhattan distance from the Archer. */
  distance: number;
  inOptimalRange: boolean;
  inLineOfSight: boolean;
  tooltip: string;
}

export interface ArcherHud {
  /** Concentración, e.g. { value: 2, max: 3, label: '2/3' }. */
  focus: { value: number; max: number; label: string };
  optimalRange: { min: number; max: number };
  prey: PreyView | null;
}

/** HUD block for `championId` (default: the active player's champion). Null when not an Archer. */
export function archerHud(state: Readonly<GameState>, content: GameContent, championId = state.player.heroId): ArcherHud | null {
  const archer = unitById(state as GameState, championId);
  const range = archer && optimalRangeOf({ content }, archer);
  if (!archer?.focus || !range) return null;
  const prey = preyOf(state, archer.id);
  const ctx = queryContext(state as GameState, content);
  return {
    focus: { value: archer.focus.value, max: archer.focus.max, label: `${archer.focus.value}/${archer.focus.max}` },
    optimalRange: { ...range },
    prey: prey ? preyView(ctx, archer, prey, range) : null,
  };
}

function preyView(ctx: RuleContext, archer: Unit, prey: Unit, range: { min: number; max: number }): PreyView {
  const distance = manhattan(archer.pos, prey.pos);
  const inOptimalRange = isOptimalDistance(range, distance);
  const inLineOfSight = hasLineOfSight(ctx, archer.pos, prey.pos);
  return {
    targetId: prey.id,
    name: prey.name,
    pos: { ...prey.pos },
    hp: prey.hp,
    maxHp: prey.maxHp,
    distance,
    inOptimalRange,
    inLineOfSight,
    tooltip:
      `Presa: ${prey.name} (${prey.hp}/${prey.maxHp} HP) a ${distance} casillas. ` +
      (inOptimalRange ? 'En Distancia Óptima.' : `Distancia Óptima: ${range.min}–${range.max}.`) +
      (inLineOfSight ? '' : ' Sin línea de visión.'),
  };
}

/**
 * "Would standing on `pos` be Distancia Óptima to my Presa?" — for movement / step previews.
 * Null when the champion has no optimal range or no Presa.
 */
export function optimalFromTile(state: Readonly<GameState>, content: GameContent, pos: Pos, championId = state.player.heroId): boolean | null {
  const archer = unitById(state as GameState, championId);
  const range = archer && optimalRangeOf({ content }, archer);
  const prey = archer && preyOf(state, archer.id);
  return range && prey ? isOptimalDistance(range, manhattan(pos, prey.pos)) : null;
}

export interface ArcherForecast {
  cardId: string;
  /** Unit the shot resolves on (UNIT target, or the unit a LINE arrow hits), if any. */
  targetId: string | null;
  targetIsPrey: boolean;
  /** Distance caster → target unit (or chosen tile when no unit). */
  distance: number | null;
  inOptimalRange: boolean;
  /** Printed damage of the card's first DAMAGE effect (null for non-damage cards). */
  baseDamage: number | null;
  /** Damage if its bonus / condition is met (null when the card has none). */
  conditionalDamage: number | null;
  /** The conditional damage applies to this target, now. */
  conditionMet: boolean;
  /** HP the target would actually lose (after armour, shield, cover), from the dry run. */
  predictedHpLoss: number;
  focus: { before: number; gain: number; spend: number; after: number; max: number };
  /** LINE focus pierce chosen by this target. */
  pierces: boolean;
  /**
   * Flecha de Rebote: the exact bounce path after the target (A → B → C), with the HP each one
   * would lose (dry run). Empty for other cards or when nothing is adjacent.
   */
  rebound: { unitId: string; name: string; pos: Pos; hpLoss: number }[];
  /** Statuses the card applies to the target (special arrows): id, label and duration in turns. */
  statuses: { status: string; name: string; turns: number }[];
  /**
   * Terrain the card would paint (Flecha de Humo), from the dry run: the exact tiles (fire, ice,
   * exits… are skipped), rounds, and whether it blocks sight / costs extra to leave.
   */
  terrain: { terrain: string; name: string; rounds: number | null; tiles: Pos[]; blocksLineOfSight: boolean; exitCost: number }[];
  /** Short Spanish lines for the confirm panel; nothing important is omitted. */
  notes: string[];
}

const firstDamage = (effects: readonly EffectDef[]) =>
  effects.find((fx): fx is Extract<EffectDef, { type: 'DAMAGE' }> => fx.type === 'DAMAGE');

/**
 * Everything the player must know BEFORE confirming an Archer card on `target`: base and
 * conditional damage, Presa / Distancia Óptima state and the Concentración it gains or spends.
 * Focus and HP numbers come from a dry run of the real rules (same code as the server).
 */
export function archerCardForecast(
  state: Readonly<GameState>,
  content: GameContent,
  cardUid: string,
  target: Pos | null,
): ArcherForecast | null {
  const ctx = queryContext(state as GameState, content);
  const check = checkPlayability(ctx, cardUid);
  if (!check.ok || !check.caster.focus) return null;
  const { caster, def } = check;
  const focus = check.caster.focus;
  const resolved = resolveTarget(ctx, caster, def.targeting, target);
  if (!resolved) return null;

  const unit =
    def.targeting.type === 'LINE'
      ? resolved.hitUnitId ? unitById(ctx.state, resolved.hitUnitId) : undefined
      : resolved.target ? unitAt(ctx.state, resolved.target) : undefined;
  const range = optimalRangeOf(ctx, caster);
  // Movement cards: what matters is where you END relative to your Presa.
  const prey = preyOf(state, caster.id);
  const distance =
    def.targeting.type === 'STEP'
      ? prey ? manhattan(resolved.impact, prey.pos) : null
      : unit ? manhattan(caster.pos, unit.pos) : resolved.target ? manhattan(caster.pos, resolved.target) : null;
  const dmg = firstDamage(def.effects);
  const conditional = dmg?.bonus ? dmg.amount + dmg.bonus.amount : null;
  const conditionMet = !!(dmg?.bonus && unit && conditionsHold({ ctx, caster, resolved }, dmg.bonus.when, unit));

  const events: GameEvent[] = [];
  const dry: RuleContext = { state: structuredClone(state) as GameState, content, emit: (e) => events.push(e) };
  playCard(dry, cardUid, target);
  let gain = 0, spend = 0, hpLoss = 0;
  for (const e of events) {
    if (e.type === 'FOCUS_CHANGED' && e.unitId === caster.id) {
      if (e.reason === 'SPENT') spend += e.from - e.to;
      else gain += e.to - e.from;
    }
    if (e.type === 'UNIT_DAMAGED' && unit && e.unitId === unit.id && e.sourceId === caster.id) hpLoss += e.hpLost;
  }
  const chain = dmg?.rebound && unit ? reboundChain(state, caster, unit, dmg.rebound.bounces) : [];
  const rebound = chain.map((u) => ({
    unitId: u.id,
    name: u.name,
    pos: { ...u.pos },
    hpLoss: events.filter((e) => e.type === 'UNIT_DAMAGED' && e.unitId === u.id && e.sourceId === caster.id).reduce((n, e) => n + (e.type === 'UNIT_DAMAGED' ? e.hpLost : 0), 0),
  }));
  const painted = new Map<string, { terrain: string; rounds: number | null; tiles: Pos[] }>();
  for (const e of events)
    if (e.type === 'TERRAIN_CREATED' && e.sourceId === caster.id) {
      const entry = painted.get(e.terrain) ?? { terrain: e.terrain, rounds: e.turnsLeft, tiles: [] };
      entry.tiles.push({ ...e.pos });
      painted.set(e.terrain, entry);
    }
  const terrain = [...painted.values()].map((t) => {
    const tdef = content.terrain[t.terrain as keyof typeof content.terrain];
    return { ...t, name: tdef?.name ?? t.terrain, blocksLineOfSight: !!tdef?.blocksLineOfSight, exitCost: tdef?.exitCostBonus ?? 0 };
  });
  const statuses = def.effects.flatMap((fx) =>
    fx.type === 'APPLY_STATUS' && fx.status !== 'PREY' ? [{ status: fx.status, name: content.statuses[fx.status].name, turns: fx.duration }] : [],
  );
  const before = focus.value;
  const pierces = !!resolved.focusSpent;
  const targetIsPrey = !!unit && prey?.id === unit.id;
  const inOptimalRange = distance !== null && isOptimalDistance(range, distance);
  return {
    cardId: def.id,
    targetId: unit?.id ?? null,
    targetIsPrey,
    distance,
    inOptimalRange,
    baseDamage: dmg?.amount ?? null,
    conditionalDamage: conditional,
    conditionMet,
    predictedHpLoss: hpLoss,
    focus: { before, gain, spend, after: Math.max(0, Math.min(focus.max, before - spend + gain)), max: focus.max },
    pierces,
    rebound,
    statuses,
    terrain,
    notes: [
      ...forecastNotes(def, { targetIsPrey, inOptimalRange, distance, range, conditionMet, conditional, gain, spend, pierces,
        movement: def.targeting.type === 'STEP', hasPrey: !!prey }),
      ...statuses.map((s) => `Aplica ${s.name} ${s.turns} turno${s.turns === 1 ? '' : 's'}`),
      ...terrain.map((t) =>
        `${t.name} en ${t.tiles.length} casilla${t.tiles.length === 1 ? '' : 's'}${t.rounds ? ` durante ${t.rounds} ronda${t.rounds === 1 ? '' : 's'}` : ''}` +
        `${t.blocksLineOfSight ? ': bloquea la visión a través' : ''}${t.exitCost ? `; salir cuesta +${t.exitCost} movimiento` : ''}`),
      ...(dmg?.rebound && unit
        ? [rebound.length ? `Rebote: ${[unit.name, ...rebound.map((r) => r.name)].join(' → ')}` : 'Rebote: ningún enemigo adyacente']
        : []),
    ],
  };
}

function conditionLabel(c: EffectCondition): string {
  switch (c.type) {
    case 'TARGET_IS_PREY': return 'contra tu Presa';
    case 'TARGET_IN_OPTIMAL_RANGE': return 'desde Distancia Óptima';
    case 'TARGET_HP_AT_MOST_PCT': return `objetivo ≤${c.pct}% de vida`;
    default: return 'condición';
  }
}

function forecastNotes(
  def: CardDefinition,
  f: { targetIsPrey: boolean; inOptimalRange: boolean; distance: number | null; range: { min: number; max: number } | null;
    conditionMet: boolean; conditional: number | null; gain: number; spend: number; pierces: boolean;
    movement: boolean; hasPrey: boolean },
): string[] {
  const notes: string[] = [];
  const dmg = firstDamage(def.effects);
  if (dmg) {
    notes.push(`Daño base ${dmg.amount}`);
    if (dmg.bonus && f.conditional !== null) {
      const when = (Array.isArray(dmg.bonus.when) ? dmg.bonus.when : [dmg.bonus.when]) as EffectCondition[];
      notes.push(`${f.conditional} ${when.map(conditionLabel).join(' y ')}${f.conditionMet ? ' — se cumple' : ' — no se cumple'}`);
    }
  }
  const where = f.movement ? 'Destino a ' : 'Distancia ';
  if (f.distance !== null && f.range)
    notes.push(f.inOptimalRange ? `${where}${f.distance}${f.movement ? ' de tu Presa' : ''}: Óptima` : `${where}${f.distance}${f.movement ? ' de tu Presa' : ''} (Óptima ${f.range.min}–${f.range.max})`);
  if (f.movement) { if (!f.hasPrey) notes.push('Sin Presa marcada'); }
  else if (dmg) notes.push(f.targetIsPrey ? 'Objetivo: tu Presa' : 'Objetivo: no es tu Presa');
  if (f.spend) notes.push(`Consume ${f.spend} Concentración${f.pierces ? ' (atraviesa)' : ''}`);
  if (f.gain) notes.push(`Ganas ${f.gain} Concentración`);
  return notes;
}

/** The active player's Archer, if any (convenience for HUD wiring). */
export const activeArcher = (state: Readonly<GameState>): Unit | undefined => {
  const hero = getHero(state as GameState);
  return hero?.focus ? hero : undefined;
};
