import { guardianWindow } from './finalReadability';
import { useMechanismPlayback } from './mechanismPlayback';
import { mechanismView } from '../../game/domain/mechanisms/mechanism-view';
import { puzzlePresentation, mechanismHint } from './puzzlePresentation';
import { phase2Feedback, phase2ActionLabel } from './phase2Presentation';
import type { GameEngine, GameState } from '../../game';
import { useEffect, useState } from 'react';
import { useBattleStore } from '../store/battleStore';
import { presentationBus } from '../events/presentationBus';
import { describeMechanismEvent } from './mechanismLabels';
import {
  interactionPresentation,
  mechanismNames,
  mechanismStateLabel,
} from './interactionPresentation';
import '../../styles/mechanisms.css';

export function InteractionPanel() {
  const engine = useBattleStore((s) => s.engine),
    liveState = useBattleStore((s) => s.state);
  const selected = useBattleStore((s) => s.selectedMechanismId),
    card = useBattleStore((s) => s.selectedCardUid);
  const busy = useBattleStore((s) => s.playbackBusy || s.introLocked || !!s.handDiscard);
  const shown = useMechanismPlayback((s) => s.state);
  const state = busy && shown?.scenarioId === liveState?.scenarioId ? shown : liveState;
  const [feedback, setFeedback] = useState('');
  useEffect(
    () =>
      presentationBus.subscribe((events) => {
        const lines = events
          .map((e) =>
            e.type === 'MECHANISM_CHANGED'
              ? e.cue === 'PLATFORM_BLOCKED'
                ? 'CAMINO BLOQUEADO'
                : describeMechanismEvent(e)?.text
              : e.type === 'GUARDIAN_STATE'
                ? e.cue === 'GUARDIAN_EXPOSED'
                  ? 'NÚCLEO EXPUESTO'
                  : 'Blindaje restaurado'
                : e.type === 'OBJECTIVE_STAGE_CHANGED'
                  ? 'OBJETIVO ACTUALIZADO'
                  : null,
          )
          .filter(Boolean);
        const concise = phase2Feedback(events);
        if (concise || lines.length) setFeedback(concise ?? [...new Set(lines)].join(' · '));
      }),
    [],
  );
  if (!engine || !state) return null;
  return (
    <InteractionPanelView
      engine={engine}
      state={state}
      selected={selected}
      card={card}
      busy={busy}
      feedback={busy ? '' : feedback}
    />
  );
}

export function InteractionPanelView({
  engine,
  state,
  selected,
  card,
  busy,
  feedback,
}: {
  engine: GameEngine;
  state: Readonly<GameState>;
  selected: string | null;
  card: string | null;
  busy: boolean;
  feedback: string;
}) {
  const interaction = interactionPresentation(engine, selected);
  if (!interaction) return null;
  const ui = { ...interaction, view: mechanismView(state) ?? interaction.view };
  const puzzle = puzzlePresentation(state);
  const window = guardianWindow(state, ui.view);
  const object = ui.view.objects.find((o) => o.id === selected);
  const options = card ? [] : ui.options.filter(option => option.allowed);
  return (
    <aside className="mechanism-controls mechanism-controls-compact" aria-label="Mecanismos del templo">
      <details className="mobile-mission">
        <summary><span>◈ {puzzle?.introTitle ?? 'Objetivo de misión'}</span><small>{puzzle?.progressTotal ? `${puzzle.progressCurrent}/${puzzle.progressTotal}` : 'Detalles'}</small></summary>
        <p>{puzzle?.hudHint}</p>
        {window && <strong>{window.title}{window.exposed ? ` · ${window.remaining} turnos` : ''}</strong>}
      </details>
      <section className="mechanism-goal" aria-label="Objetivo del mecanismo">
        <h3>{puzzle?.introTitle ?? 'MECANISMOS DEL TEMPLO'}</h3>
        <p>{puzzle?.hudHint}</p>
        {!!puzzle?.progressTotal && <strong className="mechanism-goal-progress" role="status">
          {puzzle.progressLabel} {puzzle.progressCurrent}/{puzzle.progressTotal}
        </strong>}
        {window && <strong className="mechanism-goal-progress" data-exposed={window.exposed}>
          {window.title}{window.exposed ? ` · ${window.remaining} turnos` : ''}
        </strong>}
      </section>
      {!!options.length && <div className="mechanism-context-actions" aria-label="Acciones disponibles">
        {options.map(option => <button key={option.mechanismId}
          className="mechanism-action" data-mechanism-id={option.mechanismId}
          disabled={busy || !!state.outcome || state.phase !== 'PLAYER'}
          onClick={() => useBattleStore.getState().interactMechanism(option.mechanismId)}>
          {phase2ActionLabel(option.verb, option.mechanismId, ui.view)}
          <small>{option.label ?? mechanismNames[option.kind]}</small>
        </button>)}
      </div>}
      {card && object && <small>Cancelar la carta permite interactuar.</small>}
      <details className="mechanism-inspection">
        <summary>Inspeccionar conexiones</summary>
        {object && <p>{object.label ?? mechanismNames[object.kind]} · {mechanismHint(object)}</p>}
        <div className="mechanism-list">
          {ui.view.objects.map(o => <button key={o.id} data-state={o.visualState}
            aria-pressed={selected === o.id}
            onClick={() => useBattleStore.getState().selectMechanism(o.id)}>
            <b>{o.label ?? mechanismNames[o.kind]}</b>
            <small>{mechanismStateLabel(o.state)}</small>
          </button>)}
        </div>
        {object && <p>{object.connected.map(id => ui.view.objects.find(o => o.id === id)?.label ?? id).join(' → ')}</p>}
        {selected && <button onClick={() => useBattleStore.getState().selectMechanism(null)}>Quitar selección</button>}
      </details>
      {feedback && <p className="mechanism-feedback" role="status">{feedback}</p>}
    </aside>
  );
}
