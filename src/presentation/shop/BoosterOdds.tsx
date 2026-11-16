import { DEFAULT_CONTENT, rarityOf } from "../../game";
import { BOOSTER_RARITIES } from "../../game/store/boosters";
import type { CatalogOffer } from "./api";
import { RARITY_LABELS } from "./market";
export function BoosterOdds({ offer }: { offer: CatalogOffer }) {
  if (!offer.booster) return null;
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
