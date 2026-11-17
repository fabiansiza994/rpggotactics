import { useEffect, useState } from "react";
import type { PurchasePlan } from "../../game/store/store";
import { rarityOf } from "../../game";
import { resolvePresentationCard } from "../catalog/cardPresentation";
import {useReceiptCardDiagnostics} from "./UnknownReceiptCard";
import {packExpansion} from "./PackArt";
import { PackOpening } from "./PackOpening";
export const batchSceneKey = (id: string) => `rpggo.pack-batch.v1:${id}`;
export function restoreBatch(raw: string | null, count: number) {
  try {
    const v = JSON.parse(raw ?? "null");
    if (
      v &&
      Number.isInteger(v.index) &&
      v.index >= 0 &&
      v.index < count &&
      typeof v.summary === "boolean"
    )
      return { index: v.index as number, summary: v.summary as boolean };
  } catch {
    /* Only presentation progress. */
  }
  return { index: 0, summary: false };
}
export function PackBatchOpening({
  openings,
  receiptId,
  onInspect,
  onDone,
}: {
  openings: NonNullable<PurchasePlan["openings"]>;
  receiptId: string;
  onInspect: (id: string) => void;
  onDone: () => void;
}) {
  useReceiptCardDiagnostics(openings.flatMap(o=>o.cards.map(c=>c.cardId)));
  const [state, setState] = useState(() => {
    try {
      return restoreBatch(
        localStorage.getItem(batchSceneKey(receiptId)),
        openings.length,
      );
    } catch {
      return { index: 0, summary: false };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(batchSceneKey(receiptId), JSON.stringify(state));
    } catch {
      /* A saved server receipt remains sufficient to recover all cards. */
    }
  }, [receiptId, state]);
  const cards = openings.flatMap((o) => o.cards),
    fresh = cards.filter((c) => c.total === 1).length;
  const rarityCounts = cards.reduce(
    (a, c) => {
      const card = resolvePresentationCard(c.cardId);
      const r = card ? rarityOf(card) : "UNKNOWN";
      a[r] = (a[r] ?? 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );
  const grouped = new Map<string, { count: number; isNew: boolean }>();
  for (const c of cards) {
    const old = grouped.get(c.cardId);
    grouped.set(c.cardId, {
      count: (old?.count ?? 0) + 1,
      isNew: !!old?.isNew || c.total === 1,
    });
  }
  const next = () =>
    setState((s) =>
      s.index + 1 < openings.length
        ? { index: s.index + 1, summary: false }
        : { ...s, summary: true },
    );
  if (state.summary)
    return (
      <section className="pack-batch-summary">
        <header className="pack-scene-heading">
          <span className="pack-eyebrow">COLECCIÓN ACTUALIZADA</span>
          <h2 id="shop-detail-title">{cards.length} cartas obtenidas</h2>
          <p>{packExpansion(openings[0]?.packId??"")?.name??"Tu colección arcana"}</p>
          <span className="pack-heading-ornament" aria-hidden="true">✧</span>
        </header>
        <p>
          {fresh} nuevas · {cards.length - fresh} copias adicionales
        </p>
        <div className="pack-summary-rarities">
          {Object.entries(rarityCounts).map(([r, n]) => (
            <span key={r}>
              {
                (
                  {
                    COMMON: "Comunes",
                    UNCOMMON: "Infrecuentes",
                    RARE: "Raras",
                    LEGENDARY: "Legendarias",
                    ULTRA: "Ultra",
                    UNKNOWN: "Sin datos visuales",
                  } as Record<string, string>
                )[r]
              }
              : {n}
            </span>
          ))}
        </div>
        <div className="pack-summary-grid">
          {[...grouped].map(([id, c]) => (
            <button key={id} onClick={() => onInspect(id)}>
              <strong>{resolvePresentationCard(id)?.name ?? id}</strong>
              <span>
                ×{c.count} · {c.isNew ? "Nueva" : "+ copias"}
              </span>
            </button>
          ))}
        </div>
        <button className="shop-primary" onClick={onDone}>
          Volver a la expansión
        </button>
      </section>
    );
  return (
    <div className="pack-batch">
      <PackOpening
        key={`${receiptId}:${state.index}`}
        receiptId={`${receiptId}:pack:${state.index}`}
        packNumber={state.index+1}
        packCount={openings.length}
        onOpenAll={()=>setState(s=>({...s,summary:true}))}
        opening={openings[state.index]!}
        onInspect={onInspect}
        onDone={next}
        onPackComplete={next}
        completeLabel={
          state.index + 1 < openings.length ? "Siguiente sobre" : "Ver resumen"
        }
      />
    </div>
  );
}
