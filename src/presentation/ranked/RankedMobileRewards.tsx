import { useEffect, useRef, useState } from "react";
import {
  FIRST_VALID_RANKED_MIN_ROUNDS,
  rankedItemName,
  type RankedItemView,
  type RankedNodeView,
  type RankedTrackView,
} from "../../game/ranked/rewardTrack";
import { formatRp } from "../../game/ranked/ranked";
import { PRESENTATION_CONTENT } from "../qa/shapeshifter/runtime";
import { GameIcon } from "../react/components/GameIcon";
import { FINAL_CARD_ART } from "../assets/paintedAssets";
import { SpellArt } from "../react/components/SpellArt";

/** Presentation of the server's view only: current RP never overrides entitlement/status. */
export function mobileRewardCards(view: RankedTrackView) {
  const next = new Set(view.nextReward?.items.map((i) => i.rewardId) ?? []);
  return view.nodes.flatMap((node) =>
    node.items.map((item) => ({ node, item, next: next.has(item.rewardId) })),
  );
}
export function mobileRewardCondition(
  node: RankedNodeView,
  item: RankedItemView,
) {
  if (item.condition === "FIRST_VALID_RANKED")
    return `Primera Ranked humana válida · ${FIRST_VALID_RANKED_MIN_ROUNDS} rondas mín.`;
  return item.type === "CRYSTALS"
    ? `Primer ascenso a ${node.label} · ${formatRp(node.requiredRp)}`
    : `${node.label} · ${formatRp(node.requiredRp)} de progreso competitivo`;
}
export function RankedMobileRewards({
  view,
  error,
  onDetails,
  onRefresh,
}: {
  view: RankedTrackView | null;
  error: string;
  onDetails(): void;
  onRefresh(): void;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    focusedSeason = useRef<string | null>(null),
    interacting = useRef(false);
  const [edges, setEdges] = useState({ start: true, end: false });
  const rows = view ? mobileRewardCards(view) : [];
  useEffect(() => {
    const el = viewport.current;
    if (!el || !view) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    if (focusedSeason.current !== view.seasonId) {
      focusedSeason.current = view.seasonId;
      if (!interacting.current) {
        const target = el.querySelector<HTMLElement>('[data-next="true"]');
        if (target)
          el.scrollLeft +=
            target.getBoundingClientRect().left -
            el.getBoundingClientRect().left -
            2;
      }
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [view]);
  const shift = (direction: number) => {
    interacting.current = true;
    const el = viewport.current;
    if (el)
      el.scrollBy({
        left: direction * (el.clientWidth * 0.8),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  };
  return (
    <section className="r21-rewards" aria-label="Recompensas Ranked">
      <header>
        <div>
          <span className="lobby-eyebrow">EL CAMINO DE LA ARENA</span>
          <h3>Recompensas de rango</h3>
        </div>
        <button type="button" onClick={onDetails} disabled={!view}>
          Ver todas <span aria-hidden="true">›</span>
        </button>
      </header>
      {!view ? (
        <div className="r21-reward-loading" role="status">
          {error || "Cargando recompensas…"}
          {error && (
            <button type="button" onClick={onRefresh}>
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <>
          {error && (
            <p role="status">
              Datos de la última lectura. {error}{" "}
              <button type="button" onClick={onRefresh}>
                Reintentar
              </button>
            </p>
          )}
          <div
            className="r21-reward-strip"
            ref={viewport}
            tabIndex={0}
            role="region"
            aria-label="Carrusel de recompensas; desplázate horizontalmente"
            onPointerDown={() => {
              interacting.current = true;
            }}
            onWheel={() => {
              interacting.current = true;
            }}
            onKeyDown={() => {
              interacting.current = true;
            }}
          >
            {rows.map(({ node, item, next }) => {
              const card = item.cardId
                ? PRESENTATION_CONTENT.cards[item.cardId]
                : undefined;
              return (
                <article
                  key={item.rewardId}
                  className="r21-reward-card"
                  data-status={item.status}
                  data-next={next}
                  aria-label={`${rankedItemName(item, PRESENTATION_CONTENT.cards)} · ${item.status === "CLAIMED" ? "Obtenida" : item.status === "UNLOCKED" ? "Disponible" : next ? "Próxima, bloqueada" : "Bloqueada"}`}
                >
                  <span className="r21-reward-state">
                    {item.status === "CLAIMED"
                      ? "✓ Obtenida"
                      : item.status === "UNLOCKED"
                        ? "◇ Disponible"
                        : next
                          ? "✧ Próxima"
                          : "⌑ Bloqueada"}
                  </span>
                  <div className="r21-reward-art" aria-hidden="true">
                    {card && FINAL_CARD_ART[card.id] ? (
                      <SpellArt
                        spell={card.presentation.visualKey}
                        cardId={card.id}
                      />
                    ) : card ? (
                      <GameIcon name="deck" />
                    ) : item.cosmeticId ? (
                      <img
                        src={`/art/ranked-rewards/${item.cosmeticId}.svg`}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span data-kind={item.type}>
                        {item.type === "CRYSTALS" ? "◆" : "✦"}
                      </span>
                    )}
                  </div>
                  <strong>
                    {rankedItemName(item, PRESENTATION_CONTENT.cards)}
                  </strong>
                  <b className="r21-reward-quantity">
                    {item.type === "CRYSTALS"
                      ? `${item.quantity} Cristales`
                      : `×${item.quantity}`}
                  </b>
                  <small>{mobileRewardCondition(node, item)}</small>
                  {next && item.status === "LOCKED" && (
                    <small className="r21-reward-lock">Aún bloqueada</small>
                  )}
                  {item.type === "CARD" &&
                    item.status === "CLAIMED" &&
                    item.grantedCopies !== undefined && (
                      <small>Copias recibidas: {item.grantedCopies}</small>
                    )}
                </article>
              );
            })}
          </div>
          <div className="r21-carousel-controls">
            <span>Desliza para explorar</span>
            <div>
              <button
                type="button"
                aria-label="Recompensa anterior"
                disabled={edges.start}
                onClick={() => shift(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Recompensa siguiente"
                disabled={edges.end}
                onClick={() => shift(1)}
              >
                ›
              </button>
            </div>
          </div>
        </>
      )}
      <details className="r21-reward-rules">
        <summary>Condiciones de las recompensas</summary>
        <p>
          Entrega automática por progreso competitivo humano. El RP de
          encuentros IA no desbloquea el Track ni Premium. Los Cristales se
          entregan una sola vez por el primer ascenso de la temporada.
        </p>
      </details>
    </section>
  );
}
