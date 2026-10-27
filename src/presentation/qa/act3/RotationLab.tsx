import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CONTENT, GameEngine, type GameState, type Pos } from '../../../game';
import { withArcher } from '../../../game/data/archer';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN } from '../../../game/data/temple-encounters';
import type { Orientation } from '../../../game/domain/mechanisms/mechanism';
import { orientationOf } from '../../../game/domain/mechanisms/mechanism-transform';
import { useBattleStore } from '../../store/battleStore';
import { visualSettings } from '../../vfx/visualSettings';
import { presentationBus } from '../../events/presentationBus';
import { BoardView } from '../../react/components/BoardView';
import { HandBar } from '../../react/components/Hud';
import { objectiveLabel } from '../../react/format';
import { InteractionPanel } from '../../mechanisms/InteractionPanel';
import { applyLabOp, inspectGrid, rebuildLab, sameBoard, SECTION_ID, type LabOp, type LabSave, type LabStep } from './rotationLabOps';
import '../../../styles/act3-rotation-lab.css';

const KEY = 'rpggo:act3-rotation-lab:v1';
const content = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const EXIT: Pos = { x: 10, y: 3 };
const ENEMIES = ['orc_warrior', 'shadow_wolf', 'dark_shaman', 'stone_brute'];
const SUMMONS = Object.keys(content.summons ?? {}).slice(0, 8);

/** DEV lab: ACT III — ROTATING BOARD LAB (XXVIII «El Laberinto Vivo»). */
export default function RotationLab() {
  const [hero, setHero] = useState('mage');
  const [seed] = useState(308);
  const [generation, setGeneration] = useState(0);
  const [inspect, setInspect] = useState('');
  const [at, setAt] = useState<Pos>({ x: 4, y: 5 });
  const [enemyId, setEnemyId] = useState(ENEMIES[0]!);
  const [summonId, setSummonId] = useState(SUMMONS[0] ?? 'fox');
  const [verdict, setVerdict] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const steps = useRef<LabStep[]>([]);
  const ids = useRef({ next: 1 });
  const unsubscribe = useRef<() => void>(() => {});
  const engine = useBattleStore((s) => s.engine),
    state = useBattleStore((s) => s.state),
    busy = useBattleStore((s) => s.playbackBusy);

  const persist = useCallback((h: string) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ hero: h, seed, steps: steps.current } satisfies LabSave));
    } catch {
      /* QA storage unavailable: the lab stays usable. */
    }
  }, [seed]);

  /** Puts `e` in the battle store and records every accepted command as a lab step. */
  const install = useCallback(
    (e: GameEngine, h: string, record = true) => {
      unsubscribe.current();
      useBattleStore.setState({
        engine: e,
        state: e.state,
        selectedCardUid: null,
        aim: null,
        introLocked: false,
        handDiscard: null,
        onlineCommand: null,
        notice: null,
      });
      unsubscribe.current = e.subscribe((events, next) => {
        const command = e.history.at(-1);
        if (record && command) steps.current.push({ command });
        setStepCount(steps.current.length);
        useBattleStore.setState({ state: next });
        presentationBus.publish(events, next);
        persist(h);
      });
    },
    [persist],
  );

  useEffect(() => {
    steps.current = [];
    ids.current = { next: 1 };
    const { engine: e } = rebuildLab(content, { hero, seed, steps: [] });
    install(e, hero);
    useBattleStore.setState({ selectedMechanismId: null, playbackBusy: false });
    return () => unsubscribe.current();
  }, [hero, seed, generation, install]);

  if (!engine || !state) return <p>Cargando laboratorio…</p>;
  const live = engine;
  /** New session (hero change or restart): the recorded steps start over. */
  const restart = (nextHero = hero) => {
    setVerdict('');
    setStepCount(0);
    if (nextHero !== hero) setHero(nextHero);
    else setGeneration((v) => v + 1);
  };

  const runOp = (op: LabOp) => {
    const next = applyLabOp(live, op, ids.current);
    if (!next) return setVerdict('Operación QA rechazada (destino ocupado o sin efecto).');
    steps.current.push({ op });
    setStepCount(steps.current.length);
    const e = GameEngine.fromSnapshot(next.state, live.content, live.scenario);
    install(e, hero);
    presentationBus.publish(next.events, next.state);
    persist(hero);
    setVerdict(next.events.some((x) => x.type === 'MECHANISM_CHANGED' && x.cue === 'SECTION_ROTATION_BLOCKED') ? 'SECTION_ROTATION_BLOCKED' : '');
  };

  const verifyReplay = () => {
    const { engine: rebuilt, failedAt } = rebuildLab(content, { hero, seed, steps: steps.current });
    setVerdict(failedAt !== null ? `REPLAY ✗ · paso ${failedAt} rechazado` : sameBoard(rebuilt.state, live.state) ? `REPLAY ✓ · ${steps.current.length} pasos, estado idéntico` : 'REPLAY ✗ · el estado difiere');
  };

  const reconnect = () => {
    const snapshot = JSON.parse(JSON.stringify(live.state)) as GameState;
    const e = GameEngine.fromSnapshot(snapshot, live.content, live.scenario);
    install(e, hero);
    useBattleStore.setState({ state: e.state });
    setVerdict(sameBoard(e.state, live.state) ? `RECONEXIÓN ✓ · orientación ${orientationOf(e.state.mechanisms?.objects.find((o) => o.def.id === SECTION_ID)?.state)}°` : 'RECONEXIÓN ✗');
  };

  /** Visual replay: restart the session and re-run every step, waiting for each animation. */
  const playback = async () => {
    const all = [...steps.current];
    setReplaying(true);
    steps.current = [];
    ids.current = { next: 1 };
    let e = rebuildLab(content, { hero, seed, steps: [] }).engine;
    install(e, hero);
    for (const step of all) {
      await new Promise((r) => setTimeout(r, 450));
      while (useBattleStore.getState().playbackBusy) await new Promise((r) => setTimeout(r, 60));
      if ('command' in step) e.dispatch(step.command);
      else {
        const next = applyLabOp(e, step.op, ids.current);
        if (!next) break;
        steps.current.push(step);
        setStepCount(steps.current.length);
        e = GameEngine.fromSnapshot(next.state, e.content, e.scenario);
        install(e, hero);
        presentationBus.publish(next.events, next.state);
      }
    }
    setReplaying(false);
    setVerdict(`REPRODUCCIÓN COMPLETA · ${all.length} pasos`);
  };

  const section = state.mechanisms?.objects.find((o) => o.def.id === SECTION_ID);
  const orientation = orientationOf(section?.state);
  const target = state.units.find((u) => u.id === inspect) ?? state.units.find((u) => u.id === state.player.heroId);
  const goal = target?.faction === 'ENEMY' ? (state.units.find((u) => u.id === state.player.heroId)?.pos ?? EXIT) : EXIT;
  const grid = target ? inspectGrid(live, target.id, goal) : null;
  const disabled = busy || replaying;

  return (
    <main className="battle act3-qa act3-rotation-lab">
      <header className="act3-nav">
        <strong>ACT III — ROTATING BOARD LAB</strong>
        <select aria-label="Campeón QA" value={hero} disabled={disabled} onChange={(e) => restart(e.target.value)}>
          {TEMPLE_CAMPAIGN.heroIds.map((id) => (
            <option key={id} value={id}>
              {content.heroes[id]?.name ?? id}
            </option>
          ))}
        </select>
        <button disabled={disabled} onClick={() => restart()}>
          Reiniciar
        </button>
        <label>
          Orientación
          <select aria-label="Orientación de la sección" value={orientation} disabled={disabled} onChange={(e) => runOp({ type: 'ORIENT', to: Number(e.target.value) as Orientation })}>
            {[0, 90, 180, 270].map((o) => (
              <option key={o} value={o}>
                {o}°
              </option>
            ))}
          </select>
        </label>
        <button disabled={disabled} onClick={() => runOp({ type: 'ROTATE', turns: 1 })}>
          Girar ↻
        </button>
        <button disabled={disabled} onClick={() => runOp({ type: 'ROTATE', turns: -1 })}>
          Girar ↺
        </button>
        <button disabled={disabled} onClick={() => useBattleStore.getState().selectMechanism('lever')}>
          Vista previa palanca
        </button>
        <button disabled={disabled} onClick={() => useBattleStore.getState().selectMechanism('console')}>
          Vista previa consola
        </button>
        <label>
          Cámara
          <select aria-label="Cámara lenta" defaultValue="1" onChange={(e) => (visualSettings.timeScale = Number(e.target.value))}>
            <option value="1">×1</option>
            <option value="0.25">×¼</option>
            <option value="0.1">×⅒</option>
          </select>
        </label>
        <button disabled={disabled} onClick={verifyReplay}>
          Verificar replay
        </button>
        <button disabled={disabled || !stepCount} onClick={() => void playback()}>
          Reproducir sesión
        </button>
        <button disabled={disabled} onClick={reconnect}>
          Simular reconexión
        </button>
        <button disabled={disabled || !!state.outcome} onClick={() => useBattleStore.getState().endTurn()}>
          Finalizar turno
        </button>
      </header>
      <BoardView key={`rotation:${hero}:${generation}`} focusedEnemyId={null} />
      <div className="act3-objective">
        {state.objectives.map((o, i) => {
          const l = objectiveLabel(o, state);
          return (
            <div key={i}>
              {l.title} · {l.progress}
            </div>
          );
        })}
      </div>
      <details className="rotation-lab-tools" open={typeof window !== 'undefined' && window.innerHeight > 600}>
        <summary>QA · sección {orientation}°</summary>
        <fieldset>
          <legend>Colocar en</legend>
          <label>
            x
            <input type="number" min={0} max={state.board.width - 1} value={at.x} onChange={(e) => setAt({ ...at, x: Number(e.target.value) })} />
          </label>
          <label>
            y
            <input type="number" min={0} max={state.board.height - 1} value={at.y} onChange={(e) => setAt({ ...at, y: Number(e.target.value) })} />
          </label>
          <button disabled={disabled} onClick={() => runOp({ type: 'PLACE_CHAMPION', at })}>
            Campeón aquí
          </button>
          <span className="rotation-lab-row">
            <select aria-label="Invocación QA" value={summonId} onChange={(e) => setSummonId(e.target.value)}>
              {SUMMONS.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
            <button disabled={disabled} onClick={() => runOp({ type: 'SPAWN_SUMMON', summonId, at })}>
              Invocar
            </button>
          </span>
          <span className="rotation-lab-row">
            <select aria-label="Enemigo QA" value={enemyId} onChange={(e) => setEnemyId(e.target.value)}>
              {ENEMIES.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
            <button disabled={disabled} onClick={() => runOp({ type: 'SPAWN_ENEMY', enemyId, at })}>
              Enemigo
            </button>
          </span>
        </fieldset>
        <fieldset>
          <legend>Pathfinding</legend>
          <select aria-label="Unidad inspeccionada" value={target?.id ?? ''} onChange={(e) => setInspect(e.target.value)}>
            {state.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id}
              </option>
            ))}
          </select>
          <div className="rotation-lab-grid" style={{ gridTemplateColumns: `repeat(${state.board.width}, 1fr)` }} aria-label="Mapa de alcance">
            {grid?.cells.map((c) => (
              <span
                key={`${c.pos.x},${c.pos.y}`}
                data-kind={c.kind}
                data-reach={c.reachable || undefined}
                data-path={c.onPath || undefined}
                data-section={c.inSection || undefined}
                data-faction={c.unit?.faction}
                title={`(${c.pos.x},${c.pos.y})`}
              >
                {c.unit?.letter ?? (c.kind === 'exit' ? '⇥' : '')}
              </span>
            ))}
          </div>
          <small>
            {target?.faction === 'ENEMY' ? 'Ruta al campeón' : 'Ruta a la salida'}: {grid?.pathLength != null ? `${grid.pathLength} casillas` : 'NO EXISTE en esta orientación'}
          </small>
        </fieldset>
        <small className="rotation-lab-steps">
          {stepCount} pasos grabados {verdict && `· ${verdict}`}
        </small>
      </details>
      <InteractionPanel key={`rotation-panel:${hero}:${generation}`} />
      <div className="act3-status">
        {content.heroes[hero]?.name} · Ronda {state.round} · EN {state.player.energy} · MP {state.player.movePoints}
        {state.outcome && ` · ${state.outcome.result}`}
      </div>
      <HandBar state={state} engine={live} />
    </main>
  );
}
