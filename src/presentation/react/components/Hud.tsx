import { CardActivationLabel } from './CardActivationLabel';
import { mobileCombat, mobileEndTurnAllowed } from '../mobileCombat';
import { isActionableTile } from '../../input/aim';
import { BattleResultPresentation } from '../../results/BattleResultPresentation';
import { EquippedCardBack } from '../../cosmetics/CardBack';
import '../../../styles/combat-clarity.css';
import type { CombatPhase } from '../../combat/clarity';
import { ResolvingCardPreview } from './ResolvingCardPreview';
import { shapeshifterPresentationEnabled } from '../../shapeshifterRelease';
import { activateHandCard } from '../handInteraction';
import { formVisual } from '../../qa/shapeshifter/visuals';
import {SummonSearchDialog} from './SummonSearchDialog';
import { RitualEchoDialog } from './RitualEchoDialog';
import '../../../styles/ritual-altar.css';
import { markedPrey } from '../../cards/tacticalPresentation';
import { motionCues } from '../../motion/motionCues';
import { presentationBus } from '../../events/presentationBus';
import { RitualTransfer } from './RitualTransfer';
import { RitualGlyph } from './RitualGlyph';
import { FINAL_CARD_ART } from '../../assets/paintedAssets';
import { attachCardActivation } from '../../cards/cardActivation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  altarOf,
  altarSlots,
  ritualSelection,
  type GameEngine,
  type GameState,
  type IntentPlan,
} from '../../../game';
import { activeRun, cloudActive, inputLocked, useBattleStore } from '../../store/battleStore';
import { ERROR_LABEL, intentLabel, objectiveLabel, OUTCOME_LABEL, statusChipText } from '../format';
import { CardView } from './CardView';
import { SummonCapacityMeter } from './SummonCapacityMeter';
import { explainCardBlock, type CardBlock } from '../cardBlock';
import { HandCounter, HandDiscardBar } from './HandLimitControls';
import { BattleCardFeature } from './BattleCardFeature';
import { CharacterPortrait } from './CharacterPortrait';
import { GameIcon } from './GameIcon';
import { unitVisualId } from '../../assets/visualIdentity';
import { NoDropResult, RewardChoice, RunComplete } from './RunPanels';
import { ArcherHudLine } from '../../qa/archer/ArcherHud';
import { isArcherPrey } from '../../qa/archer/archerBoard';

export function HeroPanel({ state, engine }: { state: Readonly<GameState>; engine: GameEngine }) {
  const hero = state.units.find((u) => u.id === engine.heroId);
  const heroDef = engine.content.heroes[hero?.defId ?? engine.scenario.hero.heroId];
  const p = state.player;
  const guardLabel = heroDef?.momentum ? 'Guardia' : 'Escudo';
  return (
    <section className="panel hero-panel">
      <div className="hero-portrait" aria-hidden="true">
        <CharacterPortrait unit={unitVisualId(heroDef?.id ?? 'mage')} />
        {!!hero?.shield && (
          <span
            className="hero-shield"
            data-kind={heroDef?.momentum ? 'guard' : 'shield'}
            aria-label={`${guardLabel} ${hero.shield}`}
          >
            +{hero.shield}
          </span>
        )}
      </div>
      <div className="hero-vitals">
        <div className="panel-title">
          {hero?.name ?? heroDef?.name ?? 'Héroe'}
          {shapeshifterPresentationEnabled && hero?.defId === 'shapeshifter' && <small> · {formVisual(hero.activeForm).label}</small>}
          <SummonCapacityMeter state={state} engine={engine} />
        </div>
        <Bar
          label="HP"
          value={hero?.hp ?? 0}
          max={hero?.maxHp ?? heroDef?.maxHp ?? 1}
          kind="hp"
          extra={hero?.shield ? `+${hero.shield} ${guardLabel.toLowerCase()}` : ''}
        />
        <Bar label="Energía" value={p.energy} max={p.maxEnergy} kind="energy" />
        <Bar label="Movimiento" value={p.movePoints} max={p.maxMovePoints} kind="move" />
        {hero?.momentum && <MomentumMeter value={hero.momentum.value} max={hero.momentum.max} />}
        {hero?.focus && <ArcherHudLine state={state} content={engine.content} />}
        {hero && hero.statuses.length > 0 && (
          <div className="statuses">
            {hero.statuses.map((s) => (
              <span key={s.id} className="status-chip">
                {statusChipText(s)}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Warrior's Impulso: pips + a short flash on gain/spend. Functional placeholder (Codex polishes
 * it later); the value is read from the authoritative unit state, never kept locally.
 */
function MomentumMeter({ value, max }: { value: number; max: number }) {
  const previous = useRef(value);
  const [change, setChange] = useState<{ kind: 'gain' | 'spend'; n: number } | null>(null);
  useEffect(() => {
    if (value !== previous.current) {
      const kind = value > previous.current ? 'gain' : 'spend';
      setChange((c) => ({ kind, n: (c?.n ?? 0) + 1 }));
    }
    previous.current = value;
  }, [value]);
  return (
    <div
      className="momentum-meter"
      data-change={change?.kind}
      key={change?.n ?? 0}
      role="meter"
      aria-label={`Impulso ${value} de ${max}`}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      title="Impulso: +1 al trabarte en melé (1 vez por turno) y por cada golpe enemigo recibido. Algunas cartas lo consumen."
    >
      <span className="momentum-label">IMP</span>
      <span className="momentum-pips">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`momentum-pip${i < value ? ' is-on' : ''}`} />
        ))}
      </span>
      <span className="bar-value">
        {value}/{max}
      </span>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  kind,
  extra = '',
}: {
  label: string;
  value: number;
  max: number;
  kind: string;
  extra?: string;
}) {
  return (
    <div className={`bar bar-${kind}`}>
      <span className="bar-label" aria-label={label} title={label}>
        <GameIcon name={kind === 'hp' ? 'hp' : kind === 'energy' ? 'energy' : 'move'} />
        {kind === 'energy' ? 'EN' : kind === 'move' ? 'MP' : label}
      </span>
      <span className="bar-track">
        <span
          className="bar-fill"
          style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }}
        />
      </span>
      <span className="bar-value">
        {value}/{max} <span className="bar-extra">{extra}</span>
      </span>
    </div>
  );
}

export function TurnPanel({
  state,
  scenarioName,
  displayPhase,
  children,
}: {
  state: Readonly<GameState>;
  scenarioName: string;
  displayPhase?: CombatPhase;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const primary = state.objectives[0];
  return (
    <section className={`panel turn-panel ${expanded ? 'is-expanded' : ''}`}>
      <div className="turn-title">
        <span className="round-label">Ronda {state.round}</span>
        <span className="turn-scenario" title={scenarioName}>
          {scenarioName}
        </span>
        <span>
          {displayPhase === 'FINISHED' ? 'Combate terminado' : displayPhase === 'RESOLVING' ? 'Resolviendo…' : state.phase === 'PLAYER'
            ? 'Tu turno'
            : state.phase === 'ENEMY'
              ? 'Turno enemigo'
              : 'Fin'}
        </span>
        {/* Touch layouts fold the objective list behind ⓘ: keep the live progress visible. */}
        {primary && (
          <span
            className="objective-chip"
            aria-hidden="true"
            data-status={primary.status.toLowerCase()}
          >
            ◈ {objectiveLabel(primary, state).title} {objectiveLabel(primary, state).progress}
          </span>
        )}
      </div>
      <button
        type="button"
        className="encounter-toggle"
        aria-label="Detalles del encuentro"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        ⓘ
      </button>
      <div className="turn-extra">
        {children}
        {state.objectives.map((o, i) => {
          const label = objectiveLabel(o, state);
          return (
            <div
              key={i}
              className={`objective objective-${o.status.toLowerCase()}`}
              data-objective={o.def.type.toLowerCase()}
            >
              <GameIcon name="arcane" /> <span className="objective-title">{label.title}</span>{' '}
              <span key={label.progress} className="objective-progress">
                {label.progress}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function EnemyPanel({
  state,
  plans,
  onFocus,
}: {
  state: Readonly<GameState>;
  plans: IntentPlan[];
  onFocus(enemyId: string | null): void;
}) {
  const enemies = state.units.filter((u) => u.faction === 'ENEMY');
  return (
    <section className="panel enemy-panel" data-enemies={enemies.length}>
      <div className="panel-title">Enemigos ({enemies.length})</div>
      {enemies.length === 0 && <div className="muted">Sin enemigos en el tablero</div>}
      {enemies.map((e) => {
        const intent = state.intents.find((i) => i.enemyId === e.id);
        const plan = plans.find((p) => p.enemyId === e.id);
        return (
          <button
            key={e.id}
            type="button"
            className="enemy-row"
            aria-label={`${e.name}; ${e.hp}/${e.maxHp} HP; ${markedPrey(e) || isArcherPrey(e) ? 'Presa marcada;' : ''} ${intent ? intentLabel(intent, plan, state) : ''}`}
            onClick={() => onFocus(e.id)}
            onFocus={() => onFocus(e.id)}
            onBlur={() => {
              if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) onFocus(null);
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') onFocus(e.id);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') onFocus(null);
            }}
          >
            <div className="enemy-name">
              <span className="enemy-portrait">
                <CharacterPortrait unit={unitVisualId(e.defId)} />
              </span>
              <span className="enemy-label">{e.name}</span>{markedPrey(e)&&<span className="prey-status"><GameIcon name="prey"/>Presa</span>}{isArcherPrey(e)&&<span className="prey-status hunter-prey" title="Presa del Arquero"><i aria-hidden="true">◎</i><span className="hunter-prey-text"> Presa</span></span>}{' '}
              <span className="muted">
                {e.hp}/{e.maxHp}
                <span className="enemy-hp-suffix">
                  {' '}
                  HP{e.armor ? ` · armadura ${e.armor}` : ''}
                </span>
              </span>
            </div>
            <div className="enemy-intent">{intent ? intentLabel(intent, plan, state) : '—'}</div>
            {e.statuses.some((s) => s.id !== 'PREY') && (
              <div className="statuses">
                {e.statuses.filter((s) => s.id !== 'PREY').map((s) => (
                  <span key={s.id} className="status-chip">
                    {statusChipText(s)}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </section>
  );
}

export function HandBar({ state, engine }: { state: Readonly<GameState>; engine: GameEngine }) {
  const footerRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pile, setPile] = useState<'deck' | 'discard' | null>(null);
  // PvP rebuilds its read-only engine on every authoritative snapshot, not a new battle.
  const online = useBattleStore((s) => s.onlineCommand !== null);
  const activationBattle = online ? null : engine;
  useEffect(() => {
    if (pile && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [pile]);
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    return attachCardActivation(footer, () => useBattleStore.getState().engine?.heroId ?? '');
  }, [activationBattle]);
  const aim = useBattleStore(s => s.aim);
  const pair = useBattleStore(s => s.pairSelection);
  const selectedCardUid = useBattleStore((s) => s.selectedCardUid);
  const selectCard = useBattleStore((s) => s.selectCard);
  useEffect(() => {
    if (
      !selectedCardUid ||
      !window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches
    )
      return;
    const hand = footerRef.current?.querySelector<HTMLElement>('.hand');
    const card = hand?.querySelector<HTMLElement>('.card.is-selected');
    if (!hand || !card) return;
    // Center only the hand scroller: scrollIntoView also pans the document toward a side rail.
    const handRect = hand.getBoundingClientRect(),
      cardRect = card.getBoundingClientRect();
    hand.scrollTo({
      left:
        hand.scrollLeft + cardRect.left - handRect.left - (hand.clientWidth - cardRect.width) / 2,
    });
  }, [selectedCardUid]);
  const endTurn = useBattleStore((s) => s.endTurn);
  const aiming = !!selectedCardUid || aim?.source === 'tap';
  const wasAiming = useRef(false);
  const aimReleasedAt = useRef(-Infinity);
  useEffect(() => {
    if (wasAiming.current && !aiming) aimReleasedAt.current = performance.now();
    wasAiming.current = aiming;
  }, [aiming]);
  const busy = useBattleStore(inputLocked);
  // During an intro the hand is held back and dealt on the `deal` beat.
  const dealt = useBattleStore((s) => !s.introLocked || s.introReached.includes('deal'));
  const handPulse = useBattleStore((s) => s.handPulse);
  const isPlayerTurn = state.phase === 'PLAYER' && !busy;
  // End-of-turn discard picker (hand rule): every hand card becomes a discard candidate.
  const handDiscard = useBattleStore((s) => s.handDiscard);
  const discarding = !!handDiscard && state.phase === 'PLAYER';
  // Why each hand card is blocked (E2). Recomputed from the engine whenever the state changes.
  const blocks = useMemo(() => {
    const out = new Map<string, CardBlock>();
    for (const card of state.player.hand) {
      const block = explainCardBlock(engine, state, card.uid);
      if (block) out.set(card.uid, block);
    }
    return out;
  }, [engine, state]);
  // Desktop hint for the hovered / focused blocked card (touch uses the tap notice instead).
  const [inspected, setInspected] = useState<string | null>(null);
  // Reading a blocked card never becomes a gameplay selection.
  const [detailUid, setDetailUid] = useState<string | null>(null);
  const hero = state.units.find(u => u.id === engine.heroId);
  const aimedCard = state.player.hand.find(c => c.uid === selectedCardUid);
  const aimedName = aimedCard ? engine.content.cards[aimedCard.cardId]?.name : null;
  const canActivateAim = !busy && aim?.source === 'tap' && isActionableTile(engine, selectedCardUid, aim.pos, pair);
  const hint = !discarding && inspected ? blocks.get(inspected) : undefined;
  const hintCard = hint && state.player.hand.find((c) => c.uid === inspected);
  return (
    <footer ref={footerRef} className="hand-bar" aria-busy={busy}>
      <div className="mobile-combat-header" aria-label="Estado del combate">
        <div className="mobile-enemies">{state.units.filter(u => u.faction !== hero?.faction && u.hp > 0).map(u => <span key={u.id} title={engine.content.enemies[u.defId]?.name ?? u.defId} aria-label={`${engine.content.enemies[u.defId]?.name ?? u.defId}: ${u.hp} HP`}><b>{(engine.content.enemies[u.defId]?.name ?? u.defId).slice(0, 2)}</b><small>{u.hp}</small></span>)}</div>
        <div><small>RONDA {state.round}</small><strong>{busy ? 'Resolviendo…' : state.phase === 'PLAYER' ? 'Tu turno' : 'Turno rival'}</strong></div>
      </div>
      {!discarding && (selectedCardUid || aim?.source === 'tap') && <div className="mobile-aim-controls" role="group" aria-label="Objetivo de carta">
        <span><small>{selectedCardUid ? canActivateAim ? 'Activa la carta' : 'Selecciona un objetivo válido' : 'Confirma el destino'}</small>{selectedCardUid && <strong>{aimedName ?? 'Carta seleccionada'}</strong>}</span>
        <button type="button" disabled={!canActivateAim} onClick={() => useBattleStore.getState().confirmAim()}><CardActivationLabel card={!!selectedCardUid}/></button>
        <button type="button" disabled={busy} aria-label="Cancelar objetivo" onClick={() => useBattleStore.getState().cancelAim()}>×</button>
      </div>}
      <section className="mobile-player-status" aria-label="Tu campeón">
        <div className="mobile-player-health">
          <strong>{engine.content.heroes[hero?.defId ?? '']?.name ?? 'Campeón'}</strong>
          <span aria-label={`Vida ${hero?.hp ?? 0} de ${hero?.maxHp ?? 0}`}>♥ {hero?.hp}/{hero?.maxHp}</span>
          <div className="mobile-health-track" aria-hidden="true"><i style={{width:`${100 * (hero?.hp ?? 0) / Math.max(1,hero?.maxHp ?? 1)}%`}}/></div>
        </div>
        <div className="mobile-player-resources">
          <div className="mobile-resource-row">
            <span className="mobile-energy" aria-label={`Energía ${state.player.energy} de ${state.player.maxEnergy}`}><b>EN</b> {state.player.energy}/{state.player.maxEnergy}</span>
            <span aria-label={`Movimiento ${state.player.movePoints}`}><b>PM</b> {state.player.movePoints}</span>
            <span className="mobile-shield" aria-label={`${engine.content.heroes[hero?.defId ?? '']?.momentum ? 'Guardia' : 'Escudo'} ${hero?.shield ?? 0}`}>◇ {hero?.shield ?? 0}</span>
          </div>
          <div className="mobile-status-chips" aria-label="Estados activos">
            {hero?.statuses.length ? hero.statuses.map(status => <span key={status.id} title={statusChipText(status)}>{statusChipText(status)}</span>) : <span className="mobile-no-status">Sin estados</span>}
          </div>
        </div>
      </section>
      {hint && hintCard && (
        <div className="card-block-hint" role="status">
          <strong>{engine.content.cards[hintCard.cardId]?.name}:</strong> {hint.detail}
        </div>
      )}
      <SummonSearchDialog key={selectedCardUid ?? 'no-search'} state={state} engine={engine} />
      <RitualEchoDialog key={`echo-${selectedCardUid ?? 'none'}`} state={state} engine={engine} />
      <RitualTransfer heroId={engine.heroId} />
      <ResolvingCardPreview engine={engine} />
      <BattleCardFeature state={state} engine={engine} selectedCardUid={selectedCardUid} hoveredCardUid={discarding ? null : inspected}
        inspectedCardUid={discarding ? null : detailUid} onCloseInspection={() => setDetailUid(null)} onChooseInspection={uid => { setDetailUid(null); selectCard(uid); }} />
      <AltarPanel state={state} engine={engine} busy={busy} />
      {handPulse > 0 && (
        <span key={handPulse} className="draw-feedback" aria-live="polite">
          ✦ Cartas robadas
        </span>
      )}
      {pair && pair.cardUid === selectedCardUid && <div className="pair-target-controls" role="group" aria-label="Segundo objetivo de Pacto">
        <span>Elige otra invocación o tu campeón</span>
        <button type="button" disabled={busy || !engine.getSecondaryTargets(pair.cardUid, pair.first).includes(null)} onClick={() => useBattleStore.getState().confirmPairWithChampion()}>Intercambiar conmigo</button>
        <button type="button" disabled={busy} onClick={() => useBattleStore.getState().cancelPairTarget()}>Cambiar primer objetivo</button>
      </div>}
      {discarding && <HandDiscardBar state={state} />}
      <button
        type="button"
        className="pile pile-deck"
        aria-label={`Mazo: ${state.pileCounts?.deck ?? state.player.deck.length} cartas`}
        onClick={() => setPile('deck')}
      >
        <EquippedCardBack />
        <span className="pile-count">{state.pileCounts?.deck ?? state.player.deck.length}</span>
        <span className="pile-label">Mazo</span>
      </button>
      <div className={`hand ${discarding ? 'is-discarding' : ''}`}>
        {dealt &&
          state.player.hand.map((card, i) => {
            const def = engine.content.cards[card.cardId];
            if (!def) return null;
            const block = discarding ? undefined : blocks.get(card.uid);
            return (
              <CardView
                key={card.uid}
                uid={card.uid}
                def={def}
                effectiveCost={engine.getCardCost(card.uid)?.cost ?? def.cost}
                hotkey={i + 1}
                handSize={state.player.hand.length}
                disabled={busy}
                selected={discarding ? card.uid === handDiscard?.uid : card.uid === selectedCardUid}
                playable={!block}
                block={block}
                onInspect={(on) => setInspected((cur) => (on ? card.uid : cur === card.uid ? null : cur))}
                onLongInspect={() => { useBattleStore.getState().cancelAim(); setDetailUid(card.uid); }}
                onCancel={discarding ? undefined : () => useBattleStore.getState().cancelAim()}
                onClick={() => {
                  // A ritual can still be usable on the altar even when its cast is blocked.
                  const canSeal = def.ritualPiece && engine.getCommitPlayability(card.uid).playable;
                  activateHandCard(card.uid, canSeal ? undefined : block, {
                    cancel: () => useBattleStore.getState().cancelAim(),
                    inspect: setDetailUid,
                    select: selectCard,
                  });
                }}
              />
            );
          })}
      </div>
      <div className="end-turn-box">
        <HandCounter state={state} />
        <div
          className="energy-pips"
          aria-label={`Energía ${state.player.energy} de ${state.player.maxEnergy}`}
        >
          {Array.from({ length: state.player.maxEnergy }, (_, i) => (
            <span key={i} className={`pip ${i < state.player.energy ? 'on' : ''}`} />
          ))}
        </div>
        <button
          type="button"
          className="end-turn"
          aria-label="Finalizar turno"
          disabled={!isPlayerTurn}
          onClick={() => {
            if (mobileCombat() && !mobileEndTurnAllowed(performance.now(), aimReleasedAt.current, aiming, discarding)) return;
            endTurn();
          }}
        >
          <GameIcon name="arcane" /> <span className="end-turn-full">Finalizar turno</span>
          <span className="end-turn-short" aria-hidden="true">
            Fin turno
          </span>{' '}
          <kbd>E</kbd>
        </button>
      </div>
      <button
        type="button"
        className="pile pile-discard"
        aria-label={`Descartes: ${state.player.discard.length} cartas`}
        onClick={() => setPile('discard')}
      >
        <GameIcon name="discard" />
        <span className="pile-count">{state.player.discard.length}</span>
        <span className="pile-label">Descartes</span>
      </button>
      {pile && (
        <dialog
          className="pile-dialog"
          ref={dialogRef}
          onClose={() => setPile(null)}
          onCancel={() => setPile(null)}
          aria-label={pile === 'deck' ? 'Cartas en el mazo' : 'Cartas descartadas'}
        >
          <h2>{pile === 'deck' ? 'Mazo' : 'Descartes'}</h2>
          <p>
            Al agotarse el mazo se baraja el descarte. Primer reciclaje gratis; después, Fatiga
            Arcana 1, 2, 3…
          </p>
          <p>
            Reciclajes: {state.player.deckRecycles} · Próxima fatiga: {state.player.deckRecycles}
          </p>
          <ul>
            {state.player[pile].map((card) => (
              <li key={card.uid}>
                {engine.content.cards[card.cardId]?.name} · coste{' '}
                {engine.content.cards[card.cardId]?.cost}
              </li>
            ))}
          </ul>
          {pile === 'deck' && state.pileCounts ? (
            <p>El orden del mazo lo conserva el servidor.</p>
          ) : (
            state.player[pile].length === 0 && <p>No hay cartas.</p>
          )}
          <button type="button" autoFocus onClick={() => setPile(null)}>
            Cerrar
          </button>
        </dialog>
      )}
    </footer>
  );
}

export function CombatLog() {
  const log = useBattleStore((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log]);
  return (
    <details className="panel log-panel">
      <summary>
        Registro <span aria-hidden="true">◇</span>
      </summary>
      <div className="log" ref={ref}>
        {log.map((l) => (
          <div key={l.id} className={`log-line tone-${l.tone}`}>
            {l.text}
          </div>
        ))}
      </div>
    </details>
  );
}

export function ResultOverlay(props: { state: Readonly<GameState>; masteryFeedback?:ReactNode }) {
  const engine = useBattleStore(s => s.engine);
  const busy = useBattleStore(s => s.playbackBusy);
  if (!props.state.outcome || busy || !engine) return null;
  return <BattleResultPresentation identity={engine} tone={props.state.outcome.result === 'WON' ? 'victory' : 'defeat'}><ResultContent {...props}/></BattleResultPresentation>;
}
function ResultContent({ state, masteryFeedback }: { state: Readonly<GameState>; masteryFeedback?:ReactNode }) {
  const heroName = useBattleStore((s) =>
    s.engine ? (s.engine.content.heroes[s.engine.scenario.hero.heroId]?.name ?? 'Héroe') : 'Héroe',
  );
  const restart = useBattleStore((s) => s.restart);
  const backToMenu = useBattleStore((s) => s.backToMenu);
  const busy = useBattleStore((s) => s.playbackBusy);
  const run = useBattleStore(activeRun);
  const cloud = useBattleStore((s) => (cloudActive(s) ? s.cloud : null));
  const retryCloud = useBattleStore((s) => s.retryCloud);
  if (!state.outcome || busy) return null;
  const won = state.outcome.result === 'WON';
  // Verified win that rolled nothing: the run already moved on — say so instead of offering a retry.
  if (
    run &&
    won &&
    run.status === 'IN_BATTLE' &&
    run.completedEncounterIds.includes(state.scenarioId)
  )
    return (
      <div className="result-overlay" role="dialog" aria-modal="true">
        <NoDropResult run={run} masteryFeedback={masteryFeedback}/>
      </div>
    );
  if (run && won && run.status !== 'IN_BATTLE')
    return (
      <div className="result-overlay" role="dialog" aria-modal="true">
        {run.status === 'CHOOSING_REWARD' ? (
          <RewardChoice run={run} masteryFeedback={masteryFeedback}/>
        ) : run.campaignId === 'skirmish' ? (
          <NoDropResult run={run} masteryFeedback={masteryFeedback}/>
        ) : (
          <RunComplete run={run} masteryFeedback={masteryFeedback}/>
        )}
      </div>
    );
  return (
    <div className="result-overlay" role="dialog" aria-modal="true">
      <div className={`result-card ${won ? 'won' : 'lost'}`}>
        <h2>{won ? 'Victoria' : 'Derrota'}</h2>
        {masteryFeedback}
        <p>
          {state.outcome.reason === 'HERO_DEFEATED'
            ? `El ${heroName} ha caído`
            : OUTCOME_LABEL[state.outcome.reason]}
        </p>
        {run && won && cloud && (
          <p className="cloud-sync" role="status">
            {cloud.busy
              ? 'Confirmando victoria y progreso…'
              : 'El resultado aún no está confirmado aquí. Puedes reintentar la confirmación sin repetir el combate.'}
          </p>
        )}
        <p className="muted">
          Ronda {state.round} · {state.stats.cardsPlayed} cartas jugadas ·{' '}
          {state.stats.enemiesDefeated} enemigos derrotados
        </p>
        <div className="result-actions">
          {run && won && cloud ? (
            <button type="button" disabled={!!cloud.busy || !cloud.canRetry} onClick={retryCloud}>
              Reintentar confirmación
            </button>
          ) : (
            <button type="button" onClick={restart}>
              {run ? 'Reintentar encuentro' : 'Reiniciar'}
            </button>
          )}
          <button type="button" onClick={backToMenu}>
            {run ? 'Volver a la ruta' : 'Menú'}
          </button>
        </div>
      </div>
    </div>
  );
}

const TIER_LABEL = { MINOR: 'Menor', MAJOR: 'Mayor', LEGENDARY: 'Legendario' } as const;
/** Ritual emblems painted so far (/art/rituals/<key>.svg); others show the generic glyph. */
const RITUAL_EMBLEMS = new Set(['ritual_ancestral_shell']);

/**
 * Ritual altar (functional placeholder; Codex designs the final altar/progress UI). Shows the
 * player's OWN sealed pieces and ritual progress, the seal action for a selected piece and the
 * activation buttons. In PvP only the rival's altar size is known (pileCounts.opponentAltar).
 * Every action is a command validated by the rules/server.
 */
function RitualReadyLabel({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (ready) motionCues.emit('ritual_ready');
  }, [ready]);
  return ready ? <b className="altar-ready-label"> · RITUAL LISTO</b> : null;
}

export function AltarPanel({
  state,
  engine,
  busy,
}: {
  state: Readonly<GameState>;
  engine: GameEngine;
  busy: boolean;
}) {
  const selectedCardUid = useBattleStore((s) => s.selectedCardUid);
  const selectCard = useBattleStore((s) => s.selectCard);
  const commit = useBattleStore((s) => s.commitRitualPiece);
  const release = useBattleStore((s) => s.releaseRitualPiece);
  const [activatedName, setActivatedName] = useState<string | null>(null);
  const [consuming, setConsuming] = useState<{ uid: string; cardId: string }[]>([]);
  const [feedback, setFeedback] = useState<'sealed' | 'released' | 'activating' | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = presentationBus.subscribe((events) => {
      const e = events.find(
        (e) => e.type.startsWith('RITUAL_') && 'casterId' in e && e.casterId === engine.heroId,
      );
      if (!e) return;
      if (e.type === 'RITUAL_ACTIVATED')
        setActivatedName(engine.content.rituals?.[e.ritualId]?.name ?? 'Invocación ritual');
      if (e.type === 'RITUAL_ACTIVATED')
        setConsuming(e.pieces.map((p) => ({ uid: p.cardUid, cardId: p.cardId })));
      const next =
        e.type === 'RITUAL_ACTIVATED'
          ? 'activating'
          : e.type === 'RITUAL_PIECE_COMMITTED'
            ? 'sealed'
            : e.type === 'RITUAL_PIECE_RELEASED'
              ? 'released'
              : null;
      if (next) {
        motionCues.emit(
          next === 'sealed'
            ? 'ritual_seal'
            : next === 'released'
              ? 'ritual_release'
              : 'ritual_activate',
        );
        clearTimeout(timer);
        setFeedback(next);
        timer = setTimeout(
          () => {
            setFeedback(null);
            setConsuming([]);
          },
          next === 'activating' ? 1100 : 420,
        );
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [engine]);
  const hero = state.units.find((u) => u.id === engine.heroId);
  const slots = hero ? altarSlots(engine.content, hero.defId) : 0;
  const rivalAltar = state.pileCounts?.opponentAltar ?? 0;
  const rivalHasAltar =
    rivalAltar > 0 ||
    state.units.some(
      (u) => u.kind === 'HERO' && u.id !== engine.heroId && altarSlots(engine.content, u.defId) > 0,
    );
  if (slots <= 0 && !rivalHasAltar) return null;
  const altar = altarOf(state.player);
  const shownAltar = feedback === 'activating' ? consuming : altar;
  const myTurn = state.phase === 'PLAYER' && !busy;
  const selected = selectedCardUid
    ? state.player.hand.find((c) => c.uid === selectedCardUid)
    : undefined;
  const selectedDef = selected && engine.content.cards[selected.cardId];
  const normalCheck = selected ? engine.getCardPlayability(selected.uid) : null;
  const commitCheck = selectedDef?.ritualPiece ? engine.getCommitPlayability(selected!.uid) : null;
  const inHand = new Set(state.player.hand.map((c) => c.cardId));
  // Rituals worth showing: something sealed, or a piece of it in hand.
  const progress = engine
    .getRitualProgress()
    .filter((p) => p.sealed.length > 0 || p.ritual.pieces.some((id) => inHand.has(id)));
  const status = engine.getAltarStatus();
  const creatureOf = (ritualId: string) =>
    status?.rituals.find((r) => r.ritualId === ritualId)?.creature;
  const name = (id: string) => engine.content.cards[id]?.name ?? id;
  const featuredRitual = progress.find(p => selectedDef && p.ritual.pieces.includes(selectedDef.id))
    ?? [...progress].sort((a,b) => b.sealed.length - a.sealed.length)[0];
  const expected = featuredRitual?.ritual.pieces ?? [];
  const socketCards = Array.from({length: slots}, (_,i) => shownAltar.find(c => c.cardId === expected[i]));
  // Other rituals may share the altar: never hide or lose access to their sealed pieces.
  for (const card of shownAltar) {
    if (socketCards.some(c => c?.uid === card.uid)) continue;
    const hole = socketCards.findIndex(c => !c);
    if (hole >= 0) socketCards[hole] = card;
  }
  const charged = status?.rituals.some(r => r.ready) && myTurn;

  return (
    // Opens itself only when there is a decision to make (seal the selected piece / a ritual is ready).
    <details
      className="altar-panel"
      open={!!commitCheck || progress.some((p) => p.complete) || undefined}
      data-testid="altar-panel"
      data-state={
        feedback ??
        (status?.rituals.some((r) => r.ready) && myTurn
          ? 'ready'
          : altar.length
            ? 'sealed'
            : 'empty')
      }
    >
      <summary>
        <RitualGlyph /> Altar {slots > 0 && `${altar.length}/${slots}`}
        <RitualReadyLabel ready={!!status?.rituals.some((r) => r.ready) && myTurn} />
        {feedback === 'activating' && <b> · ACTIVANDO {activatedName}</b>}
        {slots > 0 && myTurn && status && (
          <span
            className="altar-next-seal"
            data-next-seal-cost={status.nextSealCost}
            title="Energía del siguiente sello (el 1.º de cada turno es gratis)"
          >
            {' '}
            · Sello siguiente: {status.nextSealCost} energía
          </span>
        )}
        {rivalHasAltar && (
          <span className="altar-rival">
            {' '}
            · Rival: {rivalAltar} sellada{rivalAltar === 1 ? '' : 's'} / 4
          </span>
        )}
      </summary>
      <div className="altar-body">
        {feedback === 'activating' && (
          <strong className="ritual-name-reveal" role="status">
            <RitualGlyph family="MAJOR" /> {activatedName}
          </strong>
        )}
        {status && (
          <small className="altar-turn-seals">Sellos este turno: {status.sealsThisTurn}</small>
        )}
        {slots > 0 && (
          <div className="altar-constellation" data-charge={shownAltar.length} data-ready={charged || undefined}>
            <ul className="altar-slots" aria-label="Piezas selladas">
              {socketCards.map((c,i) => (
                <li key={`socket-${i}`} className={c ? '' : 'is-empty'}
                  data-slot-index={i} data-card-id={c?.cardId} data-accepts-card={expected[i]}
                  data-state={c ? 'sealed' : 'empty'}
                  title={c ? name(c.cardId) : expected[i] ? `Falta: ${name(expected[i]!)}` : 'Espera una pieza ritual'}>
                  <RitualGlyph />
                  {c ? <>
                    <img className="altar-piece-art" src={FINAL_CARD_ART[c.cardId]} alt="" />
                    <span>{name(c.cardId)}</span>
                    <button type="button" disabled={!myTurn}
                      aria-label={`Abandonar ${name(c.cardId)}`} title="Abandonar (va al descarte)"
                      onClick={() => release(c.uid)}>×</button>
                  </> : <span>{expected[i] ? name(expected[i]!).replace('Sello de la ', '').replace('Sello del ', '').replace(' Primordial', '') : 'Pieza'}</span>}
                </li>
              ))}
            </ul>
            <div className="altar-core" role="status" aria-label={`Núcleo ritual: ${charged ? 'READY' : `${shownAltar.length}/${slots}`}`}>
              <RitualGlyph family={featuredRitual?.ritual.tier ?? 'MAJOR'} />
              <strong>{charged ? 'READY' : `${shownAltar.length}/${slots}`}</strong>
              <small>{featuredRitual?.ritual.name ?? 'Altar ritual'}</small>
              {featuredRitual && <small>{featuredRitual.ritual.energyCost} energía</small>}
            </div>
          </div>
        )}
        {commitCheck && (
          <div className="ritual-piece-actions">
            <button
              type="button"
              className="altar-use"
              disabled={!myTurn || !normalCheck?.playable}
              onClick={(event) => {
                const panel = event.currentTarget.closest('details');
                if (panel) panel.open = false;
              }}
            >
              Usar · {selectedDef!.cost} energía · elige objetivo
              {normalCheck && !normalCheck.playable && (
                <small> · {ERROR_LABEL[normalCheck.reason]}</small>
              )}
            </button>
            <button
              type="button"
              className="altar-commit"
              disabled={!myTurn || !commitCheck.playable}
              title={commitCheck.playable ? undefined : ERROR_LABEL[commitCheck.reason]}
              onClick={() => commit(selected!.uid)}
            >
              Sellar «{selectedDef!.name}» en el altar
              {!commitCheck.playable && <small> · {ERROR_LABEL[commitCheck.reason]}</small>}
            </button>
            <small>
              Este sello: {status?.nextSealCost ?? 0} energía · el 1.º de cada turno es gratis, los
              siguientes 1
            </small>
          </div>
        )}
        {progress.map((p) => {
          const key = ritualSelection(p.ritual.id);
          const can = engine.getCardPlayability(key);
          const ritualStatus = status?.rituals.find((r) => r.ritualId === p.ritual.id);
          return (
            <div
              key={p.ritual.id}
              className="ritual-progress"
              data-ritual={p.ritual.id}
              data-complete={p.complete}
            >
              <strong>
                {p.ritual.tier === 'LEGENDARY' ||
                !RITUAL_EMBLEMS.has(p.ritual.presentation.visualKey) ? (
                  <RitualGlyph family={p.ritual.tier} />
                ) : (
                  <img
                    className="ritual-emblem"
                    src={`/art/rituals/${p.ritual.presentation.visualKey}.svg`}
                    alt=""
                  />
                )}{' '}
                {p.ritual.name} <small>({TIER_LABEL[p.ritual.tier]})</small>
              </strong>
              <span>
                {p.sealed.length} / {p.ritual.pieces.length} piezas
                {creatureOf(p.ritual.id) && <> · invoca {creatureOf(p.ritual.id)!.name}</>} ·{' '}
                {p.ritual.energyCost} energía
              </span>
              {p.missing.length > 0 && (
                <span className="ritual-missing">Falta: {p.missing.map(name).join(', ')}</span>
              )}
              <span className="ritual-status" data-ready={ritualStatus?.ready ?? false}>
                {p.missing.length
                  ? `Bloqueado: faltan ${p.missing.length} piezas`
                  : ritualStatus?.ready
                    ? 'Listo para activar'
                    : `Bloqueado: ${ritualStatus?.blockedBy?.message ?? (!myTurn ? 'espera tu turno' : 'no disponible')}`}
              </span>
              {ritualStatus?.replacesSummons && (
                <small className="ritual-sacrifice">Reemplaza a tus invocaciones</small>
              )}
              <span className="ritual-text">{p.ritual.rulesText}</span>
              {p.complete && (
                <button
                  type="button"
                  className={`ritual-activate${selectedCardUid === key ? ' is-selected' : ''}`}
                  disabled={!myTurn || !can.playable}
                  title={can.playable ? undefined : ERROR_LABEL[can.reason]}
                  onClick={() => selectCard(key)}
                >
                  {selectedCardUid === key ? 'Elige objetivo…' : 'Activar ritual'}
                  {!can.playable && <small> · {ERROR_LABEL[can.reason]}</small>}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
