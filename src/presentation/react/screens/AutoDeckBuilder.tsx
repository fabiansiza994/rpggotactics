import { useEffect, useRef, useState } from "react";
import {
  DECK_RULES,
  type DeckRules,
  ownedFor,
  validateDeck,
  type DeckEntry,
} from "../../../game";
import {
  generateDeck,
  DECK_STYLES,
  type DeckStyle,
  type AutoDeckResult,
} from "../../../game/collection/auto-deck";
import { PRESENTATION_CONTENT as CONTENT } from "../../qa/shapeshifter/runtime";
import { useBattleStore } from "../../store/battleStore";
import { CATEGORY_LABEL } from "../format";
import { CardView } from "../components/CardView";
import "../../../styles/auto-deck.css";
const labels = {
  attack: "Ataque",
  defense: "Defensa",
  control: "Control",
  mobility: "Movilidad",
  resources: "Recursos",
  synergy: "Sinergia",
  consistency: "Consistencia",
};
/** Proposal only. The editor owns the draft and the existing Save button owns persistence. */
export function AutoDeckBuilder({
  rules=DECK_RULES,
  heroId: hero,
  onApply,
  onClose,
}: {
  rules?:DeckRules;
  heroId: string;
  onApply: (cards: DeckEntry[]) => void;
  onClose: () => void;
}) {
  const profile = useBattleStore((s) => s.profile);
  const [style, setStyle] = useState<DeckStyle>("BALANCED"),
    [proposal, setProposal] = useState<AutoDeckResult | null>(null),
    [error, setError] = useState(""),
    [inspect, setInspect] = useState("");
  const seed = useRef(0),
    lock = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement,
      node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  function generate() {
    if (lock.current) return;
    setError("");
    setInspect("");
    setProposal(
      generateDeck(
        CONTENT,
        hero,
        ownedFor(profile, hero, CONTENT),
        rules,
        style,
        ++seed.current,
      ),
    );
  }
  function apply() {
    if (lock.current || !proposal?.ok) return;
    const current = useBattleStore.getState().profile;
    if (
      validateDeck(
        proposal.cards,
        hero,
        ownedFor(current, hero, CONTENT),
        CONTENT,
        rules,
      ).length
    ) {
      setError("Tu colección cambió. Regenera antes de aplicar.");
      return;
    }
    lock.current = true;
    onApply(proposal.cards.map((e) => ({ ...e })));
    onClose();
  }
  const analysis = proposal?.ok ? proposal.analysis : null;
  return (
    <dialog
      className="auto-deck-dialog"
      ref={dialog}
      aria-labelledby="auto-deck-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <small>TU ARSENAL · AUTOARMADOR</small>
          <h2 id="auto-deck-title">Forja tu estrategia</h2>
        </div>
        <button aria-label="Cerrar autoarmador" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="auto-deck-scroll">
        <p>
          Campeón del mazo: <strong>{CONTENT.heroes[hero]?.name}</strong>. La
          propuesta se aplicará solo a tu edición. Guarda después con «Guardar
          mazo».
        </p>
        <fieldset>
          <legend>Tu plan de batalla</legend>
          <label>
            Estilo
            <select
              value={style}
              onChange={(e) => {
                setStyle(e.target.value as DeckStyle);
                setProposal(null);
                setError("");
                setInspect("");
              }}
            >
              {Object.entries(DECK_STYLES).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <button onClick={generate}>
          {proposal ? "Regenerar propuesta" : "Crear propuesta"}
        </button>
        {error && <p role="alert">{error}</p>}
        {proposal && !proposal.ok && (
          <p role="status">
            {proposal.message} Para otro campeón, abre su mazo desde Cartas.
          </p>
        )}
        {analysis && proposal?.ok && (
          <>
            <h3>
              {DECK_STYLES[style]} · {rules.requiredSize}/
              {rules.requiredSize} cartas
            </h3>
            <section
              className="auto-deck-stats"
              aria-label="Estadísticas calculadas"
            >
              {Object.entries(analysis.scores).map(([key, value]) => (
                <label key={key}>
                  {labels[key as keyof typeof labels]}
                  <meter min={0} max={100} value={value} />
                  <span>{value}/100</span>
                </label>
              ))}
            </section>
            <details>
              <summary>Cómo se calcula</summary>
              <p>
                Puntuaciones orientativas por cobertura de efectos y categorías;
                no predicen victorias. Curva de energía y dependencias de
                invocaciones, formas y rituales influyen en la selección. No se
                usa rareza como puntuación de poder.
              </p>
              <p>
                {analysis.simulation.samples} aperturas locales reproducibles
                utilizando el motor real, incluido el inicio garantizado del
                Cambiaformas. Mano inicial y siguiente robo según el campeón.
                «Útil» significa coste asequible y dependencia básica
                disponible; no garantiza objetivo, alcance ni una jugada legal
                en un tablero concreto.
              </p>
            </details>
            <p>
              Estimaciones: mano inicial con opción potencialmente útil{" "}
              <strong>{analysis.simulation.usefulOpening}%</strong> · mano con
              mayoría de costes altos{" "}
              <strong>{analysis.simulation.expensiveHand}%</strong> · carta del
              rol principal al siguiente robo{" "}
              <strong>{analysis.simulation.keyByNextDraw}%</strong>.
            </p>
            <p>
              Cartas clave del plan:{" "}
              {analysis.simulation.keyCards.slice(0, 4).join(" · ") ||
                "Sin paquete clave disponible"}
              {analysis.simulation.keyCards.length > 4 ? "…" : ""}.
            </p>
            <div className="auto-deck-breakdown">
              <section>
                <h4>Curva de energía</h4>
                {Object.entries(analysis.curve).map(([cost, count]) => (
                  <p key={cost}>
                    {cost} energía{" "}
                    <meter max={rules.requiredSize} value={count} />{" "}
                    {count}
                  </p>
                ))}
              </section>
              <section>
                <h4>Categorías</h4>
                {Object.entries(analysis.categories).map(
                  ([category, count]) => (
                    <p key={category}>
                      {CATEGORY_LABEL[
                        category as keyof typeof CATEGORY_LABEL
                      ] ?? category}{" "}
                      · {count}
                    </p>
                  ),
                )}
              </section>
            </div>
            <p>
              Movimiento base: {analysis.tactics.baseMove} PM · Ataques a
              distancia: {analysis.tactics.ranged} · Cuerpo a cuerpo:{" "}
              {analysis.tactics.melee} · Cartas con requisitos específicos:{" "}
              {analysis.tactics.restricted}.
            </p>
            <h4>Combinaciones identificadas</h4>
            {analysis.combinations.length ? (
              <ul>
                {analysis.combinations.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p>
                Sin una combinación específica demostrable; prima la cobertura
                de funciones.
              </p>
            )}
            <h4>Fortalezas y límites</h4>
            <ul>
              {[...analysis.strengths, ...analysis.weaknesses].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <div className="auto-deck-cards">
              {proposal.cards.map((e) => (
                <article key={e.cardId}>
                  <span>×{e.count}</span>
                  <CardView
                    def={CONTENT.cards[e.cardId]!}
                    hotkey={0}
                    selected={inspect === e.cardId}
                    playable
                    onClick={() =>
                      setInspect(inspect === e.cardId ? "" : e.cardId)
                    }
                    onLongInspect={() => setInspect(e.cardId)}
                  />
                  <small>{analysis.reasons[e.cardId]}</small>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
      <footer>
        <button onClick={onClose}>Cancelar</button>
        <button disabled={!proposal?.ok} onClick={apply}>
          Aplicar al editor
        </button>
      </footer>
    </dialog>
  );
}
