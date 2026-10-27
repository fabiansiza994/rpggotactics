import victories from '../../../../tests/fixtures/act3-victories.json';
import {
  GameEngine,
  DEFAULT_CONTENT,
  encounterFor,
  type Command,
  type GameState,
} from '../../../game';
import { TEMPLE_CAMPAIGN } from '../../../game/data/temple-encounters';
import { mechanismView } from '../../../game/domain/mechanisms/mechanism-view';
export const VISUAL_CHECKPOINTS = [
  { id: 'gate', encounter: 'w3_e01', label: 'XXI · Umbral abierto' },
  { id: 'bridge', encounter: 'w3_e02', label: 'XXII · Puente bajado' },
  { id: 'seals2', encounter: 'w3_e03', label: 'XXIII · Dos sellos' },
  { id: 'seals3', encounter: 'w3_e03', label: 'XXIII · Tres sellos' },
  { id: 'platform', encounter: 'w3_e04', label: 'XXIV · Plataforma en marcha' },
  { id: 'relic', encounter: 'w3_e06', label: 'XXVI · Reliquia recogida' },
  { id: 'extract', encounter: 'w3_e06', label: 'XXVI · Extracción' },
] as const;
function reached(id: string, state: Readonly<GameState>) {
  const view = mechanismView(state)!;
  if (id === 'gate')
    return (
      view.objects.some((o) => o.kind === 'GATE' && o.state === 'OPEN') &&
      state.units.some((u) => u.faction === 'PLAYER' && u.pos.x === 5 && u.pos.y === 2)
    );
  if (id === 'bridge')
    return view.objects.some((o) => o.kind === 'BRIDGE' && o.state === 'LOWERED');
  if (id.startsWith('seals'))
    return (
      view.objects.filter(
        (o) =>
          o.id.startsWith('seal-') && (o.visualState === 'active' || o.visualState === 'locked'),
      ).length === Number(id.slice(-1))
    );
  if (id === 'platform')
    return view.objects.some((o) => o.id === 'platform-a' && o.stop === 'near');
  if (id === 'relic') return view.objects.some((o) => o.kind === 'RELIC' && o.state === 'CARRIED');
  return view.objects.some((o) => o.kind === 'RELIC' && o.state === 'EXTRACTED');
}
/** Explicit QA fixture replay: no snapshots, mutations, alternate seeds or production entry point. */
export function visualCheckpoint(id: string) {
  const checkpoint = VISUAL_CHECKPOINTS.find((c) => c.id === id);
  if (!checkpoint) return null;
  for (const run of victories.filter(
    (r) => r.encounterId === checkpoint.encounter && r.heroId === 'mage',
  )) {
    const engine = new GameEngine(
      encounterFor(TEMPLE_CAMPAIGN, run.encounterId, 'mage'),
      DEFAULT_CONTENT,
      run.seed,
    );
    const commands: Command[] = [];
    for (const command of run.commands as Command[]) {
      if (!engine.dispatch(command).ok) break;
      commands.push(command);
      if (
        id === 'gate' &&
        mechanismView(engine.state)!.objects.some((o) => o.kind === 'GATE' && o.state === 'OPEN')
      ) {
        const probe = new GameEngine(engine.scenario, DEFAULT_CONTENT, run.seed);
        for (const prior of commands) probe.dispatch(prior);
        const move: Command = { type: 'MOVE_UNIT', unitId: probe.heroId, to: { x: 5, y: 2 } };
        if (probe.dispatch(move).ok)
          return {
            hero: 'mage',
            encounter: run.encounterId,
            seed: run.seed,
            commands: [...commands, move],
          };
      }
      if (reached(id, engine.state))
        return { hero: 'mage', encounter: run.encounterId, seed: run.seed, commands };
    }
  }
  return null;
}
