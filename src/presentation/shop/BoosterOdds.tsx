import {boxTotal} from '../../game/store/boxes';
import { CARD_PRESENTATION_CONTENT as DEFAULT_CONTENT } from "../catalog/cardPresentation";
import { rarityOf } from "../../game";
import { BOOSTER_RARITIES } from "../../game/store/boosters";
import type { CatalogOffer } from "./api";
import { RARITY_LABELS } from "./market";
export function BoosterOdds({ offer }: { offer: CatalogOffer }) {
  if (!offer.booster) return null;
  const box=offer.booster.box;
  if(box){const total=boxTotal(box.remaining);return <section aria-label="Probabilidades del sobre"><h3>Probabilidades de la caja actual</h3><p>Cuatro cartas sin reemplazo. Cada copia restante tiene la misma posibilidad de salir. Las probabilidades cambian después de cada carta extraída; no son sorteos independientes.</p><p>{total} cartas · caja {box.generation}. Una copia de cada Ultra por generación completa.</p><div className="market-odds">{BOOSTER_RARITIES.map(r=>{const n=Object.entries(box.remaining).filter(([id])=>DEFAULT_CONTENT.cards[id]&&rarityOf(DEFAULT_CONTENT.cards[id]!)===r).reduce((n,[,v])=>n+v,0);return <div key={r}><strong>{RARITY_LABELS[r]}</strong><small>{n}/{total} en la próxima extracción {total>0?`(${(100*n/total).toFixed(2)} %)`:'· agotada'}</small></div>;})}</div><details><summary>Probabilidad individual por carta</summary>{Object.entries(box.remaining).map(([id,n])=><p key={id}>{DEFAULT_CONTENT.cards[id]?.name??id}: {n}/{total} {total>0?`(${(100*n/total).toFixed(2)} %)`:'· agotada'}</p>)}</details></section>;}
  return (
    <section aria-label="Probabilidades del sobre">
      <h3>Probabilidades por carta</h3>
      <p>
        Cuatro sorteos independientes. Sin rareza garantizada. Puede contener
        duplicados, que se conservan en tu colección.
      </p>
      <div className="market-odds">
        {BOOSTER_RARITIES.map((r) => {
          const n = offer.contents.filter(
              (c) =>
                c.kind === "CARD" &&
                DEFAULT_CONTENT.cards[c.cardId] &&
                rarityOf(DEFAULT_CONTENT.cards[c.cardId]!) === r,
            ).length,
            w = offer.booster!.weights[r];
          return (
            <div key={r}>
              <strong>
                {RARITY_LABELS[r]} · {w}%
              </strong>
              <small>
                {w === 0
                  ? "No incluida"
                  : `${n} cartas posibles · cada carta: ${w}% ÷ ${n} por sorteo`}
              </small>
            </div>
          );
        })}
      </div>
      <small>
        Precio y probabilidades corresponden a la cotización actual del
        servidor.
      </small>
    </section>
  );
}
