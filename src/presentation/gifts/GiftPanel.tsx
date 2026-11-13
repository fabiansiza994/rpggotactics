import {needsQuoteReview} from '../shop/presentation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GIFT_LIMITS } from '../../game';
import { useBattleStore } from '../store/battleStore';
import { useSocialStore } from '../social/socialStore';
import type { CatalogOffer, Wallet } from '../shop/api';
import { giftApi, giftError, giftConfirmation, GUEST_GIFT_TEXT, type GiftQuote } from './api';
import '../../styles/gifts.css';

type Step =
  | { kind: 'closed' }
  | { kind: 'pick'; error?: string }
  | { kind: 'checking' }
  | { kind: 'confirm'; quote: GiftQuote; error?: string; reviewQuote?: boolean }
  | { kind: 'sending'; quote: GiftQuote }
  | { kind: 'sent'; recipient: string };

/**
 * "🎁 REGALAR" in the store's product sheet — a second action next to COMPRAR (minimal functional
 * pass; Codex does the visual pass). Friends only: the picker lists accepted friends, and a typed
 * username is checked by the server. The server quote (price for the RECIPIENT, never prorated)
 * is shown before anything is charged. One idempotency key per confirmed gift, reused on retry.
 * Mount with `key={offer.id}`: another product starts a fresh gift.
 */
export function GiftPanel({ offer, token, onSent }: { offer: CatalogOffer; token: string | null; onSent(wallet: Wallet): void }) {
  const friends = useSocialStore((s) => s.overview?.friends);
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const operation = useRef<{target:string;key:string} | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (step.kind === 'pick' && !friends) void useSocialStore.getState().refresh();
  }, [step.kind, friends]);

  if (!offer.giftable) return null;
  if (!token) return <p className="gift-guest">{GUEST_GIFT_TEXT}</p>;

  async function review(event?: FormEvent) {
    event?.preventDefault();
    const name = recipient.trim().toLowerCase();
    if (!name || busy.current || !token) return;
    busy.current = true;
    setStep({ kind: 'checking' });
    const res = await giftApi.quote(token, offer.id, name);
    busy.current = false;
    if (res.ok) {
      operation.current = giftConfirmation(operation.current,offer.id,name);
      setStep({ kind: 'confirm', quote: res.data });
    } else {
      if (res.error.kind === 'AUTH') useBattleStore.getState().sessionExpired();
      setStep({ kind: 'pick', error: giftError(res.error) });
    }
  }

  async function send(quote: GiftQuote) {
    if (busy.current || !token || !operation.current) return;
    busy.current = true;
    setStep({ kind: 'sending', quote });
    const res = await giftApi.send(token, {
      productId: quote.productId,
      recipientUsername: quote.recipientUsername,
      idempotencyKey: operation.current.key,
      quoteToken: quote.purchaseQuote?.token,
      ...(message.trim() ? { message: message.trim() } : {}),
    });
    busy.current = false;
    if (res.ok) {
      operation.current = null;
      setMessage('');
      setStep({ kind: 'sent', recipient: res.data.gift.recipientUsername });
      onSent(res.data.wallet);
      return;
    }
    if (res.error.kind === 'AUTH') useBattleStore.getState().sessionExpired();
    // Keep the identifier until this operation resolves; a prior request may still commit.
    // Reviewing updated terms retains it; choosing a new recipient starts a new operation.
    setStep({ kind: 'confirm', quote, error: giftError(res.error), reviewQuote: needsQuoteReview(res.error.code) });
  }

  if (step.kind === 'closed')
    return (
      <button type="button" className="gift-open" onClick={() => setStep({ kind: 'pick' })}>
        🎁 REGALAR
      </button>
    );

  return (
    <section className="gift-panel" aria-label="Regalar este producto" data-step={step.kind}>
      {step.kind === 'sent' ? (
        <div role="status" className="gift-sent">
          <strong>Regalo enviado a {step.recipient}.</strong>
          <span>Le llegará una notificación para abrirlo.</span>
          <button type="button" onClick={() => setStep({ kind: 'closed' })}>
            Cerrar
          </button>
        </div>
      ) : step.kind === 'confirm' || step.kind === 'sending' ? (
        <div className="gift-confirm" role="group" aria-label="Confirmar regalo">
          <h3>
            ¿Regalar {step.quote.productName} a {step.quote.recipientUsername}?
          </h3>
          <p>
            Se descontarán <strong>{step.quote.price}</strong> Cristales Arcanos de tu saldo ({step.quote.balance}).
          </p>
          <ul className="gift-lines">
            {step.quote.rewardSummary.map((l) => (
              <li key={`${l.kind}:${l.id}`}>{l.label}</li>
            ))}
          </ul>
          <label className="gift-field">
            <span>Mensaje (opcional)</span>
            <input
              value={message}
              maxLength={GIFT_LIMITS.messageMaxChars}
              placeholder="Para que pruebes esta carta"
              disabled={step.kind === 'sending'}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          {step.kind === 'confirm' && step.error && (
            <p role="alert" className="gift-error">
              {step.error}
            </p>
          )}
          <div className="gift-actions">
            <button type="button" className="shop-primary" disabled={step.kind === 'sending' || !step.quote.purchaseQuote || (step.kind === 'confirm' && step.reviewQuote)} onClick={() => void send(step.quote)}>
              {step.kind === 'sending' ? 'Enviando…' : `Confirmar regalo · ${step.quote.price}`}
            </button>
            {step.kind === 'confirm' && step.reviewQuote && <button type="button" onClick={() => void review()}>Revisar condiciones actuales</button>}
            <button type="button" disabled={step.kind === 'sending'} onClick={() => setStep({ kind: 'pick' })}>
              Cambiar destinatario
            </button>
          </div>
        </div>
      ) : (
        <form className="gift-pick" onSubmit={(e) => void review(e)}>
          <h3>¿A quién se lo regalas?</h3>
          {friends === undefined ? (
            <p className="gift-muted">Cargando amigos…</p>
          ) : friends.length ? (
            <div className="gift-friends" role="list">
              {friends.map((f) => (
                <button
                  type="button"
                  role="listitem"
                  key={f.username}
                  aria-pressed={recipient === f.username}
                  className="gift-friend"
                  onClick={() => setRecipient(f.username)}
                >
                  {f.username}
                </button>
              ))}
            </div>
          ) : (
            <p className="gift-muted">Todavía no tienes amigos. Solo puedes regalar a amigos aceptados.</p>
          )}
          <label className="gift-field">
            <span>Nombre de usuario</span>
            <input
              value={recipient}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              placeholder="Escribe el nombre de tu amigo"
              disabled={step.kind === 'checking'}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          {step.kind === 'pick' && step.error && (
            <p role="alert" className="gift-error">
              {step.error}
            </p>
          )}
          <div className="gift-actions">
            <button type="submit" className="shop-primary" disabled={step.kind === 'checking' || !recipient.trim()}>
              {step.kind === 'checking' ? 'Comprobando…' : 'Revisar regalo'}
            </button>
            <button type="button" disabled={step.kind === 'checking'} onClick={() => setStep({ kind: 'closed' })}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
