import { useState } from 'react';
import { type Command, type DeckEntry, activeForm } from '../../../game';
import {
  SHAPESHIFTER_2D_CARDS as CARDS,
  SHAPESHIFTER_2D_DECKS as DECKS,
} from '../../../game/data/shapeshifter-2d-qa';
import { ERROR_LABEL } from '../../react/format';
import {
  type OpeningPolicy,
  QA_CONTENT,
  QA_STORAGE_KEY,
  restoreQa,
  saveQaDeck,
  serializeQa,
  startQaBattle,
} from './session';
import '../../../styles/shapeshifter-qa.css';
import '../../../styles/shapeshifter-visual.css';
import { FormBoard } from './FormBoard';
import {
  EMPTY_VISUAL_BATCH,
  eventVisuals,
  formVisual,
  formStyle,
  QA_CHAMPION_PORTRAIT,
  QA_FORM_VISUALS,
  QA_TRANSFORM_ART,
} from './visuals';

export default function ShapeshifterLab() {
  const [session, setSession] = useState(() => {
    try {
      return restoreQa(localStorage.getItem(QA_STORAGE_KEY));
    } catch {
      return restoreQa(null);
    }
  });
  const [draft, setDraft] = useState<DeckEntry[]>(() =>
    structuredClone(session.profile.heroes.shapeshifter!.decks[0]!.cards),
  );
  const [selected, setSelected] = useState<string | null>(null),
    [notice, setNotice] = useState('Solo QA local. Sin conexión a cuentas ni recompensas.');
  const [chosen, setChosen] = useState(!!session.engine);
  const [opening, setOpening] = useState<OpeningPolicy>('guaranteed');
  const [seed, setSeed] = useState(42);
  const [batch, setBatch] = useState(EMPTY_VISUAL_BATCH);
  const engine = session.engine,
    state = engine?.state,
    hero = state?.units.find((u) => u.id === state.player.heroId);
  const form = hero ? activeForm(hero) : null;
  const selectedInstance = state?.player.hand.find((c) => c.uid === selected);
  const def = selectedInstance && engine?.content.cards[selectedInstance.cardId];
  const targets = engine && selected ? engine.getValidTargets(selected) : [];
  const moves = engine && !selected ? engine.getLegalMoves().map((n) => n.pos) : [];
  const total = draft.reduce((n, c) => n + c.count, 0);
  function adjust(id: string, delta: number) {
    setDraft((old) => {
      const next = old.map((c) => ({ ...c }));
      const entry = next.find((c) => c.cardId === id);
      if (entry) entry.count = Math.max(0, Math.min(6, entry.count + delta));
      else if (delta > 0) next.push({ cardId: id, count: 1 });
      return next.filter((c) => c.count > 0);
    });
  }
  function dispatch(command: Command) {
    if (!engine) return;
    const before = engine.state;
    const result = engine.dispatch(command);
    if (!result.ok) {
      setNotice(ERROR_LABEL[result.error]);
      return;
    }
    setBatch((old) =>
      eventVisuals(before, engine.state, result.events, engine.content, old.serial + 1),
    );
    setSession((s) => ({ ...s }));
    setSelected(null);
    setNotice(
      result.events.some((e) => e.type === 'FORM_CHANGED')
        ? 'Forma cambiada; vida y efectos conservados.'
        : 'Acción resuelta por el motor.',
    );
  }
  function start() {
    try {
      const profile = saveQaDeck(session.profile, draft);
      const next = startQaBattle(profile, draft, seed, opening);
      setSession({ profile, engine: next });
      setBatch(EMPTY_VISUAL_BATCH);
      setSelected(null);
      setNotice(
        `Combate QA · semilla ${next.seed}. ${opening === 'normal' ? 'Apertura normal' : 'Una transformación garantizada: intercambio con la última carta si falta'}. Mano y semilla conservadas.`,
      );
    } catch (e) {
      setNotice(String(e));
    }
  }
  function persist() {
    try {
      localStorage.setItem(QA_STORAGE_KEY, serializeQa(session.profile, engine));
      setNotice('Guardado QA aislado. Al recargar se valida y reconstruye el replay.');
    } catch {
      setNotice('No se pudo guardar el laboratorio.');
    }
  }
  return (
    <main className="shapeshifter-lab">
      {Object.values(QA_FORM_VISUALS)
        .flatMap((v) => Object.values(v.poses))
        .map((src) => (
          <link key={src} rel="preload" as="image" href={src} />
        ))}
      <header>
        <img
          className="qa-champion-portrait"
          src={QA_CHAMPION_PORTRAIT}
          alt="Cambiaformas, chamán ancestral"
          width="180"
          height="180"
        />
        <span>LABORATORIO PRIVADO · FASE 2D</span>
        <h1>Cambiaformas</h1>
        <p>
          Identidad ancestral · Humanoide, Oso y Minotauro. Valores de QA provisionales; sin Furia.
        </p>
        <button aria-pressed={chosen} onClick={() => setChosen(true)}>
          Seleccionar Cambiaformas
        </button>{' '}
        <a href="/play">Salir del laboratorio</a>
      </header>
      {chosen && (
        <>
          <section aria-label="Mazo QA">
            <h2>Mazo de prueba · {total}/30</h2>
            <p>
              Hasta 6 copias por carta, solo en este contenido QA. Incluye al menos 1 Forma de Oso y
              1 Forma de Minotauro. No son límites finales.
            </p>
            <div className="lab-actions">
              {Object.entries(DECKS).map(([key, deck]) => (
                <button key={key} onClick={() => setDraft(structuredClone(deck))}>
                  {key === 'balanced8'
                    ? 'Equilibrado · 8 formas (4/4)'
                    : key === 'balanced'
                      ? 'Equilibrado'
                      : key === 'bear'
                        ? 'Énfasis Oso'
                        : 'Énfasis Minotauro'}
                </button>
              ))}
            </div>
            <div className="lab-editor">
              {CARDS.map((card) => (
                <article
                  key={card.id}
                  data-transform-card={QA_TRANSFORM_ART[card.id]?.visualId}
                  style={
                    QA_TRANSFORM_ART[card.id]
                      ? formStyle(formVisual(QA_TRANSFORM_ART[card.id]!.visualId))
                      : undefined
                  }
                >
                  {QA_TRANSFORM_ART[card.id] && (
                    <img
                      className="qa-transform-editor-art"
                      src={QA_TRANSFORM_ART[card.id]!.art}
                      alt={card.name}
                      loading="lazy"
                    />
                  )}
                  <h3>
                    {card.name} · {card.cost} energía
                  </h3>
                  <p>{card.rulesText}</p>
                  <small>
                    Forma:{' '}
                    {card.requiredForms
                      ?.map((f) => (f ? QA_CONTENT.transformations?.[f]?.name : 'Humanoide'))
                      .join(' / ') ?? 'Cualquiera'}
                  </small>
                  <div>
                    <button aria-label={`Quitar ${card.name}`} onClick={() => adjust(card.id, -1)}>
                      −
                    </button>{' '}
                    <output>{draft.find((e) => e.cardId === card.id)?.count ?? 0}</output>{' '}
                    <button aria-label={`Añadir ${card.name}`} onClick={() => adjust(card.id, 1)}>
                      +
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <p>
              Rugido sin cambios: limpiar un único estado requiere soporte que el motor aún no
              ofrece.
            </p>
            <label>
              Apertura QA{' '}
              <select value={opening} onChange={(e) => setOpening(e.target.value as OpeningPolicy)}>
                <option value="normal">Normal</option>
                <option value="guaranteed">Una transformación garantizada</option>
              </select>
            </label>{' '}
            <label>
              Semilla{' '}
              <input
                type="number"
                min="0"
                max="4294967295"
                value={seed}
                onChange={(e) =>
                  setSeed(Math.max(0, Math.min(0xffffffff, Number(e.target.value) || 0)) >>> 0)
                }
              />
            </label>
            <div className="lab-actions">
              <button
                onClick={() => {
                  try {
                    setSession((s) => ({ ...s, profile: saveQaDeck(s.profile, draft) }));
                    setNotice('Mazo QA validado.');
                  } catch (e) {
                    setNotice(String(e));
                  }
                }}
              >
                Guardar mazo QA
              </button>
              <button onClick={start}>Iniciar / reiniciar combate QA</button>
              <button onClick={persist}>Guardar sesión QA</button>
            </div>
          </section>
          {engine && state && (
            <section aria-label="Combate QA">
              <h2>
                <img className="qa-active-form-icon" src={formVisual(form).icon} alt="" />
                Forma activa: {form ? engine.content.transformations?.[form]?.name : 'Humanoide'}
              </h2>
              <p>
                Vida {hero?.hp ?? 0}/{hero?.maxHp ?? 0} · Armadura {hero?.armor ?? 0} · Escudo{' '}
                {hero?.shield ?? 0} · Energía {state.player.energy}/{state.player.maxEnergy} ·
                Movimiento {state.player.movePoints} · Ronda {state.round}
              </p>
              {hero && (
                <p>
                  Efectos:{' '}
                  {hero.statuses.map((s) => `${s.id} (${s.turnsLeft})`).join(', ') || 'ninguno'}
                </p>
              )}
              <p>
                Sin carta seleccionada, pulsa una casilla marcada para moverte. Selecciona una carta
                y pulsa su objetivo; las cartas propias usan «Lanzar carta».
              </p>
              <FormBoard
                state={state}
                targets={targets}
                moves={moves}
                selected={!!selected}
                batch={batch}
                onTile={(pos) =>
                  selected
                    ? dispatch({ type: 'PLAY_CARD', cardUid: selected, target: pos })
                    : dispatch({ type: 'MOVE_UNIT', unitId: state.player.heroId, to: pos })
                }
              />
              <div className="lab-hand" aria-label="Mano">
                {state.player.hand.map((instance) => {
                  const c = engine.content.cards[instance.cardId]!,
                    playable = engine.getCardPlayability(instance.uid);
                  return (
                    <button
                      key={instance.uid}
                      data-transform-card={QA_TRANSFORM_ART[c.id]?.visualId}
                      style={
                        QA_TRANSFORM_ART[c.id]
                          ? formStyle(formVisual(QA_TRANSFORM_ART[c.id]!.visualId))
                          : undefined
                      }
                      aria-pressed={selected === instance.uid}
                      onClick={() => {
                        setSelected(instance.uid);
                        setNotice(playable.playable ? c.rulesText : ERROR_LABEL[playable.reason]);
                      }}
                    >
                      {QA_TRANSFORM_ART[c.id] && (
                        <>
                          <img
                            className="qa-transform-hand-art"
                            src={QA_TRANSFORM_ART[c.id]!.art}
                            alt=""
                          />
                          <span className="qa-transform-badge">TRANSFORMACIÓN</span>
                        </>
                      )}
                      <strong>{c.name}</strong>
                      <span>{c.cost} energía</span>
                      <small>{c.rulesText}</small>
                      {!playable.playable && <em>{ERROR_LABEL[playable.reason]}</em>}
                    </button>
                  );
                })}
              </div>
              {def && (
                <p>
                  <strong>{def.name}</strong> — {def.rulesText}
                  {def.requiredForms && ` Requiere: ${def.requiredForms.join(' / ')}.`}
                </p>
              )}
              <div className="lab-actions">
                <button
                  disabled={!selected || def?.targeting.type !== 'SELF' || !!state.outcome}
                  onClick={() =>
                    selected && dispatch({ type: 'PLAY_CARD', cardUid: selected, target: null })
                  }
                >
                  Lanzar carta
                </button>
                <button onClick={() => setSelected(null)}>Cancelar selección</button>
                <button
                  disabled={!!state.outcome}
                  onClick={() =>
                    dispatch({
                      type: 'END_TURN',
                      ...(state.player.hand.length > 5 && selected ? { discardUid: selected } : {}),
                    })
                  }
                >
                  Finalizar turno
                </button>
              </div>
              <p>Con 6 cartas, selecciona la que quieres descartar antes de finalizar el turno.</p>
              {state.outcome && (
                <h3>Combate finalizado: {state.outcome.result}. Sin recompensa.</h3>
              )}
            </section>
          )}
        </>
      )}
      <p className="lab-notice" role="status">
        {notice}
      </p>
    </main>
  );
}
