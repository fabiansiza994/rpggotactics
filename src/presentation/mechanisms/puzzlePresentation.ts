import type { GameEvent, GameState } from '../../game';
import { mechanismView, type MechanismVisual } from '../../game/domain/mechanisms/mechanism-view';
import { guardianLabel, sequencePresentation } from './phase2Presentation';
const INTROS: Record<string, { introTitle: string; introHint: string }> = {
  w3_e01: {
    introTitle: 'LA PUERTA SELLADA',
    introHint: 'Una palanca abre el acceso. Actívala desde una casilla adyacente.',
  },
  w3_e02: {
    introTitle: 'PUENTES ROTOS',
    introHint: 'El puente necesita peso continuo sobre la placa. Mantén el cruce construido.',
  },
  w3_e03: {
    introTitle: 'LOS TRES SELLOS',
    introHint: 'Activa los tres sellos simultáneamente para abrir la cámara.',
  },
  w3_e04: {
    introTitle: 'LA CÁMARA MÓVIL',
    introHint:
      'Las palancas desplazan el suelo y sus pasajeros. Puedes corregir el mismo control sin esperar otro turno.',
  },
  w3_e05: {
    introTitle: 'MECANISMO DEL NÚCLEO',
    introHint:
      'Activa la placa y la palanca encendida para exponer al Guardián 3 rondas. Al cerrarse el núcleo se enciende otra palanca: muévete.',
  },
  w3_e06: {
    introTitle: 'LA RELIQUIA PERDIDA',
    introHint: 'Alcanza la cámara iluminada. Las Runas de Sol y Luna abren el acceso a la reliquia.',
  },
  w3_e07: {
    introTitle: 'PESO Y CONTRAPESO',
    introHint:
      'La Balanza va donde pesa la placa: con peso, al norte; sin peso, al sur. Súbete a ella y deja que el contrapeso te lleve.',
  },
  w3_e09: {
    introTitle: 'EL CORAZÓN DEL TEMPLO',
    introHint:
      'Peso en la placa abre el muro. Gira la sección (palanca o consola, las veces que quieras) hasta que su brazo toque el muro y desactiva el Corazón.',
  },
  w3_e10: {
    introTitle: 'EL ARQUITECTO DEL UMBRAL',
    introHint:
      'El Arquitecto gira el santuario y mueve sus muros, siempre con aviso. Tira de la Llave encendida para romper su blindaje 3 rondas.',
  },
  w3_e08: {
    introTitle: 'EL LABERINTO VIVO',
    introHint:
      'La palanca (↻) y la consola central (↺) giran 90° la mitad derecha del templo, con sus pasillos y quien esté encima. Selecciona un control para ver dónde quedarán los muros.',
  },
};
const HUD_HINTS: Record<string, string> = {
  w3_e01: 'Abre el paso con la palanca.',
  w3_e02: 'Mantén peso para cruzar.',
  w3_e03: 'Activa tres sellos a la vez.',
  w3_e04: 'Desplaza el suelo y avanza.',
  w3_e05: 'Peso y palanca abren el núcleo.',
  w3_e06: 'Sol y Luna abren la cámara.',
  w3_e07: 'Viaja sobre el contrapeso.',
  w3_e08: 'Gira la sección para avanzar.',
  w3_e09: 'Conecta el suelo al Corazón.',
  w3_e10: 'Activa la llave y ataca.',
};
/** Optional presentation registry; no tutorial state enters simulation/replay. */
export function puzzlePresentation(state: Readonly<GameState>) {
  const intro = INTROS[state.scenarioId],
    view = mechanismView(state);
  if (!intro || !view) return null;
  const seals = view.objects.filter((o) => o.kind === 'PRESSURE_PLATE' && o.id.startsWith('seal-'));
  const progress = seals.length
    ? seals.filter((o) => o.visualState === 'active' || o.visualState === 'locked').length
    : 0;
  const guardian = view.guardians[0],
    sequence = sequencePresentation(state);
  const progressLabel = seals.length
    ? 'SELLOS ACTIVOS'
    : guardian
      ? 'NÚCLEO'
      : sequence
        ? 'SECUENCIA · SOL → LUNA'
        : '';
  const contextualHint = seals.length
    ? progress === seals.length
      ? 'LOS TRES SELLOS RESPONDEN · Cámara abierta · Entra en la cámara'
      : progress === 2
        ? 'Dos sellos activos — falta uno. Deben mantenerse a la vez.'
        : `Sello${progress === 1 ? '' : 's'} activo${progress === 1 ? '' : 's'} — ${progress}/${seals.length}. Mantén los tres al mismo tiempo.`
    : guardian
      ? guardian.state === 'EXPOSED'
        ? [`ATÁCALO AHORA · Ataca el núcleo · ${guardianLabel(state, guardian)}`, view.scheduled[0]?.round === state.round ? boardChangeHint(view, state.round) : view.rings.length ? 'Al cerrarse, otro control se encenderá' : ''].filter(Boolean).join(' · ')
        : boardChangeHint(view, state.round) || (view.rings.length ? `Acciona el control encendido: ${liveLabel(view)}` : 'Mantén la placa activa y acciona la palanca.')
      : sequence
        ? sequence.done === 1
          ? 'Runa Solar activada · Ahora busca la Runa Lunar'
          : sequence.done === 2
            ? 'MECANISMO DESBLOQUEADO'
            : 'Interactúa con las runas desde cerca; no necesitan recibir daño.'
        : state.scenarioId === 'w3_e01' && view.objects.some(o=>o.kind==='GATE' && o.state==='OPEN')
          ? 'ACCESO ABIERTO · Cruza el portón'
          : state.scenarioId === 'w3_e02' && view.objects.filter(o=>o.kind==='BRIDGE').every(o=>o.state==='LOWERED')
            ? 'PUENTE ESTABLE · Cruza el puente'
            : state.scenarioId === 'w3_e04' ? 'Alcanza la salida'
              : state.scenarioId === 'w3_e08' ? sectionHint(view) : '';
  return {
    ...intro,
    hudHint: HUD_HINTS[state.scenarioId] ?? intro.introHint,
    mechanismLegend: [...new Set(view.objects.map((o) => o.kind))].map((kind) => ({
      kind,
      ...MECHANISM_LEGEND[kind],
    })),
    progressLabel,
    progressCurrent: seals.length ? progress : (sequence?.done ?? 0),
    progressTotal: seals.length || sequence?.total || 0,
    contextualHint,
    guardian: guardian
      ? {
          plate: view.objects.find((o) => o.kind === 'PRESSURE_PLATE')?.visualState === 'active',
          lever: view.objects.find((o) => o.id === (view.rings[0]?.live ?? 'lever'))?.state === 'ON',
          exposed: guardian.state === 'EXPOSED',
        }
      : null,
  };
}
/** Name of the live control of the first CYCLE ring (XXV levers, XXX keys). */
function liveLabel(view: NonNullable<ReturnType<typeof mechanismView>>): string {
  const live = view.rings[0]?.live;
  return view.objects.find((o) => o.id === live)?.label ?? live ?? '';
}
/** Telegraph line for the board's next scheduled change (XXX: the Architect). Empty when none. */
export function boardChangeHint(view: NonNullable<ReturnType<typeof mechanismView>>, round: number): string {
  const next = view.scheduled[0];
  if (!next?.label) return '';
  const when = next.round === round ? 'al final de esta ronda' : next.round === round + 1 ? 'al final de la próxima ronda' : `al final de la ronda ${next.round}`;
  return `AVISO · ${next.label} ${when}`;
}
/** XXVIII: where the section points now (the board shows the rest). */
function sectionHint(view: NonNullable<ReturnType<typeof mechanismView>>): string {
  const region = view.objects.find((o) => o.region)?.region;
  return region ? `SECCIÓN A ${region.orientation}° · Puedes girarla las veces que quieras en tu turno` : '';
}
export const MECHANISM_LEGEND = {
  PRESSURE_PLATE: { name: 'PLACA', hint: 'Mantén peso encima' },
  SWITCH: { name: 'PALANCA / RUNA', hint: 'Activa desde al lado' },
  STATUE: { name: 'ESTATUA', hint: 'Empuja desde el lado opuesto' },
  RELIC: { name: 'RELIQUIA', hint: 'Recoge y extrae' },
  GATE: { name: 'PORTÓN', hint: 'Abre con su mecanismo' },
  BRIDGE: { name: 'PUENTE', hint: 'Mantén su placa activa' },
  PLATFORM: { name: 'PLATAFORMA', hint: 'Viaja y alinea con la palanca' },
  TRAP: { name: 'PELIGRO', hint: 'Evita la runa armada' },
  REGION: { name: 'SECCIÓN GIRATORIA', hint: 'Gira 90° con todo lo que lleva encima' },
} as const;
export function mechanismHint(o: MechanismVisual): string {
  if (o.kind === 'PRESSURE_PLATE') return 'Actívala manteniendo peso encima.';
  if (o.kind === 'STATUE') return 'Empújala desde el lado opuesto al destino.';
  if (o.kind === 'RELIC')
    return o.state === 'CARRIED'
      ? 'Llévala al sello de entrada y asegúrala.'
      : 'Recógela desde una casilla adyacente.';
  if (o.kind === 'SWITCH') return 'Interactúa desde una casilla adyacente.';
  if (o.kind === 'TRAP') return 'Runa de peligro: evita pisarla cuando esté armada.';
  if (o.kind === 'PLATFORM') return 'Viaja encima; la controla su palanca vinculada.';
  if (o.kind === 'REGION') return 'Gira 90° con su control: suelo, muros y quien esté encima giran con ella.';
  return 'Un mecanismo vinculado controla este paso.';
}
export const PUZZLE_SOUND_HOOKS: Record<string, string> = {
  GATE_OPENED: 'DOOR_OPEN',
  BRIDGE_LOWERED: 'BRIDGE_LOWER',
  PLATE_PRESSED: 'SEAL_ACTIVATE',
  PLATFORM_MOVED: 'PLATFORM_MOVE',
  GUARDIAN_EXPOSED: 'GUARDIAN_EXPOSED',
  SEQUENCE_PROGRESS: 'RUNE_CORRECT',
  SEQUENCE_RESET: 'RUNE_RESET',
  RELIC_PICKED_UP: 'RELIC_PICKUP',
};

/** Audio consumers can subscribe to these cues; this pass never plays or synthesizes audio. */
export const PUZZLE_AUDIO_CUES = [
  'GATE_UNLOCK',
  'GATE_OPEN',
  'BRIDGE_LOWER',
  'SEAL_ACTIVATE',
  'SEALS_COMPLETE',
  'PLATFORM_MOVE',
  'PLATFORM_LOCK',
  'GUARDIAN_EXPOSED',
  'RUNE_CORRECT',
  'RUNE_RESET',
  'RELIC_PICKUP',
  'TEMPLE_REACT',
] as const;

export function puzzleSoundHooks(
  events: readonly GameEvent[],
  state: Readonly<GameState>,
): string[] {
  const hooks = new Set<string>();
  const aliases: Record<string, string> = {
    GATE_OPENED: 'GATE_OPEN',
    BRIDGE_LOWERED: 'BRIDGE_LOWER',
    PLATE_PRESSED: 'SEAL_ACTIVATE',
    PLATFORM_MOVED: 'PLATFORM_MOVE',
    GUARDIAN_EXPOSED: 'GUARDIAN_EXPOSED',
    SEQUENCE_PROGRESS: 'RUNE_CORRECT',
    SEQUENCE_RESET: 'RUNE_RESET',
    RELIC_PICKED_UP: 'RELIC_PICKUP',
  };
  for (const event of events) {
    if (event.type !== 'MECHANISM_CHANGED' && event.type !== 'GUARDIAN_STATE') continue;
    const cue = event.cue;
    if (aliases[cue]) hooks.add(aliases[cue]!);
    if (cue === 'GATE_OPENED') hooks.add('GATE_UNLOCK');
    if (cue === 'PLATFORM_MOVED') hooks.add('PLATFORM_LOCK');
    if (cue === 'RELIC_PICKED_UP') hooks.add('TEMPLE_REACT');
  }
  const puzzle = puzzlePresentation(state);
  if (
    hooks.has('SEAL_ACTIVATE') &&
    puzzle?.progressLabel === 'SELLOS ACTIVOS' &&
    puzzle.progressCurrent === puzzle.progressTotal
  )
    hooks.add('SEALS_COMPLETE');
  return [...hooks];
}
