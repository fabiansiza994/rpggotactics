import type { CardDefinition, GameEngine, GameState } from '../../game';
import { capacityNeeded, summonCapacityView } from '../../game/domain/summons/capacity-view';
import type { RuleError } from '../../game/domain/result';
import type { IconName } from '../assets/iconPaths';
import { ERROR_LABEL } from './format';

/**
 * Why a hand card cannot be played right now, in player language (first-playtest pass E2).
 *
 * The rules decide: `code` is the engine's own playability verdict (its validation order is
 * kept; the first failing check wins). The only presentation-side code is NO_VALID_TARGET:
 * the engine reports the card as playable but `getValidTargets` is empty, so it could never be
 * cast this moment (audit B3). Nothing here changes rules, error codes or the PvP contract.
 */
export type CardBlockCode = RuleError | 'NO_VALID_TARGET';

export interface CardBlock {
  code: CardBlockCode;
  /** Short label for the chip on the card (always visible, never hover-only). */
  chip: string;
  /** Optional second line (numbers); narrow mobile cards may hide it, the detail repeats it. */
  sub?: string;
  icon: IconName;
  /** Whole-hand states (not your turn): dim the card but no chip, so the hand is not flooded. */
  quiet?: boolean;
  /** Full explanation: hover/focus hint, tap notice and accessible description. */
  detail: string;
}

const points = (n: number) => `${n} ${n === 1 ? 'punto' : 'puntos'}`;

/** "Lobo (2)", "Pollo (1) y Zorro (1)". */
export function occupantList(occupants: readonly { name: string; cost: number }[]): string {
  const names = occupants.map((o) => `${o.name} (${o.cost})`);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

function heroName(engine: GameEngine, state: Readonly<GameState>): string {
  const hero = state.units.find((u) => u.id === engine.heroId);
  return (hero && engine.content.heroes[hero.defId]?.name) ?? 'Tu campeón';
}

function noTargetDetail(def: CardDefinition): string {
  const t = def.targeting;
  const reach = 'range' in t && t.range !== undefined ? ` a distancia ${t.range}` : '';
  const sight = 'requiresLineOfSight' in t && t.requiresLineOfSight ? ' con línea de visión' : '';
  if (t.type === 'UNIT') {
    const who =
      t.unitFilter === 'SUMMON'
        ? 'ninguna invocación tuya'
        : t.unitFilter === 'ENEMY'
          ? 'ningún enemigo'
          : t.unitFilter === 'ALLY'
            ? 'ningún aliado'
            : 'ninguna unidad';
    return `No hay ${who}${reach}${sight}. Acércate o cambia de posición.`;
  }
  if (t.type === 'CHARGE') return `No hay un carril libre de carga hacia un enemigo${reach}.`;
  return `No hay ninguna casilla válida${reach} ahora mismo.`;
}

/**
 * The block of a hand card, or null when it can be played now. `state` is the snapshot being
 * rendered (in PvP the seat view), always the same one the engine evaluates.
 */
export function explainCardBlock(
  engine: GameEngine,
  state: Readonly<GameState>,
  cardUid: string,
): CardBlock | null {
  const card = state.player.hand.find((c) => c.uid === cardUid);
  const def = card && engine.content.cards[card.cardId];
  if (!def) return null;
  const cost = engine.getCardCost(cardUid)?.cost ?? def.cost;
  const check = engine.getCardPlayability(cardUid);
  const energy = state.player.energy;
  if (check.playable) {
    if (def.targeting.type === 'SELF' || engine.getValidTargets(cardUid).length > 0) return null;
    // A ritual piece is still usable without a target: it can be sealed on the altar.
    if (def.ritualPiece && engine.getCommitPlayability(cardUid).playable) return null;
    return { code: 'NO_VALID_TARGET', chip: 'Sin objetivo', icon: 'target', detail: noTargetDetail(def) };
  }
  const energyNote =
    energy < cost ? ` Además necesitas ${cost} de energía y tienes ${energy}.` : '';
  switch (check.reason) {
    case 'NOT_ENOUGH_FOCUS': {
      const focus = state.units.find((u) => u.id === engine.heroId)?.focus;
      const required = def.focusCost ?? 0;
      return { code: check.reason, chip: 'Sin Concentración', icon: 'target',
        sub: `${focus?.value ?? 0}/${focus?.max ?? required} · requiere ${required}`,
        detail: `Requiere ${required} de Concentración. Concentración: ${focus?.value ?? 0}/${focus?.max ?? required}. Requiere: ${required}/${focus?.max ?? required}.` };
    }
    case 'FORM_REQUIRED':
    case 'INVALID_TRANSFORMATION':
    case 'CARD_UNAVAILABLE_THIS_TURN':
    case 'SEARCH_HAND_FULL':
    case 'NO_ELIGIBLE_SUMMON':
      return {code:check.reason,chip:ERROR_LABEL[check.reason],icon:'wait',detail:ERROR_LABEL[check.reason]};
    case 'NOT_ENOUGH_ENERGY':
      return {
        code: check.reason,
        chip: 'Sin energía',
        sub: `necesita ${cost} · tienes ${energy}`,
        icon: 'energy',
        detail: `Energía insuficiente: necesitas ${cost} y tienes ${energy}. Se recarga al inicio de tu turno.`,
      };
    case 'SUMMON_CAPACITY': {
      const cap = summonCapacityView(state, engine.content, engine.heroId);
      const needed = capacityNeeded(engine.content, def.effects);
      const holders = cap.occupants.length ? ` Ocupan: ${occupantList(cap.occupants)}.` : '';
      return {
        code: check.reason,
        chip: 'Sin capacidad',
        sub: `necesita ${needed} · libre ${cap.free}`,
        icon: 'arcane',
        detail:
          `Capacidad de invocación insuficiente: esta carta necesita ${points(needed)} y tienes ` +
          `${points(cap.free)} libre${cap.free === 1 ? '' : 's'} de ${cap.max}.${holders} ` +
          `Se libera cuando una invocación muere o la retiras.${energyNote}`,
      };
    }
    case 'NOT_ENOUGH_HP': {
      const hp = state.units.find((u) => u.id === engine.heroId)?.hp ?? 0;
      return { code: check.reason, chip: 'Sin vida', sub: `${hp} PV · requiere ${def.minCasterHp ?? 2}`, icon: 'target',
        detail: `No puede usarse con ${hp} PV: necesitas al menos ${def.minCasterHp ?? 2} para pagar el sacrificio.${energyNote}` };
    }
    case 'NOT_PLAYER_TURN':
      return { code: check.reason, chip: 'Espera tu turno', icon: 'wait', quiet: true, detail: 'Solo puedes jugar cartas durante tu turno.' };
    case 'CASTER_INCAPACITATED': {
      const name = heroName(engine, state);
      return { code: check.reason, chip: 'No puede actuar', icon: 'wait', detail: `${name} no puede actuar ahora (aturdido): no puede jugar cartas este turno.` };
    }
    case 'WRONG_CLASS':
      return { code: check.reason, chip: 'Otra clase', icon: 'neutral', detail: `${ERROR_LABEL.WRONG_CLASS}: ${heroName(engine, state)} no puede usarla.` };
    default:
      return { code: check.reason, chip: 'Bloqueada', icon: 'target', detail: ERROR_LABEL[check.reason] };
  }
}
