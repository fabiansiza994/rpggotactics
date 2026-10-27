import { useState } from 'react';
import { AGE_DECLARATION, PURCHASE_CONSENT_VERSION, type PurchaseConsent } from '../../game/store/purchaseConsent';
import { formatCop } from '../../game/store/realMoney';
import { LEGAL_DRAFT_URLS } from '../site/legal';
import type { CrystalPackageView } from './realMoney';
/** Fresh, explicit declaration for this one operation; never stored as an account age flag. */
export function PurchaseConfirmation({ pkg, operationId, busy, testMode, onConfirm, onCancel }: {
  pkg: CrystalPackageView; operationId: string; busy: boolean; testMode: boolean;
  onConfirm(consent: PurchaseConsent): void; onCancel(): void;
}) {
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  return <section className="crystal-purchase-confirmation" aria-label="Confirmación de compra para mayores de edad">
    <h3>Confirmar compra · Solo mayores de 18 años</h3>
    <p>{pkg.crystals.toLocaleString('es-CO')} Cristales Arcanos · Total: {formatCop(pkg.priceCOP)}</p>
    <p>Compra para tu cuenta conectada. Esto es una declaración del comprador, no una verificación independiente de identidad.</p>
    {testMode && <p className="crystal-shop-test">Solo pruebas · condiciones comerciales en revisión, sin cobros reales.</p>}
    <form onSubmit={event => { event.preventDefault(); if (adult && accepted && !busy) onConfirm({adult:true,termsAccepted:true,version:PURCHASE_CONSENT_VERSION,operationId}); }}>
      <label><input type="checkbox" checked={adult} required disabled={busy} onChange={event => setAdult(event.target.checked)} /> {AGE_DECLARATION}</label>
      <label><input type="checkbox" checked={accepted} required disabled={busy} onChange={event => setAccepted(event.target.checked)} /> He leído y acepto las condiciones aplicables a esta operación{testMode ? ' de prueba (documentos en revisión)' : ''}, incluidas la entrega y los derechos de reclamación. Consulte <a href={LEGAL_DRAFT_URLS.terms} target="_blank" rel="noopener noreferrer">Términos</a>, <a href={LEGAL_DRAFT_URLS.privacy} target="_blank" rel="noopener noreferrer">Privacidad</a>, <a href={LEGAL_DRAFT_URLS.delivery} target="_blank" rel="noopener noreferrer">Entregas</a> y <a href={LEGAL_DRAFT_URLS.refunds} target="_blank" rel="noopener noreferrer">Reembolsos</a>.</label>
      <p>Si no tienes 18 años o no deseas confirmar, cancela. Puedes seguir jugando y recibir contenido gratuito sin declarar edad.</p>
      <button type="submit" className="shop-primary" disabled={!adult || !accepted || busy}>{busy ? 'Preparando pago…' : 'Confirmar y continuar a ePayco'}</button>
      <button type="button" className="crystal-shop-link" disabled={busy} onClick={onCancel}>No tengo 18 años / Cancelar compra</button>
    </form>
  </section>;
}
