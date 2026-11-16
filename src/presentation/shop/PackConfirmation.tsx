import type { CatalogOffer } from "./api";
import { PackArt, packExpansion } from "./PackArt";
export function PackConfirmation({
  offer,
  balance,
  busy,
  onConfirm,
  onCancel,
  demo = false,
}: {
  offer: CatalogOffer;
  balance: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  demo?: boolean;
}) {
  return (
    <section
      className="pack-confirmation"
      aria-label="Confirmar compra de sobre"
    >
      <span className="shop-label">UN NUEVO DESCUBRIMIENTO</span>
      <h2 id="shop-detail-title">
        {packExpansion(offer.id)?.name ?? offer.title}
      </h2>
      <PackArt packId={offer.id} />
      <strong className="pack-price">
        {offer.booster?.freeGrant
          ? "4 cartas · GRATIS"
          : `${offer.booster?.packs ?? 1} ${(offer.booster?.packs ?? 1) === 1 ? "sobre" : "sobres"} · ${(offer.booster?.packs ?? 1) * 4} cartas · ${offer.price.toLocaleString("es-CO")} Cristales Arcanos`}
      </strong>
      <dl>
        <dt>Saldo actual</dt>
        <dd>{balance.toLocaleString("es-CO")}</dd>
        <dt>Saldo después</dt>
        <dd>{(balance - offer.price).toLocaleString("es-CO")}</dd>
        <dt>Tipo de sobre</dt>
        <dd>
          {offer.booster?.poolType === "GENERAL"
            ? "Sobre general"
            : (offer.heroId ?? "Expansión")}
        </dd>
      </dl>
      {demo && (
        <small>Compra de demostración · No utiliza premios reales</small>
      )}
      <div className="pack-actions">
        <button
          className="shop-primary"
          disabled={
            busy || balance < offer.price || !offer.availability.purchasable
          }
          onClick={onConfirm}
        >
          {busy
            ? "Confirmando…"
            : offer.booster?.freeGrant
              ? "Confirmar sobre GRATIS"
              : `Comprar x${offer.booster?.packs ?? 1} · ${offer.price.toLocaleString("es-CO")}`}
        </button>
        <button disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {balance < offer.price && <p role="status">Saldo insuficiente</p>}
    </section>
  );
}
