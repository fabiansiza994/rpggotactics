import { MyDecks, DeckNameDialog, deckActionError } from './MyDecks';
import '../../../styles/deckbuilder.css';
const CardCosmeticPicker = lazy(() => import('../../cosmetics/CardCosmeticPicker').then(m => ({ default: m.CardCosmeticPicker })));
import { DiscoverRarities } from '../../catalog/FreeCatalog';
import { CardTypeVisual } from '../components/CardTypeVisual';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import { primordialCardVisible } from '../../campaignRelease';
import { forbiddenBondCardVisible } from '../../forbiddenBondRelease';
import { CardOriginBadge, NeutralCounter } from '../components/CardOriginBadge';
import { useCardPremiumEffect } from '../../cards/useCardPremiumEffect';
import { CardPremiumFx, CardCosmeticMark } from '../components/CardPremiumFx';
import { WorldRewardBadge } from '../components/WorldRewardBadge';
import { RitualGlyph } from '../components/RitualGlyph';
import {
  lazy, Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  activeDeck,
  addCardIssue,
  cardFamily,
  cardsForHero,
  copyLimit,
  countInDeck,
  DECK_RULES,
  deckSize,
  deckStatus,
  deckBuilderView,
  editDeck,
  heroProfile,
  isNeutral,
  ownedCard,
  ownedFor,
  sharedPool,
  SHARED_POOL_ID,
  rarityOf,
  ritualsUsingPiece,
  sameDeck,
  starterDeck,
  type CardCategory,
  type CardDefinition,
  type CardFamily,
  type CardRarity,
  type DeckEntry,
  type DeckIssue,
  ARCHER_HUNT_WORLD_ID,
} from '../../../game';
import { CARD_IDENTITY } from '../../assets/visualIdentity';
import { archerCampaignReleasedIn, cloudActive, useBattleStore, world2ReleasedIn } from '../../store/battleStore';
import { CardPattern } from '../components/CardPattern';
import { CATEGORY_ICON } from '../components/CardView';
import { GameIcon } from '../components/GameIcon';
import { SpellArt } from '../components/SpellArt';
import {
  browseCollection,
  categoryCounts,
  costCurve,
  COST_BUCKETS,
  deckLines,
  EMPTY_QUERY,
  facets,
  FAMILY_LABEL,
  isFiltered,
  ORIGIN_LABEL,
  SORT_LABEL,
  type CollectionQuery,
  type CostBucket,
  type OriginFilter,
  type OwnershipFilter,
  type SortKey,
} from '../deckbuilder/collectionView';
import { CATEGORY_LABEL, deckIssueText, RARITY_LABEL, rangeText, targetingNotes } from '../format';

/** Short-lived response to the last add/remove/rejection. `id` replays the CSS pulse. */
interface Feedback {
  id: number;
  cardId: string;
  kind: 'added' | 'removed' | 'rejected' | 'saved';
  text: string;
}

const DRAG_TYPE = 'application/x-rpggo-card';

/** Per-device "already shown" marker for NEW badges (a convenience: losing it only re-shows badges). */
const seenKey = (heroId: string) => `rpg-go-tactics:seen-cards:${heroId}`;
function readSeen(heroId: string): number {
  try {
    const raw = Number(window.localStorage.getItem(seenKey(heroId)));
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return Number.POSITIVE_INFINITY; // no storage: show no badges rather than all of them
  }
}
function writeSeen(heroId: string, acquisitions: number): void {
  try {
    window.localStorage.setItem(seenKey(heroId), String(acquisitions));
  } catch {
    /* best effort */
  }
}
const OWNERSHIP_LABEL: Record<OwnershipFilter, string> = {
  ALL: 'Todas',
  UNLOCKED: 'Desbloqueadas',
  LOCKED: 'Bloqueadas',
};

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

const toneStyle = (card: CardDefinition) =>
  ({ '--card-tone': CARD_IDENTITY[card.presentation.visualKey]?.tone }) as CSSProperties;

function LockIcon() {
  return (
    <svg className="db-lock" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}

function Chip({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick(): void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`db-chip${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** "Copies in deck / most you can use" as pips; empty pips beyond what you own are dimmed. */
function CopyPips({ inDeck, limit, owned }: { inDeck: number; limit: number; owned: number }) {
  return (
    <span className="db-pips" aria-hidden="true">
      {Array.from({ length: limit }, (_, i) => (
        <span
          key={i}
          className={`db-pip${i < inDeck ? ' is-in' : i < owned ? '' : ' is-missing'}`}
        />
      ))}
    </span>
  );
}

export function CollectionTile({
  card,
  owned,
  inDeck,
  selected,
  pulse,
  isNew,
  onActivate,
  onPointerDown,
  onInspect,
  onAdd,
  onDoubleClick,
  onDrag,
  onDragEnd,
  availability,
  canAdd,
  addReason,
  dragging,
}: {
  card: CardDefinition;
  owned: number;
  inDeck: number;
  selected: boolean;
  pulse: Feedback | null;
  /** Acquired since this device last opened the builder for this champion. */
  isNew: boolean;
  onActivate(): void;
  onPointerDown(e: PointerEvent): void;
  onInspect(): void;
  onAdd(): void;
  onDoubleClick(): void;
  onDrag(): void;
  onDragEnd(): void;
  availability: number;
  canAdd: boolean;
  addReason: string;
  dragging: boolean;
}) {
  const premiumRef = useCardPremiumEffect<HTMLButtonElement>(card, 'grid', selected);
  const locked = owned === 0;
  const limit = copyLimit(card, DECK_RULES);
  const rarity = rarityOf(card);
  const addable = Math.max(0, Math.min(owned, limit) - inDeck);
  const status = locked
    ? 'Bloqueada'
    : `Poseídas ${owned}; Límite por mazo ${limit}; En mazo ${inDeck}; Puedes añadir ${addable}`;
  return (
    <li
      className={`db-tile-wrap${owned > 0 && availability === 0 ? ' is-depleted' : ''}`}
      data-card-id={card.id}
      data-origin-world={card.acquisition?.worldId}
      data-premium={card.id === 'summon_war_drake' || undefined}
      data-available={availability}
    >
      <button
        type="button"
        ref={premiumRef}
        className={`db-tile${dragging ? ' is-dragging' : ''}${locked ? ' is-locked' : ''}${selected ? ' is-selected' : ''}${inDeck ? ' is-in-deck' : ''}`}
        data-card-id={card.id}
        data-premium={card.id === 'summon_war_drake' || undefined}
        data-category={card.category}
        data-locked={locked || undefined}
        aria-label={`${card.heroId ? "" : "Neutral; "}${card.name}${isNew ? ' (nueva)' : ''}; coste ${card.cost}; ${CATEGORY_LABEL[card.category]}; ${RARITY_LABEL[rarity]}; ${status}`}
        aria-pressed={selected}
        title={locked ? `${card.name} · Bloqueada` : `${card.name} · ${card.rulesText}`}
        draggable={!locked && availability > 0}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, `collection:${card.id}`);
          e.dataTransfer.effectAllowed = 'copy';
          onDrag();
        }}
        onDragEnd={onDragEnd}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onClick={onActivate}
        onContextMenu={(e) => {
          e.preventDefault();
          onInspect();
        }}
        style={toneStyle(card)}
      >
        <span className="db-tile-art" aria-hidden="true">
          <SpellArt cardId={card.id} spell={card.presentation.visualKey} /><CardTypeVisual card={card} /><CardPremiumFx def={card} />
          <WorldRewardBadge def={card} compact /><CardOriginBadge card={card} />
        </span>
        {/* Remounted per feedback id so the pulse replays without remounting (and unfocusing) the button. */}
        {pulse && (
          <span key={pulse.id} className={`db-flash flash-${pulse.kind}`} aria-hidden="true" />
        )}
        <span className="db-cost" aria-hidden="true">
          {card.cost}
        </span>
        <span className={`db-rarity rarity-${rarity.toLowerCase()}`} aria-hidden="true" />
        {isNew && (
          <span className="db-new" aria-hidden="true">
            Nueva
          </span>
        )}
        {locked && (
          <span className="db-tile-lock" aria-hidden="true">
            <LockIcon />
            Bloqueada
          </span>
        )}
        <span className="db-tile-body" aria-hidden="true">
          <span className="db-tile-name">{card.name}</span>
          <span className="db-tile-meta">
            {card.ritualPiece ? <RitualGlyph /> : <GameIcon name={CATEGORY_ICON[card.category]} />}
            {card.ritualPiece && 'Ritual · '}
            {CATEGORY_LABEL[card.category]}
            <CardCosmeticMark def={card} /><small className="db-tile-rarity">{RARITY_LABEL[rarity]}</small>
          </span>
          {!locked && (
            <span className="db-tile-copies">
              <CopyPips inDeck={inDeck} limit={limit} owned={owned} />
              <span className="db-tile-owned">
                Poseídas: {owned} · En mazo: {inDeck}
              </span>
              <strong className="db-tile-available">
                {addable > 0 ? `Puedes añadir ${addable}` : owned > 0 ? 'Límite en este mazo' : 'Sin copias'}
              </strong>
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="db-tile-add"
        aria-label={`Agregar una copia de ${card.name}`}
        disabled={!canAdd}
        title={canAdd ? 'Agregar al mazo' : addReason}
        onClick={onAdd}
      >
        +
      </button>
    </li>
  );
}

function CardDetail({
  card,
  owned,
  inDeck,
  addIssue,
  heroName,
  onAdd,
  onRemove,
  onClose,
  context,
}: {
  card: CardDefinition;
  owned: number;
  inDeck: number;
  addIssue: DeckIssue | null;
  heroName: string;
  onAdd(): void;
  onRemove(): void;
  onClose(): void;
  context: 'deck' | 'collection';
}) {
  const rarity = rarityOf(card);
  const limit = copyLimit(card, DECK_RULES);
  const notes = targetingNotes(card);
  const premiumRef = useCardPremiumEffect<HTMLDivElement>(card, 'large');
  return (
    <div
      ref={premiumRef}
      className="db-detail-card"
      style={toneStyle(card)}
      data-card-id={card.id}
      data-premium={card.id === 'summon_war_drake' || undefined}
    >
      <button
        type="button"
        className="db-detail-close"
        aria-label="Cerrar detalle"
        onClick={onClose}
      >
        ×
      </button>
      <div className={`db-detail-art${owned === 0 ? ' is-locked' : ''}`} aria-hidden="true">
        <SpellArt cardId={card.id} spell={card.presentation.visualKey} /><CardTypeVisual card={card} /><CardPremiumFx def={card} />
        <span className="db-cost db-cost-lg">{card.cost}</span>
      </div>
      <h3 className="db-detail-name">{card.name}</h3>
      <p className="db-detail-tags">
        <CardCosmeticMark def={card} />
        <span>
          <GameIcon name={CATEGORY_ICON[card.category]} /> {CATEGORY_LABEL[card.category]}
        </span>
        <span className={`db-rarity-label rarity-${rarity.toLowerCase()}`}>
          {RARITY_LABEL[rarity]}
        </span>
        <span className="db-class-label" data-class={card.heroId ?? 'neutral'}>
          {card.heroId
            ? `Solo ${DEFAULT_CONTENT.heroes[card.heroId]?.name ?? card.heroId}`
            : 'Neutral · todos los campeones'}
        </span>
        <span>Coste {card.cost}</span>
      </p>
      <p className="db-detail-text">{card.rulesText}</p>
      <RitualDetail card={card} />
      <div className="db-detail-target">
        <CardPattern targeting={card.targeting} />
        <div>
          <strong>{rangeText(card)}</strong>
          {notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </div>
      <p className="db-detail-own">
        {owned === 0 ? (
          <>
            <LockIcon /> Bloqueada · se obtiene como recompensa
          </>
        ) : (
          <>
            Poseídas: {owned} · En mazo: {inDeck} · Puedes añadir: {Math.max(0, Math.min(owned, copyLimit(card, DECK_RULES)) - inDeck)}
            <span className="muted"> (máx. {limit} por mazo)</span>
          </>
        )}
      </p>
      <div className="db-detail-actions">
        {addIssue && owned > 0 && (
          <p className="db-detail-why">{deckIssueText(addIssue, heroName)}</p>
        )}
        <button
          type="button"
          className={`db-btn ${context === 'collection' ? 'db-btn-primary' : ''}`}
          disabled={addIssue !== null}
          onClick={onAdd}
        >
          Agregar al mazo
        </button>
        <button
          type="button"
          className={`db-btn ${context === 'deck' ? 'db-btn-primary' : ''}`}
          disabled={inDeck === 0}
          onClick={onRemove}
        >
          Quitar del mazo
        </button>
      </div>
    </div>
  );
}

/**
 * Ritual pieces explain themselves: which ritual(s) they belong to and every piece required,
 * so nobody has to memorise combinations. Direct summons say they are direct.
 */
function RitualDetail({ card }: { card: CardDefinition }) {
  const family = cardFamily(card);
  if (family === 'SUMMON')
    return <p className="db-detail-ritual">Invocación directa: una carta, una criatura.</p>;
  if (family !== 'RITUAL_PIECE') return null;
  return (
    <div className="db-detail-ritual">
      {ritualsUsingPiece(DEFAULT_CONTENT, card.id).map((r) => (
        <p key={r.id}>
          <strong>
            <RitualGlyph family={r.tier} /> Parte de: {r.name}
          </strong>{' '}
          ({r.pieces.length} piezas · {r.energyCost} energía al activar)
          <br />
          Requiere: {r.pieces.map((id) => DEFAULT_CONTENT.cards[id]?.name ?? id).join(' + ')}
          <br />
          <span className="muted">{r.rulesText}</span>
          <br />
          <small>
            Efecto secundario · {card.cost} energía: {card.rulesText.split('O juégala: ')[1]}
          </small>
        </p>
      ))}
    </div>
  );
}

/** Leave with unsaved edits: keep editing, discard, or save first. */
function LeaveDialog({
  canSave,
  onStay,
  onDiscard,
  onSave,
}: {
  canSave: boolean;
  onStay(): void;
  onDiscard(): void;
  onSave(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="pile-dialog confirm-dialog"
      aria-labelledby="db-leave-title"
      onCancel={onStay}
      onClose={onStay}
    >
      <h2 id="db-leave-title">Cambios sin guardar</h2>
      <p>
        {canSave
          ? 'Guarda el mazo antes de salir o descarta los cambios.'
          : 'El mazo no es válido todavía: si sales, se descartan los cambios.'}
      </p>
      <div className="confirm-actions">
        <button type="button" autoFocus onClick={onStay}>
          Seguir editando
        </button>
        <button type="button" className="confirm-danger" onClick={onDiscard}>
          Descartar
        </button>
        {canSave && (
          <button type="button" className="db-dialog-save" onClick={onSave}>
            Guardar y salir
          </button>
        )}
      </div>
    </dialog>
  );
}

function DetailDialog({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="db-detail-dialog"
      aria-label="Detalle de carta"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}
function StarterDialog({ onConfirm, onClose }: { onConfirm(): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="pile-dialog confirm-dialog"
      aria-labelledby="db-starter-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <h2 id="db-starter-title">¿Cargar el mazo inicial?</h2>
      <p>
        Reemplazará tus cambios en este borrador por el mazo inicial de 30 cartas. No se guardará
        hasta que pulses Guardar mazo.
      </p>
      <div className="confirm-actions">
        <button onClick={onClose}>Conservar borrador</button>
        <button onClick={onConfirm}>Cargar mazo inicial</button>
      </div>
    </dialog>
  );
}

export function DeckBuilder() {
  const heroId=useBattleStore(s=>s.deckHeroId);
  const profile=useBattleStore(s=>s.profile);
  const [editing,setEditing]=useState<{heroId:string;deckId:string}|null>(null);
  const selected=editing?.heroId===heroId&&heroProfile(profile,heroId,DEFAULT_CONTENT).decks.some(d=>d.id===editing.deckId)?editing.deckId:null;
  return selected ? <DeckEditor key={`${heroId}:${selected}`} deckId={selected} onBack={()=>setEditing(null)}/> : <MyDecks onEdit={deckId=>setEditing({heroId,deckId})}/>;
}
function DeckEditor({deckId,onBack}:{deckId:string;onBack:()=>void}) {
  const profile = useBattleStore((s) => s.profile);
  const saveDeck = useBattleStore((s) => s.saveDeck);
  const closeDeckBuilder = onBack;
  const heroId = useBattleStore((s) => s.deckHeroId);
  const backLabel = 'Mis mazos';
  const heroDef = DEFAULT_CONTENT.heroes[heroId]!;
  const hero = heroProfile(profile, heroId, DEFAULT_CONTENT);
  const saved = hero.decks.find(d=>d.id===deckId) ?? activeDeck(hero);
  const [renaming,setRenaming]=useState(false),[renameBusy,setRenameBusy]=useState(false),[renameError,setRenameError]=useState('');
  const owned = ownedFor(profile, heroId, DEFAULT_CONTENT);
  // NEW badges: cards acquired after the last time this device opened this champion's builder.
  const [seenUpTo] = useState(() => readSeen(heroId));
  // Neutral cards count acquisitions in the shared pool, so they keep their own marker.
  const [sharedSeenUpTo] = useState(() => readSeen(SHARED_POOL_ID));
  const sharedAcquisitions = sharedPool(profile, DEFAULT_CONTENT).acquisitions;
  useEffect(() => writeSeen(heroId, hero.acquisitions), [heroId, hero.acquisitions]);
  useEffect(() => writeSeen(SHARED_POOL_ID, sharedAcquisitions), [sharedAcquisitions]);
  const lookup = (cardId: string) => ownedCard(profile, heroId, cardId, DEFAULT_CONTENT);
  const isNewCard = (cardId: string) => {
    const card = DEFAULT_CONTENT.cards[cardId];
    return (lookup(cardId)?.acquired ?? 0) > (card && isNeutral(card) ? sharedSeenUpTo : seenUpTo);
  };

  const [draft, setDraft] = useState<DeckEntry[]>(() => saved.cards.map((e) => ({ ...e })));
  const [query, setQuery] = useState<CollectionQuery>(EMPTY_QUERY);
  const compact = useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia('(max-width: 1000px), (max-height: 500px)');
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia('(max-width: 1000px), (max-height: 500px)').matches,
    () => false,
  );
  const [inspected, setInspected] = useState<string | null>(saved.cards[0]?.cardId ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState<'COLLECTION' | 'DECK'>('DECK');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [starterConfirm, setStarterConfirm] = useState(false);
  const [detailContext, setDetailContext] = useState<'deck' | 'collection'>('deck');
  const [dragged, setDragged] = useState<{ from: 'deck' | 'collection'; cardId: string } | null>(
    null,
  );
  const inspectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (inspectTimer.current) clearTimeout(inspectTimer.current);
    },
    [],
  );
  const [saving, setSaving] = useState(false);
  const cloud = useBattleStore(cloudActive);
  const world2Visible = useBattleStore(world2ReleasedIn);
  const archerCampaignVisible = useBattleStore(archerCampaignReleasedIn);
  const [dropActive, setDropActive] = useState<'deck' | 'collection' | null>(null);
  const pointerType = useRef<string>('mouse');
  const feedbackId = useRef(0);

  const pool = useMemo(() => cardsForHero(DEFAULT_CONTENT, heroId).filter(card =>
    (card.acquisition?.worldId !== 'world_2' || world2Visible || (ownedCard(profile,heroId,card.id,DEFAULT_CONTENT)?.copies ?? 0)>0) && primordialCardVisible(card, ownedCard(profile,heroId,card.id,DEFAULT_CONTENT)?.copies ?? 0)
    && forbiddenBondCardVisible(card, ownedCard(profile,heroId,card.id,DEFAULT_CONTENT)?.copies ?? 0, DEFAULT_CONTENT.releasedExpansions)
    && (card.acquisition?.worldId !== ARCHER_HUNT_WORLD_ID || archerCampaignVisible || (ownedCard(profile,heroId,card.id,DEFAULT_CONTENT)?.copies ?? 0)>0)
  ), [heroId,world2Visible,archerCampaignVisible,profile]);
  const available = useMemo(() => facets(pool), [pool]);
  const lines = deckLines(draft, DEFAULT_CONTENT);
  const view = deckBuilderView(profile, heroId, draft, DEFAULT_CONTENT, DECK_RULES);
  const copyStatus = new Map(view.collection.map((c) => [c.cardId, c]));
  // Keep browsing order/filters, but show only owned copies not already in the draft.
  const shown = browseCollection(pool, lookup, query).filter(
    card => (copyStatus.get(card.id)?.availableCopies ?? 0) > 0,
  );
  const status = view.deck;
  const { totalCards: size, issues } = status;
  // The saved deck is an old 20-card one: shown untouched, the player adds the rest by hand.
  const savedLegacy = deckStatus(saved.cards, heroId, owned, DEFAULT_CONTENT, DECK_RULES).legacy;
  const dirty = !sameDeck(draft, saved.cards);
  const unlockedCount = pool.filter((c) => owned(c.id) > 0).length;
  const curve = costCurve(lines);
  const curveMax = Math.max(1, ...COST_BUCKETS.map((b) => curve[b]));
  const inspectedCard = inspected ? DEFAULT_CONTENT.cards[inspected] : undefined;
  const sizeState = status.excessCount ? 'over' : status.missingCount ? 'under' : 'ok';

  // A reload or tab close with unsaved edits asks first (the in-app Back button has its own dialog).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const say = (cardId: string, kind: Feedback['kind'], text: string) =>
    setFeedback({ id: ++feedbackId.current, cardId, kind, text });

  function tryAdd(cardId: string) {
    if (inspectTimer.current) {
      clearTimeout(inspectTimer.current);
      inspectTimer.current = null;
    }
    const card = DEFAULT_CONTENT.cards[cardId];
    if (!card) return;
    const result = editDeck(
      draft,
      { type: 'ADD_CARD', cardId },
      heroId,
      owned,
      DEFAULT_CONTENT,
      DECK_RULES,
    );
    if (!result.ok)
      return result.issue.code === 'NOT_IN_DECK'
        ? undefined
        : say(cardId, 'rejected', deckIssueText(result.issue, heroDef.name));
    setDraft(result.deck);
    say(cardId, 'added', `${card.name} añadida (${size + 1}/${DECK_RULES.requiredSize})`);
  }

  /** Only removes: the gap stays until the player picks a card (nothing is added for them). */
  function tryRemove(cardId: string) {
    if (inspectTimer.current) {
      clearTimeout(inspectTimer.current);
      inspectTimer.current = null;
    }
    const card = DEFAULT_CONTENT.cards[cardId];
    if (!card) return;
    const result = editDeck(
      draft,
      { type: 'REMOVE_CARD', cardId },
      heroId,
      owned,
      DEFAULT_CONTENT,
      DECK_RULES,
    );
    if (!result.ok) return;
    setDraft(result.deck);
    say(cardId, 'removed', `${card.name} quitada (${size - 1}/${DECK_RULES.requiredSize})`);
  }

  const inspect = (
    cardId: string,
    open: boolean,
    context: 'deck' | 'collection' = 'collection',
  ) => {
    if (inspectTimer.current) {
      clearTimeout(inspectTimer.current);
      inspectTimer.current = null;
    }
    setDetailContext(context);
    setInspected(cardId);
    if (open && compact) setDetailOpen(true);
  };

  /** Touch opens an action sheet; mouse single-click inspects, double-click adds exactly one. */
  function activateTile(card: CardDefinition) {
    const touch = pointerType.current === 'touch' || pointerType.current === 'pen';
    pointerType.current = 'mouse';
    if (inspectTimer.current) clearTimeout(inspectTimer.current);
    if (!compact) return inspect(card.id, false);
    if (touch) return inspect(card.id, true);
    inspectTimer.current = setTimeout(() => inspect(card.id, true), 250);
  }
  function doubleAdd(cardId: string) {
    if (inspectTimer.current) clearTimeout(inspectTimer.current);
    tryAdd(cardId);
  }
  function activateLine(cardId: string) {
    const touch = pointerType.current === 'touch' || pointerType.current === 'pen';
    pointerType.current = 'mouse';
    if (inspectTimer.current) clearTimeout(inspectTimer.current);
    if (!compact) return inspect(cardId, false, 'deck');
    if (touch) return inspect(cardId, true, 'deck');
    inspectTimer.current = setTimeout(() => inspect(cardId, true, 'deck'), 250);
  }
  function doubleRemove(cardId: string) {
    if (inspectTimer.current) clearTimeout(inspectTimer.current);
    tryRemove(cardId);
  }
  function loadStarter() {
    setStarterConfirm(false);
    setDraft(starterDeck(heroDef));
    say('', 'removed', 'Mazo inicial cargado (sin guardar)');
  }
  const endDrag = () => {
    setDragged(null);
    setDropActive(null);
  };
  const dragIssue =
    dragged?.from === 'collection'
      ? addCardIssue(draft, dragged.cardId, heroId, owned, DEFAULT_CONTENT, DECK_RULES)
      : null;
  const dropMessage = (zone: 'deck' | 'collection') =>
    !dragged || dragged.from === zone
      ? null
      : zone === 'collection'
        ? 'Soltar para quitar'
        : dragIssue
          ? deckIssueText(dragIssue, heroDef.name)
          : 'Soltar para agregar';

  /** Local or cloud save. A failed cloud write keeps the draft and says so (never "saved"). */
  async function save(): Promise<boolean> {
    setSaving(true);
    const result = await saveDeck(heroId, draft, deckId);
    setSaving(false);
    if (!result.ok) {
      say(
        '',
        'rejected',
        result.issues[0]
          ? deckIssueText(result.issues[0], heroDef.name)
          : (result.error ?? 'No se pudo guardar.'),
      );
      return false;
    }
    say('', 'saved', cloud ? 'Mazo guardado en la nube' : 'Mazo guardado');
    return true;
  }

  const leave = () => (dirty ? setLeaving(true) : closeDeckBuilder());

  // Drag & drop (mouse only; touch and keyboard use click/tap): collection → deck adds, deck → collection removes.
  const zoneOf = (e: DragEvent) =>
    (e.currentTarget as HTMLElement).dataset.dropZone as 'deck' | 'collection';
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    const zone = zoneOf(e);
    e.dataTransfer.dropEffect =
      dragged?.from === zone || (zone === 'deck' && dragIssue)
        ? 'none'
        : zone === 'deck'
          ? 'copy'
          : 'move';
    if (dropActive !== zone) setDropActive(zone);
  }
  function onDragLeave(e: DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(null);
  }
  function onDrop(e: DragEvent) {
    endDrag();
    const [from, cardId] = e.dataTransfer.getData(DRAG_TYPE).split(':');
    if (!cardId) return;
    e.preventDefault();
    const zone = zoneOf(e);
    if (zone === 'deck' && from === 'collection') tryAdd(cardId);
    if (zone === 'collection' && from === 'deck') tryRemove(cardId);
  }

  const notePointer = (e: PointerEvent) => {
    pointerType.current = e.pointerType;
  };

  const filterCount =
    query.categories.length +
    query.families.length +
    query.costs.length +
    query.rarities.length +
    (query.ownership !== 'ALL' ? 1 : 0) +
    (query.origin !== 'ALL' ? 1 : 0);

  return (
    <div
      className="deckbuilder"
      data-tab={tab.toLowerCase()}
      data-detail={detailOpen && inspectedCard ? 'open' : 'closed'}
    >
      {renaming&&<DeckNameDialog name={saved.name} busy={renameBusy} error={renameError} onClose={()=>setRenaming(false)} onSave={name=>{setRenameBusy(true);void useBattleStore.getState().renameDeck(heroId,deckId,name).then(r=>{if(r.ok)setRenaming(false);else setRenameError(deckActionError(r));}).finally(()=>setRenameBusy(false));}}/>}
      <header className="db-header">
        <button type="button" className="db-back" onClick={leave}>
          <span aria-hidden="true">‹</span> {backLabel}
        </button>
        <div className="db-title">
          <span className="menu-eyebrow">Colección y mazo</span>
          <h1>{saved.name}</h1><button type="button" className="db-rename" onClick={()=>setRenaming(true)}>Renombrar</button>
        </div>
        <label className="db-search">
          <span className="sr-only">Buscar carta</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            type="search"
            placeholder="Buscar carta…"
            value={query.text}
            onChange={(e) => setQuery({ ...query, text: e.target.value })}
          />
        </label>
        <label className="db-sort">
          <span>Ordenar</span>
          <select
            value={query.sort}
            onChange={(e) => setQuery({ ...query, sort: e.target.value as SortKey })}
          >
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`db-filter-toggle${filtersOpen ? ' is-active' : ''}`}
          aria-expanded={filtersOpen}
          aria-controls="db-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          Filtros{filterCount ? ` · ${filterCount}` : ''}
        </button>
      </header>

      <div
        id="db-filters"
        className={`db-filters${filtersOpen ? ' is-open' : ''}`}
        role="group"
        aria-label="Filtros de la colección"
      >
        <div className="db-filter-group" role="group" aria-label="Estado">
          {(Object.keys(OWNERSHIP_LABEL) as OwnershipFilter[]).map((o) => (
            <Chip
              key={o}
              active={query.ownership === o}
              onClick={() => setQuery({ ...query, ownership: o })}
            >
              {o === 'LOCKED' && <LockIcon />}
              {OWNERSHIP_LABEL[o]}
            </Chip>
          ))}
        </div>
        {available.origins.length > 0 && (
          <div className="db-filter-group db-origin-filter" role="group" aria-label="Origen">
            <span className="db-filter-label" aria-hidden="true">
              Origen
            </span>
            {available.origins.map((o: OriginFilter) => (
              <Chip key={o} active={query.origin === o} onClick={() => setQuery({ ...query, origin: o })}>
                {o === 'NEUTRAL' && <GameIcon name="neutral" />} {ORIGIN_LABEL[o]}
              </Chip>
            ))}
          </div>
        )}
        <div className="db-filter-group" role="group" aria-label="Coste">
          <span className="db-filter-label" aria-hidden="true">
            Coste
          </span>
          {available.costs.map((b: CostBucket) => (
            <Chip
              key={b}
              active={query.costs.includes(b)}
              label={`Coste ${b}`}
              onClick={() => setQuery({ ...query, costs: toggle(query.costs, b) })}
            >
              <span className="db-chip-cost">{b}</span>
            </Chip>
          ))}
        </div>
        {available.families.length > 1 &&
          available.families.some((f) => f === 'SUMMON' || f === 'RITUAL_PIECE') && (
            <div className="db-filter-group" role="group" aria-label="Familia">
              {available.families.map((f: CardFamily) => (
                <Chip
                  key={f}
                  active={query.families.includes(f)}
                  onClick={() => setQuery({ ...query, families: toggle(query.families, f) })}
                >
                  {FAMILY_LABEL[f]}
                </Chip>
              ))}
            </div>
          )}
        <div className="db-filter-group" role="group" aria-label="Tipo">
          {available.categories.map((c: CardCategory) => (
            <Chip
              key={c}
              active={query.categories.includes(c)}
              onClick={() => setQuery({ ...query, categories: toggle(query.categories, c) })}
            >
              <GameIcon name={CATEGORY_ICON[c]} />
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
        {available.rarities.length > 1 && (
          <div className="db-filter-group" role="group" aria-label="Rareza">
            {available.rarities.map((r: CardRarity) => (
              <Chip
                key={r}
                active={query.rarities.includes(r)}
                onClick={() => setQuery({ ...query, rarities: toggle(query.rarities, r) })}
              >
                <span className={`db-rarity rarity-${r.toLowerCase()}`} aria-hidden="true" />
                {RARITY_LABEL[r]}
              </Chip>
            ))}
          </div>
        )}
        {isFiltered(query) && (
          <button
            type="button"
            className="db-clear"
            onClick={() => setQuery({ ...EMPTY_QUERY, sort: query.sort })}
          >
            Limpiar
          </button>
        )}
      </div>

      <nav className="db-tabs" aria-label="Secciones">
        <NeutralCounter count={status.neutralCards} limit={DECK_RULES.maxNeutralCards} compact />
        <button type="button" aria-pressed={tab === 'DECK'} onClick={() => setTab('DECK')}>
          Mi mazo{' '}
          <span className={`db-count-inline size-${sizeState}`}>
            {size}/{DECK_RULES.requiredSize}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={tab === 'COLLECTION'}
          onClick={() => setTab('COLLECTION')}
        >
          Colección disponible
        </button>
      </nav>

      <Suspense fallback={null}><CardCosmeticPicker /></Suspense>
      <main className="db-body">
        {!compact && (
          <aside className="db-detail" aria-label="Detalle de carta">
            <h2 className="db-panel-title">Detalle de carta</h2>
            {inspectedCard ? (
              <CardDetail
                card={inspectedCard}
                owned={owned(inspectedCard.id)}
                inDeck={countInDeck(draft, inspectedCard.id)}
                addIssue={addCardIssue(
                  draft,
                  inspectedCard.id,
                  heroId,
                  owned,
                  DEFAULT_CONTENT,
                  DECK_RULES,
                )}
                heroName={heroDef.name}
                context={detailContext}
                onAdd={() => tryAdd(inspectedCard.id)}
                onRemove={() => tryRemove(inspectedCard.id)}
                onClose={() => {
                  setDetailOpen(false);
                  setInspected(null);
                }}
              />
            ) : (
              <p className="db-detail-empty">Selecciona una carta del mazo o la colección.</p>
            )}
          </aside>
        )}
        <section
          className={`db-deck${dropActive === 'deck' ? ' is-drop' : ''}`}
          data-drag-state={dropActive === 'deck' ? (dragIssue ? 'invalid' : 'valid') : undefined}
          aria-labelledby="db-deck-title"
          data-drop-zone="deck"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="db-deck-head">
            <div>
              <h2 id="db-deck-title" className="menu-section-title">
                Mi mazo
              </h2>
              <span className="db-deck-name">
                {saved.name}
                {dirty && <span className="db-dirty"> · sin guardar</span>}
              </span>
            </div>
            <div
              className={`db-count size-${sizeState}`}
              key={feedback?.kind === 'added' || feedback?.kind === 'removed' ? feedback.id : 0}
            >
              <strong>{size}</strong>
              <span>/ {DECK_RULES.requiredSize}</span>
            </div>
          </div>
          <NeutralCounter count={status.neutralCards} limit={DECK_RULES.maxNeutralCards} />
          <div
            className={`db-meter size-${sizeState}`}
            role="meter"
            aria-label="Cartas en el mazo"
            aria-valuemin={0}
            aria-valuemax={DECK_RULES.requiredSize}
            aria-valuenow={size}
          >
            <span style={{ width: `${Math.min(100, (size / DECK_RULES.requiredSize) * 100)}%` }} />
          </div>

          <p className={`db-missing size-${sizeState}`} role="status">
            {status.missingCount
              ? `Falta${status.missingCount === 1 ? '' : 'n'} ${status.missingCount} carta${status.missingCount === 1 ? '' : 's'}`
              : status.valid
                ? '30 / 30 ✓ Listo para jugar'
                : 'Revisa las cartas del mazo'}
          </p>
          {dropMessage('deck') && <p className="db-drop-hint">{dropMessage('deck')}</p>}
          <details className="db-stats">
            <summary>Curva de coste y composición</summary>
            <div className="db-summary">
              <div
                className="db-curve"
                aria-label={`Curva de coste: ${COST_BUCKETS.map((b) => `coste ${b}: ${curve[b]}`).join(', ')}`}
              >
                {COST_BUCKETS.map((b) => (
                  <span key={b} className="db-curve-col" aria-hidden="true">
                    <span className="db-curve-n">{curve[b]}</span>
                    <span
                      className="db-curve-bar"
                      style={{ height: `${(curve[b] / curveMax) * 100}%` }}
                    />
                    <span className="db-curve-label">{b}</span>
                  </span>
                ))}
              </div>
              <ul className="db-cats" aria-label="Tipos en el mazo">
                {categoryCounts(lines).map(([c, n]) => (
                  <li key={c} data-category={c} title={CATEGORY_LABEL[c]}>
                    <GameIcon name={CATEGORY_ICON[c]} />
                    <span className="sr-only">{CATEGORY_LABEL[c]}</span>
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          </details>
          {lines.length || status.missingCount ? (
            <ol className="db-list">
              {lines.map(({ card, count }) => (
                <li
                  key={card.id}
                  className={`db-line${dragged?.from === 'deck' && dragged.cardId === card.id ? ' is-dragging' : ''}${inspected === card.id ? ' is-selected' : ''}`}
                  data-card-id={card.id}
                  data-premium={card.id === 'summon_war_drake' || undefined}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, `deck:${card.id}`);
                    e.dataTransfer.effectAllowed = 'move';
                    if (inspectTimer.current) clearTimeout(inspectTimer.current);
                    setDragged({ from: 'deck', cardId: card.id });
                  }}
                  onDragEnd={endDrag}
                  style={toneStyle(card)}
                >
                  <button
                    type="button"
                    className="db-line-main"
                    aria-label={`${card.name}, coste ${card.cost}, ${count} ${count === 1 ? 'copia' : 'copias'}. Ver detalle`}
                    onPointerDown={notePointer}
                    onClick={() => activateLine(card.id)}
                    onDoubleClick={() => doubleRemove(card.id)}
                    title="Doble clic para quitar una copia"
                  >
                    <span className="db-cost db-cost-sm" aria-hidden="true">
                      {card.cost}
                    </span>
                    <span className="db-line-art" aria-hidden="true">
                      <SpellArt cardId={card.id} spell={card.presentation.visualKey} />
                      <CardTypeVisual card={card} /><CardPremiumFx def={card} />
                    </span>
                    <span className="db-line-name">{card.name}</span><CardCosmeticMark def={card} />
                    <span className="db-line-count" aria-hidden="true">
                      ×{count}
                    </span>
                  </button>
                  {feedback?.cardId === card.id &&
                    (feedback.kind === 'added' || feedback.kind === 'removed') && (
                      <span
                        key={feedback.id}
                        className={`db-flash flash-${feedback.kind}`}
                        aria-hidden="true"
                      />
                    )}
                  <button
                    type="button"
                    className="db-line-remove"
                    aria-label={`Quitar una copia de ${card.name}`}
                    onClick={() => tryRemove(card.id)}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                </li>
              ))}
              {Array.from({ length: status.missingCount }, (_, i) => (
                <li key={`gap-${i}`} className="db-empty-slot">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('COLLECTION');
                      document.querySelector<HTMLInputElement>('.db-search input')?.focus();
                    }}
                    aria-label={`Elegir carta para espacio vacío ${i + 1}`}
                  >
                    <span>+</span> Carta
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="db-empty">El mazo está vacío. Añade cartas desde la colección.</p>
          )}

          <div className="db-status" role="status" aria-live="polite">
            {savedLegacy && (
              <p
                className="db-legacy"
                data-legacy-missing={DECK_RULES.requiredSize - deckSize(saved.cards)}
              >
                Este es tu mazo anterior de 20 cartas. No hemos cambiado ninguna carta. Añade 10
                cartas para actualizarlo al nuevo formato de 30.
              </p>
            )}
            {feedback && (
              <p key={feedback.id} className={`db-feedback is-${feedback.kind}`}>
                {feedback.text}
              </p>
            )}
            {issues.length > 0 && (
              <ul className="db-issues">
                {issues.slice(0, 3).map((issue, i) => (
                  <li key={i}>{deckIssueText(issue, heroDef.name)}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="db-actions">
            <button
              type="button"
              className="db-btn db-btn-ghost"
              disabled={sameDeck(draft, starterDeck(heroDef))}
              onClick={() => (dirty ? setStarterConfirm(true) : loadStarter())}
            >
              Mazo inicial
            </button>
            <button
              type="button"
              className="db-btn db-btn-ghost"
              disabled={!dirty}
              onClick={() => setDraft(saved.cards.map((e) => ({ ...e })))}
            >
              Deshacer
            </button>
            <button
              type="button"
              className="db-btn db-btn-primary db-save"
              disabled={issues.length > 0 || saving}
              onClick={() => void save()}
            >
              {saving ? 'Guardando…' : 'Guardar mazo'}
            </button>
          </div>
        </section>
        <section
          className={`db-collection${dropActive === 'collection' ? ' is-drop' : ''}`}
          data-drag-state={dropActive === 'collection' ? 'valid' : undefined}
          aria-labelledby="db-collection-title"
          data-drop-zone="collection"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <DiscoverRarities heroId={heroId}/>
          <h2 id="db-collection-title" className="menu-section-title">
            Colección disponible{' '}
            <span className="db-section-count">
              {unlockedCount}/{pool.length} desbloqueadas
            </span>
          </h2>
          {dropMessage('collection') && <p className="db-drop-hint">{dropMessage('collection')}</p>}
          {shown.length ? (
            <ul className="db-grid">
              {shown.map((card) => (
                <CollectionTile
                  key={card.id}
                  card={card}
                  owned={owned(card.id)}
                  inDeck={countInDeck(draft, card.id)}
                  selected={inspected === card.id}
                  pulse={feedback?.cardId === card.id ? feedback : null}
                  isNew={isNewCard(card.id)}
                  onPointerDown={notePointer}
                  onActivate={() => activateTile(card)}
                  onInspect={() => inspect(card.id, true)}
                  onAdd={() => tryAdd(card.id)}
                  onDoubleClick={() => doubleAdd(card.id)}
                  onDrag={() => {
                    if (inspectTimer.current) clearTimeout(inspectTimer.current);
                    setDragged({ from: 'collection', cardId: card.id });
                  }}
                  onDragEnd={endDrag}
                  dragging={dragged?.from === 'collection' && dragged.cardId === card.id}
                  availability={copyStatus.get(card.id)!.availableCopies}
                  canAdd={copyStatus.get(card.id)!.canAdd}
                  addReason={
                    copyStatus.get(card.id)!.addIssue
                      ? deckIssueText(copyStatus.get(card.id)!.addIssue!, heroDef.name)
                      : ''
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="db-empty">
              {query.ownership === 'LOCKED' && !query.text && unlockedCount === pool.length
                ? `Ya tienes todas las cartas del ${heroDef.name}.`
                : 'No hay copias disponibles que coincidan con los filtros.'}{' '}
              <button
                type="button"
                className="db-clear"
                onClick={() => setQuery({ ...EMPTY_QUERY, sort: query.sort })}
              >
                Limpiar filtros
              </button>
            </p>
          )}
        </section>
      </main>

      {compact && detailOpen && inspectedCard && (
        <DetailDialog
          onClose={() => {
            setDetailOpen(false);
            setInspected(null);
          }}
        >
          {inspectedCard ? (
            <CardDetail
              card={inspectedCard}
              owned={owned(inspectedCard.id)}
              inDeck={countInDeck(draft, inspectedCard.id)}
              addIssue={addCardIssue(
                draft,
                inspectedCard.id,
                heroId,
                owned,
                DEFAULT_CONTENT,
                DECK_RULES,
              )}
              heroName={heroDef.name}
              context={detailContext}
              onAdd={() => tryAdd(inspectedCard.id)}
              onRemove={() => tryRemove(inspectedCard.id)}
              onClose={() => {
                setDetailOpen(false);
                setInspected(null);
              }}
            />
          ) : (
            <p className="db-detail-empty">
              Selecciona una carta para ver su efecto, alcance y patrón.
            </p>
          )}
        </DetailDialog>
      )}
      {starterConfirm && (
        <StarterDialog onConfirm={loadStarter} onClose={() => setStarterConfirm(false)} />
      )}
      {leaving && (
        <LeaveDialog
          canSave={issues.length === 0}
          onStay={() => setLeaving(false)}
          onDiscard={() => {
            setLeaving(false);
            closeDeckBuilder();
          }}
          onSave={() => {
            setLeaving(false);
            void save().then((ok) => ok && closeDeckBuilder());
          }}
        />
      )}
    </div>
  );
}
