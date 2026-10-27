import type { PremiumTrackView } from '../../game/ranked/premiumTrack';
import {
  PremiumNode,
  PremiumPurchasePanel,
  PremiumDetail,
  type PremiumActions,
} from './RankedPremiumTrack';
import { nextPremiumNode, premiumName } from './premiumPresentation';
import { loadSession } from '../cloud/session';
import { storeApi } from '../shop/api';
import { useCardPremiumEffect } from '../cards/useCardPremiumEffect';
import { CardPremiumFx } from '../react/components/CardPremiumFx';
import { RankedCosmeticPreview } from './RankedCosmeticPreview';
import { RankedCosmeticEquip } from './RankedCosmetics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatRp, rankFor, RANKED_TIERS } from '../../game/ranked/ranked';
import {
  RANKED_COSMETICS,
  RANKED_CARD_RELEASE_POLICY,
  rankedItemName,
  type RankedItemStatus,
  type RankedItemView,
  type RankedNodeView,
  type RankedTrackView,
} from '../../game/ranked/rewardTrack';
import { RANKED_TRACK_CARDS } from '../../game/data/ranked-cards';
import type { CardDefinition } from '../../game';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { SpellArt } from '../react/components/SpellArt';
import { CATEGORY_LABEL, RARITY_LABEL } from '../react/format';
import { equipTitle } from '../mastery/masteryApi';
import { rankedApi } from './rankedApi';
import { RankShield } from './RankShield';
import '../../styles/ranked-rewards.css';

/**
 * Ranked Reward Track — visual timeline (authoritative reward data unchanged). Everything shown comes from the
 * server view (GET /ranked/track, computed with the shared `rankedTrackView`): no thresholds or
 * rewards are hardcoded here. Codex hooks: class names + data-status / data-tier / data-type
 * (qa/ranked-reward-track/CODEX_HANDOFF.md).
 */

const CARDS: Record<string, CardDefinition> = Object.fromEntries(
  RANKED_TRACK_CARDS.map((c) => [c.id, c]),
);
const HERO_NAME: Record<string, string> = { archer: 'Arquero', shapeshifter: 'Cambiaformas' };
const heroName = (id?: string) =>
  (id && (PRESENTATION_CONTENT.heroes[id]?.name ?? HERO_NAME[id])) || 'Neutral';
const STATUS_LABEL: Record<RankedItemStatus, string> = {
  CLAIMED: 'Reclamado',
  UNLOCKED: 'Desbloqueado',
  LOCKED: 'Bloqueado',
};
const TYPE_LABEL: Record<RankedItemView['type'], string> = {
  CARD: 'Carta',
  CRYSTALS: 'Cristales',
  TITLE: 'Título',
  COSMETIC: 'Cosmético',
};
const COSMETIC_KIND_LABEL = {
  RANKED_CREST: 'Cresta',
  PROFILE_FRAME: 'Marco de perfil',
  VICTORY_BADGE: 'Sello de victoria',
} as const;
const itemName = (i: RankedItemView) => rankedItemName(i, CARDS);
const ICON: Record<RankedItemView['type'], string> = {
  CARD: '▧',
  CRYSTALS: '◆',
  TITLE: '✦',
  COSMETIC: '♜',
};
const STATUS_ICON = { CLAIMED: '✓', UNLOCKED: '◇', LOCKED: '⌑' };

function useTrack() {
  const [view, setView] = useState<RankedTrackView | null>(null);
  const [error, setError] = useState('');
  const [premium, setPremium] = useState<PremiumTrackView>();
  const [balance, setBalance] = useState<number | null>(null);
  const onPremiumChange = (value: PremiumTrackView, nextBalance?: number) => {
    setPremium(value);
    if (nextBalance !== undefined) setBalance(nextBalance);
    const session = loadSession();
    if (!session) return;
    // Refresh the real collection after a grant; no client-side reward simulation.
    void Promise.all([import('../cloud/api'), import('../store/battleStore')]).then(
      async ([{ tacticsApi }, { useBattleStore }]) => {
        const result = await tacticsApi.state(session.token);
        if (loadSession()?.token !== session.token) return;
        if (result.ok && result.data.profile)
          useBattleStore.setState({ profile: result.data.profile });
        else setError('La compra se guardó. Actualiza tu colección al recuperar la conexión.');
      },
    );
  };
  useEffect(() => {
    const session = loadSession();
    if (!premium || !session) return;
    let active = true;
    void storeApi.catalog(session.token).then((r) => {
      if (active && r.ok) setBalance(r.data.wallet.balance);
    });
    return () => {
      active = false;
    };
  }, [premium]);
  const apply = useCallback((r: Awaited<ReturnType<typeof rankedApi.track>>) => {
    if (!r) return;
    if (r.ok && r.data.enabled) {
      setView(r.data.track);
      setPremium(r.data.premium);
      setError('');
    } else if (!r.ok) setError(r.error.message);
  }, []);
  const load = useCallback(() => void rankedApi.track().then(apply), [apply]);
  useEffect(() => {
    let alive = true;
    void rankedApi.track().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply]);
  return { view, premium, balance, onPremiumChange, error, load };
}

/** "Próxima: Salto de Asedio · faltan 60 RP" — compact entry inside the Ranked lobby panel. */
export function RankedRewardsEntry() {
  const { view, premium, balance, onPremiumChange, error, load } = useTrack();
  const [open, setOpen] = useState(false);
  const next = view?.nextReward;
  return (
    <div className="rrt-entry">
      <button
        type="button"
        className="rrt-entry-button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <b>Recompensas Ranked</b>
        <small>
          {!view
            ? error || 'Cargando recompensas…'
            : next
              ? `Próxima: ${next.items.map(itemName).join(' + ')} · ${next.distance > 0 ? `faltan ${next.distance} RP` : 'termina una Ranked'}`
              : 'Todas las recompensas reclamadas'}
        </small>
      </button>
      {open &&
        view &&
        createPortal(
          <RankedRewardsDialog
            view={view}
            premium={premium}
            premiumBalance={balance}
            onPremiumChange={onPremiumChange}
            onClose={() => setOpen(false)}
            onRefresh={load}
          />,
          document.body,
        )}
    </div>
  );
}

function Summary({ view, onNext }: { view: RankedTrackView; onNext(): void }) {
  const next = view.nextReward;
  return (
    <div className="rrt-summary" data-tier={view.rank.tierId}>
      <RankShield rp={view.rp} size="sm" />
      <div>
        <small className="rrt-location-label">TÚ ESTÁS AQUÍ · RANGO ACTUAL</small>
        <strong>
          {view.rank.label} · {formatRp(view.rp)}
        </strong>
        {view.nextDivision ? (
          <span>
            → {view.nextDivision.label} · {formatRp(view.nextDivision.rp)}
          </span>
        ) : (
          <span>Rango máximo de la pretemporada</span>
        )}
        <span
          className="rrt-progress-bar"
          role="progressbar"
          aria-label="Progreso a siguiente división"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.rank.progress}
        >
          <i style={{ width: `${view.rank.progress}%` }} />
        </span>
        <span className="rrt-peak">
          MÁXIMO ALCANZADO · {rankFor(view.peakRp).label} · {formatRp(view.peakRp)} · Las
          recompensas no se pierden.
        </span>
      </div>
      <button
        type="button"
        className="rrt-next"
        onClick={onNext}
        aria-label="Ver próxima recompensa"
      >
        {next ? (
          <>
            <small>Próxima recompensa</small>
            <b>{next.items.map(itemName).join(' + ')}</b>
            <span>
              {next.label} · {formatRp(next.requiredRp)}
              {next.distance > 0 ? ` · faltan ${next.distance} RP` : ' · termina tu primera Ranked'}
            </span>
          </>
        ) : (
          <b>¡Track completo!</b>
        )}
      </button>
    </div>
  );
}

function NodeButton({
  node,
  selected,
  onSelect,
  peak,
  next,
}: {
  node: RankedNodeView;
  selected: boolean;
  onSelect(): void;
  peak: boolean;
  next: boolean;
}) {
  return (
    <button
      type="button"
      className="rrt-node"
      data-status={node.status}
      data-current={node.current || undefined}
      data-peak={peak || undefined}
      data-next={next || undefined}
      aria-pressed={selected}
      aria-label={`${node.label}, ${formatRp(node.requiredRp)}: ${node.items.map(itemName).join(', ')}. ${STATUS_LABEL[node.status]}${node.current ? '. Tu posición actual' : ''}`}
      onClick={onSelect}
    >
      {node.current ? (
        <span className="rrt-you">TÚ ESTÁS AQUÍ</span>
      ) : next ? (
        <span className="rrt-you rrt-up-next">SIGUIENTE</span>
      ) : null}
      <span className="rrt-node-rank">
        {node.division} <small>· {node.label.split(' ').slice(0, -1).join(' ')}</small>
      </span>
      <span className="rrt-node-rp">{node.requiredRp}</span>
      <span className="rrt-node-preview">
        {node.items
          .filter((i) => i.type === 'CARD')
          .map((i) => {
            const card = CARDS[i.cardId!];
            return card ? (
              <span key={i.rewardId} className="rrt-node-card" data-rarity={card.rarity}>
                <span className="rrt-node-art">
                  <SpellArt cardId={card.id} spell={card.presentation.visualKey} />
                </span>
                <b>
                  {card.name} ×{i.quantity}
                </b>
                <small>
                  {RARITY_LABEL[card.rarity ?? 'COMMON']} · {heroName(card.heroId)}
                </small>
              </span>
            ) : null;
          })}
      </span>
      <span className="rrt-node-items">
        {node.items.map((i) => (
          <i key={i.rewardId} data-type={i.type} title={itemName(i)}>
            {i.type === 'COSMETIC'
              ? { PROFILE_FRAME: '▣', RANKED_CREST: '♜', VICTORY_BADGE: '✺' }[
                  i.cosmeticKind ?? 'RANKED_CREST'
                ]
              : ICON[i.type]}
          </i>
        ))}
      </span>
      <span className="rrt-node-status">
        {STATUS_ICON[node.status]} {STATUS_LABEL[node.status]}
      </span>
    </button>
  );
}

export function RankedCardFace({ card }: { card: CardDefinition }) {
  const premium = useCardPremiumEffect<HTMLElement>(card, 'large', true);
  return (
    <article ref={premium} className="rrt-card" data-rarity={card.rarity ?? 'COMMON'}>
      <div className="rrt-card-art">
        <SpellArt cardId={card.id} spell={card.presentation.visualKey} />
        <CardPremiumFx def={card} />
        <span className="rrt-card-cost" aria-label={`Coste de energía: ${card.cost}`}>
          {card.cost}
        </span>
      </div>
      <h4>{card.name}</h4>
      <span className="rrt-card-meta">
        {RARITY_LABEL[card.rarity ?? 'COMMON']} · {heroName(card.heroId)} ·{' '}
        {CATEGORY_LABEL[card.category]}
      </span>
      <p>{card.rulesText}</p>
    </article>
  );
}

function ItemDetail({
  item,
  node,
  onEquipped,
}: {
  item: RankedItemView;
  node: RankedNodeView;
  onEquipped(msg: string): void;
}) {
  const requirement = `Se desbloquea en ${node.label} · ${formatRp(node.requiredRp)}`;
  const card = item.cardId ? CARDS[item.cardId] : undefined;
  return (
    <section className="rrt-item" data-type={item.type} data-status={item.status}>
      <header>
        <span className="rrt-item-type">{TYPE_LABEL[item.type]}</span>
        <b>{itemName(item)}</b>
        <span className="rrt-item-status">{STATUS_LABEL[item.status]}</span>
      </header>
      {card && <RankedCardFace card={card} />}
      {item.type === 'COSMETIC' && item.cosmeticId && (
        <RankedCosmeticPreview
          cosmeticId={item.cosmeticId}
          owned={item.status === 'CLAIMED'}
          status={item.status}
        />
      )}
      {item.type === 'TITLE' && <div className="rrt-title-banner">✦ {itemName(item)} ✦</div>}
      {item.type === 'CRYSTALS' && (
        <div className="rrt-crystals">
          ◆ <strong>{item.quantity}</strong> Cristales Arcanos
        </div>
      )}
      <ul className="rrt-item-facts">
        <li>
          {item.condition === 'FIRST_VALID_RANKED'
            ? 'Termina tu primera partida Ranked (2+ rondas).'
            : requirement}
        </li>
        {item.type === 'CARD' && (
          <>
            <li>
              {item.quantity === 1 ? '1 copia' : `${item.quantity} copias`} (colección completa para
              tu mazo) · se quedan para siempre
            </li>
            {item.status === 'CLAIMED' && item.grantedCopies === 0 && (
              <li>Ya tenías todas las copias: no se superó el límite.</li>
            )}
            <li>
              Acceso anticipado Ranked · Pretemporada. Después llegará a la colección general (sin
              dinero real).
            </li>
          </>
        )}
        {item.type === 'CRYSTALS' && <li>Hito de rango de la pretemporada (pago único).</li>}
        {item.type === 'TITLE' && (
          <li>
            {item.exclusive
              ? 'Título exclusivo de la Pretemporada.'
              : 'Título permanente de rango.'}{' '}
            Comparte el espacio con los títulos de Maestría.
          </li>
        )}
        {item.type === 'COSMETIC' && item.cosmeticId && (
          <li>
            {COSMETIC_KIND_LABEL[RANKED_COSMETICS[item.cosmeticId]!.kind]} exclusivo de la
            Pretemporada
          </li>
        )}
      </ul>
      {item.type === 'TITLE' && item.status === 'CLAIMED' && item.titleId && (
        <button
          type="button"
          className="rrt-equip"
          onClick={async () => {
            const err = await equipTitle(item.titleId!);
            onEquipped(err ?? `Título equipado: ${itemName(item)}`);
          }}
        >
          Equipar título
        </button>
      )}
      {item.type === 'COSMETIC' && item.status === 'CLAIMED' && item.cosmeticId && (
        <RankedCosmeticEquip cosmeticId={item.cosmeticId} onNotice={onEquipped} />
      )}
    </section>
  );
}

export function RankedRewardsDialog({
  view,
  onClose,
  onRefresh,
  premium,
  premiumBalance = null,
  onPremiumChange = () => {},
  premiumActions,
}: {
  view: RankedTrackView;
  premium?: PremiumTrackView;
  premiumBalance?: number | null;
  onPremiumChange?(view: PremiumTrackView, balance?: number): void;
  premiumActions?: PremiumActions;
  onClose(): void;
  onRefresh(): void;
}) {
  const current = view.nodes.find((n) => n.current) ?? view.nodes[0]!;
  const [selectedId, setSelectedId] = useState(view.nextReward?.nodeId ?? current.nodeId);
  const [notice, setNotice] = useState('');
  const [selectedLane, setSelectedLane] = useState<'free' | 'premium'>('free');
  const premiumNext = premium ? nextPremiumNode(premium.nodes) : undefined;
  const premiumSelected = premium?.nodes.find((n) => n.nodeId === selectedId);
  const [mobileInspect, setMobileInspect] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const revealDetail = () => {
    if (premium || matchMedia('(max-height: 500px) and (orientation: landscape)').matches) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          block: 'start',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        }),
      );
    }
  };
  const selected = view.nodes.find((n) => n.nodeId === selectedId) ?? current;
  const peakNode = [...view.nodes].reverse().find((n) => n.requiredRp <= view.peakRp);
  const scrollTo = useCallback((nodeId: string, smooth = true) => {
    const track = trackRef.current;
    const node = track?.querySelector<HTMLElement>(`[data-node='${nodeId}']`);
    if (!track || !node) return;
    // Only pan the shared rail: scrollIntoView would also scroll the entire sheet on mount.
    track.scrollTo({
      left:
        node.getBoundingClientRect().left -
        track.getBoundingClientRect().left +
        track.scrollLeft -
        (track.clientWidth - node.clientWidth) / 2,
      behavior:
        smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
    });
  }, []);
  useEffect(() => {
    scrollTo(current.nodeId, false);
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (dialogRef.current?.querySelector('.earn-crystals')) return;
      if (e.key === 'Escape') {
        if (dialogRef.current?.querySelector('[aria-busy="true"], [data-premium-confirm]')) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),[tabindex="0"]',
          ) ?? [],
        ).filter((el) => el.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, [current.nodeId, onClose, scrollTo]);
  return (
    <div
      ref={dialogRef}
      className="rrt-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Recompensas Ranked"
    >
      <div
        className="rrt-sheet rpg-scroll-y rpg-scroll-panel"
        data-inspecting={mobileInspect || undefined}
        data-premium={!!premium || undefined}
      >
        <header className="rrt-head">
          <div>
            <span className="lobby-eyebrow">Ranked · {view.seasonName}</span>
            <h2>Recompensas Ranked</h2>
            <nav className="rrt-tier-jumps" aria-label="Rangos de la ruta">
              {RANKED_TIERS.map((t) => (
                <button
                  key={t.id}
                  aria-pressed={selected.tierId === t.id}
                  onClick={() => {
                    const node = view.nodes.find((n) => n.tierId === t.id);
                    if (node) {
                      setSelectedId(node.nodeId);
                      setSelectedLane('free');
                      scrollTo(node.nodeId);
                      if (premium)
                        trackRef.current?.parentElement?.scrollIntoView({
                          block: 'start',
                          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'auto'
                            : 'smooth',
                        });
                    }
                  }}
                >
                  {t.name}
                </button>
              ))}
            </nav>
          </div>
          <div className="rrt-head-actions">
            {mobileInspect && (
              <button className="rrt-back-route" onClick={() => setMobileInspect(false)}>
                Ver ruta
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMobileInspect(false);
                setSelectedId(current.nodeId);
                setSelectedLane('free');
                requestAnimationFrame(() => {
                  scrollTo(current.nodeId);
                  if (premium)
                    trackRef.current?.parentElement?.scrollIntoView({
                      block: 'start',
                      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
                    });
                });
              }}
            >
              Mi posición
            </button>
            <button type="button" onClick={onRefresh}>
              Actualizar
            </button>
            <button
              type="button"
              className="rrt-close"
              onClick={onClose}
              autoFocus
              aria-label="Cerrar recompensas"
            >
              ✕
            </button>
          </div>
        </header>
        <Summary
          view={view}
          onNext={() => {
            if (view.nextReward) {
              setSelectedId(view.nextReward.nodeId);
              setSelectedLane('free');
              setMobileInspect(true);
              scrollTo(view.nextReward.nodeId);
              revealDetail();
            }
          }}
        />
        {premium && (
          <>
            <div className="rpt-next-line">
              <span>✦ Próxima Premium</span>
              <button
                type="button"
                onClick={() => {
                  if (premiumNext) {
                    setSelectedId(premiumNext.nodeId);
                    setSelectedLane('premium');
                    scrollTo(premiumNext.nodeId);
                    revealDetail();
                  }
                }}
              >
                {premiumNext
                  ? `${premiumNext.items.map(premiumName).join(' + ')} · ${premiumNext.label}`
                  : 'Todas las recompensas concedidas'}
                {premium && !premium.purchased ? ' · Requiere Premium' : ''}
              </button>
            </div>
            <PremiumPurchasePanel
              view={premium}
              balance={premiumBalance}
              onChange={onPremiumChange}
              onRefresh={onRefresh}
              actions={premiumActions}
            />
          </>
        )}
        <div className="rrt-rail">
          <div
            className="rrt-track rpg-scroll-x"
            ref={trackRef}
            role="list"
            aria-label="Línea de recompensas"
          >
            {RANKED_TIERS.map((tier) => (
              <div className="rrt-tier" data-tier={tier.id} key={tier.id} role="listitem">
                <span className="rrt-tier-name">
                  <RankShield
                    rp={view.nodes.find((n) => n.tierId === tier.id)?.requiredRp ?? 0}
                    size="sm"
                  />
                  {tier.name}
                </span>
                <div className="rrt-tier-nodes">
                  {view.nodes
                    .filter((n) => n.tierId === tier.id)
                    .map((n) => (
                      <div
                        key={n.nodeId}
                        data-node={n.nodeId}
                        className={premium ? 'rpt-node-pair' : undefined}
                      >
                        {premium && <span className="rpt-lane-label">GRATUITA</span>}
                        <NodeButton
                          node={n}
                          selected={selectedLane === 'free' && n.nodeId === selected.nodeId}
                          next={n.nodeId === view.nextReward?.nodeId}
                          peak={n === peakNode && view.peakRp > view.rp}
                          onSelect={() => {
                            setSelectedId(n.nodeId);
                            setSelectedLane('free');
                            setMobileInspect(true);
                            revealDetail();
                          }}
                        />
                        {premium && (
                          <>
                            <span className="rpt-lane-label rpt-gold">✦ PREMIUM</span>
                            {premium.nodes.find((p) => p.nodeId === n.nodeId) && (
                              <PremiumNode
                                node={premium.nodes.find((p) => p.nodeId === n.nodeId)!}
                                purchased={premium.purchased}
                                current={n.current}
                                next={premiumNext?.nodeId === n.nodeId}
                                selected={selectedLane === 'premium' && selectedId === n.nodeId}
                                onSelect={() => {
                                  setSelectedId(n.nodeId);
                                  setSelectedLane('premium');
                                  revealDetail();
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div ref={detailRef} className="rrt-detail" aria-live="polite">
          {selectedLane === 'premium' && premium && premiumSelected ? (
            <PremiumDetail
              key={premiumSelected.nodeId}
              node={premiumSelected}
              view={premium}
              onChange={onPremiumChange}
              onRefresh={onRefresh}
              actions={premiumActions}
            />
          ) : (
            <>
              <h3>
                {selected.label} · {formatRp(selected.requiredRp)}
                {selected.current && <span className="rrt-you-inline">Tu posición</span>}
              </h3>
              <div className="rrt-items">
                {selected.items.map((i) => (
                  <ItemDetail key={i.rewardId} item={i} node={selected} onEquipped={setNotice} />
                ))}
              </div>
            </>
          )}
          {notice && (
            <p className="rrt-notice" role="status">
              {notice}
            </p>
          )}
          <p className="rrt-policy">
            Pista gratuita: Las recompensas se entregan solas al alcanzar el RP y no se pierden al
            bajar de rango. Las cartas son acceso anticipado
            {RANKED_CARD_RELEASE_POLICY.realMoney ? '' : ' (nunca con dinero real)'}.
          </p>
        </div>
      </div>
    </div>
  );
}
