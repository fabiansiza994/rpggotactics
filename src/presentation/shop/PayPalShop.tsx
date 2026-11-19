import { useEffect, useRef, useState } from 'react';
import { paypalSandboxBuildEnabled, paypalReturnPending } from './paypalAvailability';
import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';
import { loadSession } from '../cloud/session';
import type { Wallet } from './api';
import '../../styles/crystal-shop.css';
import '../../styles/paypal-shop.css';

type Package = { id: string; name: string; crystals: number; usd: string; bestValue?: boolean };
type Status = 'CREATED' | 'APPROVED' | 'PENDING' | 'DECLINED' | 'FULFILLED' | 'REVIEW';
type Order = { id: string; packageId: string; crystals: number; usd: string; status: Status; checkoutUrl: string | null; createdAt: number };
type OrderResult = { order: Order; wallet?: Wallet };

const path = '/api/tactics/store/paypal';
const endpoint = CLOUD_CONFIG.apiUrl;
const timeoutMs = 30000;
const ordersPath = path + '/orders';
const packageArt: Readonly<Record<string, string | undefined>> = {
  arcane_small: '/art/arcane-crystal-packs/bag.webp',
  arcane_medium: '/art/arcane-crystal-packs/chest.webp',
  arcane_large: '/art/arcane-crystal-packs/treasure.webp',
  arcane_vault: '/art/arcane-crystal-packs/vault.webp',
};
const labels: Record<Status, string> = {
  CREATED: 'Esperando aprobación en PayPal.',
  APPROVED: 'Pago aprobado. Falta confirmar el cobro.',
  PENDING: 'Pago pendiente de confirmación.',
  DECLINED: 'PayPal rechazó el pago.',
  FULFILLED: 'Pago confirmado. Cristales acreditados.',
  REVIEW: 'Pago en revisión por reembolso o disputa.',
};
const money = (usd: string) => 'US$' + usd;
const crystals = (amount: number) => amount.toLocaleString('es-CO');
const getOrder = (token: string, id: string, capture: boolean) =>
  request<OrderResult>(endpoint, ordersPath + '/' + encodeURIComponent(id) + (capture ? '/capture' : ''), {
    token, timeoutMs, method: capture ? 'POST' : 'GET',
  });

export function PayPalShop({ token, onWallet }: { token: string | null; onWallet(wallet: Wallet): void }) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const attempts = useRef(new Map<string, string>());

  useEffect(() => {
    if (!paypalSandboxBuildEnabled()) return;
    let active = true;
    void request<{ available: boolean; packages: Package[] }>(endpoint, path + '/catalog', { timeoutMs })
      .then(result => { if (active && result.ok && result.data.available) setPackages(result.data.packages); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try { await action(); }
    finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function buy(packageId: string) {
    if (!token) return;
    void run(async () => {
      const storageKey = 'rpggo:paypal-attempt:' + packageId;
      let key = attempts.current.get(packageId) ?? crypto.randomUUID();
      try {
        key = sessionStorage.getItem(storageKey) ?? key;
        sessionStorage.setItem(storageKey, key);
      } catch { /* storage can be disabled */ }
      attempts.current.set(packageId, key);
      const clearAttempt = () => {
        attempts.current.delete(packageId);
        try { sessionStorage.removeItem(storageKey); } catch { /* storage can be disabled */ }
      };
      const result = await request<OrderResult>(endpoint, ordersPath, {
        token, timeoutMs, method: 'POST', body: { packageId }, idempotencyKey: key,
      });
      if (!result.ok) {
        if (result.error.code === 'ORDER_EXPIRED' || result.error.code === 'ORDER_CONFLICT') clearAttempt();
        setMessage(result.error.kind === 'AUTH' ? 'Inicia sesión de nuevo.' : 'No pudimos abrir PayPal. Puedes reintentar.');
        return;
      }
      if (result.data.order.checkoutUrl) {
        clearAttempt();
        location.assign(result.data.order.checkoutUrl);
      }
      else setMessage('No encontramos el enlace a PayPal.');
    });
  }

  function loadHistory() {
    if (!token) return;
    void run(async () => {
      const result = await request<{ orders: Order[] }>(endpoint, ordersPath, { token, timeoutMs });
      if (result.ok) {
        setOrders(result.data.orders);
        if (!result.data.orders.length) setMessage('Todavía no hay pedidos de PayPal.');
      } else setMessage('No pudimos cargar el historial.');
    });
  }

  function check(order: Order, capture: boolean) {
    if (!token) return;
    void run(async () => {
      const result = await getOrder(token, order.id, capture);
      if (!result.ok) return setMessage('No pudimos verificar el pedido. Consulta su estado antes de reintentar.');
      setOrders(previous => previous.map(item => item.id === order.id ? result.data.order : item));
      if (result.data.wallet && loadSession()?.token === token) onWallet(result.data.wallet);
      setMessage(labels[result.data.order.status]);
    });
  }

  if (!packages.length) return null;
  return (
    <section className="shop-section crystal-shop paypal-shop" aria-label="Paquetes PayPal">
      <div className="shop-section-title">
        <h2>Comprar Cristales Arcanos</h2>
        <span className="crystal-shop-test">PayPal Sandbox · sin cobros reales</span>
      </div>
      <div className="crystal-shop-grid">
        {packages.map(pkg => {
          const art = packageArt[pkg.id];
          return (
            <article className="crystal-pack" data-best={pkg.bestValue || undefined} key={pkg.id}>
              <div className="paypal-pack-art">
                {art && <img src={art} width={640} height={426} alt="" decoding="async" />}
              </div>
              <div className="paypal-pack-title">
                <h3>{pkg.name}</h3>
                {pkg.bestValue && <small>Mejor valor</small>}
              </div>
              <div className="paypal-pack-quantity">
                <strong>{crystals(pkg.crystals)}</strong>
                <span>Cristales Arcanos</span>
              </div>
              <em>{money(pkg.usd)}</em>
              <button className="shop-primary" disabled={!token || busy} onClick={() => buy(pkg.id)}>Pagar con PayPal</button>
            </article>
          );
        })}
      </div>
      {token
        ? <button className="crystal-shop-link" disabled={busy} onClick={loadHistory}>Historial de compras PayPal</button>
        : <p>Inicia sesión para comprar Cristales.</p>}
      {(message || busy) && <p role="status">{busy ? 'Procesando…' : message}</p>}
      {!!orders.length && <ul className="crystal-history">
        {orders.map(order => <li key={order.id}>
          <span>{new Date(order.createdAt).toLocaleDateString('es-CO')}</span>
          <span>{packages.find(pkg => pkg.id === order.packageId)?.name ?? order.packageId}</span>
          <span>{crystals(order.crystals)} Cristales</span>
          <span>{money(order.usd)}</span>
          <strong>{labels[order.status]}</strong>
          <button className="crystal-shop-link" disabled={busy} onClick={() => check(order, false)}>Consultar estado</button>
          {order.status === 'APPROVED' && <button className="shop-primary" disabled={busy} onClick={() => check(order, true)}>Confirmar pago</button>}
          {order.status === 'CREATED' && order.checkoutUrl && <a href={order.checkoutUrl}>Volver a PayPal</a>}
        </li>)}
      </ul>}
    </section>
  );
}

export function PayPalResult({ onClose }: { onClose?(): void } = {}) {
  const [params] = useState(() => new URLSearchParams(location.search));
  const id = params.get('order');
  const flow = params.get('paypal');
  const [open, setOpen] = useState(() => paypalReturnPending());
  const [status, setStatus] = useState(flow === 'cancelled' ? 'Pago cancelado.' : 'Verificando el pago…');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    if (!open || !id || flow !== 'approved') return;
    const token = loadSession()?.token;
    if (!token) return;
    let active = true;
    void getOrder(token, id, true).then(result => {
      if (!active || loadSession()?.token !== token) return;
      if (result.ok) {
        setOrder(result.data.order);
        setStatus(labels[result.data.order.status]);
        setWallet(result.data.wallet ?? null);
        if (result.data.wallet) window.dispatchEvent(new Event('rpggo-paypal-wallet-confirmed'));
      } else setStatus('No pudimos confirmar el pago. Consulta su estado.');
    });
    return () => { active = false; };
  }, [flow, id, open]);

  async function refresh(capture: boolean) {
    const token = loadSession()?.token;
    if (!token || !id || busy) return;
    setBusy(true);
    const result = await getOrder(token, id, capture);
    setBusy(false);
    if (loadSession()?.token !== token) return;
    if (result.ok) {
      setOrder(result.data.order);
      setStatus(labels[result.data.order.status]);
      setWallet(result.data.wallet ?? null);
      if (result.data.wallet) window.dispatchEvent(new Event('rpggo-paypal-wallet-confirmed'));
    } else setStatus('No pudimos verificar el pedido. Intenta consultar su estado de nuevo.');
  }

  if (!open) return null;
  const signedIn = !!loadSession()?.token;
  return <div className="payment-result" role="dialog" aria-modal="true" aria-labelledby="paypal-result-title">
    <div className="payment-result-card">
      <span className="crystal-shop-test">PayPal Sandbox</span>
      <h2 id="paypal-result-title">Resultado del pago</h2>
      <p role="status">{!signedIn ? 'Inicia sesión y consulta el pedido en el historial.' : busy ? 'Procesando pago…' : status}</p>
      {wallet && <p>Saldo confirmado: {crystals(wallet.balance)} Cristales.</p>}
      {signedIn && <button className="shop-primary" disabled={busy} onClick={() => void refresh(false)}>Consultar estado</button>}
      {signedIn && order?.status === 'APPROVED' && <button className="shop-primary" disabled={busy} onClick={() => void refresh(true)}>Confirmar pago</button>}
      <button className="crystal-shop-link" onClick={() => {
        const url = new URL(location.href);
        for (const key of ['paypal', 'order', 'token', 'PayerID']) url.searchParams.delete(key);
        history.replaceState(history.state, '', url);
        setOpen(false);
        onClose?.();
      }}>Cerrar</button>
    </div>
  </div>;
}
