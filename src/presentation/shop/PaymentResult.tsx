import { useEffect, useState } from 'react';
import { loadSession } from '../cloud/session';
import { requestBugReport } from '../support/reportContext';
import { pendingOrder, pollOrder, realMoneyApi, rememberPendingOrder, resultText, type OrderResponse } from './realMoney';
import '../../styles/crystal-shop.css';

export const PAYMENT_RESULT_PATH = '/store/payment-result';
const ORDER_ID = /^rmo_[0-9a-f-]{36}$/;
const REF_PAYCO = /^[A-Za-z0-9]{6,64}$/;

/**
 * ePayco's response URL (UX only). It reads OUR order id and shows the server's result. The
 * `ref_payco` ePayco appends is forwarded only as a lookup hint (the server accepts ePayco's own
 * signed record for it only if it belongs to this order); no URL param can grant crystals.
 */
export function PaymentResult() {
  const [visible, setVisible] = useState(() => typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === PAYMENT_RESULT_PATH);
  const [params] = useState(() => {
    if (!visible) return { orderId: null, ref: null };
    const q = new URLSearchParams(location.search);
    const fromUrl = q.get('order');
    const id = fromUrl && ORDER_ID.test(fromUrl) ? fromUrl : pendingOrder();
    const ref = q.get('ref_payco');
    return { orderId: id && ORDER_ID.test(id) ? id : null, ref: ref && REF_PAYCO.test(ref) ? ref : null };
  });
  const [data, setData] = useState<OrderResponse | null>(null);
  const [problem, setProblem] = useState(() =>
    !visible ? '' : !params.orderId ? 'No encontramos el pedido de este pago.' : !loadSession() ? 'Inicia sesión para ver el estado de tu compra.' : '',
  );

  useEffect(() => {
    const token = loadSession()?.token;
    const orderId = params.orderId;
    if (!visible || !orderId || !token) return;
    let first = true;
    const poll = pollOrder(
      () => {
        const hint = first ? params.ref : null; // the hint is only needed once
        first = false;
        return realMoneyApi.order(token, orderId, hint);
      },
      (next) => {
        setData(next);
        if (next.order.status === 'FULFILLED') rememberPendingOrder(null);
      },
      { onAuthError: () => setProblem('Inicia sesión para ver el estado de tu compra.') },
    );
    return () => poll.stop();
  }, [visible, params]);

  if (!visible) return null;
  const order = data?.order ?? null;
  const result = order?.result ?? 'VERIFYING';
  const text = resultText(result);
  const close = () => {
    history.replaceState(null, '', '/play?store=1&crystals=1');
    window.dispatchEvent(new Event('rpggo-open-crystals'));
    // The Store reads the wallet from the server whenever it opens, so the new balance shows there.
    setVisible(false);
  };
  return (
    <div className="payment-result" role="dialog" aria-modal="true" aria-labelledby="payment-result-title" data-result={problem ? 'ERROR' : result}>
      <div className="payment-result-card">
        {order?.testMode !== false && <span className="crystal-shop-test">MODO DE PRUEBA · sin cobros reales</span>}
        <h2 id="payment-result-title">Resultado del pago</h2>
        <p className={`crystal-shop-status is-${problem ? 'bad' : text.tone}`} role="status">
          {problem || (order?.status === 'FULFILLED' ? '¡Cristales acreditados!' : text.title)}
        </p>
        {order && (
          <dl className="payment-result-facts">
            <dt>Cristales</dt>
            <dd>{order.crystals.toLocaleString('es-CO')}</dd>
            {result === 'APPROVED' && data && (
              <>
                <dt>Saldo nuevo</dt>
                <dd>{data.wallet.balance.toLocaleString('es-CO')}</dd>
              </>
            )}
            <dt>Referencia</dt>
            <dd>
              <code>{order.reference}</code>
            </dd>
          </dl>
        )}
        <div className="payment-result-actions">
          <button className="shop-primary" onClick={close}>
            VOLVER A LA TIENDA
          </button>
          <button
            type="button"
            className="crystal-shop-link"
            onClick={() => requestBugReport({ category: 'STORE', ...(params.orderId ? { orderId: params.orderId } : {}) })}
          >
            Reportar un problema
          </button>
        </div>
      </div>
    </div>
  );
}
