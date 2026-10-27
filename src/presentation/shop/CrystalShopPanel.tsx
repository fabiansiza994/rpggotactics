import { PurchaseConfirmation } from './PurchaseConfirmation';
import type { PurchaseConsent } from '../../game/store/purchaseConsent';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCop } from '../../game/store/realMoney';
import { loadSession } from '../cloud/session';
import { requestBugReport } from '../support/reportContext';
import type { Wallet } from './api';
import { openEpaycoCheckout } from './epaycoCheckout';
import {
  isFinalStatus,
  pendingOrder,
  pollOrder,
  realMoneyApi,
  rememberPendingOrder,
  RESULT_LABEL,
  resultText,
  type CrystalPackageView,
  type OrderView,
  type StoreLegal,
} from './realMoney';
import '../../styles/crystal-shop.css';
import { LEGAL_DRAFT_URLS } from '../site/legal';

export const GUEST_CRYSTALS_TEXT = 'Inicia sesión para comprar Cristales.';

/** Link to the landing drafts without representing them as published policies. */
export function LegalLinks({ legal }: { legal: StoreLegal }) {
  const links: [string, string | null, string][] = [
    ['Términos de compra', legal.termsUrl, LEGAL_DRAFT_URLS.terms],
    ['Política de reembolso', legal.refundUrl, LEGAL_DRAFT_URLS.refunds],
    ['Privacidad', legal.privacyUrl, LEGAL_DRAFT_URLS.privacy],
    ['Entregas digitales', null, LEGAL_DRAFT_URLS.delivery],
  ];
  return (
    <p className="crystal-shop-legal">
      {links.map(([label, url, draft]) => (
        <a key={label} href={url ?? draft} target="_blank" rel="noopener noreferrer"
          className={url ? undefined : 'is-pending'}
          title={url ? undefined : 'Borrador para revisión. Pendiente de aprobación y publicación definitiva.'}>
          {label}{url ? '' : ' (pendiente de publicar)'}
        </a>
      ))}
      <a href="https://rpg-go-tactics.com/contact" target="_blank" rel="noopener noreferrer">Soporte público</a>
    </p>
  );
}

/** Minimal «Historial de compras»: our data only (date, package, price, crystals, result). */
function PurchaseHistory({ token }: { token: string }) {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void realMoneyApi.history(token).then((res) => {
      if (!alive) return;
      if (res.ok) setOrders(res.data.orders);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [token]);
  if (failed) return <p className="crystal-shop-note">No pudimos cargar tu historial de compras.</p>;
  if (!orders) return <p className="crystal-shop-note">Cargando historial…</p>;
  if (!orders.length) return <p className="crystal-shop-note">Todavía no has comprado Cristales.</p>;
  return (
    <ul className="crystal-history">
      {orders.map((o) => (
        <li key={o.orderId} data-result={o.result}>
          <span>{new Date(o.createdAt).toLocaleDateString('es-CO')}</span>
          <span>{o.crystals.toLocaleString('es-CO')} Cristales</span>
          <span>{formatCop(o.amount)}</span>
          <strong>{RESULT_LABEL[o.result]}</strong>
          <code>{o.reference}</code>
          <button type="button" className="crystal-shop-link" onClick={() => requestBugReport({ category: 'STORE', orderId: o.orderId })}>
            Reportar un problema
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "COMPRAR CRISTALES" (functional pass; a visual pass may restyle it). Hidden unless the Worker
 * reports checkout as available. Prices/packages come from the server; the wallet updates from the
 * server's order status after ePayco's signed confirmation — never from the checkout callbacks.
 */
export function CrystalShopPanel({ token, onWallet, onAuthExpired, onCriticalChange }: { token: string | null; onWallet(wallet: Wallet): void; onAuthExpired(): void; onCriticalChange?(critical: boolean): void }) {
  const [packages, setPackages] = useState<CrystalPackageView[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [legal, setLegal] = useState<StoreLegal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const buying = useRef(false);
  const [confirmation, setConfirmation] = useState<{pkg: CrystalPackageView; operationId: string} | null>(null);
  const confirmationRoot = useRef<HTMLDivElement>(null);
  useEffect(() => { if(confirmation) confirmationRoot.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [confirmation]);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<OrderView | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const polling = useRef<{ stop(): void } | null>(null);
  const callbacks = useRef({ onWallet, onAuthExpired });
  useEffect(() => {
    callbacks.current = { onWallet, onAuthExpired };
  });

  useEffect(() => {
    let alive = true;
    void realMoneyApi.packages().then((res) => {
      if (!alive) return;
      if (!res.ok || !res.data.available) { setUnavailable(true); return; }
      setPackages(res.data.packages);
      setTestMode(res.data.testMode);
      setLegal(res.data.legal ?? { termsUrl: null, refundUrl: null, privacyUrl: null, taxNote: null });
    });
    return () => {
      alive = false;
      polling.current?.stop();
    };
  }, []);

  const watch = useCallback((orderId: string, sessionToken: string) => {
    polling.current?.stop();
    polling.current = pollOrder(
      () => realMoneyApi.order(sessionToken, orderId),
      (data) => {
        setOrder(data.order);
        if (data.order.status === 'FULFILLED') {
          callbacks.current.onWallet(data.wallet);
          rememberPendingOrder(null);
        }
      },
      { onAuthError: () => callbacks.current.onAuthExpired() },
    );
  }, []);

  useEffect(() => { const id=pendingOrder(); if(token && id) watch(id,token); return () => polling.current?.stop(); }, [token,watch]);

  async function buy(pkg: CrystalPackageView, consent: PurchaseConsent) {
    const sessionToken = token ?? loadSession()?.token;
    if (!sessionToken || busy || buying.current) return;
    buying.current = true;
    onCriticalChange?.(true);
    setConfirmation(null);
    setBusy(pkg.id);
    setError('');
    setOrder(null);
    const res = await realMoneyApi.checkout(sessionToken, pkg.id, consent);
    buying.current = false;
    onCriticalChange?.(false);
    if (!res.ok) {
      setBusy(null);
      if (res.error.kind === 'AUTH') return callbacks.current.onAuthExpired();
      return setError(res.error.status === 429 ? 'Demasiados intentos de compra. Espera un minuto.' : 'No pudimos iniciar el pago. Intenta nuevamente.');
    }
    const { orderId, sessionId } = res.data;
    rememberPendingOrder(orderId);
    watch(orderId, sessionToken);
    try {
      // Closing the checkout is not a failure: the order stays open and a later webhook still counts.
      await openEpaycoCheckout(sessionId, { onClosed: () => setBusy(null), onResponse: () => setBusy(null), onErrors: () => setBusy(null) });
    } catch {
      setBusy(null);
      setError('No pudimos abrir el pago de ePayco. Intenta nuevamente.');
    }
  }

  if (unavailable) return <p role="status" className="crystal-shop-note">La compra de Cristales no está disponible en este momento. Puedes seguir usando la tienda.</p>;
  if (!packages || !legal) return <p role="status" className="crystal-shop-note">Cargando paquetes de Cristales…</p>;
  const status = order ? resultText(order.result) : null;
  return (
    <section className="shop-section crystal-shop" data-category="CRYSTALS">
      <div className="shop-section-title">
        <h3>Elige tu reserva arcana</h3>
        {testMode && <span className="crystal-shop-test">MODO DE PRUEBA · sin cobros reales</span>}
      </div>
      {!token ? (
        <p className="crystal-shop-note">{GUEST_CRYSTALS_TEXT}</p>
      ) : (
        <>
          <div className="crystal-shop-tabs" role="group" aria-label="Compra de Cristales"><button aria-pressed={!showHistory} onClick={() => setShowHistory(false)}>Paquetes</button><button aria-pressed={showHistory} onClick={() => setShowHistory(true)}>Historial de compras</button></div>
          {!showHistory && <CrystalPackages packages={packages} busy={busy} pending={order !== null && !isFinalStatus(order.status)} onBuy={p => setConfirmation({pkg:p,operationId:crypto.randomUUID()})}/>}
          {confirmation && <div ref={confirmationRoot}><PurchaseConfirmation key={`${token}:${confirmation.operationId}`} pkg={confirmation.pkg} operationId={confirmation.operationId} busy={busy !== null} testMode={testMode} onCancel={() => setConfirmation(null)} onConfirm={consent => void buy(confirmation.pkg, consent)} /></div>}
          {legal.taxNote && <p className="crystal-shop-note">{legal.taxNote}</p>}
          {order && token && order.status !== 'FULFILLED' && <button className="crystal-shop-link" onClick={() => watch(order.orderId,token)}>Actualizar estado del pedido</button>}
          {status && order && (
            <p className={`crystal-shop-status is-${status.tone}`} role="status">
              {order.status === 'FULFILLED' ? `¡Cristales acreditados! +${order.crystals.toLocaleString('es-CO')}` : status.title} <code>{order.reference}</code>
            </p>
          )}
          {error && (
            <p className="shop-error" role="alert">
              {error}
            </p>
          )}
          <p className="crystal-shop-note">Pago procesado por ePayco. Tus Cristales se acreditan cuando ePayco confirma el pago.</p>
          <LegalLinks legal={legal} />
          {showHistory && <PurchaseHistory token={token} />}
        </>
      )}
    </section>
  );
}

/** Catalog-only presentation; no client prices or bonus calculations. */
export function CrystalPackages({packages,busy,pending,onBuy}:{packages:CrystalPackageView[];busy:string|null;pending:boolean;onBuy(pkg:CrystalPackageView):void}) {
  return (
    <div className="crystal-shop-grid">
            {packages.map((p) => (
              <article className="crystal-pack" key={p.id} data-package={p.id}>
                <strong>{p.crystals.toLocaleString('es-CO')}</strong>
                <span>Cristales Arcanos</span>
                {p.bonusCrystals > 0 && (
                  <small className="crystal-pack-bonus">
                    {p.baseCrystals.toLocaleString('es-CO')} + {p.bonusCrystals.toLocaleString('es-CO')} BONUS
                  </small>
                )}
                <em>{formatCop(p.priceCOP)}</em>
                <button className="shop-primary" disabled={busy !== null || pending} onClick={() => onBuy(p)}>
                  {busy === p.id ? 'Preparando pago…' : 'COMPRAR'}
                </button>
              </article>
            ))}
    </div>
  );
}
