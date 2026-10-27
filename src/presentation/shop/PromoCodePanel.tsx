import { useRef, useState, type FormEvent } from 'react';
import { normalizePromoCode, PROMO_INPUT_MAX, PROMO_RESULT_LABEL, PROMO_RESULTS, type PromoResult } from '../../game';
import { storeApi, type PromoRedeemResponse, type PromoRewardLine } from './api';
import '../../styles/promo.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'processing' }
  | { kind: 'success'; code: string; items: PromoRewardLine[] }
  | { kind: 'error'; result: string; message: string };

const isResult = (code: string): code is PromoResult => (PROMO_RESULTS as readonly string[]).includes(code);

/**
 * "Código de regalo" in the store. The client sends only the code text and shows what the server
 * granted; it never decides a reward. Guests are asked to sign in (no local-only redemptions).
 */
export function PromoCodePanel({
  token,
  onRedeemed,
  onAuthExpired,
}: {
  token: string | null;
  onRedeemed(data: PromoRedeemResponse): void;
  onAuthExpired(): void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || busy.current) return;
    const code = normalizePromoCode(text);
    if (!code) {
      setStatus({ kind: 'error', result: 'INVALID_CODE', message: 'Escribe un código válido (4–32 letras o números).' });
      return;
    }
    busy.current = true;
    setStatus({ kind: 'processing' });
    const res = await storeApi.redeemCode(token, code);
    busy.current = false;
    if (res.ok && res.data?.success) {
      setStatus({ kind: 'success', code: res.data.code, items: res.data.reward.items });
      setText('');
      onRedeemed(res.data);
      return;
    }
    if (!res.ok && res.error.kind === 'AUTH') onAuthExpired();
    const result = res.ok ? 'SERVER' : res.error.code;
    setStatus({
      kind: 'error',
      result,
      message: isResult(result)
        ? PROMO_RESULT_LABEL[result]
        : 'No pudimos canjear el código ahora. Inténtalo de nuevo en un momento.',
    });
  }

  return (
    <section className="shop-section promo-panel" aria-labelledby="promo-title" data-status={status.kind}>
      <div className="shop-section-title">
        <h2 id="promo-title">Código de regalo</h2>
        <span>Canjea códigos de eventos y regalos</span>
      </div>
      {token ? (
        <form className="promo-form" onSubmit={(e) => void submit(e)}>
          <input
            className="promo-input"
            aria-label="Código de regalo"
            placeholder="Escribe tu código"
            value={text}
            maxLength={PROMO_INPUT_MAX}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            disabled={status.kind === 'processing'}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="shop-primary" type="submit" disabled={status.kind === 'processing' || !text.trim()}>
            {status.kind === 'processing' ? 'Canjeando…' : 'Canjear'}
          </button>
        </form>
      ) : (
        <p className="promo-guest">Crea o inicia sesión para canjear códigos.</p>
      )}
      <div className="promo-feedback" aria-live="polite">
        {status.kind === 'success' && (
          <div className="promo-success" role="status">
            <span className="shop-label">CÓDIGO CANJEADO</span>
            <strong>{status.code}</strong>
            {status.items.length === 1 ? (
              <span data-kind={status.items[0]!.kind}>Recibiste {status.items[0]!.label}.</span>
            ) : (
              <>
                <span>Recibiste:</span>
                <ul>
                  {status.items.map((i) => (
                    <li key={`${i.kind}:${i.id}`} data-kind={i.kind}>
                      {i.label}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {status.kind === 'error' && (
          <p className="promo-error" role="alert" data-result={status.result}>
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
