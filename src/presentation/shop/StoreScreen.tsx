import {LaunchReward} from './LaunchReward';
import { MarketHome } from "./MarketHome";
import { ExpansionCatalog } from './ExpansionCatalog';
import { MARKET_SECTIONS, marketOffers, marketOfferPrimary, RARITY_LABELS } from './market';
import { PackOpening } from './PackOpening';
import { PackBatchOpening } from './PackBatchOpening';
import {useMarketNavigation} from './marketNavigation';
import { PackConfirmation } from './PackConfirmation';
import { packExpansion } from './PackArt';
import { BoosterOdds } from './BoosterOdds';
import '../../styles/arcane-market.css';
import { ThunderNews, THUNDER_NEWS_IDS } from './ThunderNews';
import { EarnCrystalsModal } from './EarnCrystalsModal';
import { realMoneyPurchasesEnabled } from './paymentAvailability';
import { StoreNewsCarousel, type StoreNewsItem } from './StoreNewsCarousel';
import { ShapeshifterNews } from './ShapeshifterNews';
import { shapeshifterBuildEnabled } from '../shapeshifterRelease';
import { availableChampionsIn } from '../store/battleStore';
import { MarketCard } from './MarketCard';
import {MarketCardPreview} from './MarketCardPreview';
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
  needsQuoteReview,
  type PurchaseIntent,
} from './presentation';
import '../../styles/shop.css';

const heroName = (id?: string) => (id && DEFAULT_CONTENT.heroes[id]?.name) || 'Todos los campeones';
/** Server price; a prorated bundle also shows its catalog price struck through. */
function Price({ offer }: { offer: CatalogOffer }) {
  if(offer.booster?.freeGrant)return <span className="shop-price">GRATIS</span>;
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
export function CardPreviewFace({ card:c }: {card:CardDefinition}) {return <article className="market-card-detail"><MarketCard card={c} accessible/></article>;}

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
        <span className="market-wallet-label">Cristales Arcanos</span>
        <strong>{display.toLocaleString('es')}</strong>
      </div>
    </div>
  );
}
export function StoreScreen({ onExit,mobile=false }: { onExit: () => void;mobile?:boolean }) {
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
  const {category,expansionId,navigate:navigateMarket,up:marketUp}=useMarketNavigation();
  const setCategory=(id:typeof category)=>navigateMarket(id);
  const setExpansionId=(id:string|null)=>id?navigateMarket('packs',id):marketUp();
  const [heroFilter,setHeroFilter]=useState('');
  const [rarityFilter,setRarityFilter]=useState('');
  const [availableOnly,setAvailableOnly]=useState(false);
  const [catalogCard,setCatalogCard]=useState<string|null>(null);
  const [selected, setSelected] = useState<CatalogOffer | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [quoteReview, setQuoteReview] = useState(false);
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
      return null;
    }
    setLoading(true);
    setSynced(false);
    const [cat, state] = await Promise.all([
      storeApi.catalog(session.token),
      tacticsApi.state(session.token),
    ]);
    if (!mounted.current || loadSession()?.token !== session.token) return null;
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
    return cat.ok && cat.data?.wallet && state.ok && state.data?.profile ? cat.data : null;
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
      setCatalogCard(null);
      setReceipt(null);
      setConfirm(false);
      setInspect(null);
    }
  };
  const finishOpening = () => {
    if(lock.current)return;
    const e=receipt?.granted.opening&&packExpansion(receipt.granted.opening.packId);
    if(e){navigateMarket('packs',e.id);}
    if(session&&intent)try{saveIntent(null,session.username);setIntent(null);}catch{/* Server receipt remains recoverable. */}
    close();
  };
  const open = (offer: CatalogOffer) => {
    opener.current = document.activeElement as HTMLElement;
    setCatalogCard(null);
    setSelected(offer);
    setInspect(null);
    setConfirm(false);
    setReceipt(null);
    setError(null);
  };
  const buy = async (retry?: PurchaseIntent, confirmedOffer?: CatalogOffer) => {
    if (!session || lock.current) return;
    const recovering = !!retry && !confirmedOffer;
    const chosen = confirmedOffer ?? selected;
    if (!recovering && (!chosen || !catalog || !synced || loading || !chosen.availability.purchasable || catalog.wallet.balance < chosen.price || (intent && !confirmedOffer))) return;
    if (retry && (retry.username !== session.username || (confirmedOffer && confirmedOffer.id !== retry.offerId))) return;
    if (!recovering && !chosen?.purchaseQuote) {
      setError('Actualiza la tienda antes de confirmar esta compra.');
      return;
    }
    const next: PurchaseIntent = recovering ? retry! : {
      username: session.username,
      offerId: chosen!.id,
      key: retry?.key ?? crypto.randomUUID(),
      quote: chosen!.purchaseQuote,
      packRevision: chosen!.booster?.revision,
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
    const result = await storeApi.purchase(session.token, next.offerId, next.key, recovering ? undefined : next.quote?.token, recovering, next.packRevision);
    if (result.ok && result.data?.purchase && result.data.wallet && result.data.profile) {
      if (!result.data.purchase.granted.opening && readIntent(session.username)?.key === next.key) {
        try {
          saveIntent(null, session.username);
        } catch {
          /* A future same-key replay can still recover this receipt. */
        }
      }
      if (mounted.current && loadSession()?.token === session.token) {
        setIntent(result.data.purchase.granted.opening ? next : null);
        setQuoteReview(false);
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
        if (needsQuoteReview(result.error.code)) {
          setQuoteReview(true);
        } else if (!['NETWORK', 'TIMEOUT', 'SERVER', 'AUTH'].includes(result.error.kind)) {
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
  const reviewPending = async () => {
    if (!intent || busy || loading) return;
    const fresh = await reload();
    if (!fresh) return;
    const offer = fresh.offers.find(o => o.id === intent.offerId);
    if (!offer?.availability.purchasable || !offer.purchaseQuote) {
      setError('La oferta ya no está disponible. Conservamos el identificador para recuperar su recibo.');
      return;
    }
    setCatalogCard(null);
    setSelected(offer);
    setReceipt(null);
    setQuoteReview(true);
    setConfirm(true);
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
  const activeCategory=category;
  const visibleOffers=marketOffers(catalog?.offers??[],activeCategory,heroFilter,rarityFilter,availableOnly).filter(o=>(activeCategory!=='featured'||o.id!==featured?.id)&&(!o.booster||activeCategory!=='packs'||o.booster.expansionId===expansionId)&&(!o.booster||activeCategory!=='featured'||(o.booster.packs??1)===1));
  const heroOptions=[...new Set((catalog?.offers??[]).map(o=>o.heroId).filter((id):id is string=>!!id))];
  const exploreOffer=(offer:CatalogOffer)=>{if(offer.type==='CARD')navigateMarket('packs',marketOfferPrimary(offer));else open(offer);};
  const offerCard = (offer: CatalogOffer) => (
    <button
      className="shop-offer"
      data-offer={offer.id}
      data-premium-offer={isPremiumOffer(offer) || undefined}
      data-ritual-offer={offer.ritualPreview ? '' : undefined}
      key={offer.id}
      onClick={() => open(offer)}
    >
      {!offer.booster && isPremiumOffer(offer) && (
        <span className="shop-premium-ribbon">{offer.ritualPreview ? '✦ Ritual Premium' : '✦ Premium'}</span>
      )}
      {!offer.booster&&offer.contents.some(item=>item.kind==='CARD'&&THUNDER_NEWS_IDS.includes(item.cardId))&&<span className="shop-thunder-new">NUEVO · TRUENO</span>}
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
    <main className="shop-screen" data-market="arcane-2" data-mobile={mobile}>
      <header className="shop-header" hidden={activeCategory==='packs'&&!!expansionId}>
        <button onClick={activeCategory==='packs'?marketUp:onExit} disabled={busy}>
          {activeCategory==='packs'?'← Mercado Arcano':'‹ Menú'}
        </button>
        <div>
          <span className="shop-label">RPG-GO TACTICS</span>
          <h1>{activeCategory==='packs'&&expansionId?'Expansión':'Mercado Arcano'}</h1>
        </div>
        {catalog && <Wallet balance={catalog.wallet.balance} />}
      </header>
      {activeCategory!=='featured'&&!(activeCategory==='packs'&&expansionId)&&<nav className="market-nav" aria-label="Categorías del mercado">{MARKET_SECTIONS.map(cat=><button key={cat.id} aria-pressed={activeCategory===cat.id} onClick={()=>{setCategory(cat.id);setHeroFilter('');setRarityFilter('');setAvailableOnly(false);}}>{cat.label}</button>)}</nav>}

      <div className="shop-scroll">
        {session&&synced&&<LaunchReward key={session.username} token={session.token}
          onWallet={wallet=>setCatalog(old=>old?{...old,wallet}:old)}
          onAuthExpired={()=>useBattleStore.getState().sessionExpired()}/>}

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
            {quoteReview && <button disabled={busy || loading} onClick={() => void reviewPending()}>Revisar condiciones actuales</button>}
          </div>
        )}
        {loading && !catalog && session && (
          <p className="shop-message" role="status">
            Abriendo el grimorio de ofertas…
          </p>
        )}
        {activeCategory==='featured'&&catalog&&<MarketHome expansions={catalog.expansions??[]} offers={catalog.offers} profile={profile} heroId={champion} onExpansion={id=>navigateMarket('packs',id)} onCategory={setCategory} onOffer={exploreOffer}/>}
        {activeCategory==='featured'&&<details className="market-home-additional"><summary>Más novedades y promociones</summary><div className="market-home-tools">        <button className="crystal-topup-trigger" onClick={() => {setCrystalsVisited(true);setCrystalsOpen(true);}}>{realMoneyPurchasesEnabled() ? '+ Cristales' : 'Cómo conseguir cristales'}</button>
        <button onClick={() => void reload()} disabled={busy || loading}>
          Actualizar
        </button>
</div><ThunderNews key={session?.username ?? 'guest'} profile={profile} account={session?.username ?? 'guest'} offers={catalog?.offers ?? []} onOffer={exploreOffer} />
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
              <button className="shop-primary" onClick={() => exploreOffer(featured)}>
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
        </details>}
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
        {activeCategory==='featured' && (!session || catalog) && <details className="market-home-additional"><summary>Historial de regalos</summary><GiftHistoryPanel token={session?.token ?? null} /></details>}
        {activeCategory==='crystals'&&<section className="shop-section"><h2>Cristales Arcanos</h2><p>Utiliza tu saldo habitual. No se habilitan nuevos cobros.</p>{catalog&&<Wallet balance={catalog.wallet.balance}/>}<button className="shop-primary" onClick={()=>{setCrystalsVisited(true);setCrystalsOpen(true);}}>{realMoneyPurchasesEnabled()?'Consultar paquetes disponibles':'Cómo conseguir cristales jugando'}</button></section>}
        {catalog&&activeCategory==='packs'&&<ExpansionCatalog expansions={catalog.expansions??[]} offers={catalog.offers} balance={catalog.wallet.balance} busy={busy||loading||!!intent} onBuy={open} selectedId={expansionId} onSelect={setExpansionId} profile={profile} onInspect={id=>{opener.current=document.activeElement as HTMLElement;setCatalogCard(id);setSelected(null);setReceipt(null);}}/>}
        {catalog&&activeCategory!=='featured'&&activeCategory!=='crystals'&&activeCategory!=='packs'&&<section className="shop-section" data-category={activeCategory}>
          <div className="shop-section-title"><h2>{MARKET_SECTIONS.find(c=>c.id===activeCategory)?.label}</h2><span>Tu próxima estrategia comienza aquí</span></div>
          {activeCategory==='cards'&&<div className="market-filters">
            <label>Campeón<select value={heroFilter} onChange={e=>setHeroFilter(e.target.value)}><option value="">Todos</option>{heroOptions.map(id=><option key={id} value={id}>{heroName(id)}</option>)}</select></label>
            {activeCategory==='cards'&&<label>Rareza<select value={rarityFilter} onChange={e=>setRarityFilter(e.target.value)}><option value="">Todas</option>{Object.entries(RARITY_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
            <label className="market-filter-available"><input type="checkbox" checked={availableOnly} onChange={e=>setAvailableOnly(e.target.checked)}/>Solo disponibles</label>
          </div>}
          <div className="shop-offers">{visibleOffers.map(offerCard)}</div>
          {!visibleOffers.length&&<p role="status">No hay artículos que coincidan con estos filtros.</p>}
        </section>}
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
        {receipt?.granted.opening ? (
          <div className="pack-receipt"><PackBatchOpening key={receipt.purchaseId} receiptId={receipt.purchaseId} openings={receipt.granted.openings??[receipt.granted.opening]} onInspect={setInspect} onDone={finishOpening}/></div>
        ) : receipt ? (
          <div className="shop-success" aria-live="polite">
            <span className="shop-label">COLECCIÓN ACTUALIZADA</span>
            <h2 id="shop-detail-title">{receipt.granted.opening?'Sobre confirmado':'Adquirido'}</h2>
            <p>
              Tu compra está confirmada.{' '}
              {receipt.granted.cards.length > 0 && 'Las cartas ya están en tu colección. '}
              {receipt.granted.cosmetics.length > 0 &&
                'Puedes equipar tu cosmético desde su ficha.'}
            </p>
            {receipt.granted.opening&&<PackOpening key={receipt.purchaseId} opening={receipt.granted.opening} onInspect={setInspect}/>}

            <div className="shop-grants">
              {(!receipt.granted.opening?receipt.granted.cards:[]).map((c) => (
                <div className="shop-grant" key={c.cardId}>
                  <CardPreview id={c.cardId} />
                  <p>
                    +{c.copies} copias · Límite por mazo: {c.cap}
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
        ) : selected?.booster ? (
          <><PackConfirmation offer={selected} balance={catalog?.wallet.balance??0} busy={busy||loading||!synced||!!intent&&!quoteReview} onConfirm={()=>void buy(intent&&quoteReview?intent:undefined,selected)} onCancel={close}/>{error&&<p role="alert">{error}</p>}</>
        ) : (
          selected && (
            <div className="shop-detail">
              <div className="shop-detail-art">
                {(() => {
                  // Hero shot: the inspected card, else the offer's star card (angled, with depth).
                  if(selected.booster&&!inspect)return <StoreArt offer={selected} heroId={champion}/>;
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
                  <h3>{selected.booster?'Contenido posible':selected.ritualPreview ? 'Piezas incluidas' : 'Contenido incluido'}</h3>
                  {selected.booster&&<BoosterOdds offer={selected}/>}
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
                              Poseídas: {ownership(selected, c.cardId, profile).owned} · Límite por mazo: {ownership(selected, c.cardId, profile).cap}
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
                    {selected.booster ? 'Recibes cuatro cartas aleatorias del contenido posible. Sin garantía de rareza. Los duplicados se acumulan y los límites por mazo no cambian.' : selected.type === 'COSMETIC'
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
                      <button autoFocus className="shop-primary" disabled={busy || !selected.purchaseQuote} onClick={() => void buy(quoteReview && intent ? intent : undefined, quoteReview && intent ? selected : undefined)}>
                        Confirmar compra · {selected.price}
                      </button>
                      <button onClick={() => setConfirm(false)}>Cancelar</button>
                    </div>
                  ) : intent ? (
                    <div>
                      <button className="shop-primary" disabled={busy} onClick={() => void buy(intent)}>
                        {busy ? 'Confirmando…' : 'Recuperar compra pendiente'}
                      </button>
                      {quoteReview && <button disabled={busy || loading} onClick={() => void reviewPending()}>Revisar condiciones actuales</button>}
                    </div>
                  ) : (
                    <button
                      className="shop-primary"
                      disabled={busy || loading || !synced || !!blocked || insufficient || !selected.purchaseQuote}
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
      <MarketCardPreview cardId={catalogCard??inspect} onClose={()=>{setCatalogCard(null);setInspect(null);}}/>
    </main>
  );
}
