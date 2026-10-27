import { VISUAL_CHECKPOINTS, visualCheckpoint } from './checkpoints';
import victories from '../../../../tests/fixtures/act3-victories.json';
import { useEffect, useState } from 'react';
import { GameEngine, DEFAULT_CONTENT, encounterFor, type Command } from '../../../game';
import { TEMPLE_CAMPAIGN, TEMPLE_ENCOUNTERS } from '../../../game/data/temple-encounters';
import { withArcher } from '../../../game/data/archer';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { useBattleStore } from '../../store/battleStore';
import { presentationBus } from '../../events/presentationBus';
import { BoardView } from '../../react/components/BoardView';
import { HandBar } from '../../react/components/Hud';
import { objectiveLabel } from '../../react/format';
import { InteractionPanel } from '../../mechanisms/InteractionPanel';
const KEY = 'rpggo:act3-visual-qa:v1';
const content = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
/** `seed` (optional): replays a recorded run (tests/fixtures/act3-victories.json) on its own seed. */
type Save = { hero: string; encounter: string; commands: Command[]; seed?: number };
export default function Act3Qa() {
  const [hero, setHero] = useState('mage'),
    [encounter, setEncounter] = useState('w3_e01'),
    [generation, setGeneration] = useState(0),
    [resume, setResume] = useState<Save | null>(null),
    [replaySteps, setReplaySteps] = useState<Command[]>([]);
  const engine = useBattleStore((s) => s.engine),
    state = useBattleStore((s) => s.state),
    busy = useBattleStore((s) => s.playbackBusy),
    notice = useBattleStore((s) => s.notice);
  useEffect(() => {
    const e = new GameEngine(encounterFor(TEMPLE_CAMPAIGN, encounter, hero), content, resume?.seed);
    if (resume)
      for (const command of resume.commands) {
        if (!e.dispatch(command).ok) break;
      }
    useBattleStore.setState({
      engine: e,
      state: e.state,
      selectedCardUid: null,
      selectedMechanismId: null,
      aim: null,
      introLocked: false,
      playbackBusy: false,
      handDiscard: null,
      onlineCommand: null,
      notice: null,
    });
    return e.subscribe((events, next) => {
      useBattleStore.setState({ state: next });
      presentationBus.publish(events, next);
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ hero, encounter, commands: e.history, seed: e.seed }),
        );
      } catch {
        /* QA storage unavailable: game stays playable. */
      }
    });
  }, [hero, encounter, generation, resume]);
  const restore = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Save | null;
      if (
        saved &&
        TEMPLE_ENCOUNTERS.some((e) => e.id === saved.encounter) &&
        TEMPLE_CAMPAIGN.heroIds.includes(saved.hero)
      ) {
        setReplaySteps([]);
        setHero(saved.hero);
        setEncounter(saved.encounter);
        setResume(saved);
        setGeneration((v) => v + 1);
      }
    } catch {
      /* malformed QA save ignored */
    }
  };
  if (!engine || !state) return <p>Cargando templo…</p>;
  const player = state.units.find((u) => u.id === engine.heroId);
  return (
    <main className="battle act3-qa" data-qa-encounter={engine.scenario.id}>
      <header className="act3-nav">
        <strong>ACTO III · QA LOCAL</strong>
        <select
          aria-label="Encuentro del templo"
          value={encounter}
          onChange={(e) => {
            setResume(null);
            setReplaySteps([]);
            setEncounter(e.target.value);
          }}
        >
          {TEMPLE_ENCOUNTERS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Campeón QA"
          value={hero}
          onChange={(e) => {
            setResume(null);
            setReplaySteps([]);
            setHero(e.target.value);
          }}
        >
          {TEMPLE_CAMPAIGN.heroIds.map((id) => (
            <option key={id} value={id}>
              {content.heroes[id]?.name ?? id}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setResume(null);
            setReplaySteps([]);
            setGeneration((v) => v + 1);
          }}
        >
          Reiniciar batalla
        </button>
        <button onClick={restore}>Reanudar QA</button>
        <select
          aria-label="Punto de revisión visual"
          value=""
          onChange={(e) => {
            const save = visualCheckpoint(e.target.value);
            if (!save) return;
            const run = victories.find(r=>r.encounterId===save.encounter && r.heroId===save.hero && r.seed===save.seed);
            const prefix = run && JSON.stringify(run.commands.slice(0,save.commands.length))===JSON.stringify(save.commands);
            setReplaySteps(prefix ? run.commands.slice(save.commands.length) as Command[] : []);
            setHero(save.hero);
            setEncounter(save.encounter);
            setResume(save);
            setGeneration((v) => v + 1);
          }}
        >
          <option value="">Revisión visual · replay real</option>
          {VISUAL_CHECKPOINTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Control de revisión QA" defaultValue="" onChange={event=>{
          const [enc,id]=event.target.value.split(':');
          const run=victories.find(r=>r.encounterId===enc&&r.heroId==='mage');
          const at=run?.commands.findIndex(c=>c.type==='INTERACT'&&'mechanismId' in c&&c.mechanismId===id)??-1;
          if(!run||at<0)return;
          setHero('mage');setEncounter(enc!);setReplaySteps([run.commands[at] as Command]);
          setResume({hero:'mage',encounter:enc!,seed:run.seed,commands:run.commands.slice(0,at) as Command[]});setGeneration(v=>v+1);
        }}>
          <option value="">Control · replay real</option>
          <option value="w3_e03:statue-a">Sellos · preparar empuje</option>
          <option value="w3_e01:lever">Muro · activar</option>
          <option value="w3_e05:lever-a">Guardián · A</option>
          <option value="w3_e05:lever-b">Guardián · B</option>
          <option value="w3_e05:lever-c">Guardián · C</option>
          <option value="w3_e08:lever">Laberinto · girar</option>
          <option value="w3_e10:key-a">Jefe · exponer</option>
        </select>
        <button
          onClick={() => {
            const run = victories.find((r) => r.encounterId === 'w3_e05' && r.heroId === 'mage');
            if (!run) return;
            setHero('mage');
            setEncounter('w3_e05');
            setReplaySteps(run.commands.slice(-2) as Command[]);
            setResume({
              hero: 'mage',
              encounter: 'w3_e05',
              seed: run.seed,
              commands: run.commands.slice(0, -2) as Command[],
            });
            setGeneration((v) => v + 1);
          }}
        >
          Cargar cierre XXV QA
        </button>
        <button onClick={() => {
          const save = visualCheckpoint('seals3');
          if (!save || !save.commands.length) return;
          setHero(save.hero); setEncounter(save.encounter);
          setReplaySteps(save.commands.slice(-1));
          setResume({...save,commands:save.commands.slice(0,-1)});
          setGeneration(v=>v+1);
        }}>Cargar llegada XXIII QA</button>
        <button disabled={busy} onClick={() => {
          const run=victories.find(r=>r.encounterId===encounter && r.heroId===hero);
          if (!run) return;
          setReplaySteps([]);
          setResume({hero,encounter,seed:run.seed,commands:run.commands as Command[]});
          setGeneration(v=>v+1);
        }}>Cargar final de segmento QA</button>
        <button disabled={busy || state.outcome?.result !== 'WON' || !TEMPLE_ENCOUNTERS.find(e=>e.id===encounter)?.next}
          onClick={() => {
            const next=TEMPLE_ENCOUNTERS.find(e=>e.id===encounter)?.next;
            if (!next) return;
            setResume(null); setReplaySteps([]); setEncounter(next);
          }}>Adentrarse en el templo →</button>
        {replaySteps.length > 0 && (
          <button
            disabled={busy}
            onClick={() => {
              const command = replaySteps[0];
              if (command && engine.dispatch(command).ok) setReplaySteps((s) => s.slice(1));
            }}
          >
            Paso replay QA ({replaySteps.length})
          </button>
        )}
        <button
          disabled={busy || !!state.outcome}
          onClick={() => useBattleStore.getState().endTurn()}
        >
          Finalizar turno
        </button>
      </header>
      <BoardView key={`board:${hero}:${generation}`} focusedEnemyId={null} />
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
      <InteractionPanel key={`${hero}:${encounter}:${generation}`} />
      <div className="act3-status">
        {content.heroes[hero]?.name} · Ronda {state.round} · HP {player?.hp}/{player?.maxHp} · EN{' '}
        {state.player.energy} · MP {state.player.movePoints}
        {state.outcome && ` · ${state.outcome.result}`}
        {notice && ` · ${notice}`}
      </div>
      <HandBar state={state} engine={engine} />
    </main>
  );
}
