import type { GameEvent, GameState } from '../../game';
import type { MechanismView, MechanismVisual } from '../../game/domain/mechanisms/mechanism-view';
import { interactionLabel } from './interactionPresentation';
/** Visual variants only; engine metadata continues to own actions and state. */
export function templeArt(object: MechanismVisual): string {
  if (object.id === 'rune-sun') return 'rune-sun';
  if (object.id === 'rune-moon') return 'rune-moon';
  if (object.extraction) return 'relic-lost';
  return (
    (
      {
        PLATFORM: 'platform',
        SWITCH: 'switch',
        PRESSURE_PLATE: 'plate',
        GATE: 'gate',
        BRIDGE: 'bridge',
        STATUE: 'statue',
        RELIC: 'relic',
        TRAP: 'trap',
      } as Record<string, string>
    )[object.kind] ?? 'switch'
  );
}
export function phase2ActionLabel(verb: string, id: string, view: MechanismView) {
  const object = view.objects.find((o) => o.id === id);
  if (object?.kind === 'RELIC')
    return (
      (
        {
          RECOGER: 'RECOGER RELIQUIA',
          SOLTAR: 'SOLTAR RELIQUIA',
          ASEGURAR: 'ASEGURAR RELIQUIA',
        } as Record<string, string>
      )[verb] ?? interactionLabel(verb)
    );
  if (view.links.some((l) => l.from === id && view.objects.some((o) => o.id === l.to && o.kind === 'REGION')))
    return object?.label?.includes('↺') ? 'GIRAR ↺ SECCIÓN' : object?.label?.includes('↻') ? 'GIRAR ↻ SECCIÓN' : 'GIRAR SECCIÓN';
  if (verb === 'RESTABLECER' && object?.label?.toLocaleLowerCase().includes('cámara'))
    return 'REINICIAR CÁMARA';
  if (
    view.links.some(
      (l) => l.from === id && view.objects.some((o) => o.id === l.to && o.kind === 'PLATFORM'),
    )
  )
    return 'LLAMAR PLATAFORMA';
  return interactionLabel(verb);
}
export function guardianLabel(
  state: Readonly<GameState>,
  guardian: MechanismView['guardians'][number],
) {
  const remaining = Math.max(0, (guardian.untilRound ?? state.round) - state.round + 1);
  return guardian.state === 'EXPOSED'
    ? `NÚCLEO EXPUESTO · ${remaining} ${remaining === 1 ? 'TURNO' : 'TURNOS'}`
    : 'BLINDADO · −2 daño';
}
export function stagePresentation(state: Readonly<GameState>) {
  const staged = state.objectives.find(
    (o) => o.def.type === 'MECHANISM' && o.def.goal === 'STAGES',
  );
  if (!staged || staged.def.type !== 'MECHANISM') return null;
  const stages = staged.def.stages ?? [];
  const done = Math.min(stages.length, staged.current);
  return { done, total: stages.length, label: stages[done]?.label ?? 'Reliquia asegurada' };
}
export const PLATFORM_PRESENTATION_MS = 700;
export function platformProgress(elapsed: number, reduced: boolean) {
  return reduced
    ? 1
    : 1 - Math.pow(1 - Math.max(0, Math.min(1, elapsed / PLATFORM_PRESENTATION_MS)), 3);
}
export function sequencePresentation(state: Readonly<GameState>){
  const board=state.mechanisms,rule=board?.rules.find(r=>r.trigger.type==='ON_SEQUENCE');
  if(!board||!rule)return null;
  const sources=rule.trigger.sources??[];
  return {done:board.fired.includes(rule.id)?sources.length:board.sequences?.[rule.id]??0,total:sources.length};
}

/** Concise authoritative cascade feedback, independent of animation durations. */
export function phase2Feedback(events: readonly GameEvent[]): string | null {
  const mechanisms = events.filter(e => e.type === 'MECHANISM_CHANGED');
  if (mechanisms.some(e => e.cue === 'CONTROL_RELOCATED')) return 'NUEVO CONTROL ACTIVADO';
  if (mechanisms.some(e => e.cue === 'RELIC_EXTRACTED')) return 'RELIQUIA ASEGURADA';
  if (mechanisms.some(e => e.cue === 'RELIC_PICKED_UP')) return 'EL TEMPLO DESPIERTA · Busca el paso lateral';
  if (mechanisms.some(e => e.cue === 'SEQUENCE_RESET')) return 'RESONANCIA INTERRUMPIDA';
  if (mechanisms.some(e => e.cue === 'SEQUENCE_PROGRESS'))
    return mechanisms.some(e => e.cue === 'GATE_OPENED') ? 'MECANISMO DESBLOQUEADO' : 'SOL DESPIERTO · 1 / 2';
  if (mechanisms.some(e => e.cue === 'PLATFORM_BLOCKED')) return 'CAMINO BLOQUEADO';
  if (mechanisms.some(e => e.cue === 'SECTION_ROTATION_BLOCKED')) return 'LA SECCIÓN NO PUEDE GIRAR';
  const turned = mechanisms.filter(e => e.cue === 'SECTION_ROTATED').at(-1);
  if (turned?.rotation) return `SECCIÓN GIRADA · ${turned.rotation.to}°`;
  if (mechanisms.some(e => e.cue === 'MECHANISM_RESET')) return 'MECANISMO RESTABLECIDO';
  if (mechanisms.some(e => e.cue === 'BRIDGE_LOWERED')) return 'CRUCE CONSTRUIDO · Mantén el peso sobre la placa';
  if (mechanisms.some(e => e.cue === 'BRIDGE_RAISED')) return 'EL PUENTE SE ELEVA · Falta peso en la placa';
  if (mechanisms.some(e => e.cue === 'GATE_OPENED')) return 'ACCESO ABIERTO';
  if (mechanisms.some(e => e.cue === 'PLATFORM_MOVED')) return 'PLATAFORMA EN POSICIÓN';
  return null;
}
