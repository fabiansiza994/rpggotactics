import type { GameEvent, ObjectiveDef, ObjectiveState, RuleError } from '../../game';

/**
 * Spanish copy for the interactive battlefield (Act III). Kept out of react/format.ts so the
 * shared formatter only gains one-line delegations. Short on purpose: the combat log must not
 * flood when a cascade (plate → bridge → gate) resolves in one action.
 */
type MechanismEvent = Extract<GameEvent, { type: 'MECHANISM_CHANGED' }>;
type MechanismObjective = Extract<ObjectiveDef, { type: 'MECHANISM' }>;

/** Log line per cue; null = silent (deferred/visual-only cues the board already shows). */
const CUE_LOG: Partial<Record<MechanismEvent['cue'], { text: string; tone: 'info' | 'good' | 'bad' }>> = {
  SWITCH_ACTIVATED: { text: 'Interruptor activado', tone: 'good' },
  SWITCH_DEACTIVATED: { text: 'Interruptor desactivado', tone: 'info' },
  PLATE_PRESSED: { text: 'Placa activada', tone: 'info' },
  PLATE_RELEASED: { text: 'Placa liberada', tone: 'info' },
  GATE_OPENED: { text: 'Puerta abierta', tone: 'good' },
  GATE_CLOSED: { text: 'Puerta cerrada', tone: 'bad' },
  GATE_CLOSE_DEFERRED: { text: 'La puerta espera a que se libere el paso', tone: 'info' },
  BRIDGE_LOWERED: { text: 'Puente descendido', tone: 'good' },
  BRIDGE_RAISED: { text: 'Puente elevado', tone: 'bad' },
  BRIDGE_RAISE_DEFERRED: { text: 'El puente aguanta mientras alguien lo cruza', tone: 'info' },
  STATUE_PUSHED: { text: 'Estatua desplazada', tone: 'info' },
  RELIC_COLLECTED: { text: 'Reliquia obtenida', tone: 'good' },
  TRAP_FIRED: { text: 'Runa de trampa activada', tone: 'bad' },
  TRAP_DISABLED: { text: 'Trampa desactivada', tone: 'good' },
  TRAP_ENABLED: { text: 'Trampa reactivada', tone: 'bad' },
  MECHANISM_RESET: { text: 'Mecanismo restablecido', tone: 'info' },
  MECHANISM_LOCKED: { text: 'Sello fijado', tone: 'good' },
  PLATFORM_MOVED: { text: 'Sección desplazada', tone: 'info' },
  PLATFORM_BLOCKED: { text: 'La sección no puede moverse: algo bloquea el destino', tone: 'bad' },
  RELIC_PICKED_UP: { text: 'Reliquia recogida', tone: 'good' },
  RELIC_DROPPED: { text: 'Reliquia soltada', tone: 'info' },
  RELIC_EXTRACTED: { text: 'Reliquia asegurada', tone: 'good' },
  SEQUENCE_PROGRESS: { text: 'Runa despertada', tone: 'good' },
  SEQUENCE_RESET: { text: 'Orden incorrecto: las runas se apagan', tone: 'bad' },
  SECTION_ROTATED: { text: 'La sección gira', tone: 'info' },
  SECTION_ROTATION_BLOCKED: { text: 'La sección no puede girar: algo la bloquea', tone: 'bad' },
  CONTROL_RELOCATED: { text: 'Nuevo control activado', tone: 'good' },
};

type GuardianEvent = Extract<GameEvent, { type: 'GUARDIAN_STATE' }>;
type StageEvent = Extract<GameEvent, { type: 'OBJECTIVE_STAGE_CHANGED' }>;

const GUARDIAN_LOG: Record<GuardianEvent['cue'], { text: string; tone: 'info' | 'good' | 'bad' }> = {
  GUARDIAN_FORTIFIED: { text: 'El Guardián se blinda', tone: 'bad' },
  GUARDIAN_EXPOSED: { text: '¡Núcleo del Guardián expuesto!', tone: 'good' },
  GUARDIAN_REFORTIFIED: { text: 'El Guardián vuelve a blindarse', tone: 'bad' },
};

export const describeGuardianEvent = (e: GuardianEvent) => GUARDIAN_LOG[e.cue];

export const describeStageEvent = (e: StageEvent): { text: string; tone: 'good' } =>
  ({ text: e.label ? `Nueva etapa: ${e.label}` : 'Misión completada', tone: 'good' });

export function describeMechanismEvent(e: MechanismEvent): { text: string; tone: 'info' | 'good' | 'bad' } | null {
  return CUE_LOG[e.cue] ?? null;
}

const GOAL_TITLE: Record<MechanismObjective['goal'], string> = {
  ACTIVATE_N: 'Activa los mecanismos',
  KEEP_ACTIVE: 'Mantén las placas activas',
  OPEN: 'Abre la puerta',
  COLLECT_RELIC: 'Recupera la reliquia',
  MOVE_OBJECT: 'Coloca la estatua',
  FLAG: 'Completa el mecanismo',
  EXTRACT_RELIC: 'Asegura la reliquia',
  STAGES: 'Misión',
};

export function mechanismObjectiveLabel(def: MechanismObjective, obj: ObjectiveState): { title: string; progress: string } {
  // Multi-stage: the HUD names the CURRENT stage ("Llega a la reliquia · etapa 1/3").
  if (def.goal === 'STAGES' && def.stages?.length) {
    const stage = def.stages[Math.min(obj.current, def.stages.length - 1)]!;
    return { title: obj.current >= def.stages.length ? (def.label ?? GOAL_TITLE.STAGES) : stage.label, progress: `etapa ${Math.min(obj.current + 1, obj.target)}/${obj.target}` };
  }
  const title = def.label ?? GOAL_TITLE[def.goal];
  const progress = def.goal === 'KEEP_ACTIVE' ? `${obj.current}/${obj.target} rondas` : `${obj.current}/${obj.target}`;
  return { title, progress };
}

export function mechanismObjectiveBrief(def: MechanismObjective): string {
  const base = def.label ?? GOAL_TITLE[def.goal];
  return def.roundLimit ? `${base} antes de la ronda ${def.roundLimit}` : base;
}

export const MECHANISM_ERROR_LABEL: Record<Extract<RuleError, 'UNKNOWN_MECHANISM' | 'NOT_INTERACTABLE' | 'NOT_ADJACENT' | 'INTERACTION_USED' | 'PUSH_BLOCKED'>, string> = {
  UNKNOWN_MECHANISM: 'Mecanismo desconocido',
  NOT_INTERACTABLE: 'No se puede usar ahora',
  NOT_ADJACENT: 'Acércate a una casilla adyacente',
  INTERACTION_USED: 'Ya interactuaste este turno',
  PUSH_BLOCKED: 'La estatua no puede moverse ahí',
};
