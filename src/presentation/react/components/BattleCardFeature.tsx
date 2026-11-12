import { CardTypeVisual } from './CardTypeVisual';
import { CardOriginBadge } from './CardOriginBadge';
import { useCardPremiumEffect } from '../../cards/useCardPremiumEffect';
import { CardPremiumFx, CardCosmeticMark } from './CardPremiumFx';
import { WorldRewardBadge } from './WorldRewardBadge';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CardDefinition, GameEngine, GameState, RitualStatus } from '../../../game';
import { CARD_IDENTITY } from '../../assets/visualIdentity';
import { CATEGORY_LABEL, ERROR_LABEL, RARITY_LABEL, rangeText, targetingNotes } from '../format';
import { CardPattern } from './CardPattern';
import { CATEGORY_ICON } from './CardView';
import { GameIcon } from './GameIcon';
import { RitualGlyph } from './RitualGlyph';
import { SpellArt } from './SpellArt';
import '../../../styles/card-preview.css';
import { explainCardBlock } from '../cardBlock';

/** How long the previous card lingers while the next one is presented (matches the CSS exit). */
const SWAP_MS = 220;

interface Shown {
  uid: string;
  cardId: string;
}

interface Extras {
  playable: boolean;
  reason?: string;
  ritualName?: string;
  ritualTier?: 'MINOR' | 'MAJOR' | 'LEGENDARY';
  ritualSize?: number;
  progress?: RitualStatus;
}

/**
 * Presentation only: the selected hand card, enlarged and presented toward the board (desktop)
 * or opened on demand as a zoom dialog (phones). Reads definitions and read-only status from the
 * engine; never dispatches or changes targeting. The previous card cross-fades out so switching
 * selection is never a hard cut.
 */
export function BattleCardFeature({
  state,
  engine,
  selectedCardUid,
  hoveredCardUid = null,
  inspectedCardUid = null,
  onCloseInspection,
  onChooseInspection,
}: {
  state: Readonly<GameState>;
  engine: GameEngine;
  selectedCardUid: string | null;
  hoveredCardUid?: string | null;
  inspectedCardUid?: string | null;
  onCloseInspection?(): void;
  onChooseInspection?(uid: string): void;
}) {
  const inspection = state.player.hand.some((c) => c.uid === inspectedCardUid) ? inspectedCardUid : null;
  const previewUid = inspection ?? hoveredCardUid ?? selectedCardUid;
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!previewUid) return;
    const stage = stageRef.current;
    const hand = document.querySelector<HTMLElement>('.hand-bar > .hand');
    if (!stage || !hand) return;
    const fit = () => {
      const button = zoomButtonRef.current;
      const parent = button?.offsetParent;
      if (button && parent instanceof HTMLElement)
        button.style.setProperty('--zoom-safe-left', `${Math.max(6, 6 - parent.getBoundingClientRect().left)}px`);
      stage.style.setProperty(
        '--fc-bottom',
        `${Math.max(0, innerHeight - hand.getBoundingClientRect().top + 42)}px`,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(hand);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [previewUid]);
  const selected = state.player.hand.find((c) => c.uid === previewUid);
  const card = selected && engine.content.cards[selected.cardId];
  const current: Shown | null = selected && card ? { uid: selected.uid, cardId: card.id } : null;

  // Derived during render: when the selection changes, the old card becomes the leaving ghost.
  const [shown, setShown] = useState<{ current: Shown | null; leaving: Shown | null }>({
    current,
    leaving: null,
  });
  const [zoomOpen, setZoomOpen] = useState(false);
  const closeDetail = () => { setZoomOpen(false); onCloseInspection?.(); };
  if (shown.current?.uid !== current?.uid) {
    setShown({ current, leaving: shown.current ?? shown.leaving });
    if (!current) setZoomOpen(false);
  }
  useEffect(() => {
    if (!shown.leaving) return;
    const timer = setTimeout(() => setShown((s) => ({ ...s, leaving: null })), SWAP_MS);
    return () => clearTimeout(timer);
  }, [shown.leaving]);

  const leavingDef =
    shown.leaving && shown.leaving.uid !== selected?.uid
      ? engine.content.cards[shown.leaving.cardId]
      : undefined;
  if (!card && !leavingDef) return null;

  let extras: Extras = { playable: false };
  if (card && selected) {
    const playability = engine.getCardPlayability(selected.uid);
    const block = explainCardBlock(engine, state, selected.uid);
    const ritual = card.ritualPiece
      ? Object.values(engine.content.rituals ?? {}).find((r) => r.pieces.includes(card.id))
      : undefined;
    extras = {
      playable: !block && playability.playable,
      reason: block?.detail ?? (playability.playable ? undefined : ERROR_LABEL[playability.reason]),
      ritualName: ritual?.name,
      ritualTier: ritual?.tier,
      ritualSize: ritual?.pieces.length,
      progress: ritual && engine.getAltarStatus()?.rituals.find((r) => r.ritualId === ritual.id),
    };
  }
  return (
    <>
      <div ref={stageRef} className="card-feature-stage">
        {leavingDef && (
          <FeatureCard
            key={`leaving-${shown.leaving!.uid}`}
            def={leavingDef}
            engine={engine}
            className="is-leaving"
            extras={{ playable: true }}
            ariaHidden
          />
        )}
        {card && selected && (
          <FeatureCard
            key={selected.uid}
            def={card}
            engine={engine}
            className="battle-card-feature"
            extras={extras}
          />
        )}
      </div>
      {card && (
        <button
          type="button"
          ref={zoomButtonRef}
          className="mobile-card-zoom-button"
          onClick={() => setZoomOpen(true)}
          aria-label={`Ampliar carta ${card.name}`}
        >
          ✧ Ver carta
        </button>
      )}
      {card && (zoomOpen || inspection) && (
        <dialog
          className="card-preview-zoom"
          ref={(dialog) => {
            if (dialog && !dialog.open) dialog.showModal();
          }}
          onClose={closeDetail}
          onCancel={closeDetail}
          onClick={(event) => {
            // A tap on the backdrop (the dialog box itself, outside its content) closes it.
            if (event.target === event.currentTarget) closeDetail();
          }}
          aria-label={`Detalle: ${card.name}`}
        >
          <FeatureCard def={card} engine={engine} className="is-zoomed" extras={extras} />
          <div className="zoom-support">
            {onChooseInspection && selected && <button className="mobile-inspection-play" type="button" disabled={!extras.playable} onClick={() => { closeDetail(); onChooseInspection(selected.uid); }}>Elegir carta</button>}
            <button className="card-zoom-close" type="button" onClick={closeDetail} autoFocus>
              Cerrar detalle
            </button>
            <CardPattern targeting={card.targeting} />
            <strong>{rangeText(card)}</strong>
            <ul>
              {targetingNotes(card).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            {extras.reason && <section className="zoom-reason" role="status">
              <strong>NO DISPONIBLE AHORA</strong>
              <p>{extras.reason}</p>
            </section>}
          </div>
        </dialog>
      )}
    </>
  );
}

/** Long rules shrink the art band and the type so the full text always fits the face. */
function textLength(text: string): 'short' | 'medium' | 'long' {
  return text.length > 150 ? 'long' : text.length > 100 ? 'medium' : 'short';
}

function kindLabel(def: CardDefinition): string {
  if (def.ritualPiece) return 'Pieza de ritual';
  if (def.effects.some((e) => e.type === 'SUMMON')) return 'Invocación';
  return CATEGORY_LABEL[def.category];
}

/** The card face itself: frame, cost, rarity gem, uncropped art, type line and rules text. */
export function FeatureCard({
  def,
  engine,
  className,
  extras,
  ariaHidden,
  scrollableDescription,
}: {
  def: CardDefinition;
  engine?: GameEngine;
  className: string;
  extras: Extras;
  ariaHidden?: boolean;
  scrollableDescription?: boolean;
}) {
  const premiumRef = useCardPremiumEffect<HTMLElement>(def, 'large', true, !ariaHidden);
  const premium = def.id === 'summon_war_drake';
  const rarity = def.rarity ?? 'COMMON';
  const cost = engine?.getCardCost(engine.state.player.hand.find(c => c.cardId === def.id)?.uid ?? '')?.cost ?? def.cost;
  const champion = def.heroId ? (engine?.content.heroes[def.heroId]?.name ?? (({mage:'Mago',summoner:'Invocador',warrior:'Guerrero',archer:'Arquero',shapeshifter:'Cambiaformas'} as Record<string,string>)[def.heroId] ?? def.heroId)) : 'Neutral';
  const { playable, reason, ritualName, ritualTier, ritualSize, progress } = extras;
  return (
    <aside ref={premiumRef}
      className={`feature-card ${className}`}
      data-card-id={def.id}
      data-rarity={rarity}
      data-premium={premium || undefined}
      data-ritual-piece={def.ritualPiece || undefined}
      data-playable={playable}
      data-text-length={textLength(def.rulesText)}
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : `Carta elegida: ${def.name}`}
      style={{ '--card-tone': CARD_IDENTITY[def.presentation.visualKey]?.tone } as CSSProperties}
    >
      <span className="fc-glow" aria-hidden="true" />
      <div className="fc-frame">
        <header className="fc-head">
          <span className="fc-cost" aria-label={`${cost} energía`}>
            {cost}
          </span>
          <strong className="fc-name">{def.name}</strong>
          <span className="fc-gem" title={RARITY_LABEL[rarity]} aria-hidden="true" />
        </header>
        <div className="fc-art">
          <span className="fc-art-backdrop" aria-hidden="true">
            <SpellArt cardId={def.id} spell={def.presentation.visualKey} />
          </span>
          <span className="featured-art">
            <SpellArt cardId={def.id} spell={def.presentation.visualKey} />
          </span>
          <CardTypeVisual card={def} /><CardPremiumFx def={def} />
        </div>
        <div className="fc-typeline">
          <span className="fc-kind">
            {def.ritualPiece && ritualTier ? (
              <RitualGlyph family={ritualTier} />
            ) : (
              <GameIcon name={CATEGORY_ICON[def.category]} />
            )}
            {kindLabel(def)}
          </span>
          <CardOriginBadge card={def} /><CardCosmeticMark def={def} />
          {premium ? (
            <span className="fc-rarity premium-tier-label">✧ Reliquia arcana</span>
          ) : (
            <span className="fc-rarity">{RARITY_LABEL[rarity]}</span>
          )}
        </div>
        <WorldRewardBadge def={def} compact />
        <p className="fc-text" tabIndex={scrollableDescription ? 0 : undefined}>{def.rulesText}</p>
        <footer className="fc-support">
          <CardPattern targeting={def.targeting} />
          <span className="fc-range">
            {champion} · {rangeText(def)}
          </span>
          {ritualName && (
            <span className="featured-ritual">
              {ritualName} · {progress?.sealedCount ?? 0}/{ritualSize}
            </span>
          )}
        </footer>
      </div>
      {!playable && reason && <span className="fc-status">{reason}</span>}
    </aside>
  );
}
