import { premiumThumbnail } from './premiumPresentation';
import { FINAL_CARD_ART } from '../assets/paintedAssets';
import { CardPremiumFx } from '../react/components/CardPremiumFx';
import { useCardPremiumEffect } from '../cards/useCardPremiumEffect';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PremiumItemView,
  PremiumNodeView,
  PremiumTrackView,
} from '../../game/ranked/premiumTrack';
import { formatRp } from '../../game/ranked/ranked';
import { rankedApi } from './rankedApi';
import { PREMIUM_CARDS, premiumArt, premiumName, premiumStatus } from './premiumPresentation';
import { RankedCosmeticEquip } from './RankedCosmetics';
import { equipTitle } from '../mastery/masteryApi';
import { SocialChampionPortrait } from '../social/SocialChampionPortrait';
import type { CloudResult } from '../cloud/http';
import '../../styles/ranked-premium-track.css';

const CardCosmeticPicker = lazy(() => import('../cosmetics/CardCosmeticPicker').then(m => ({default: m.CardCosmeticPicker})));
const EarnCrystals = lazy(() =>
  import('../shop/EarnCrystalsModal').then((m) => ({ default: m.EarnCrystalsModal })),
);
const HERO_LABEL: Record<string, string> = {
  mage: 'Mago',
  summoner: 'Invocador',
  warrior: 'Guerrero',
  archer: 'Arquero',
  shapeshifter: 'Cambiaformas',
};
const KIND = {
  CARD: 'Carta · Legendaria Única',
  AVATAR: 'Avatar',
  COSMETIC: 'Cosmético',
  TITLE: 'Título',
  CRYSTALS: 'Cristales Arcanos',
  SHOWCASE_CHOICE: 'Showcase · elige 1 de 5',
};
const GLYPH = {
  CARD: '▧',
  AVATAR: '◉',
  COSMETIC: '♜',
  TITLE: '✦',
  CRYSTALS: '◆',
  SHOWCASE_CHOICE: '✧',
};

export function PremiumRewardArt({
  item,
  compact = false,
}: {
  item: PremiumItemView;
  compact?: boolean;
}) {
  const src = compact ? premiumThumbnail(item) : premiumArt(item);
  const base = PREMIUM_CARDS[item.cardId ?? (item.type === 'SHOWCASE_CHOICE' ? item.chosenCardId ?? 'double_moon_pact' : '')];
  const card = useMemo(() => base && item.type === 'SHOWCASE_CHOICE'
    ? { ...base, presentation: { ...base.presentation, premiumTreatment: 'showcase' as const } } : base, [base, item.type]);
  const artRef = useCardPremiumEffect<HTMLSpanElement>(card, compact ? 'grid' : 'large', false, !compact);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const artwork = <img src={src} alt={premiumName(item)} loading="lazy" decoding="async" onError={() => setFailedSrc(src ?? null)} />;
  return (
    <span
      ref={artRef}
      className="rpt-art"
      data-kind={item.cosmeticKind ?? item.type}
      data-compact={compact || undefined}
    >
      {src && src !== failedSrc ? (
        card ? <span className="rpt-art-image">{artwork}<CardPremiumFx def={card} /></span> : artwork
      ) : (
        <>
          <span className="rpt-art-symbol" aria-hidden="true">
            {compact && item.type === 'CARD' && item.heroId ? (
              <SocialChampionPortrait id={item.heroId} />
            ) : (
              GLYPH[item.type]
            )}
          </span>
          {!compact && (
            <small>
              {item.type === 'CRYSTALS'
                ? 'CRISTALES ARCANOS'
                : item.type === 'TITLE'
                  ? 'TÍTULO EXCLUSIVO'
                  : 'Vista previa no disponible'}
            </small>
          )}
        </>
      )}
      {item.type === 'CRYSTALS' && <b>{item.quantity}</b>}
    </span>
  );
}

export function PremiumNode({
  node,
  purchased,
  selected,
  current,
  next,
  onSelect,
}: {
  node: PremiumNodeView;
  purchased: boolean;
  selected: boolean;
  current: boolean;
  next: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className="rpt-node"
      data-status={node.status}
      data-items={node.items.length}
      data-pass={purchased ? 'owned' : 'required'}
      data-current={current || undefined}
      data-next={next || undefined}
      aria-pressed={selected}
      aria-label={`Premium · ${node.label}, ${formatRp(node.requiredRp)}: ${node.items.map(premiumName).join(', ')}. ${premiumStatus(node.status, purchased)}`}
      onClick={onSelect}
    >
      <span className="rpt-node-heading">
        <small>✦ PREMIUM</small>
        <span>{formatRp(node.requiredRp)}</span>
      </span>
      {node.items.map((item) => (
        <span key={item.rewardId} className="rpt-node-reward">
          <PremiumRewardArt item={item} compact />
          <span>
            <b>{premiumName(item)}</b>
            <small>
              {KIND[item.type]}
              {item.heroId ? ` · ${HERO_LABEL[item.heroId] ?? item.heroId}` : ''}
            </small>
          </span>
        </span>
      ))}
      <span className="rpt-node-status">
        {node.status === 'CLAIMED' ? '✓' : node.status === 'CLAIMABLE' ? '◇' : '⌑'}{' '}
        {node.items.some((i) => i.type === 'SHOWCASE_CHOICE' && i.status === 'CLAIMABLE')
          ? 'Elegir Showcase'
          : premiumStatus(node.status, purchased)}
        {next ? ' · Siguiente' : current ? ' · Actual' : ''}
      </span>
    </button>
  );
}

export interface PremiumActions {
  purchase: typeof rankedApi.purchasePremium;
  showcase: typeof rankedApi.chooseShowcase;
  equipTitle?: typeof equipTitle;
}
export const livePremiumActions: PremiumActions = {
  purchase: rankedApi.purchasePremium,
  showcase: rankedApi.chooseShowcase,
  equipTitle,
};

export function PremiumPurchasePanel({
  view,
  balance,
  onChange,
  onRefresh,
  actions = livePremiumActions,
}: {
  view: PremiumTrackView;
  balance: number | null;
  onChange(view: PremiumTrackView, balance?: number): void;
  onRefresh(): void;
  actions?: PremiumActions;
}) {
  const [confirm, setConfirm] = useState(false);
  const [earnOpen, setEarnOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const key = useRef('');
  const submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const insufficient = balance !== null && balance < view.price;
  useEffect(() => {
    if (confirm) confirmation.current?.focus();
  }, [confirm]);
  const dismiss = () => {
    if (!submitting.current) {
      setConfirm(false);
      trigger.current?.focus();
    }
  };
  const purchase = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = await actions.purchase(view.seasonId, key.current);
      if (!result) {
        setNotice('Inicia sesión para desbloquear la pista.');
        return;
      }
      if (result.ok) {
        onChange(result.data.premium, result.data.balance);
        onRefresh();
        setNotice(
          `Pista premium desbloqueada · ${result.data.granted.length} recompensas concedidas. Saldo: ${result.data.balance} Cristales.`,
        );
        setConfirm(false);
      } else {
        if (result.error.code === 'INSUFFICIENT_FUNDS') {
          const latestBalance = result.error.details?.balance;
          if (
            typeof latestBalance === 'number' &&
            Number.isSafeInteger(latestBalance) &&
            latestBalance >= 0
          )
            onChange(view, latestBalance);
          setConfirm(false);
          setEarnOpen(true);
          onRefresh();
        }
        if (result.error.code === 'ALREADY_PURCHASED' || result.error.code === 'SEASON_MISMATCH') {
          onRefresh();
          setConfirm(false);
        }
        setNotice(
          result.error.code === 'INSUFFICIENT_FUNDS'
            ? 'No tienes suficientes Cristales Arcanos. Tu saldo no se ha debitado por esta compra.'
            : result.error.message,
        );
        // Retain the operation key and confirmation after an uncertain response for a safe retry.
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-busy={busy} className="rpt-purchase" aria-label="Pista Premium Ranked">
      <div>
        <span className="rpt-eyebrow">✦ EL CÍRCULO ARCANO · PREMIUM</span>
        <h3>
          {view.purchased ? 'Pista premium desbloqueada' : 'Una segunda ruta. Los mismos hitos.'}
        </h3>
        <p>
          Usa los mismos hitos de RP del track gratuito. Las recompensas alcanzadas se conceden
          retroactivamente al comprar.
        </p>
        <small>
          {view.crystalReturn} Cristales en todo el recorrido · las recompensas concedidas se
          conservan al bajar de rango.
        </small>
      </div>
      <div className="rpt-purchase-action">
        <strong>
          ◆ {view.price} <small>Cristales Arcanos</small>
        </strong>
        {view.purchased ? (
          <span className="rpt-owned">✓ Pista premium desbloqueada</span>
        ) : (
          <>
            <span>
              {balance === null ? 'Consultando saldo…' : `Tu saldo: ${balance} Cristales`}
            </span>
            <button
              ref={trigger}
              type="button"
              disabled={balance === null || insufficient}
              onClick={() => {
                key.current = crypto.randomUUID();
                setConfirm(true);
                setNotice('');
              }}
            >
              Desbloquear pista premium
            </button>
            {insufficient && (
              <>
                <small role="status">Te faltan {view.price - balance!} Cristales Arcanos.</small>
                <button type="button" className="rpt-secondary" onClick={() => setEarnOpen(true)}>
                  Cómo conseguir cristales
                </button>
              </>
            )}
          </>
        )}
      </div>
      {confirm && !view.purchased && (
        <div
          data-premium-confirm
          ref={confirmation}
          tabIndex={-1}
          className="rpt-confirm"
          role="group"
          aria-label="Confirmar desbloqueo premium"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              dismiss();
            }
          }}
        >
          <h4>Desbloquear por {view.price} Cristales Arcanos</h4>
          <p>
            Recibirás ahora {view.onPurchase.nodes} hitos alcanzados, incluidos{' '}
            {view.onPurchase.crystals} Cristales
            {view.onPurchase.cards.length
              ? ` y ${view.onPurchase.cards.map((id) => PREMIUM_CARDS[id]?.name ?? id).join(', ')}`
              : ''}
            . El resto se obtiene al avanzar.
          </p>
          <p>
            El avatar de Hierro III se concede al comprar, incluso con 0 RP, y queda disponible en tu selector de perfil.
          </p>
          <button type="button" disabled={busy} onClick={() => void purchase()}>
            {busy ? 'Desbloqueando…' : `Confirmar · ${view.price} Cristales`}
          </button>
          <button type="button" className="rpt-secondary" disabled={busy} onClick={dismiss}>
            Cancelar
          </button>
        </div>
      )}
      {view.purchased && actions === livePremiumActions && <Suspense fallback={null}><CardCosmeticPicker /></Suspense>}
      {earnOpen && (
        <Suspense fallback={<p role="status">Cargando…</p>}>
          <EarnCrystals open onClose={() => setEarnOpen(false)} />
        </Suspense>
      )}
      {notice && (
        <p className="rpt-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

export function PremiumDetail({
  node,
  view,
  onChange,
  onRefresh,
  actions = livePremiumActions,
}: {
  node: PremiumNodeView;
  view: PremiumTrackView;
  onChange(view: PremiumTrackView): void;
  onRefresh(): void;
  actions?: PremiumActions;
}) {
  const [choice, setChoice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const saving = useRef(false);
  const pick = async () => {
    if (!choice || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const r = await actions.showcase(choice);
      if (r?.ok) {
        onChange(r.data.premium);
        setNotice('Showcase concedido. La elección se ha guardado.');
        setConfirm(false);
      } else {
        setNotice(r?.error.message ?? 'Inicia sesión para elegir.');
        if (r && !r.ok && r.error.code === 'SHOWCASE_ALREADY_CHOSEN') onRefresh();
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="rpt-detail"
      aria-busy={busy}
      aria-label={`Recompensas Premium de ${node.label}`}
    >
      <header>
        <span className="rpt-eyebrow">✦ PISTA PREMIUM</span>
        <h3>
          {node.label} · {formatRp(node.requiredRp)}
        </h3>
        <span>{premiumStatus(node.status, view.purchased)}</span>
      </header>
      <div className="rpt-detail-items">
        {node.items.map((item) => {
          const card = item.cardId ? PREMIUM_CARDS[item.cardId] : undefined;
          return (
            <article className="rpt-detail-item" key={item.rewardId} data-kind={item.type}>
              <PremiumRewardArt item={item} />
              <div>
                <small>
                  {KIND[item.type]}
                  {item.heroId ? ` · ${HERO_LABEL[item.heroId] ?? item.heroId}` : ''}
                </small>
                <h4>{premiumName(item)}</h4>
                {card && (
                  <>
                    <span className="rpt-card-meta">
                      <SocialChampionPortrait id={card.heroId!} />
                      {HERO_LABEL[card.heroId!] ?? card.heroId} · Coste {card.cost} · Legendaria ·
                      Única
                    </span>
                    <p>{card.rulesText}</p>
                  </>
                )}
                <p>
                  {item.status === 'CLAIMED'
                    ? '✓ Concedido a tu cuenta'
                    : !view.purchased
                      ? node.reached
                        ? 'Hito alcanzado: se concede al desbloquear Premium.'
                        : 'Necesitas la pista Premium y alcanzar este hito de RP.'
                      : item.type === 'SHOWCASE_CHOICE' && item.status === 'CLAIMABLE'
                        ? 'Elige una variante cosmética. No cambia el poder de la carta.'
                        : node.reached
                          ? 'Entrega pendiente de sincronización.'
                          : 'Avanza en Ranked para alcanzar este hito.'}
                </p>
                {item.availability === 'EARLY_ACCESS' && (
                  <small>
                    Acceso anticipado esta temporada y la siguiente. Ruta gratuita prevista desde
                    Temporada 2.
                  </small>
                )}
                {item.cosmeticKind === 'CARD_BACK' && (
                  <p className="rpt-pending">
                    Reverso seleccionable en «Presentación de mis cartas». Reverso ilustrado del Círculo Arcano.
                  </p>
                )}
                {item.type === 'AVATAR' && !premiumArt(item) && (
                  <p className="rpt-pending">
                    Se guarda la propiedad. Aparecerá en el selector cuando su arte esté disponible.
                  </p>
                )}
                {item.type === 'COSMETIC' &&
                  item.cosmeticKind === 'PROFILE_FRAME' &&
                  item.status === 'CLAIMED' &&
                  item.cosmeticId &&
                  premiumArt(item) && (
                    <RankedCosmeticEquip cosmeticId={item.cosmeticId} onNotice={setNotice} />
                  )}
                {item.type === 'TITLE' && item.status === 'CLAIMED' && item.titleId && (
                  <button
                    type="button"
                    onClick={async () =>
                      setNotice(
                        (await (actions.equipTitle ?? equipTitle)(item.titleId!)) ??
                          'Título equipado',
                      )
                    }
                  >
                    Equipar título
                  </button>
                )}
                {item.type === 'SHOWCASE_CHOICE' && (
                  <>
                    <p>
                      1 de 5 · misma carta, mismo efecto. Arte completo, marco y foil cosmético en combate.
                    </p>
                    {item.chosenCardId ? (
                      <strong>Elegido: {PREMIUM_CARDS[item.chosenCardId]?.name}</strong>
                    ) : (
                      <>
                        <div className="rpt-showcases" role="group" aria-label="Elige tu Showcase">
                          {view.showcase.choices.map((id) => (
                            <button
                              type="button"
                              key={id}
                              aria-pressed={choice === id}
                              disabled={!view.showcase.claimable || busy}
                              onClick={() => {
                                setChoice(id);
                                setConfirm(false);
                              }}
                            >
                              <img src={FINAL_CARD_ART[id]} alt="" loading="lazy" decoding="async" />
                              <span>
                                {PREMIUM_CARDS[id]?.name ?? id}
                                <small>Showcase · cosmético</small>
                              </span>
                            </button>
                          ))}
                        </div>
                        {view.showcase.claimable && (
                          <button
                            type="button"
                            disabled={!choice || busy}
                            onClick={() => setConfirm(true)}
                          >
                            Elegir Showcase
                          </button>
                        )}
                        {confirm && (
                          <div
                            className="rpt-confirm"
                            role="group"
                            data-premium-confirm
                            onKeyDown={(e) => {
                              if (e.key === 'Escape' && !saving.current) {
                                e.preventDefault();
                                e.stopPropagation();
                                setConfirm(false);
                              }
                            }}
                            aria-label="Confirmar Showcase"
                          >
                            <p>
                              Elegir {PREMIUM_CARDS[choice]?.name}. Esta elección no se puede
                              cambiar.
                            </p>
                            <button type="button" disabled={busy} onClick={() => void pick()}>
                              {busy ? 'Guardando…' : 'Confirmar elección definitiva'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="rpt-secondary"
                              onClick={() => setConfirm(false)}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

// Response type retained here for local transports without weakening the live API.
export type PremiumActionResult<T> = CloudResult<T> | null;
