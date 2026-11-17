import { useEffect } from 'react';
import { resolvePresentationCard } from '../catalog/cardPresentation';
const diagnosed = new Set<string>();
/** Diagnostics contain public card IDs only, never a session or the receipt payload. */
export function useReceiptCardDiagnostics(ids: readonly string[]) {
  const missing = [...new Set(ids.filter(id => !resolvePresentationCard(id)))].sort().join('\n');
  useEffect(() => {
    for (const id of missing.split('\n').filter(Boolean)) {
      if (diagnosed.has(id)) continue;
      if (diagnosed.size >= 200) diagnosed.clear();
      diagnosed.add(id);
      console.warn('[market:unresolved-receipt-card]', {cardId:id});
    }
  }, [missing]);
}
export function UnknownReceiptCard({cardId}:{cardId:string}) {
  return <span className="market-unknown-card" role="status" data-unresolved-card={cardId}>
    <strong>Carta confirmada</strong><span>{cardId}</span>
    <small>Datos visuales no disponibles. Tu entrega se conserva en el recibo.</small>
  </span>;
}
