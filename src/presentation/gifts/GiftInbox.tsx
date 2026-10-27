import { useEffect, useRef, useState } from 'react';
import { loadSession } from '../cloud/session';
import { useBattleStore } from '../store/battleStore';
import { useSocialStore } from '../social/socialStore';
import { StoreArt } from '../shop/StoreArt';
import type { CatalogOffer } from '../shop/api';
import { blockedText, giftApi, GUEST_GIFT_TEXT, type ReceivedGift, type SentGift } from './api';
import { useGiftStore } from './giftStore';
import '../../styles/gifts.css';

/**
 * Recipient side of store gifts (minimal functional pass; the premium modal and its animation
 * are Codex's visual pass): a notice "🎁 X te ha enviado un regalo!", the gift modal with
 * "RECIBIR REGALO", and the small history panel in the store.
 */

/** The gift's product as StoreArt expects it (StoreArt only reads id/type/heroId/contents). */
const artOffer = (g: ReceivedGift | SentGift) => ({ ...g.product, title: g.productName }) as unknown as CatalogOffer;

/** Keeps the received list in sync with the social badge count. Mount once (App). */
export function GiftRuntime() {
  const ready = useBattleStore((s) => s.account.status === 'READY');
  const pending = useSocialStore((s) => s.overview?.counts.gifts);
  useEffect(() => {
    if (ready) void useGiftStore.getState().refresh();
    else useGiftStore.getState().reset();
  }, [ready, pending]);
  return null;
}

/**
 * Floating notice for the newest pending gift (not over a battle: `quiet`), plus the gift modal.
 * Opening shows the gift; it is NOT claimed until the button is pressed.
 */
export function GiftNotifications({ quiet = false }: { quiet?: boolean }) {
  const received = useGiftStore((s) => s.received);
  const later = useGiftStore((s) => s.later);
  const openId = useGiftStore((s) => s.openId);
  const next = quiet || openId ? null : received.find((g) => g.status === 'PENDING' && !later.includes(g.giftId));
  return (
    <>
      {next && (
        <div className="gift-notice" role="status" data-gift={next.giftId}>
          <span className="gift-notice-icon" aria-hidden="true">
            🎁
          </span>
          <strong>{next.senderUsername} te ha enviado un regalo!</strong>
          <div className="gift-actions">
            <button type="button" className="shop-primary" onClick={() => useGiftStore.getState().open(next.giftId)}>
              Abrir regalo
            </button>
            <button type="button" onClick={() => useGiftStore.getState().snooze(next.giftId)}>
              Más tarde
            </button>
          </div>
        </div>
      )}
      <GiftModal />
    </>
  );
}

/** Basic gift modal (data contract for Codex: see qa/gifts/REPORT.md § Visual handoff). */
export function GiftModal() {
  const gift = useGiftStore((s) => s.received.find((g) => g.giftId === s.openId) ?? null);
  const claiming = useGiftStore((s) => s.claiming);
  const result = useGiftStore((s) => s.result);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (gift && !dialog.current?.open) dialog.current?.showModal();
    if (!gift && dialog.current?.open) dialog.current.close();
  }, [gift]);
  const outcome = gift && result?.giftId === gift.giftId ? result : null;
  const claimed = gift?.status === 'CLAIMED';
  return (
    <dialog
      ref={dialog}
      className="gift-modal"
      aria-labelledby="gift-modal-title"
      data-status={gift?.status}
      data-rarity={gift?.rarity ?? undefined}
      onCancel={(e) => {
        e.preventDefault();
        useGiftStore.getState().close();
      }}
    >
      {gift && (
        <div className="gift-modal-body">
          <h2 id="gift-modal-title">{claimed ? '¡Regalo recibido!' : `🎁 ${gift.senderUsername} te ha enviado un regalo!`}</h2>
          <div className="gift-modal-art">
            <StoreArt offer={artOffer(gift)} heroId={gift.heroId ?? undefined} />
          </div>
          <h3 className="gift-modal-product">{gift.productName}</h3>
          <ul className="gift-lines">
            {gift.rewardSummary.map((l) => (
              <li key={`${l.kind}:${l.id}`}>{l.label}</li>
            ))}
          </ul>
          {gift.message && <blockquote className="gift-message">“{gift.message}”</blockquote>}
          {claimed ? (
            <p role="status" className="gift-claimed">
              Se ha añadido a tu colección.
            </p>
          ) : (
            gift.claimable === false &&
            gift.blockedReason && (
              <p className="gift-error">No puedes recibirlo todavía: {blockedText(gift.blockedReason)}. El regalo sigue guardado.</p>
            )
          )}
          {outcome && !outcome.ok && (
            <p role="alert" className="gift-error">
              {outcome.text}
            </p>
          )}
          <div className="gift-actions">
            {!claimed && (
              <button
                type="button"
                className="shop-primary gift-claim"
                autoFocus
                disabled={claiming || gift.claimable === false}
                onClick={() => void useGiftStore.getState().claim(gift.giftId)}
              >
                {claiming ? 'Recibiendo…' : 'RECIBIR REGALO'}
              </button>
            )}
            <button type="button" disabled={claiming} onClick={() => useGiftStore.getState().close()}>
              {claimed ? 'Cerrar' : 'Más tarde'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

const when = (ms: number) => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendiente', CLAIMED: 'Recibido', CANCELLED: 'Cancelado', EXPIRED: 'Caducado', REVOKED: 'Retirado' };

/** "Regalos" section in the store: received (open/claim) and sent (history). */
export function GiftHistoryPanel({ token }: { token: string | null }) {
  const received = useGiftStore((s) => s.received);
  const [sent, setSent] = useState<SentGift[] | null>(null);
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  useEffect(() => {
    if (!token) return;
    void useGiftStore.getState().refresh();
  }, [token]);
  useEffect(() => {
    if (!token || tab !== 'sent') return;
    let live = true;
    void giftApi.sent(token).then((res) => {
      if (live && res.ok && loadSession()?.token === token) setSent(res.data.gifts);
    });
    return () => {
      live = false;
    };
  }, [token, tab]);
  return (
    <section className="shop-section gift-history" aria-labelledby="gift-history-title">
      <div className="shop-section-title">
        <h2 id="gift-history-title">Regalos</h2>
        <span>Regala a tus amigos desde la ficha de cada producto</span>
      </div>
      {!token ? (
        <p className="gift-guest">{GUEST_GIFT_TEXT}</p>
      ) : (
        <>
          <div className="gift-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'received'} onClick={() => setTab('received')}>
              Recibidos
            </button>
            <button type="button" role="tab" aria-selected={tab === 'sent'} onClick={() => setTab('sent')}>
              Enviados
            </button>
          </div>
          {tab === 'received' ? (
            received.length ? (
              <ul className="gift-list">
                {received.map((g) => (
                  <li key={g.giftId} data-status={g.status}>
                    <span>
                      <strong>{g.productName}</strong> · de {g.senderUsername} · {when(g.createdAt)}
                    </span>
                    {g.status === 'PENDING' ? (
                      <button type="button" className="shop-primary" onClick={() => useGiftStore.getState().open(g.giftId)}>
                        Abrir
                      </button>
                    ) : (
                      <em>{STATUS_LABEL[g.status]}</em>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="gift-muted">Aún no has recibido regalos.</p>
            )
          ) : sent === null ? (
            <p className="gift-muted">Cargando…</p>
          ) : sent.length ? (
            <ul className="gift-list">
              {sent.map((g) => (
                <li key={g.giftId} data-status={g.status}>
                  <span>
                    <strong>{g.productName}</strong> · para {g.recipientUsername} · {when(g.createdAt)} · {g.price} cristales
                  </span>
                  <em>{STATUS_LABEL[g.status]}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gift-muted">Aún no has enviado regalos.</p>
          )}
        </>
      )}
    </section>
  );
}
