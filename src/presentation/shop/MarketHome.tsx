import { DEFAULT_CONTENT, ownedFor, type PlayerProfile } from "../../game";
import type { MarketExpansionView } from "../../game/store/market-expansions";
import type { CatalogOffer } from "./api";
import type { MarketSection } from "./market";
import { StoreArt } from "./StoreArt";

/** Presentation only: every destination and purchase still uses the existing market flow. */
export function MarketHome({
  expansions,
  offers,
  profile,
  heroId,
  onExpansion,
  onCategory,
  onOffer,
}: {
  expansions: readonly MarketExpansionView[];
  offers: readonly CatalogOffer[];
  profile: PlayerProfile;
  heroId: string;
  onExpansion: (id: string) => void;
  onCategory: (id: MarketSection) => void;
  onOffer: (offer: CatalogOffer) => void;
}) {
  const featured = expansions.find((e) => e.status === "AVAILABLE");
  const count = (e: MarketExpansionView) =>
    e.cardIds.filter((id) => {
      const c = DEFAULT_CONTENT.cards[id];
      return (
        c &&
        ownedFor(
          profile,
          c.heroId ?? DEFAULT_CONTENT.defaultHeroId!,
          DEFAULT_CONTENT,
        )(id) > 0
      );
    }).length;
  const free = (e: MarketExpansionView) =>
    offers.find((o) => o.booster?.expansionId === e.id && o.booster.freeGrant)
      ?.freeRemaining ?? 0;
  const eligible = offers.filter(
    (o) => !o.booster && o.availability.purchasable,
  );
  const picks: CatalogOffer[] = [];
  for (const o of [
    eligible.find((o) => o.type === "CARD"),
    eligible.find((o) => o.type === "COSMETIC"),
    ...eligible.filter((o) => o.categories.includes("FEATURED")),
  ]) {
    if (o && !picks.some((p) => p.id === o.id) && picks.length < 3)
      picks.push(o);
  }
  return (
    <div className="market-home">
      {featured && (
        <section className="market-home-hero" aria-label="Expansión destacada">
          <img src={featured.art} alt="" />
          <div className="market-home-hero-copy">
            <span className="shop-label">EXPANSIÓN DESTACADA</span>
            <h2>{featured.name}</h2>
            <p>{featured.description.split(". ")[0]}.</p>
            <span>
              {featured.cardIds.length} cartas · Colección: {count(featured)}/
              {featured.cardIds.length}
            </span>
            <progress
              aria-label={`Colección de ${featured.name}`}
              value={count(featured)}
              max={featured.cardIds.length}
            />
            {free(featured) > 0 && (
              <strong className="market-home-free">
                ✧ {free(featured)} sobres gratis disponibles
              </strong>
            )}
            <button
              className="shop-primary"
              onClick={() => onExpansion(featured.id)}
            >
              Explorar expansión
            </button>
          </div>
        </section>
      )}
      <section
        className="market-home-expansions"
        aria-label="Expansiones del mercado"
      >
        <div className="market-home-heading">
          <h2>Expansiones</h2>
          <button onClick={() => onCategory("packs")}>
            Ver todas las expansiones →
          </button>
        </div>
        <div className="market-home-shelf">
          {expansions.map((e) => (
            <button
              key={e.id}
              className="market-home-expansion"
              onClick={() => onExpansion(e.id)}
            >
              <img src={e.art} alt="" loading="lazy" />
              <span className="shop-label">
                {e.status === "AVAILABLE" ? "DISPONIBLE" : "PRÓXIMAMENTE"}
              </span>
              <strong>{e.name}</strong>
              {e.status === "AVAILABLE" ? (
                <small>
                  {e.cardIds.length} cartas · Colección {count(e)}/
                  {e.cardIds.length}
                </small>
              ) : (
                <small>Contenido por anunciar</small>
              )}
            </button>
          ))}
        </div>
      </section>
      {picks.length > 0 && (
        <section aria-label="Destacados del mercado">
          <h2>Destacados</h2>
          <div className="market-home-products">
            {picks.map((o) => (
              <button
                key={o.id}
                className="market-home-product"
                onClick={() => onOffer(o)}
              >
                <div className="market-home-product-art">
                  <StoreArt offer={o} heroId={heroId} />
                </div>
                <strong>{o.title}</strong>
                <small>{o.price.toLocaleString("es-CO")} Cristales</small>
                <span>Ver artículo →</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section aria-label="Explorar mercado">
        <h2>Explorar mercado</h2>
        <nav className="market-home-shortcuts" aria-label="Accesos del mercado">
          {(
            [
              ["cards", "♧", "Cartas"],
              ["cosmetics", "✧", "Cosméticos"],
              ["crystals", "◇", "Cristales"],
              ["packs", "▥", "Expansiones"],
            ] as const
          ).map(([id, icon, label]) => (
            <button key={id} onClick={() => onCategory(id)}>
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      </section>
    </div>
  );
}
