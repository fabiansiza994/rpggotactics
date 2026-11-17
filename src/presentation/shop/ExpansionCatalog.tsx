import {ExpansionProduct} from "./ExpansionProduct";
import {CARD_PRESENTATION_CONTENT as DEFAULT_CONTENT} from '../catalog/cardPresentation';
import { useRef } from "react";
import {
  ownedFor,
  copyLimit,
  DECK_RULES,
  rarityOf,
  type PlayerProfile,
} from "../../game";
import type { MarketExpansionView } from "../../game/store/market-expansions";
import type { CatalogOffer } from "./api";
import { MarketCard } from "./MarketCard";
import { BOOSTER_RARITIES } from "../../game/store/boosters";
import { BoosterOdds } from "./BoosterOdds";

export function ExpansionCatalog({
  expansions,
  offers,
  selectedId,
  onSelect,
  profile,
  onInspect,
  onBuy,
  balance,
  busy,
}: {
  expansions: readonly MarketExpansionView[];
  offers: readonly CatalogOffer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  profile: PlayerProfile;
  onInspect: (id: string) => void;
  onBuy: (o: CatalogOffer) => void;
  balance: number;
  busy: boolean;
}) {
  const oddsDialog = useRef<HTMLDialogElement>(null);
  const have = (id: string) => {
    const c = DEFAULT_CONTENT.cards[id];
    return c
      ? ownedFor(
          profile,
          c.heroId ??
            DEFAULT_CONTENT.defaultHeroId ??
            Object.keys(DEFAULT_CONTENT.heroes)[0]!,
          DEFAULT_CONTENT,
        )(id)
      : 0;
  };
  const selected = expansions.find((e) => e.id === selectedId);
  if (!selected)
    return (
      <section className="market-expansions" aria-label="Expansiones">
        <h2>Colecciones de la arena</h2>
        <p>
          Explora las cartas de cada colección. Cada sobre contiene cuatro
          sorteos independientes.
        </p>
        <div
          className="market-expansion-shelf expansion-product-shelf"
          aria-label="Colecciones de cartas"
        >
          {expansions.map(e=><ExpansionProduct key={e.id} expansion={e} offers={offers}
            owned={e.cardIds.filter(id=>have(id)>0).length} onSelect={onSelect}/>)}
        </div>
      </section>
    );
  const cards = selected.cardIds.flatMap((id) =>
    DEFAULT_CONTENT.cards[id] ? [DEFAULT_CONTENT.cards[id]!] : [],
  );
  const ordered = [...cards].sort(
    (a, b) =>
      BOOSTER_RARITIES.indexOf(rarityOf(b)) -
        BOOSTER_RARITIES.indexOf(rarityOf(a)) ||
      a.name.localeCompare(b.name, "es") ||
      a.id.localeCompare(b.id),
  );
  const purchaseOffers = offers
    .filter((o) => o.booster?.expansionId === selected.id)
    .sort((a, b) => (a.booster?.packs ?? 1) - (b.booster?.packs ?? 1));
  const chosen =
    purchaseOffers.find((o) => !o.booster?.freeGrant) ?? purchaseOffers[0];
  const freeOffer = purchaseOffers.find((o) => o.booster?.freeGrant);
  const freeRemaining = freeOffer?.freeRemaining ?? 0;
  const detailCard = (id: string, caption?: string) => {
    const c = DEFAULT_CONTENT.cards[id];
    return c ? (
      <article className="market-card-item" key={id} data-owned={have(id) > 0}>
        {caption && <em>{caption}</em>}
        <button
          className="market-card-button"
          onClick={() => onInspect(id)}
          aria-label={`Consultar ${c.name}; ${have(id) > 0 ? `${have(id)} copias poseídas` : "Faltante"}`}
        >
          <MarketCard card={c} />
          {!offers.some(o=>o.booster?.expansionId===selected.id && o.contents.some(x=>x.kind==='CARD'&&x.cardId===id)) && <small className="market-card-source">{c.acquisition?.source ? 'Fuente exclusiva · fuera del sobre' : 'Fuera del sobre disponible'}</small>}
          <span
            className="market-copy-indicator"
            title={`${have(id)} copias poseídas · máximo ${copyLimit(c, DECK_RULES)} por mazo`}
            aria-label={`${have(id)} copias poseídas; límite por mazo ${copyLimit(c, DECK_RULES)}`}
          >
            <span>
              {Math.min(have(id), copyLimit(c, DECK_RULES))}/
              {copyLimit(c, DECK_RULES)}
            </span>
            {have(id) > copyLimit(c, DECK_RULES) && (
              <small aria-hidden="true">×{have(id)}</small>
            )}
          </span>
        </button>
      </article>
    ) : null;
  };
  return (
    <article
      className="market-expansion-page"
      aria-label={`Detalles de ${selected.name}`}
    >
      <button onClick={() => onSelect(null)}>← Expansiones</button>
      <header className="market-expansion-compact">
        <h2>{selected.name}</h2>
        <p>
          Saldo: <strong>{balance.toLocaleString("es-CO")} Cristales</strong>
        </p>
        {selected.status === "AVAILABLE" && selected.packs.length>0 && (
          <div className="market-hero-purchase">
            {freeOffer && (
              <div className="market-free-packs">
                <strong>
                  🎁 Tus primeros {freeOffer.purchaseLimit ?? selected.freePacksPerPlayer} sobres gratis
                </strong>
                <p role="status">Sobres gratuitos restantes: {freeRemaining}/{freeOffer.purchaseLimit ?? selected.freePacksPerPlayer}</p>
              </div>
            )}
            {freeOffer && freeRemaining > 0 ? (
              <div className="market-free-packs">
                <button
                  className="shop-primary"
                  disabled={busy || !freeOffer.availability.purchasable}
                  onClick={() => onBuy(freeOffer)}
                >
                  ABRIR SOBRE GRATIS
                </button>
                <small>
                  Después: {chosen?.price ?? 200} Cristales por sobre. Mismo
                  contenido y probabilidades.
                </small>
              </div>
            ) : (
              <div className="market-buy-options">
                {purchaseOffers
                  .filter((o) => !o.booster?.freeGrant)
                  .map((o) => (
                    <div key={o.id}>
                      <button
                        className="shop-primary"
                        disabled={
                          busy ||
                          !o.availability.purchasable ||
                          balance < o.price
                        }
                        onClick={() => onBuy(o)}
                      >
                        Comprar x{o.booster?.packs ?? 1} ·{" "}
                        {o.price.toLocaleString("es-CO")} Cristales
                      </button>
                      {balance < o.price && <small>Saldo insuficiente</small>}
                    </div>
                  ))}
              </div>
            )}
            <div className="market-hero-secondary">
              <button onClick={() => oddsDialog.current?.showModal()}>
                Probabilidades
              </button>
            </div>
            {freeRemaining === 0 && chosen && balance < chosen.price && (
              <p role="status">Saldo insuficiente para este sobre.</p>
            )}
          </div>
        )}
      </header>
      <dialog
        ref={oddsDialog}
        className="shop-dialog market-odds-dialog"
        aria-label="Probabilidades del sobre"
      >
        <button
          className="shop-close"
          aria-label="Cerrar probabilidades"
          onClick={() => oddsDialog.current?.close()}
        >
          ×
        </button>
        {chosen ? (
          <BoosterOdds offer={chosen} />
        ) : (
          <p>No hay sobres disponibles.</p>
        )}
      </dialog>
      {selected.status === "COMING_SOON" ? (
        <p className="shop-message">
          Próximamente. Catálogo pendiente de publicación; compras
          deshabilitadas.
        </p>
      ) : (
        <>
          <section className="market-catalog" aria-label="Catálogo completo">
            <h3>Cartas de la expansión · {cards.length} cartas</h3>
            <div className="market-expansion-cards">
              {ordered.map((c) => detailCard(c.id))}
            </div>
          </section>
        </>
      )}
    </article>
  );
}
