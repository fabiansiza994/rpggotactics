import {
  RANKED_PREMIUM_COSMETICS,
  RANKED_PREMIUM_SHOWCASES,
} from '../../game/ranked/premiumCosmetics';
import { useCosmeticView, useCardCosmetics } from './cardCosmetics';
import { CardBackFace } from './CardBack';
export function CardCosmeticPicker() {
  const data = useCosmeticView(),
    busy = useCardCosmetics((s) => s.busy),
    error = useCardCosmetics((s) => s.error);
  const rewards = { ...RANKED_PREMIUM_COSMETICS, ...RANKED_PREMIUM_SHOWCASES };
  const owned = data.owned.filter(
    (o) => ['CARD_BACK', 'CARD_ART'].includes(o.kind) && rewards[o.cosmeticId],
  );
  if (!owned.length) return null;
  return (
    <section className="card-cosmetic-picker" aria-label="Presentación de mis cartas">
      <h3>Presentación de mis cartas</h3>
      <p>Cosméticos: no cambian estadísticas. Un reverso y un Showcase activos a la vez.</p>
      {owned.map((o) => {
        const item = rewards[o.cosmeticId]!,
          slot = o.kind as 'CARD_BACK' | 'CARD_ART',
          active = data.equipped[slot] === o.cosmeticId;
        return (
          <button
            type="button"
            key={o.cosmeticId}
            disabled={busy}
            aria-pressed={active}
            onClick={() =>
              void useCardCosmetics.getState().equip(slot, active ? null : o.cosmeticId)
            }
          >
            {slot === 'CARD_BACK' ? (
              <CardBackFace cosmetics={{ owned: [o], equipped: { CARD_BACK: o.cosmeticId } }} />
            ) : (
              <span aria-hidden="true">✧</span>
            )}
            <span>
              {item.name}
              <small>
                {active ? 'Equipado · quitar' : 'Equipar'}
                {slot === 'CARD_BACK' ? ' · reverso ilustrado' : ' · acabado cosmético'}
              </small>
            </span>
          </button>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
