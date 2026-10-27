import { counterFeedback, type CounterCase } from './counterFeedback';
import { useEffect, useRef, useState } from 'react';
import { BattleCanvas } from '../../pixi/BattleCanvas';
import { DEFAULT_CONTENT } from '../../../game';
import { alignedDirection } from '../../../game/domain/core/position';
import {
  showcaseState,
  showcaseModel,
  showcaseRoute,
  showcaseDirectionalRoute,
  showcaseTurnRoute,
  SHOWCASE_UNIT,
} from './showcase';
import type { GameState } from '../../../game';
import './locomotion-lab.css';

/** Loopback/dev route only. Uses the actual Pixi board, views, event director and GridWalk. */
export default function SummonerLocomotionLab() {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<BattleCanvas | null>(null),
    state = useRef<GameState | null>(null);
  const [counterCase, setCounterCase] = useState<CounterCase>('single');
  const [reactionReadout, setReactionReadout] = useState('');
  const [id, setId] = useState<string>(location.pathname === '/golem-cycles-qa' ? 'pact_golem' : 'chicken');
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [reduced, setReduced] = useState(false),
    [slow, setSlow] = useState(false),
    [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState('idle'),
    [error, setError] = useState('');
  useEffect(() => {
    if (!host.current) return;
    let alive = true;
    const board = new BattleCanvas({
      onTileHover: () => {},
      onTileClick: () => {},
      onTileTap: () => {},
      onCancel: () => {},
      onPlaybackChange: (value) => {
        if (alive) setBusy(value);
      },
      onHandPulse: () => {},
      introVariant: () => 'QUICK',
      onIntroBeat: () => {},
      onTurnBanner: () => {},
    });
    canvas.current = board;
    void board
      .mount(host.current)
      .then(() => {
        if (alive) setReady(true);
      })
      .catch(() => {
        if (alive) setError('No se pudo cargar el tablero QA.');
      });
    const timer = window.setInterval(() => {
      if (!alive) return;
      const s = board.qaAnimationSnapshot(SHOWCASE_UNIT);
      const visual = board.qaPresentationSnapshot();
      if (visual) setReactionReadout(visual.units.map(u => `${u.name}: HP ${u.hp} · escudo ${u.shield}`).join(' | '));
      if (s) setSnapshot(`${s.motion} · frame ${s.frame + 1} · ${s.horizontalFacing ?? s.facing}`);
    }, 100);
    return () => {
      alive = false;
      window.clearInterval(timer);
      board.destroy();
      canvas.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !canvas.current) return;
    state.current = showcaseState(id);
    canvas.current.render(showcaseModel(state.current));
  }, [id, ready]);
  // Same reduced-effects switch used by the real board; restored when the inspector unmounts.
  useEffect(() => {
    let active = true,
      restore: (() => void) | undefined;
    void import('../../vfx/visualSettings').then(({ visualSettings }) => {
      if (!active) return;
      const before = visualSettings.reducedEffects;
      visualSettings.reducedEffects = reduced;
      restore = () => {
        visualSettings.reducedEffects = before;
      };
    });
    return () => {
      active = false;
      restore?.();
    };
  }, [reduced]);
  useEffect(() => {
    let active = true,
      restore: (() => void) | undefined;
    void import('../../vfx/visualSettings').then(({ visualSettings }) => {
      if (!active) return;
      const previous = visualSettings.timeScale;
      visualSettings.timeScale = slow ? 0.25 : 1;
      restore = () => {
        visualSettings.timeScale = previous;
      };
    });
    return () => {
      active = false;
      restore?.();
    };
  }, [slow]);
  useEffect(() => {
    canvas.current?.qaPauseFrame(paused);
  }, [paused, ready]);
  function pose(motion: 'idle' | 'attack' | 'hit' | 'death') {
    if (!canvas.current || !ready || busy) return;
    if (motion === 'idle') {
      const next = showcaseState(id);
      canvas.current.render(showcaseModel({ ...next, units: [] }));
      canvas.current.render(showcaseModel(next));
      state.current = next;
    } else {
      const played = canvas.current.qaPlayCharacterAnimation(SHOWCASE_UNIT, motion, 90);
      if (!played && motion === 'attack')
        canvas.current.qaPlayCharacterAnimation(SHOWCASE_UNIT, 'cast', 90);
    }
  }
  function travel(steps: 2 | 3, direction: 1 | -1) {
    if (!ready || busy || !canvas.current) return;
    const before = state.current ? structuredClone(state.current) : showcaseState(id);
    const previous = before.units[0]!.pos;
    const endX = previous.x + steps * direction;
    const start = endX >= 0 && endX < before.board.width ? previous : undefined;
    const route = showcaseRoute(steps, direction, start);
    before.units[0]!.pos = route.from;
    canvas.current.render(showcaseModel(before));
    const after = structuredClone(before);
    after.units[0]!.pos = route.to;
    after.units[0]!.combatFacing =
      alignedDirection(
        route.path.length > 1 ? route.path[route.path.length - 2]! : route.from,
        route.to,
      ) ?? undefined;
    state.current = after;
    canvas.current.playEvents(
      [{ type: 'UNIT_MOVED', unitId: SHOWCASE_UNIT, ...route, cost: steps, mode: 'WALK' }],
      after,
    );
  }
  function directionalTravel(steps: 2 | 3, direction: 'up' | 'down' | 'left' | 'right' | 'turn') {
    if (!ready || busy || !canvas.current) return;
    const route =
      direction === 'turn' ? showcaseTurnRoute() : showcaseDirectionalRoute(steps, direction);
    const before = showcaseState(id);
    before.units[0]!.pos = route.from;
    canvas.current.render(showcaseModel(before));
    const after = structuredClone(before);
    after.units[0]!.pos = route.to;
    after.units[0]!.combatFacing =
      alignedDirection(
        route.path.length > 1 ? route.path[route.path.length - 2]! : route.from,
        route.to,
      ) ?? undefined;
    state.current = after;
    canvas.current.playEvents(
      [
        {
          type: 'UNIT_MOVED',
          unitId: SHOWCASE_UNIT,
          ...route,
          cost: route.path.length,
          mode: 'WALK',
        },
      ],
      after,
    );
  }
  function archerShot(direction: 'left'|'right'|'up'|'down') {
    if (!ready || busy || !canvas.current || id !== 'qa_archer') return;
    const next=showcaseState(id);
    const source=next.units[0]!;
    source.pos={x:3,y:2};
    const delta={left:{x:-2,y:0},right:{x:2,y:0},up:{x:0,y:-2},down:{x:0,y:2}}[direction];
    next.units.push({...structuredClone(source),id:'qa-archer-target',defId:'orc_warrior',
      kind:'ENEMY',name:'Blanco visual',pos:{x:source.pos.x+delta.x,y:source.pos.y+delta.y}});
    state.current=next;
    canvas.current.render(showcaseModel({...next,units:[]}));
    canvas.current.render(showcaseModel(next));
    canvas.current.qaArcherShot(SHOWCASE_UNIT,'qa-archer-target');
  }
  function reaction() {
    if (!ready || busy || !canvas.current) return;
    const fixture = counterFeedback(id === 'qa_form_minotaur' ? 'minotaur' : 'bear', counterCase);
    canvas.current.render(showcaseModel({ ...fixture.before, units: [] }));
    canvas.current.render(showcaseModel(fixture.before));
    state.current = fixture.after;
    canvas.current.playEvents(fixture.events, fixture.after);
  }
  const specimens = {
    ...DEFAULT_CONTENT.heroes,
    ...DEFAULT_CONTENT.enemies,
    ...DEFAULT_CONTENT.summons,
    qa_archer: { name: 'Arquero · visual QA' },
    qa_form_humanoid: { name: 'Cambiaformas humanoide' },
    qa_form_bear: { name: 'Cambiaformas Oso' },
    qa_form_minotaur: { name: 'Cambiaformas Minotauro' },
  };
  const flight = ['raven', 'primordial_dragon', 'war_drake'].includes(id);
  return (
    <main className="locomotion-lab">
      <header>
        <strong>Locomoción · QA privada</strong>
        <a href="/">Volver al juego</a>
      </header>
      <nav aria-label="Personajes de locomoción">
        <label>
          Unidad QA{' '}
          <select
            aria-label="Unidad QA"
            value={id}
            disabled={busy}
            onChange={(e) => setId(e.target.value)}
          >
            {Object.entries(specimens).map(([key, spec]) => (
              <option key={key} value={key}>
                {spec.name}
              </option>
            ))}
          </select>
        </label>
      </nav>
      {id==='qa_archer' && <section className="locomotion-lab-controls" aria-label="Arquero visual">
        <img src="/art/archer/thumbnail.webp" width="48" height="48" alt="Retrato del Arquero" />
        <span>Solo presentación · sin daño ni habilidades</span>
        {(['left','right','up','down'] as const).map(direction=><button key={direction} disabled={!ready||busy} onClick={()=>archerShot(direction)}>Tiro · {direction}</button>)}
      </section>}
      <section className="locomotion-lab-controls" aria-label="Recorridos visuales">
        <button disabled={!ready || busy} onClick={() => travel(2, 1)}>
          {flight ? 'Vuelo lento' : 'Caminar'} · 2 →
        </button>
        <button disabled={!ready || busy} onClick={() => travel(3, 1)}>
          {flight ? 'Vuelo rápido' : 'Correr'} · 3 →
        </button>
        <button disabled={!ready || busy} onClick={() => travel(2, -1)}>
          2 ←
        </button>
        <button disabled={!ready || busy} onClick={() => travel(3, -1)}>
          3 ←
        </button>
        {(['up', 'down'] as const).flatMap((direction) =>
          ([2, 3] as const).map((steps) => (
            <button
              key={direction + steps}
              disabled={!ready || busy}
              onClick={() => directionalTravel(steps, direction)}
            >
              {steps} {direction === 'up' ? '↑' : '↓'}
            </button>
          )),
        )}
        <button disabled={!ready || busy} onClick={() => directionalTravel(3, 'turn')}>
          Ruta con giros
        </button>
        {(['idle', 'attack', 'hit', 'death'] as const).map((motion) => (
          <button key={motion} disabled={!ready || busy} onClick={() => pose(motion)}>
            {{ idle: 'Reiniciar idle', attack: 'Ataque', hit: 'Daño', death: 'Derrota' }[motion]}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />{' '}
          Pausar fotograma QA
        </label>
        <label>
          <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />{' '}
          Cámara lenta QA
        </label>
        <label>
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />{' '}
          Movimiento reducido
        </label>
      </section>
      <section className="locomotion-lab-controls" aria-label="Reacciones QA">
        <label>Caso de contraataque <select aria-label="Caso de contraataque" disabled={busy}
          value={counterCase} onChange={e=>setCounterCase(e.target.value as CounterCase)}>
          <option value="single">Un golpe</option><option value="multiple">Dos golpes</option>
          <option value="defender-death">Muere defensor</option><option value="attacker-death">Muere atacante</option>
          <option value="shield">Contra escudo</option><option value="armor">Contra armadura</option>
        </select></label>
        <button disabled={!ready || busy} onClick={reaction}>Reproducir contraataque</button>
        <output data-testid="reaction-state">{reactionReadout}</output>
      </section>
      <div ref={host} className="locomotion-lab-board" />
      <footer>
        <output aria-label="Estado de animación" data-testid="locomotion-state">
          {error || (!ready ? 'Cargando atlas…' : snapshot)}
        </output>
        <span>Inspección visual: no ejecuta órdenes ni guarda partidas.</span>
      </footer>
    </main>
  );
}
