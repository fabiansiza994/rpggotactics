import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../qa/shapeshifter/runtime';
import type {
  CardCategory,
  CardDefinition,
  CardRarity,
  DeckIssue,
  CollectibleKind,
  ObjectiveDef,
  ScenarioDef,
  EnemyIntent,
  Faction,
  GameEvent,
  GameState,
  IntentPlan,
  ObjectiveState,
  RuleError,
  StatusId,
} from '../../game';
import { STATUS_LABEL } from '../assets/statusLabels';
import { describeGuardianEvent, describeMechanismEvent, describeStageEvent, MECHANISM_ERROR_LABEL, mechanismObjectiveBrief, mechanismObjectiveLabel } from '../mechanisms/mechanismLabels';
export { STATUS_LABEL } from '../assets/statusLabels';

/** Status chip text: statuses that never count down (Presa) show no turn counter. */
export const statusChipText = (s: { id: StatusId; turnsLeft: number }): string =>
  DEFAULT_CONTENT.statuses[s.id]?.permanent ? STATUS_LABEL[s.id] : `${STATUS_LABEL[s.id]} ${s.turnsLeft}`;

/** Spanish UI strings for domain data. Presentation-only. */

// Defeated units disappear from the state; remember what we have seen for log lines.
const seen = new Map<string, { name: string; faction: Faction }>();

function remember(id: string, state: Readonly<GameState>) {
  const unit = state.units.find((u) => u.id === id);
  if (unit) seen.set(id, { name: unit.name, faction: unit.faction });
  return seen.get(id);
}

/** Call with the state BEFORE a batch so units defeated in it keep their names. */
export function rememberUnits(state: Readonly<GameState>): void {
  for (const u of state.units) seen.set(u.id, { name: u.name, faction: u.faction });
}

export function unitName(id: string, state: Readonly<GameState>): string {
  if (id.startsWith('terrain:')) return `Terreno (${id.slice(8)})`;
  if (id.startsWith('status:')) return STATUS_LABEL[id.slice(7) as StatusId] ?? id;
  return remember(id, state)?.name ?? id;
}


export const CATEGORY_LABEL: Record<CardCategory, string> = {
  ATTACK: 'Ataque',
  MOVEMENT: 'Movimiento',
  DEFENSE: 'Defensa',
  CONTROL: 'Control',
  TERRAIN: 'Terreno',
  UTILITY: 'Utilidad',
};

export const RARITY_LABEL: Record<CardRarity, string> = { COMMON: 'Común', UNCOMMON: 'Poco común', RARE: 'Rara', LEGENDARY: 'Legendaria', ULTRA: 'Ultra' };

export const TARGETING_LABEL: Record<CardDefinition['targeting']['type'], string> = {
  SELF: 'Propio',
  UNIT: 'Unidad',
  TILE: 'Casilla',
  LINE: 'Línea',
  CROSS: 'Cruz',
  AREA: 'Área',
  CHARGE: 'Carga',
  STEP: 'Paso',
};

export function rangeText(def: CardDefinition): string {
  const t = def.targeting;
  return t.type === 'SELF' ? TARGETING_LABEL.SELF : `${TARGETING_LABEL[t.type]} · alcance ${t.range}`;
}

/** Targeting fine print for the card detail view, read straight from the card's targeting data. */
export function targetingNotes(def: CardDefinition): string[] {
  const t = def.targeting;
  const notes: string[] = [];
  if ('minRange' in t && t.minRange) notes.push(`Alcance mínimo ${t.minRange}`);
  if ('requiresLineOfSight' in t && t.requiresLineOfSight) notes.push('Requiere línea de visión');
  if (t.type === 'LINE') notes.push(t.pierce ? 'Atraviesa unidades' : 'Se detiene en el primer objetivo');
  if (t.type === 'CHARGE') notes.push('En línea recta, con el camino libre; acabas adyacente', 'Bloqueada si estás Enraizado');
  if (t.type === 'STEP') notes.push('Andando a una casilla libre; no gasta movimiento', 'Bloqueada si estás Enraizado');
  if (def.empowered) notes.push(`Impulso ${def.empowered.momentum}: se consume solo al jugarla`);
  if ((t.type === 'CROSS' || t.type === 'AREA') && t.radius) notes.push(`Radio ${t.radius}`);
  return notes;
}

const copies = (n: number) => `${n} ${n === 1 ? 'copia' : 'copias'}`;

/** Player-facing wording for a deck rule violation (the rule itself lives in the game core). */
export function deckIssueText(issue: DeckIssue, heroName: string): string {
  const name = 'cardId' in issue ? (DEFAULT_CONTENT.cards[issue.cardId]?.name ?? issue.cardId) : '';
  switch (issue.code) {
    case 'DECK_INCOMPLETE':
      return issue.required - issue.current === 1
        ? `Mazo incompleto (${issue.current}/${issue.required}): falta 1 carta.`
        : `Mazo incompleto (${issue.current}/${issue.required}): faltan ${issue.required - issue.current} cartas.`;
    case 'DECK_TOO_LARGE':
      return `El mazo lleva exactamente ${issue.required} cartas. Quita una antes de añadir otra.`;
    case 'UNKNOWN_CARD':
      return `La carta «${name}» ya no existe.`;
    case 'WRONG_HERO':
      return `${name} no es una carta del ${heroName}.`;
    case 'LOCKED':
      return `${name} está bloqueada. Consíguela como recompensa de batalla.`;
    case 'NOT_ENOUGH_COPIES':
      return `Solo tienes ${copies(issue.owned)} de ${name}.`;
    case 'COPY_LIMIT':
      return `Máximo ${copies(issue.limit)} de ${name} por mazo.`;
    case 'NEUTRAL_LIMIT':
      return `Máximo ${issue.limit} cartas neutrales por mazo.`;
    case 'ULTRA_LIMIT':
      return `Máximo ${issue.limit === 1 ? '1 carta Ultra' : `${issue.limit} cartas Ultra`} por mazo.`;
    case 'MALFORMED_ENTRY':
      return 'El mazo guardado contiene una entrada inválida.';
  }
}

const DIR_LABEL = { UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→' } as const;

export function intentLabel(intent: EnemyIntent, plan: IntentPlan | undefined, state: Readonly<GameState>): string {
  // No plan = the simulated enemy phase says it will not get to act (e.g. dies to BURNING first).
  if (!plan && state.phase === 'PLAYER') return 'No llegará a actuar';
  switch (intent.kind) {
    case 'MELEE_ATTACK': {
      const hits = plan && plan.targetUnitIds.length > 0;
      return hits
        ? `${plan.path.length > 0 ? "Mover + atacar" : "Atacar"} a ${unitName(intent.targetUnitId, state)} (${plan.damage})`
        : `Acercarse a ${unitName(intent.targetUnitId, state)}`;
    }
    case 'CHARGE': {
      const hit = plan?.targetUnitIds[0];
      return `Embestida ${DIR_LABEL[intent.direction]} (${plan?.damage ?? intent.damage})${hit ? ` → ${unitName(hit, state)}` : ' → nadie'}`;
    }
    case 'APPROACH':
      return `Reposicionarse hacia ${unitName(intent.targetUnitId, state)}`;
    case 'AREA_SPELL':
      return `Hechizo de área en (${intent.center.x},${intent.center.y}) (${plan?.damage ?? intent.damage})`;
    case 'IDLE':
      return intent.reason === 'STUNNED' ? 'Aturdido' : 'Sin objetivo';
  }
}

export function intentIcon(intent: EnemyIntent): string {
  switch (intent.kind) {
    case 'MELEE_ATTACK':
      return `⚔${intent.damage}`;
    case 'CHARGE':
      return `${DIR_LABEL[intent.direction]}${intent.damage}`;
    case 'APPROACH':
      return '…';
    case 'AREA_SPELL':
      return `✸${intent.damage}`;
    case 'IDLE':
      return 'z';
  }
}

/** Pickup names: singular (log), plural (objective), and the objective's title. */
export const COLLECTIBLE_LABEL: Record<CollectibleKind, { one: string; many: string; title: string }> = {
  ORB: { one: 'orbe arcano', many: 'orbes', title: 'Recupera los orbes' },
  PAGE: { one: 'página del grimorio', many: 'páginas', title: 'Páginas del grimorio' },
  CORE: { one: 'núcleo de forja', many: 'núcleos', title: 'Recupera los núcleos' },
};

const structureName = (id: string) => DEFAULT_CONTENT.structures[id]?.name.toLowerCase() ?? id;

/** Live HUD line: compact title + progress, e.g. "Recupera los orbes · 1/2". */
export function objectiveLabel(obj: ObjectiveState, state: Readonly<GameState>): { title: string; progress: string } {
  const def = obj.def;
  switch (def.type) {
    case 'ELIMINATE_ALL':
      return { title: 'Elimina a todos', progress: `${obj.current}/${obj.target}` };
    case 'PROTECT_TARGET': {
      const left = obj.target - obj.current;
      const target = state.units.find((u) => u.id === def.targetUnitId);
      return {
        title: `Protege el ${target?.name.toLowerCase() ?? structureName(def.targetUnitId)}`,
        progress: obj.status === 'IN_PROGRESS' ? `${left} ${left === 1 ? 'ronda restante' : 'rondas restantes'}` : `${obj.current}/${obj.target}`,
      };
    }
    case 'DEFEAT_TARGET':
      return { title: `Derrota a ${unitName(def.targetUnitId, state)}`, progress: `${obj.current}/${obj.target}` };
    case 'REACH_TILE':
      return { title: 'Llega a la salida', progress: `ronda ${Math.min(state.round, def.roundLimit)}/${def.roundLimit}` };
    case 'COLLECT_OBJECTS':
      return { title: COLLECTIBLE_LABEL[def.kind].title, progress: `${obj.current}/${obj.target}` };
    case 'SURVIVE_ROUNDS':
      return { title: 'Sobrevive', progress: `${obj.current}/${obj.target} rondas` };
    case 'MECHANISM':
      return mechanismObjectiveLabel(def, obj);
  }
}

/** Static mission brief for the campaign route (no battle state yet). */
export function objectiveBrief(def: ObjectiveDef, scenario: ScenarioDef): string {
  switch (def.type) {
    case 'ELIMINATE_ALL':
      return 'Elimina a todos los enemigos';
    case 'PROTECT_TARGET': {
      const s = scenario.structures.find((x) => x.id === def.targetUnitId);
      return `Protege el ${structureName(s?.structureId ?? def.targetUnitId)} ${def.rounds} rondas`;
    }
    case 'DEFEAT_TARGET': {
      const spawn = [...scenario.enemies, ...scenario.waves.flatMap((w) => w.enemies)].find((e) => e.id === def.targetUnitId);
      return `Derrota a ${DEFAULT_CONTENT.enemies[spawn?.enemyId ?? '']?.name ?? def.targetUnitId}`;
    }
    case 'REACH_TILE':
      return `Llega a la salida antes de la ronda ${def.roundLimit}`;
    case 'COLLECT_OBJECTS':
      return `Recupera ${def.required} ${COLLECTIBLE_LABEL[def.kind].many}`;
    case 'SURVIVE_ROUNDS':
      return `Sobrevive ${def.rounds} rondas`;
    case 'MECHANISM':
      return mechanismObjectiveBrief(def);
  }
}

/** One-word mission type for tags (menu cards, route nodes). */
export const OBJECTIVE_TAG: Record<ObjectiveDef['type'], string> = {
  ELIMINATE_ALL: 'Eliminar',
  PROTECT_TARGET: 'Proteger',
  REACH_TILE: 'Escapar',
  DEFEAT_TARGET: 'Líder',
  COLLECT_OBJECTS: 'Recuperar',
  SURVIVE_ROUNDS: 'Resistir',
  MECHANISM: 'Mecanismo',
};

export const OUTCOME_LABEL = {
  OBJECTIVES_COMPLETED: 'Objetivo cumplido',
  HERO_DEFEATED: 'El Mago ha caído',
  PROTECTED_TARGET_DESTROYED: 'El cristal fue destruido',
  ROUND_LIMIT_REACHED: 'Se agotaron las rondas',
} as const;

export const ERROR_LABEL: Record<RuleError, string> = {
  FORM_REQUIRED: 'Requiere otra forma activa',
  INVALID_TRANSFORMATION: 'Transformación no disponible',
  CARD_UNAVAILABLE_THIS_TURN: 'No disponible durante este turno',
  SEARCH_HAND_FULL: 'Mano completa: necesitas espacio para buscar',
  NO_ELIGIBLE_SUMMON: 'No hay invocaciones elegibles en el mazo',
  NO_ELIGIBLE_PIECE: 'No hay piezas de ritual en tu descarte',
  WRONG_CLASS: 'Carta de otra clase',
  SUMMON_CAPACITY: 'Capacidad de invocación completa',
  BATTLE_OVER: 'La batalla ha terminado',
  NOT_PLAYER_TURN: 'No es tu turno',
  UNKNOWN_UNIT: 'Unidad desconocida',
  UNIT_NOT_CONTROLLABLE: 'No controlas esa unidad',
  MOVEMENT_PREVENTED: 'No puedes moverte (enraizado)',
  UNREACHABLE: 'Casilla inalcanzable',
  CARD_NOT_IN_HAND: 'La carta no está en tu mano',
  NOT_ENOUGH_ENERGY: 'Energía insuficiente',
  NOT_ENOUGH_FOCUS: 'Concentración insuficiente',
  NOT_ENOUGH_HP: 'No puede usarse con 1 PV',
  UNIQUE_ALREADY_USED: 'Única: ya usada en este combate',
  INVALID_TARGET: 'Objetivo inválido para esta carta',
  // Champion-neutral: the HUD names the actual champion (cardBlock.ts); PvP reuses this map.
  CASTER_INCAPACITATED: 'Tu campeón no puede actuar',
  NOT_A_RITUAL_PIECE: 'No es una pieza de ritual',
  NO_ALTAR: 'Este campeón no tiene altar',
  ALTAR_FULL: 'El altar está lleno',
  ALTAR_DUPLICATE: 'Esa pieza ya está sellada',
  PIECE_NOT_ON_ALTAR: 'Esa pieza no está en tu altar',
  UNKNOWN_RITUAL: 'Ritual desconocido',
  RITUAL_INCOMPLETE: 'Faltan piezas en el altar',
  RITUAL_LIMIT: 'Ritual ya completado en este combate',
  DISCARD_REQUIRED: 'Descarta 1 carta para terminar tu turno',
  DISCARD_NOT_ALLOWED: 'No hace falta descartar',
  ...MECHANISM_ERROR_LABEL,
};

const ritualName = (id: string) => DEFAULT_CONTENT.rituals?.[id]?.name ?? 'Ritual';

const cardName = (id: string) => DEFAULT_CONTENT.cards[id]?.name ?? id;

export function describeEvent(
  e: GameEvent,
  state: Readonly<GameState>,
): { text: string; tone: 'info' | 'good' | 'bad' | 'turn' } | null {
  const n = (id: string) => id === 'arcane-fatigue' ? 'Fatiga Arcana' : unitName(id, state);
  switch (e.type) {
    case 'DECK_RESHUFFLED':
      return { text: `Descarte reciclado: ${e.cardCount} cartas`, tone: 'info' };
    case 'ARCANE_FATIGUE':
      return { text: `Fatiga Arcana ${e.amount} · reciclaje ${e.recycle}`, tone: 'bad' };
    case 'ROUND_STARTED':
      return { text: `— Ronda ${e.round} —`, tone: 'turn' };
    case 'TURN_STARTED':
      return { text: e.faction === 'PLAYER' ? 'Tu turno' : 'Turno enemigo', tone: 'turn' };
    case 'CARD_PLAYED':
      return { text: `Lanzas ${cardName(e.cardId)}${e.empowered ? ' (con Impulso)' : ''}`, tone: 'info' };
    case 'RITUAL_PIECE_COMMITTED':
      return e.cardId
        ? { text: `Sellas ${cardName(e.cardId)} en el altar (${e.altarSize})`, tone: 'info' }
        : { text: `${n(e.casterId)} sella una pieza oculta en su altar (${e.altarSize})`, tone: 'bad' };
    case 'RITUAL_PIECE_RELEASED':
      return e.cardId
        ? { text: `Liberas ${cardName(e.cardId)} del altar`, tone: 'info' }
        : { text: `${n(e.casterId)} abandona una pieza de su altar (${e.altarSize})`, tone: 'info' };
    case 'SUMMON_BREATH':
      return { text: `${n(e.unitId)} libera ${e.name}`, tone: 'info' };
    case 'RITUAL_ACTIVATED':
      return { text: `${n(e.casterId)} completa el ${ritualName(e.ritualId)}`, tone: 'good' };
    case 'MOMENTUM_CHANGED':
      return e.reason === 'SPENT'
        ? { text: `${n(e.unitId)} consume ${e.from - e.to} de Impulso (${e.to}/${e.max})`, tone: 'info' }
        : { text: `${n(e.unitId)} gana Impulso (${e.to}/${e.max})`, tone: 'good' };
    case 'FINISHER_TRIGGERED':
      return { text: `Remate: ${n(e.unitId)} tenía ${e.hpAtMost} HP o menos`, tone: 'good' };
    case 'COUNTER_ATTACK':
      return { text: `${n(e.unitId)} contraataca a ${n(e.targetId)}`, tone: 'info' };
    case 'UNIT_DAMAGED': {
      const extra = e.shieldAbsorbed ? ` (escudo absorbe ${e.shieldAbsorbed})` : '';
      const good = remember(e.unitId, state)?.faction === 'ENEMY';
      return { text: `${n(e.unitId)} recibe ${e.hpLost} de daño de ${n(e.sourceId)}${extra}`, tone: good ? 'good' : 'bad' };
    }
    case 'HP_SACRIFICED': {
      const good = remember(e.unitId, state)?.faction === 'ENEMY';
      return { text: `${n(e.unitId)} sacrifica ${e.amount} PV${e.cardId ? ` (${cardName(e.cardId)})` : ''}`, tone: good ? 'good' : 'bad' };
    }
    case 'SUMMON_CAPACITY_CHANGED': {
      const rival = remember(e.unitId, state)?.faction === 'ENEMY';
      return { text: `${rival ? `${n(e.unitId)}: c` : 'C'}apacidad de invocación ${e.from} → ${e.to}`, tone: rival ? 'bad' : 'good' };
    }
    case 'UNIT_DEFEATED':
      return { text: `${n(e.unitId)} ha sido derrotado`, tone: e.faction === 'ENEMY' ? 'good' : 'bad' };
    case 'UNIT_SPAWNED':
      // Own summons are good news; enemy reinforcements keep the warning tone.
      return e.faction === 'PLAYER'
        ? { text: e.kind === 'SUMMON' ? `Invocas: ${n(e.unitId)}` : `¡Aparece ${n(e.unitId)}!`, tone: 'good' }
        : { text: `¡Aparece ${n(e.unitId)}!`, tone: 'bad' };
    case 'SHIELD_GAINED':
      return { text: `${n(e.unitId)} gana ${e.amount} de escudo`, tone: 'good' };
    case 'STATUS_APPLIED':
      return { text: `${n(e.unitId)}: ${STATUS_LABEL[e.status]} (${e.turnsLeft})`, tone: 'info' };
    case 'UNIT_PUSHED':
      return { text: `${n(e.unitId)} es empujado${e.collision ? ' y choca' : ''}`, tone: 'info' };
    case 'TERRAIN_CREATED':
      return { text: `Terreno ${e.terrain} en (${e.pos.x},${e.pos.y})`, tone: 'info' };
    case 'TERRAIN_REMOVED':
      return { text: `${e.terrain} desaparece de (${e.pos.x},${e.pos.y})`, tone: 'info' };
    case 'OBSTACLE_CREATED':
      return { text: `${DEFAULT_CONTENT.obstacles[e.defId]?.name ?? e.defId} en (${e.pos.x},${e.pos.y})`, tone: 'info' };
    case 'OBSTACLE_REMOVED':
      return { text: `${DEFAULT_CONTENT.obstacles[e.defId]?.name ?? e.defId} desaparece de (${e.pos.x},${e.pos.y})`, tone: 'info' };
    case 'STATUS_REMOVED':
      return { text: `${n(e.unitId)} ya no está ${STATUS_LABEL[e.status]}`, tone: 'info' };
    case 'ENEMY_ATTACKED':
      return { text: `${n(e.enemyId)} ataca`, tone: 'bad' };
    case 'COLLECTIBLE_COLLECTED':
      return { text: `Recuperas ${e.kind === 'ORB' ? 'un' : 'una'} ${COLLECTIBLE_LABEL[e.kind].one}`, tone: 'good' };
    case 'MECHANISM_CHANGED':
      return describeMechanismEvent(e);
    case 'GUARDIAN_STATE':
      return describeGuardianEvent(e);
    case 'OBJECTIVE_STAGE_CHANGED':
      return describeStageEvent(e);
    case 'BATTLE_WON':
      return { text: '¡Victoria!', tone: 'good' };
    case 'BATTLE_LOST':
      return { text: 'Derrota', tone: 'bad' };
    default:
      return null;
  }
}
