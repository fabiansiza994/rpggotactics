import { useEffect, useRef, useState } from "react";
import type { PurchasePlan } from "../../game/store/store";
import { rarityOf } from "../../game";
import { resolvePresentationCard } from "../catalog/cardPresentation";
import {UnknownReceiptCard,useReceiptCardDiagnostics} from "./UnknownReceiptCard";
import { MarketCard } from "./MarketCard";
import { PackArt, packExpansion } from "./PackArt";
import {
  advancePack,
  initialPackScene,
  packSceneKey,
  restorePackScene,
  type PackAction,
} from "./packScene";
import "../../styles/arcane-market.css";
/** Receives only a persisted receipt; all phases are presentation, never acquisition. */
export function PackOpening({
  opening,
  onInspect,
  onDone,
  receiptId,
  onPackComplete,
  completeLabel,
  packNumber = 1,
  packCount = 1,
  onOpenAll,
}: {
  opening: NonNullable<PurchasePlan["opening"]>;
  onInspect: (id: string) => void;
  onDone?: () => void;
  receiptId?: string;
  onPackComplete?: () => void;
  completeLabel?: string;
  packNumber?: number;
  packCount?: number;
  onOpenAll?: () => void;
}) {
  useReceiptCardDiagnostics(opening.cards.map(c=>c.cardId));
  const key = receiptId ? packSceneKey(receiptId) : null;
  const [scene, setScene] = useState(() => {
    try {
      return key
        ? restorePackScene(localStorage.getItem(key))
        : initialPackScene();
    } catch {
      return initialPackScene();
    }
  });
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [paused, setPaused] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );
  useEffect(() => {
    const changed = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const [pending, setPending] = useState(-1);
  const pendingRef = useRef(-1),
    delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const send = (action: PackAction) => setScene((s) => advancePack(s, action));
  useEffect(() => {
    if (key)
      try {
        localStorage.setItem(key, JSON.stringify(scene));
      } catch {
        /* Receipt remains authoritative even without visual storage. */
      }
  }, [key, scene]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (scene.phase !== "opening") return;
    const t = setTimeout(() => send({ type: "OPENED" }), reduced ? 0 : 1350);
    const hide = () => {
      if (document.hidden) send({ type: "OPENED" });
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [scene.phase, reduced]);
  useEffect(
    () => () => {
      if (delay.current) clearTimeout(delay.current);
    },
    [],
  );
  const reveal = (i: number) => {
    if (scene.phase === "summary") {
      onInspect(opening.cards[i]!.cardId);
      return;
    }
    if (scene.phase !== "reveal" || pendingRef.current >= 0) return;
    if (scene.mask & (1 << i)) {
      onInspect(opening.cards[i]!.cardId);
      return;
    }
    const card = resolvePresentationCard(opening.cards[i]!.cardId);
    const legendary = card && rarityOf(card) === "LEGENDARY";
    if (legendary && !reduced) {
      pendingRef.current = i;
      setPending(i);
      delay.current = setTimeout(() => {
        send({ type: "REVEAL", index: i });
        pendingRef.current = -1;
        setPending(-1);
      }, 240);
    } else send({ type: "REVEAL", index: i });
  };
  const all = () => {
    if (delay.current) clearTimeout(delay.current);
    pendingRef.current = -1;
    setPending(-1);
    send({ type: "ALL" });
  };
  const count = [0, 1, 2, 3].filter((i) => scene.mask & (1 << i)).length;
  return (
    <section
      className="market-opening pack-scene"
      aria-label="Abrir sobre confirmado"
      data-expansion={packExpansion(opening.packId)?.id}
      data-phase={scene.phase}
      data-complete={scene.mask === 15}
      data-reduced={reduced}
      data-paused={paused}
    >
      <header className="pack-scene-heading">
        <span className="pack-eyebrow">UN NUEVO DESCUBRIMIENTO</span>
        <h2 id="shop-detail-title">{packExpansion(opening.packId)?.name ?? "Tu sobre arcano"}</h2>
        <span className="pack-heading-ornament" aria-hidden="true">✧</span>
        <div className="pack-batch-bar"><strong>Sobre {packNumber} de {packCount}</strong>
          {onOpenAll&&<button onClick={onOpenAll}>Abrir todos</button>}
        </div>
        {scene.phase!=="sealed"&&scene.phase!=="opening"&&<p role="status">
          {scene.phase==="summary"?"Las cuatro cartas están en tu colección.":<><span className="pack-reveal-count">{count} de 4 cartas reveladas</span><span className="pack-reveal-instruction">{count===4?"¡Todas las cartas descubiertas!":"Toca una carta para descubrirla"}</span></>}
        </p>}
      </header>
      {scene.phase === "sealed" || scene.phase === "opening" ? (
        <div className="pack-stage">
          <div className="pack-aura" aria-hidden="true" />
          <div className="market-opening-motes" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <button
            className="sealed-pack-button"
            aria-label="Abrir sobre"
            disabled={scene.phase === "opening"}
            onClick={() => send({ type: "OPEN", reduced })}
          >
            <PackArt packId={opening.packId} />
          </button>
          {scene.phase === "sealed" ? (
            <p className="pack-invitation">
              <span className="pack-touch">Toca para abrir</span>
              <span className="pack-click">Haz clic para abrir</span>
            </p>
          ) : (
            <p role="status">El sello se abre…</p>
          )}
          <button className="pack-skip" onClick={() => send({ type: "SKIP" })}>Omitir</button>
        </div>
      ) : (
        <>
          <div className="pack-reveal-viewport" role="region" aria-label="Cartas del sobre" tabIndex={0}>
          <div className="market-reveal-grid">
            {opening.cards.map((slot, i) => {
              const card = resolvePresentationCard(slot.cardId),
                revealed = !!(scene.mask & (1 << i));
              return (
                <button
                  className="market-reveal-card"
                  key={`${i}-${slot.cardId}`}
                  data-revealed={revealed}
                  data-rarity={revealed && card ? rarityOf(card) : undefined}
                  data-reveal-pending={pending === i}
                  aria-label={
                    revealed
                      ? `Consultar ${card?.name ?? slot.cardId}`
                      : `Revelar carta ${i + 1}`
                  }
                  disabled={pending >= 0 && pending !== i}
                  onClick={() => reveal(i)}
                >
                  <span className="market-reveal-back" aria-hidden="true">
                    ✧
                    <small>
                      RPG-GO
                      <br />
                      TACTICS
                    </small>
                  </span>
                  {revealed && (
                    <span className="market-reveal-face">
                      {card ? <MarketCard card={card} /> : <UnknownReceiptCard cardId={slot.cardId}/>}
                      <small
                        className="pack-acquired"
                        data-new={slot.total === 1}
                      >
                        {slot.total === 1 ? "Nueva" : "+1 copia"}
                      </small>
                      {card &&
                        ["RARE", "LEGENDARY"].includes(rarityOf(card)) && (
                          <span className="pack-card-sparks" aria-hidden="true">
                            {Array.from(
                              {
                                length: rarityOf(card) === "LEGENDARY" ? 8 : 4,
                              },
                              (_, n) => (
                                <i key={n} />
                              ),
                            )}
                          </span>
                        )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          </div>
          <div className="pack-actions">
            {scene.phase === "reveal" ? (
              scene.mask === 15 ? (
                <button
                  className="shop-primary"
                  onClick={() =>
                    onPackComplete
                      ? onPackComplete()
                      : send({ type: "CONTINUE" })
                  }
                >
                  {completeLabel ?? "Continuar"}
                </button>
              ) : (
                <button className="shop-primary" onClick={all}>
                  Revelar todas
                </button>
              )
            ) : (
              <button className="shop-primary" onClick={onDone}>
                Volver a la expansión
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
