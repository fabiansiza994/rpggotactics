import { cardBackFor, useCosmeticView } from './cardCosmetics';
import type { Cosmetics } from '../shop/api';
import '../../styles/card-cosmetics.css';
export const STANDARD_CARD_BACK = '/art/card-backs/standard.webp';
/** Standard and owned equipped backs share one renderer; art is requested only when rendered. */
export function CardBackFace({ cosmetics }: { cosmetics: Cosmetics }) {
  const id = cardBackFor(cosmetics);
  return (
    <span
      className="card-back-face"
      data-card-back={id ?? 'default'}
      data-art-state="final"
      aria-label={id ? 'Sello del Círculo Arcano' : 'Reverso de carta'}
      title={id ? 'Reverso Premium equipado' : 'Reverso de carta'}
    >
      <img src={id ? `/art/ranked-premium/${id}.webp` : STANDARD_CARD_BACK} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
export function EquippedCardBack() {
  const data = useCosmeticView();
  return <CardBackFace cosmetics={data} />;
}
