import {BattleRail} from './BattleRails';
import {OpponentHand} from './OpponentHand';
import { useEffect, useRef, useState } from "react";
import type { GameContent, GameState, CardInstance } from "../../game";
import { EquippedCardBack, STANDARD_CARD_BACK } from "../cosmetics/CardBack";
import { FeatureCard } from "../react/components/BattleCardFeature";
import { GameIcon } from "../react/components/GameIcon";
import {
  CATEGORY_LABEL,
  RARITY_LABEL,
  rangeText,
  targetingNotes,
} from "../react/format";
import { CompactCardGrid } from "../react/deckbuilder/CompactCardGrid";
import "../../styles/compact-deck-editor.css";
import "../../styles/battle-piles.css";
export function graveEntries(cards: readonly CardInstance[]) {
  const counts = new Map<string, number>();
  for (const card of cards)
    counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1);
  return [...counts].map(([cardId, count]) => ({ cardId, count }));
}
export function BattlePileBank({
  state,
  content,
  opponent = false,
}: {
  state: Readonly<GameState>;
  content: GameContent;
  opponent?: boolean;
}) {
  const [opened, setOpened] = useState<"deck" | "grave" | null>(null),
    [inspect, setInspect] = useState<string | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const cards = opponent ? (state.opponentDiscard ?? []) : state.player.discard;
  const count = opponent
    ? (state.pileCounts?.opponentDiscard ?? 0)
    : state.player.discard.length;
  const deck = opponent
    ? (state.pileCounts?.opponentDeck ?? 0)
    : (state.pileCounts?.deck ?? state.player.deck.length);
  const who = opponent ? "Rival" : "Tu",
    card = inspect ? content.cards[inspect] : undefined;
  useEffect(() => {
    if (!opened) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [opened]);
  if (opponent && !state.pileCounts) return <div aria-hidden="true" />;
  return (
    <aside
      className={`battle-pile-bank ${opponent ? "is-rival" : "is-own"}`}
      aria-label={opponent ? "Zonas del rival" : "Tus zonas"}
    >
      <span className="battle-pile-owner" aria-hidden="true">{opponent?'Rival':'Tú'}</span>
      <button
        className="battle-pile battle-pile-deck"
        title={`${who} mazo`}
        aria-label={`${who} mazo: ${deck} cartas`}
        onClick={() => {
          setInspect(null);
          setOpened("deck");
        }}
      >
        <span className="battle-pile-back">
          {opponent ? (
            <img src={STANDARD_CARD_BACK} alt="" />
          ) : (
            <EquippedCardBack />
          )}
        </span>
        <b>{deck}</b>
      </button>
      <button
        className="battle-pile battle-pile-grave"
        title={`${who} cementerio`}
        aria-label={`${who} cementerio: ${count} cartas`}
        onClick={() => {
          setInspect(null);
          setOpened("grave");
        }}
      >
        <GameIcon name="discard" />
        <b>{count}</b>
      </button>
      {opponent && state.pileCounts && <BattleRail slot="opponent"><OpponentHand count={state.pileCounts.opponentHand} opponentId={state.units.find(u=>u.kind==='HERO'&&u.id!==state.player.heroId)?.id??''}/></BattleRail> }
      {opened && (
        <dialog
          ref={dialog}
          className="battle-grave-dialog"
          aria-label={opponent ? "Zonas del rival" : "Tus zonas"}
          onCancel={() => setOpened(null)}
          onClose={() => setOpened(null)}
        >
          <header>
            <h2>
              {opened === "deck" ? `${who} mazo` : `${who} cementerio`} ·{" "}
              {opened === "deck" ? deck : count}
            </h2>
            <button aria-label="Cerrar zonas" onClick={() => setOpened(null)}>
              ×
            </button>
          </header>
          {opened === "deck" ? (
            <>
              <p>
                Cartas boca abajo. No se revela el contenido ni el orden de
                robo.
              </p>
              <p>
                {state.competitiveRules || state.duel?.competitiveRules
                  ? "Si debes robar y no quedan cartas, pierdes. Llegar a cero no causa derrota por sí solo."
                  : "Al agotarse el mazo, Historia conserva su reciclaje y Fatiga Arcana actuales."}
              </p>
            </>
          ) : (
            <>
              {opponent && count > cards.length && (
                <p role="status">
                  {count - cards.length} cartas no reveladas. Sus identidades
                  permanecen privadas.
                </p>
              )}
              {card ? (
                <section className="grave-card-detail">
                  <FeatureCard
                    def={card}
                    className="grave-detail-face"
                    extras={{ playable: true }}
                  />
                  <div>
                    <h3>{card.name}</h3>
                    <p>
                      {card.cost} energía ·{" "}
                      {RARITY_LABEL[card.rarity ?? "COMMON"]} ·{" "}
                      {CATEGORY_LABEL[card.category]}
                    </p>
                    <p>{card.rulesText}</p>
                    <p>{rangeText(card)}</p>
                    {targetingNotes(card).map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                    <button onClick={() => setInspect(null)}>
                      Volver al cementerio
                    </button>
                  </div>
                </section>
              ) : cards.length ? (
                <>
                  {cards.some(card => !card.recoveredThisBattle) && <CompactCardGrid
                    entries={graveEntries(cards.filter(card => !card.recoveredThisBattle))}
                    cards={content.cards} context="collection" collectionLabel="en esta zona" draggable={false}
                    selected={inspect} onInspect={setInspect} onDragStart={() => {}} onDragEnd={() => {}}
                  />}
                  {cards.some(card => card.recoveredThisBattle) && <section className="grave-recovered" aria-label="Recuperación agotada">
                    <h3>Recuperación agotada</h3>
                    <p>Estas instancias ya fueron recuperadas durante esta partida. Puedes inspeccionarlas, pero no recuperarlas otra vez.</p>
                    <CompactCardGrid entries={graveEntries(cards.filter(card => card.recoveredThisBattle))}
                      cards={content.cards} context="collection" collectionLabel="ya recuperadas" draggable={false}
                      selected={inspect} onInspect={setInspect} onDragStart={() => {}} onDragEnd={() => {}}
                    />
                  </section>}
                </>
              ) : (
                <p>No hay cartas reveladas en esta zona.</p>
              )}
            </>
          )}
        </dialog>
      )}
    </aside>
  );
}
