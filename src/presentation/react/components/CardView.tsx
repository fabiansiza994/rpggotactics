import '../../../styles/combat-clarity.css';
import { CardTypeVisual } from './CardTypeVisual';
import { CardOriginBadge } from './CardOriginBadge';
import { useCardPremiumEffect } from '../../cards/useCardPremiumEffect';
import { CardPremiumFx } from './CardPremiumFx';
import { worldRewardIdentity } from '../../cards/worldRewardPresentation';
import { RitualGlyph } from './RitualGlyph';
import type { CardDefinition } from '../../../game';
import { CATEGORY_LABEL, rangeText } from '../format';
import { CardPattern } from './CardPattern';
import { SpellArt } from './SpellArt';
import { useEffect, useRef, type CSSProperties } from 'react';
import { cardHold, mobileCombat } from '../mobileCombat';
import { CARD_IDENTITY } from '../../assets/visualIdentity';
import { GameIcon } from './GameIcon';
import type { IconName } from '../../assets/iconPaths';
import { STAGGER, staggerDelay } from '../../motion/tokens';
import type { CardBlock } from '../cardBlock';

interface Props {
  def: CardDefinition;
  hotkey: number;
  selected: boolean;
  playable: boolean;
  disabled?: boolean;
  /** Why it cannot be played now (cardBlock.ts); shown as a chip, detail on hover/focus/tap. */
  block?: CardBlock;
  /** Fine-pointer hover / keyboard focus in or out, for the hand's explanation hint. */
  onInspect?(on: boolean): void;
  onClick(): void;
  onLongInspect?(): void;
  onCancel?(): void;
  handSize?: number;
  uid?: string;
  effectiveCost?: number;
}

function compactText(text: string, maxLength = 52): string {
  if (text.length <= maxLength) return text;
  const excerpt = text.slice(0, maxLength + 1);
  const boundary = excerpt.lastIndexOf(' ');
  return `${excerpt.slice(0, boundary > 24 ? boundary : maxLength).trimEnd()}…`;
}

export const CATEGORY_ICON: Record<CardDefinition['category'], IconName> = {
  ATTACK: 'melee',
  MOVEMENT: 'move',
  DEFENSE: 'shield',
  CONTROL: 'target',
  TERRAIN: 'tile',
  UTILITY: 'arcane',
};

/** Illustrated presentation; all rule text and costs come directly from Core content. */
export function CardView({
  def,
  hotkey,
  selected,
  playable,
  disabled,
  block,
  onInspect,
  onClick,
  onCancel,
  onLongInspect,
  handSize = 5,
  uid,
  effectiveCost = def.cost,
}: Props) {
  const inspectRef = useRef(onLongInspect);
  useEffect(() => { inspectRef.current = onLongInspect; }, [onLongInspect]);
  const holdRef = useRef<ReturnType<typeof cardHold> | null>(null);
  useEffect(() => {
    let releaseGuard: (() => void) | undefined;
    const hold = cardHold(() => {
      // A modal can retarget the compatibility click away from the card that was held.
      releaseGuard?.();
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); document.removeEventListener('click', swallow, true); document.removeEventListener('pointerup', released, true); hold.consumeClick(); };
      const swallow = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); };
      const released = () => { clearTimeout(timer); timer = setTimeout(cleanup, 250); };
      document.addEventListener('click', swallow, true);
      document.addEventListener('pointerup', released, { capture: true, once: true });
      timer = setTimeout(cleanup, 10000);
      releaseGuard = cleanup;
      inspectRef.current?.();
    });
    holdRef.current = hold;
    return () => { hold.destroy(); releaseGuard?.(); };
  }, []);
  const premiumRef = useCardPremiumEffect<HTMLDivElement>(def, 'compact', selected, !disabled);
  const origin = worldRewardIdentity(def);
  const identity = CARD_IDENTITY[def.presentation.visualKey];
  const targetIcon: Record<CardDefinition['targeting']['type'], IconName> = {
    SELF: 'arcane',
    UNIT: 'target',
    TILE: 'tile',
    LINE: 'move',
    CROSS: 'cross',
    AREA: 'target',
    CHARGE: 'melee',
    STEP: 'move',
  };
  return (
    <div
      ref={premiumRef}
      data-disabled={disabled || undefined}
      className={`card ${selected ? 'is-selected' : ''} ${playable ? '' : 'is-unplayable'}`}
      data-ritual-piece={def.ritualPiece || undefined}
      data-premium={def.id === 'summon_war_drake' || undefined}
      data-origin-world={origin?.worldId}
      data-rarity={def.rarity ?? 'COMMON'}
      data-target-mode={(selected && playable && def.targeting.type !== 'SELF') || undefined}
      data-state={selected ? 'selected' : 'idle'}
      data-playable={playable}
      data-block={block?.code}
      data-card-uid={uid}
      data-element={def.presentation.element}
      data-visual-key={def.presentation.visualKey}
      data-category={def.category}
      data-family={identity?.family}

      style={
        {
          '--card-tone': identity?.tone,
          '--card-rise': `${Math.min(8, Math.abs(hotkey - (handSize + 1) / 2) * 2.5)}px`,
          '--card-tilt': `${Math.max(-4, Math.min(4, (hotkey - (handSize + 1) / 2) * 1.3))}deg`,
          '--deal-delay': `${staggerDelay(hotkey - 1, handSize, STAGGER.card)}ms`,
        } as CSSProperties
      }
      title={block ? undefined : def.rulesText}
      onClick={(event) => {
        if (holdRef.current?.consumeClick()) { event.preventDefault(); event.stopPropagation(); return; }
        if (!disabled) onClick();
      }}
      onPointerDown={(event) => {
        if (mobileCombat() && onLongInspect && !disabled && event.button === 0 && !(event.target as HTMLElement).closest('.card-selection-cancel'))
          holdRef.current?.start(event.clientX, event.clientY);
      }}
      onPointerMove={event => holdRef.current?.move(event.clientX, event.clientY)}
      onPointerUp={() => holdRef.current?.end()}
      onPointerCancel={() => holdRef.current?.cancel()}
      onContextMenu={event => { if (mobileCombat()) event.preventDefault(); }}
      onPointerEnter={onInspect && ((e) => e.pointerType === 'mouse' && matchMedia('(hover: hover) and (pointer: fine)').matches && onInspect(true))}
      onPointerLeave={onInspect && ((e) => e.pointerType === 'mouse' && onInspect(false))}
      onFocus={onInspect && (() => matchMedia('(hover: hover) and (pointer: fine)').matches && onInspect(true))}
      onBlur={onInspect && (() => onInspect(false))}
    >
      <button
        type="button"
        className="card-select-surface"
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`${def.name}; ${def.heroId ? '' : 'Neutral; '} coste ${effectiveCost}; ${CATEGORY_LABEL[def.category]} · ${rangeText(def)}; ${def.rulesText}`}
        aria-description={block ? `No se puede jugar: ${block.detail}` : undefined}
      />
      {block && !block.quiet && (
        <span className="card-block" aria-hidden="true">
          <span className="card-block-main">
            <GameIcon name={block.icon} />
            {block.chip}
          </span>
          {block.sub && <span className="card-block-sub">{block.sub}</span>}
        </span>
      )}
      {selected && onCancel && (
        <button
          type="button"
          className="card-selection-cancel"
          aria-label="Cancelar selección"
          title="Cancelar selección"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      <span className="card-selection-aura" aria-hidden="true" />
      <span className="card-cost" data-discounted={effectiveCost < def.cost || undefined} title={effectiveCost < def.cost ? `Coste original ${def.cost} · descuento activo` : undefined}>{effectiveCost}</span>
      <span className="card-class-icon" aria-hidden="true">
        {def.ritualPiece ? (
          <RitualGlyph
            family={
              def.id.startsWith('mark_')
                ? 'MAJOR'
                : def.id.startsWith('seal_')
                  ? 'LEGENDARY'
                  : 'MINOR'
            }
          />
        ) : (
          <GameIcon name={CATEGORY_ICON[def.category]} />
        )}
      </span>
      <span className="card-hotkey">{hotkey}</span>
      <span className="card-art" aria-hidden="true">
        <CardPremiumFx def={def} />
        <SpellArt cardId={def.id} spell={def.presentation.visualKey} /><CardTypeVisual card={def} showIcon={false} />
        <CardOriginBadge card={def} />
      </span>
      <span className="card-name">{def.name}</span>
      <span className="card-rarity-slot" aria-hidden="true">
        {origin ? `◆ RARA · ${origin.name}` : def.id === 'summon_war_drake' ? '◆ RARA' : null}
      </span>
      <span className="card-details">
        <span className="card-meta">
          <GameIcon name={targetIcon[def.targeting.type]} />
          {CATEGORY_LABEL[def.category]} · {rangeText(def)}
        </span>
        <span className="card-category">{CATEGORY_LABEL[def.category]}</span>
        <span className="card-quick-meta" title={`${CATEGORY_LABEL[def.category]} · ${rangeText(def)}`}>
          <GameIcon name={CATEGORY_ICON[def.category]}/><span className="hand-role">{CATEGORY_LABEL[def.category]} · </span>{{SELF:'Tú',UNIT:'Unidad',TILE:'Casilla',LINE:'Línea',CROSS:'Cruz',AREA:'Área',CHARGE:'Carga',STEP:'Paso'}[def.targeting.type]}{'range' in def.targeting ? ` ${def.targeting.range}` : ''}
        </span>
        <CardPattern targeting={def.targeting} />
      </span>
      <span className="card-summary">{compactText(def.rulesText)}</span>
      <span className="card-text">{def.rulesText}</span>
    </div>
  );
}
