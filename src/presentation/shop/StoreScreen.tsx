import { ThunderNews, THUNDER_NEWS_IDS } from './ThunderNews';
import { EarnCrystalsModal } from './EarnCrystalsModal';
import { realMoneyPurchasesEnabled } from './paymentAvailability';
import { StoreNewsCarousel, type StoreNewsItem } from './StoreNewsCarousel';
import { ShapeshifterNews } from './ShapeshifterNews';
import { shapeshifterBuildEnabled } from '../shapeshifterRelease';
import { availableChampionsIn } from '../store/battleStore';
import { useCardPremiumEffect } from '../cards/useCardPremiumEffect';
import { CardPremiumFx } from '../react/components/CardPremiumFx';
import type { CardDefinition } from '../../game';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COSMETICS, DEFAULT_CONTENT, isChampionUnlocked, rarityOf } from '../../game';
import { tacticsApi } from '../cloud/api';
import { loadSession } from '../cloud/session';
import { PromoCodePanel } from './PromoCodePanel';
import { CrystalPurchaseModal } from './CrystalPurchaseModal';
import { GiftPanel } from '../gifts/GiftPanel';
import { GiftHistoryPanel } from '../gifts/GiftInbox';
import { useBattleStore } from '../store/battleStore';
import { CATEGORY_LABEL } from '../react/format';
import { SpellArt } from '../react/components/SpellArt';
import { CrystalIcon, StoreArt } from './StoreArt';
import { featuredCardOf, isPremiumOffer, StoreHeroShot } from './StoreHeroShot';
import { RitualHeroShot, RitualRecipe } from './RitualHeroShot';
import { storeApi, type Catalog, type CatalogOffer, type PurchaseResponse } from './api';
import { FramedPortrait } from './ProfileFrame';
import {
  availabilityText,
  excludedText,
  isReduced,
  offerKind,
  ownership,
  purchaseError,
  readIntent,
  remainingTime,
  saveIntent,
  type PurchaseIntent,
} from './presentation';
import '../../styles/shop.css';

const heroName = (id?: string) => (id && DEFAULT_CONTENT.heroes[id]?.name) || 'Todos los campeones';
/** Server price; a prorated bundle also shows its catalog price struck through. */
function Price({ offer }: { offer: CatalogOffer }) {
  return (
    <span className="shop-price">
      <CrystalIcon />
      {isReduced(offer) && <s aria-label={`Antes ${offer.basePrice}`}>{offer.basePrice}</s>}
      {offer.price}
    </span>
  );
}
const rarityName = { COMMON: 'Común', UNCOMMON: 'Infrecuente', RARE: 'Rara', LEGENDARY: 'Legendaria', ULTRA: 'Ultra' };
function CardPreview({ id }: { id: string }) {
  const c = DEFAULT_CONTENT.cards[id];
  if (!c) return <p>Contenido de colección · {id}</p>;
  return <CardPreviewFace card={c} />;
}
export function CardPreviewFace({ card: c }: { card: CardDefinition }) {
  const premiumRef = useCardPremiumEffect<HTMLElement>(c, 'large');
  return (
    <article ref={premiumRef} className={`shop-card-preview rarity-${rarityOf(c).toLowerCase()}`} data-premium={c.id === 'summon_war_drake' || undefined}>
      <div className="shop-card-image"><CardPremiumFx def={c} />
        <SpellArt cardId={c.id} spell={c.presentation.visualKey} />
        <span className="shop-cost" aria-label={`Coste de energía: ${c.cost}`}>
          {c.cost}
        </span>
      </div>
      <h3>{c.name}</h3>
      <span className="shop-label">
        {rarityName[rarityOf(c)]} · {heroName(c.heroId)} · {CATEGORY_LABEL[c.category]}
      </span>
      <p>{c.rulesText}</p>
    </article>
  );
}
function Wallet({ balance }: { balance: number }) {
  const [display, setDisplay] = useState(balance);
  const previous = useRef(balance);
  useEffect(() => {
    const from = previous.current;
    previous.current = balance;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1
        : Math.min(1, (now - start) / 550);
      setDisplay(Math.round(from + (balance - from) * t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [balance]);
  return (
    <div className="shop-wallet" aria-label={`Cristales Arcanos: ${balance}`}>
      <CrystalIcon />
      <div>
        <span>Cristales Arcanos</span>
        <strong>{display.toLocaleString('es')}</strong>
      </div>
    </div>
  );
}
export function StoreScreen({ onExit }: { onExit: () => void }) {
  const profile = useBattleStore((s) => s.profile);
  const serverHasShapeshifter = useBattleStore(s => availableChampionsIn(s).includes('shapeshifter'));
  const claimChampion = useBattleStore(s => s.claimChampionUnlock);
  const selectChampion = useBattleStore(s => s.selectChampion);
  const selectCampaignHero = useBattleStore(s => s.selectCampaignHero);
  const [crystalsOpen, setCrystalsOpen] = useState(() => new URLSearchParams(location.search).get('crystals') === '1');
  const [crystalsVisited, setCrystalsVisited] = useState(() => new URLSearchParams(location.search).get('crystals') === '1');
  useEffect(() => {const open = () => {setCrystalsVisited(true);setCrystalsOpen(true);};window.addEventListener('rpggo-open-crystals',open);return () => window.removeEventListener('rpggo-open-crystals',open);}, []);
  const [claimBusy, setClaimBusy] = useState(false);
  const claimLock = useRef(false);
  const [session] = useState(loadSession);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<CatalogOffer | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<PurchaseIntent | null>(() =>
    session ? readIntent(session.username) : null,
  );
  const [receipt, setReceipt] = useState<PurchaseResponse['purchase'] | null>(null);
  const [clock, setClock] = useState({ server: 0, local: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [equipping, setEquipping] = useState(false);
  const lock = useRef(false);
  const modal = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const opener = useRef<HTMLElement | null>(null);
  const reload = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setSynced(false);
    const [cat, state] = await Promise.all([
      storeApi.catalog(session.token),
      tacticsApi.state(session.token),
    ]);
    if (!mounted.current || loadSession()?.token !== session.token) return;
    if (cat.ok && cat.data?.wallet && state.ok && state.data?.profile) {
      setSynced(true);
      setNow(Date.now());
      setCatalog(cat.data);
      setClock({ server: cat.data.serverTime, local: Date.now() });
      useBattleStore.setState({ profile: state.data.profile });
      setSelected((old) => (old ? (cat.data.offers.find((o) => o.id === old.id) ?? null) : null));
      setError(null);
    } else if (
      (!cat.ok && cat.error.kind === 'AUTH') ||
      (!state.ok && state.error.kind === 'AUTH')
    ) {
      useBattleStore.getState().sessionExpired();
    } else setError('No pudimos actualizar la tienda. Revisa tu conexión y vuelve a intentarlo.');
    setLoading(false);
  }, [session]);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearTimeout(initial);
    };
  }, [reload]);
  useEffect(() => {
    if (selected || receipt) {
      if (!modal.current?.open) modal.current?.showModal();
    } else if (modal.current?.open) {
      modal.current.close();
      opener.current?.focus();
    }
  }, [selected, receipt]);
  const close = () => {
    if (!lock.current) {
      setSelected(null);
      setReceipt(null);
      setConfirm(false);
      setInspect(null);
    }
  };
  const open = (offer: CatalogOffer) => {
    opener.current = document.activeElement as HTMLElement;
    setSelected(offer);
    setInspect(null);
    setConfirm(false);
    setReceipt(null);
    setError(null);
  };
  const buy = async (retry?: PurchaseIntent) => {
    if (
      !session ||
      lock.current ||
      (!retry &&
        (!selected ||
          !catalog ||
          !synced ||
          loading ||
          !selected.availability.purchasable ||
          catalog.wallet.balance < selected.price ||
          intent))
    )
      return;
    const next = retry ?? {
      username: session.username,
      offerId: selected!.id,
      key: crypto.randomUUID(),
    };
    try {
      saveIntent(next);
    } catch {
      setError(
        'No podemos guardar una compra segura en este dispositivo. Habilita el almacenamiento del navegador.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setIntent(next);
    setConfirm(false);
    setError(null);
    const result = await storeApi.purchase(session.token, next.offerId, next.key);
    if (result.ok && result.data?.purchase && result.data.wallet && result.data.profile) {
      if (readIntent(session.username)?.key === next.key) {
        try {
          saveIntent(null, session.username);
        } catch {
          /* A future same-key replay can still recover this receipt. */
        }
      }
      if (mounted.current && loadSession()?.token === session.token) {
        setIntent(null);
        setReceipt(result.data.purchase);
        setCatalog((old) => (old ? { ...old, wallet: result.data.wallet } : old));
        useBattleStore.setState({ profile: result.data.profile });
        await reload();
      }
    } else if (mounted.current) {
      if (result.ok)
        setError(
          'No pudimos confirmar el resultado. Reintenta esta misma compra; no se cobrará dos veces.',
        );
      else {
        setError(purchaseError(result.error));
        if (result.error.kind === 'AUTH' && loadSession()?.token === session.token)
          useBattleStore.getState().sessionExpired();
        if (!['NETWORK', 'TIMEOUT', 'SERVER', 'AUTH'].includes(result.error.kind)) {
          try {
            saveIntent(null, session.username);
          } catch {
            /* Keep the saved key recoverable on the next visit. */
          }
          setIntent(null);
        }
      }
    }
    lock.current = false;
    if (mounted.current) setBusy(false);
  };
  const equip = async (slot: string, cosmeticId: string | null) => {
    if (!session || lock.current) return;
    setEquipping(true);
    const result = await storeApi.equip(session.token, slot, cosmeticId);
    if (!mounted.current) return;
    if (result.ok && result.data?.equipped)
      setCatalog((old) => (old ? { ...old, cosmetics: result.data } : old));
    else if (!result.ok && result.error.kind === 'AUTH') useBattleStore.getState().sessionExpired();
    else setError('No pudimos equipar el cosmético. Actualiza la tienda e inténtalo de nuevo.');
    setEquipping(false);
  };
  const serverNow = clock.server + Math.max(0, now - clock.local);
  const champion = profile.selectedChampionId;
  const ownsCosmetic = (id: string) => !!catalog?.cosmetics?.owned.some((c) => c.cosmeticId === id);
  const featured = catalog?.offers.find((o) => o.categories.includes('FEATURED'));
  const blocked = selected ? availabilityText(selected) : null;
  const insufficient = !!selected && !!catalog && catalog.wallet.balance < selected.price;
  const offerCard = (offer: CatalogOffer) => (
    <button
      className="shop-offer"
      data-offer={offer.id}
      data-premium-offer={isPremiumOffer(offer) || undefined}
      data-ritual-offer={offer.ritualPreview ? '' : undefined}
      key={offer.id}
      onClick={() => open(offer)}
    >
      {isPremiumOffer(offer) && (
        <span className="shop-premium-ribbon">{offer.ritualPreview ? '✦ Ritual Premium' : '✦ Premium'}</span>
      )}
      {offer.contents.some(item=>item.kind==='CARD'&&THUNDER_NEWS_IDS.includes(item.cardId))&&<span className="shop-thunder-new">NUEVO · TRUENO</span>}
      <StoreArt offer={offer} heroId={champion} />
      <div className="shop-offer-body">
        <span className="shop-label">
          {heroName(offer.heroId)} · {offerKind(offer)}
        </span>
        <h3>{offer.title}</h3>
        <p>{offer.description}</p>
        <div className="shop-offer-foot">
          <Price offer={offer} />
          <span>
            {offer.availability.purchasable
              ? isReduced(offer)
                ? 'Precio ajustado →'
                : 'Ver contenido →'
              : offer.availability.reason?.code === 'PURCHASE_LIMIT' ||
                  offer.availability.reason?.code === 'COSMETIC_OWNED'
                ? 'Adquirido'
                : 'No disponible'}
          </span>
        </div>
      </div>
    </button>
  );
  return (
    <main className="shop-screen">
      <header className="shop-header">
        <button onClick={onExit} disabled={busy}>
          ‹ Menú
        </button>
        <div>
          <span className="shop-label">RPG-GO TACTICS</span>
          <h1>Tienda arcana</h1>
        </div>
        {catalog && <Wallet balance={catalog.wallet.balance} />}
        <button className="crystal-topup-trigger" onClick={() => {setCrystalsVisited(true);setCrystalsOpen(true);}}>{realMoneyPurchasesEnabled() ? '+ Cristales' : 'Cómo conseguir cristales'}</button>
        <button onClick={() => void reload()} disabled={busy || loading}>
          Actualizar
        </button>
      </header>
      <div className="shop-scroll">
        {!session && (
          <div className="shop-message">
            <h2>Tu colección te espera</h2>
            <p>Inicia sesión desde el menú para consultar tu saldo y la tienda.</p>
            <button onClick={onExit}>Volver al menú</button>
          </div>
        )}
        {error && (
          <p className="shop-error" role="alert">
            {error}
          </p>
        )}
        {intent && (
          <div className="shop-recovery" role="status">
            <span>
              Hay una compra pendiente de confirmación. Recupera su resultado antes de comprar de
              nuevo.
            </span>
            <button disabled={busy} onClick={() => void buy(intent)}>
              {busy ? 'Confirmando…' : 'Recuperar compra'}
            </button>
          </div>
        )}
        {loading && !catalog && session && (
          <p className="shop-message" role="status">
            Abriendo el grimorio de ofertas…
          </p>
        )}
        <ThunderNews key={session?.username ?? 'guest'} profile={profile} account={session?.username ?? 'guest'} offers={catalog?.offers ?? []} onOffer={open} />
        <StoreNewsCarousel items={[
          ...(shapeshifterBuildEnabled() && (!session || serverHasShapeshifter) ? [{id:'shapeshifter',label:'Cambiaformas gratis',content:
            <ShapeshifterNews owned={isChampionUnlocked(profile,'shapeshifter')} busy={claimBusy||busy}
              canClaim={!!session&&synced&&serverHasShapeshifter}
              onClaim={()=>{if(claimLock.current)return;claimLock.current=true;setClaimBusy(true);
                void claimChampion('shapeshifter').then(ok=>{if(!ok)setError('No se pudo confirmar el desbloqueo gratuito. Intenta nuevamente.');})
                  .catch(()=>setError('No se pudo confirmar el desbloqueo gratuito. Intenta nuevamente.'))
                  .finally(()=>{claimLock.current=false;setClaimBusy(false);});}}
              onPlay={()=>{selectChampion('shapeshifter');selectCampaignHero('shapeshifter');onExit();}} />
          }] : []),
          ...(featured ? [{id:featured.id,label:featured.title,content:(<section
            className="shop-featured"
            data-offer={featured.id}
            data-ritual-offer={featured.ritualPreview ? '' : undefined}
          >
            <div className="shop-featured-copy">
              <span className="shop-label">
                {featured.ritualPreview ? 'OFERTA DESTACADA · RITUAL PREMIUM' : `DESTACADO · ${heroName(featured.heroId)}`}
              </span>
              <h2>{featured.title}</h2>
              {featured.ritualPreview && (
                <p className="ritual-tagline">Una invocación legendaria reservada para quienes completan el ritual.</p>
              )}
              <p>{featured.description}</p>
              <span className="shop-label">
                {featured.contents.filter((c) => c.kind === 'CARD').length} cartas para tu colección
              </span>
              <button className="shop-primary" onClick={() => open(featured)}>
                {featured.ritualPreview ? 'Descubrir el ritual' : 'Descubrir pack'} <Price offer={featured} />
              </button>
              <small>
                {availabilityText(featured) ?? 'Amplía tu colección. Construye tu propio mazo.'}
              </small>
            </div>
            <StoreArt offer={featured} heroId={champion} />
          </section>)}] : []),
        ] satisfies StoreNewsItem[]} />
        {(!session || catalog) && (
          <PromoCodePanel
            token={session?.token ?? null}
            onRedeemed={(data) => {
              // Crystals, cards and cosmetics show at once: wallet + collection from the response,
              // then a catalog refresh (ownership-dependent prices, owned cosmetics).
              setCatalog((old) => (old ? { ...old, wallet: data.wallet } : old));
              if (data.profile) useBattleStore.setState({ profile: data.profile });
              void reload();
            }}
            onAuthExpired={() => useBattleStore.getState().sessionExpired()}
          />
        )}
        {crystalsVisited && !realMoneyPurchasesEnabled() && <EarnCrystalsModal open={crystalsOpen} onClose={() => setCrystalsOpen(false)} />}
        {crystalsVisited && realMoneyPurchasesEnabled() && (
          <CrystalPurchaseModal
            open={crystalsOpen}
            onClose={() => setCrystalsOpen(false)}
            token={session?.token ?? null}
            onWallet={(wallet) => setCatalog((old) => (old ? { ...old, wallet } : old))}
            onAuthExpired={() => useBattleStore.getState().sessionExpired()}
          />
        )}
        {(!session || catalog) && <GiftHistoryPanel token={session?.token ?? null} />}
        {catalog?.categories
          .filter(
            (cat) =>
              cat.id !== 'FEATURED' && catalog.offers.some((o) => o.categories.includes(cat.id)),
          )
          .map((cat) => (
            <section className="shop-section" data-category={cat.id} key={cat.id}>
              <div className="shop-section-title">
                <h2>{cat.label}</h2>
                <span>Elige tu próxima táctica</span>
              </div>
              <div className="shop-offers">
                {catalog.offers.filter((o) => o.categories.includes(cat.id)).map(offerCard)}
              </div>
            </section>
          ))}
        {catalog && (
          <footer className="shop-note">
            Las cartas también se obtienen jugando. Las compras amplían tu colección y no cambian tu
            mazo activo.
          </footer>
        )}
      </div>
      <dialog
        className="shop-dialog"
        ref={modal}
        data-ritual-offer={selected?.ritualPreview && !receipt ? '' : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'),
          ).filter((el) => el.getClientRects().length > 0);
          const first = items[0],
            last = items.at(-1);
          if (!first || !last) {
            e.preventDefault();
            return;
          }
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        onCancel={(e) => {
          e.preventDefault();
          if (confirm && !busy) setConfirm(false);
          else close();
        }}
        aria-labelledby="shop-detail-title"
      >
        <button className="shop-close" onClick={close} disabled={busy} aria-label="Cerrar producto">
          ×
        </button>
        {receipt ? (
          <div className="shop-success" aria-live="polite">
            <span className="shop-label">COLECCIÓN ACTUALIZADA</span>
            <h2 id="shop-detail-title">Adquirido</h2>
            <p>
              Tu compra está confirmada.{' '}
              {receipt.granted.cards.length > 0 && 'Las cartas ya están en tu colección. '}
              {receipt.granted.cosmetics.length > 0 &&
                'Puedes equipar tu cosmético desde su ficha.'}
            </p>
            <div className="shop-grants">
              {receipt.granted.cards.map((c) => (
                <div className="shop-grant" key={c.cardId}>
                  <CardPreview id={c.cardId} />
                  <p>
                    +{c.copies} · Ahora {c.total}/{c.cap} copias
                  </p>
                </div>
              ))}
              {receipt.granted.cosmetics.map((c) => (
                <div className="shop-grant" key={c.cosmeticId}>
                  <FramedPortrait frameId={c.cosmeticId} heroId={champion} />
                  <p>{COSMETICS[c.cosmeticId]?.name ?? c.cosmeticId}</p>
                </div>
              ))}
            </div>
            {catalog && <Wallet balance={catalog.wallet.balance} />}
            <button className="shop-primary" disabled={busy} onClick={close}>
              Seguir explorando
            </button>
          </div>
        ) : (
          selected && (
            <div className="shop-detail">
              <div className="shop-detail-art">
                {(() => {
                  // Hero shot: the inspected card, else the offer's star card (angled, with depth).
                  const star = featuredCardOf(selected);
                  const shown = inspect ?? star;
                  // Ritual pack: the summoned creature is the hero shot until a piece is inspected.
                  if (selected.ritualPreview && !inspect) return <RitualHeroShot offer={selected} />;
                  return shown ? (
                    <StoreHeroShot cardId={shown} star={shown === star && selected.type !== 'CARD'}>
                      <CardPreview id={shown} />
                    </StoreHeroShot>
                  ) : (
                    <StoreArt offer={selected} heroId={champion} />
                  );
                })()}
                {selected.ritualPreview && inspect && (
                  <button className="ritual-back" onClick={() => setInspect(null)}>
                    ‹ Ver recompensa del ritual
                  </button>
                )}
              </div>
              <div className="shop-detail-info">
                <div className="shop-detail-content">
                  <span className="shop-label">
                    {heroName(selected.heroId)} · {offerKind(selected, true)}
                  </span>
                  <h2 id="shop-detail-title">{selected.title}</h2>
                  <p>{selected.description}</p>
                  {selected.heroId && !isChampionUnlocked(profile, selected.heroId) && (
                    <p className="shop-locked-note">
                      Todavía no has desbloqueado al {heroName(selected.heroId)}. Lo que compres
                      queda en su colección y podrás usarlo en cuanto lo desbloquees en la campaña.
                    </p>
                  )}
                  {remainingTime(selected.endAt, serverNow) && (
                    <p className="shop-expiry">{remainingTime(selected.endAt, serverNow)}</p>
                  )}
                  {selected.ritualPreview && <RitualRecipe offer={selected} />}
                  <h3>{selected.ritualPreview ? 'Piezas incluidas' : 'Contenido incluido'}</h3>
                  <div className="shop-contents">
                    {selected.contents.map((c, i) =>
                      c.kind === 'CARD' ? (
                        <button
                          key={c.cardId}
                          onClick={() => setInspect(c.cardId)}
                          aria-pressed={inspect === c.cardId}
                        >
                          <div className="shop-content-art">
                            <SpellArt
                              cardId={c.cardId}
                              spell={
                                DEFAULT_CONTENT.cards[c.cardId]?.presentation.visualKey ?? c.cardId
                              }
                            />
                          </div>
                          <span>
                            <strong>{DEFAULT_CONTENT.cards[c.cardId]?.name ?? c.cardId}</strong>
                            <small>
                              ×{c.copies} · {rarityName[rarityOf(DEFAULT_CONTENT.cards[c.cardId]!)]}
                            </small>
                            <small>
                              Tienes {ownership(selected, c.cardId, profile).owned}/
                              {ownership(selected, c.cardId, profile).cap} copias
                            </small>
                          </span>
                        </button>
                      ) : (
                        <div className="shop-content-cosmetic" key={c.cosmeticId ?? i}>
                          <div className="shop-content-frame">
                            <FramedPortrait frameId={c.cosmeticId} heroId={champion} />
                          </div>
                          <span>
                            <strong>{COSMETICS[c.cosmeticId]?.name ?? c.cosmeticId}</strong>
                            <small>Marco de perfil · visible en la sala PvP</small>
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                  {selected.excluded.length > 0 && (
                    <div className="shop-excluded">
                      Ya lo tienes, no se incluye:
                      <ul>
                        {excludedText(selected).map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                      Precio ajustado: {selected.price} en lugar de {selected.basePrice} Cristales
                      Arcanos.
                    </div>
                  )}
                  {/* Equip from the cosmetic's own offer or from a pack that contained it. */}
                  {selected.contents.map(
                    (c) =>
                      c.kind === 'COSMETIC' &&
                      ownsCosmetic(c.cosmeticId) && (
                        <div className="shop-equip" key={`equip-${c.cosmeticId}`}>
                          {catalog?.cosmetics.equipped.PROFILE_FRAME === c.cosmeticId ? (
                            <>
                              <strong>Equipado</strong>
                              <button
                                disabled={equipping}
                                onClick={() => void equip('PROFILE_FRAME', null)}
                              >
                                Quitar marco
                              </button>
                            </>
                          ) : (
                            <button
                              className="shop-primary"
                              disabled={equipping}
                              onClick={() => void equip('PROFILE_FRAME', c.cosmeticId)}
                            >
                              {equipping ? 'Equipando…' : 'Equipar marco'}
                            </button>
                          )}
                        </div>
                      ),
                  )}
                  <p className="shop-note">
                    {selected.type === 'COSMETIC'
                      ? 'Solo estético: no cambia reglas ni estadísticas.'
                      : selected.excluded.length
                        ? 'Solo se entrega lo que aún no tienes. No se equipa automáticamente.'
                        : 'Todo el contenido se entrega junto. No se equipa automáticamente.'}
                  </p>
                </div>
                <div className="shop-purchase-area">
                  {catalog && (
                    <p>
                      Tu saldo: <strong>{catalog.wallet.balance}</strong> Cristales Arcanos
                    </p>
                  )}
                  {blocked && <p className="shop-blocked">{blocked}</p>}
                  {insufficient && !blocked && (
                    <p className="shop-blocked">
                      Tienes {catalog?.wallet.balance} · Necesitas {selected.price} Cristales
                      Arcanos.
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="shop-error">
                      {error}
                    </p>
                  )}
                  {confirm ? (
                    <div className="shop-confirm" role="group" aria-label="Confirmar compra">
                      <h3>¿Adquirir {selected.title}?</h3>
                      <p>Se descontarán {selected.price} Cristales Arcanos de tu saldo.</p>
                      <button autoFocus className="shop-primary" onClick={() => void buy()}>
                        Confirmar compra · {selected.price}
                      </button>
                      <button onClick={() => setConfirm(false)}>Cancelar</button>
                    </div>
                  ) : intent ? (
                    <button
                      className="shop-primary"
                      disabled={busy}
                      onClick={() => void buy(intent)}
                    >
                      {busy ? 'Confirmando…' : 'Recuperar compra pendiente'}
                    </button>
                  ) : (
                    <button
                      className="shop-primary"
                      disabled={busy || loading || !synced || !!blocked || insufficient}
                      onClick={() => setConfirm(true)}
                    >
                      {busy ? 'Adquiriendo…' : 'COMPRAR'} <Price offer={selected} />
                    </button>
                  )}
                  {/* Second action: buy it for a friend (server-checked against THEIR collection). */}
                  {!confirm && !intent && (
                    <GiftPanel
                      key={selected.id}
                      offer={selected}
                      token={session?.token ?? null}
                      onSent={(wallet) => setCatalog((old) => (old ? { ...old, wallet } : old))}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        )}
      </dialog>
    </main>
  );
}
