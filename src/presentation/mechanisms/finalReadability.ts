import type { GameState } from '../../game';
import type { MechanismView, MechanismVisual } from '../../game/domain/mechanisms/mechanism-view';
/** Presentation derived from the displayed snapshot, never future authoritative state. */
export function guardianWindow(state: Readonly<GameState>, view: MechanismView) {
  const g = view.guardians[0];
  if (!g) return null;
  const exposed = g.state === 'EXPOSED';
  const remaining = exposed ? Math.max(0, (g.untilRound ?? state.round) - state.round + 1) : 0;
  const control = view.objects.find((o) => o.id === view.rings[0]?.live);
  return {
    exposed,
    remaining,
    closing: exposed && remaining <= 1,
    control: control?.label ?? '',
    title: exposed ? 'NÚCLEO EXPUESTO' : 'NÚCLEO BLINDADO',
    instruction: exposed
      ? remaining <= 1
        ? 'Última ventana · ataca antes del cierre'
        : 'Ataca el núcleo durante esta ventana'
      : control
        ? `Busca ${control.label ?? 'el control encendido'}`
        : 'Mantén peso y activa la palanca',
  };
}
export function mechanismCallout(o: MechanismVisual, view: MechanismView): string | null {
  if (o.kind === 'STATUE') return '↓ Empuja';
  if (o.kind === 'PRESSURE_PLATE') return '↓ Mantén peso';
  if (o.kind === 'RELIC') return '✧ Alcanza la reliquia';
  if (o.kind !== 'SWITCH' || !o.interactable || o.visualState === 'locked') return null;
  if (
    view.links.some(
      (l) => l.from === o.id && view.objects.some((t) => t.id === l.to && t.kind === 'REGION'),
    )
  )
    return `${o.label?.includes('↺') ? '↺' : '↻'} Selecciona para prever el giro`;
  return '↓ Activa';
}
