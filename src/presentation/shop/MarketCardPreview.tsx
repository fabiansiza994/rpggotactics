import { useEffect, useRef } from "react";
import {PRESENTATION_CONTENT as DEFAULT_CONTENT} from '../qa/shapeshifter/runtime';
import {CardAcquisition,openMarketExpansion} from './CardAcquisition';
import { MarketCard } from "./MarketCard";
/** One focused card, no duplicated labels or secondary navigation. */
export function MarketCardPreview({
  cardId,
  onClose,
  onExpansion,
}: {
  cardId: string | null;
  onClose: () => void;
  onExpansion?: (id:string)=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node || !cardId || !DEFAULT_CONTENT.cards[cardId]) return;
    const previous = document.activeElement as HTMLElement | null;
    node.showModal();
    closeButton.current?.focus();
    return () => {
      if (node.open) node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [cardId]);
  const card = cardId ? DEFAULT_CONTENT.cards[cardId] : null;
  return (
    <dialog
      ref={dialog}
      className="market-card-preview-dialog"
      aria-label={card ? `Carta: ${card.name}` : "Carta"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}

    >
      <button
        ref={closeButton}
        className="market-card-preview-close"
        aria-label="Cerrar carta"
        onClick={onClose}
      >
        ×
      </button>
      {card && <><MarketCard card={card} accessible /><CardAcquisition cardId={card.id} onExpansion={id=>{onClose();(onExpansion??openMarketExpansion)(id);}}/></>}
    </dialog>
  );
}
