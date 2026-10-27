import type { GameEngine } from '../../game';
export const mechanismNames: Record<string, string> = {
  SWITCH: 'Interruptor',
  PRESSURE_PLATE: 'Placa',
  GATE: 'Puerta',
  BRIDGE: 'Puente',
  STATUE: 'Estatua',
  RELIC: 'Reliquia',
  TRAP: 'Trampa',
  PLATFORM: 'Plataforma',
  REGION: 'Sección giratoria',
};
export function interactionPresentation(engine: GameEngine, selected: string | null) {
  const view = engine.getMechanismView();
  if (!view) return null;
  const adjacent = engine.getInteractions().filter((o) => o.adjacent);
  return {
    view,
    options:
      selected && view.objects.some((o) => o.id === selected && o.interactable)
        ? adjacent.filter((o) => o.mechanismId === selected)
        : adjacent,
    used: engine.state.mechanisms?.interactedRound === engine.state.round,
  };
}
export const interactionLabel = (verb: string) =>
  verb === 'RESTABLECER' ? 'REINICIAR MECANISMO' : verb;

/** Translate state without inferring any rules in presentation. */
export const mechanismStateLabel = (state: string) =>
  ({
    OFF: 'Inactivo',
    ON: 'Activado',
    IDLE: 'En reposo',
    PRESSED: 'Presionada',
    CLOSED: 'Cerrada',
    OPEN: 'Abierta',
    RAISED: 'Elevado',
    LOWERED: 'Descendido',
    COLLECTED: 'Recogida',
    CARRIED: 'Portada',
    DROPPED: 'En el suelo',
    EXTRACTED: 'Asegurada',
    AVAILABLE: 'Disponible',
    ENABLED: 'Armada',
    DISABLED: 'Desactivada',
    ORIENTATION_0: 'Orientación 0°',
    ORIENTATION_90: 'Orientación 90°',
    ORIENTATION_180: 'Orientación 180°',
    ORIENTATION_270: 'Orientación 270°',
  })[state] ?? state;
