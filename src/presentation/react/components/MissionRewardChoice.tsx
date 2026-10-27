import { useEffect, useReducer, useState, type CSSProperties, type ReactNode, type Dispatch } from 'react';
import { ownedFor, type RewardOption } from '../../../game';
import { PRESENTATION_CONTENT as CONTENT } from '../../qa/shapeshifter/runtime';
import { useBattleStore } from '../../store/battleStore';
import { EquippedCardBack } from '../../cosmetics/CardBack';
import { FeatureCard } from './BattleCardFeature';
import { initialReveal, revealBusy, rewardRevealReducer, type RevealAction } from '../../cards/rewardRevealState';
import { cardRarityFinish } from '../../cards/premiumTreatment';
import { useCosmeticCard } from '../../cosmetics/cardCosmetics';
import { RARITY_LABEL } from '../format';
import '../../../styles/mission-reward.css';

function useReducedRewardMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

function RewardFace({ option, index, count, phase, selected, muted, disabled, selectLocked, reduced, heroId, onReveal, dispatch, onSelect }: {
  option: RewardOption; index: number; count: number; phase: 'hidden' | 'revealing' | 'revealed'; selected: boolean; muted: boolean;
  disabled: boolean; selectLocked: boolean; reduced: boolean; heroId: string; onReveal(): void; dispatch: Dispatch<RevealAction>; onSelect(): void;
}) {
  const owned = useBattleStore(s => option.kind === 'ADD_CARD' ? ownedFor(s.profile, heroId, CONTENT)(option.cardId) : 0);
  const def = option.kind === 'ADD_CARD' ? CONTENT.cards[option.cardId] : undefined;
  const visual = useCosmeticCard(def);
  const finish = def ? cardRarityFinish(visual ?? def) : 'common';
  const sparks = { common:'· ✧ ·', rare:'✧ · ✦ · ✧', super:'✦ ✧ ✦ ✧ ✦', ultra:'✦ · ✧ ✦ ✧ · ✦', secret:'✧ ✦ ✧ ✦ ✧ ✦ ✧', 'arcana-secret':'✧ ⋆ ✦ ⋆ ✧ ⋆ ✦' }[finish];
  const revealed = phase !== 'hidden';
  // UI wall-clock fallback also completes in a background tab; no engine timers or commands.
  useEffect(() => {
    if (phase !== 'revealing') return;
    const timer = setTimeout(() => dispatch({ type: 'finish', id: option.id }), reduced ? 30 : 720);
    return () => clearTimeout(timer);
  }, [phase, reduced, dispatch, option.id]);
  return <div className="mission-reward-slot" data-phase={phase} data-selected={selected} data-muted={muted}
    data-finish={finish} data-rarity={def?.rarity ?? 'COMMON'} data-reward-id={option.id} style={{ '--reward-index': index } as CSSProperties}>
    <div className="mission-reward-flipper">
      <div className="mission-reward-back" aria-hidden={revealed} inert={revealed}>
        <EquippedCardBack />
        <button type="button" disabled={disabled || revealed} onClick={onReveal} aria-label={`Revelar recompensa ${index + 1}`}>
          <span>Revelar</span><small>{index + 1} / {count}</small>
        </button>
      </div>
      <div className="mission-reward-front" aria-hidden={!revealed} inert={!revealed}>
        {def ? <FeatureCard def={def} className="mission-reward-face" extras={{ playable: true }} ariaHidden={!revealed} scrollableDescription />
          : option.kind === 'MAX_HP' ? <div className="mission-reward-stat"><strong>+{option.amount}</strong><h3>Vida máxima</h3><p>Para el resto de la campaña.</p></div> : null}
        <button className="mission-reward-select" type="button" aria-pressed={selected}
          aria-label={`${selected ? 'Deseleccionar' : 'Elegir'} ${def?.name ?? 'Vida máxima'}`}
          disabled={disabled || selectLocked || phase !== 'revealed'} onClick={onSelect} />
      </div>
    </div>
    <span className="mission-reward-sparks" aria-hidden="true">{sparks}</span>
    <div className="mission-reward-status" aria-live="polite">
      {selected ? '✓ Recompensa seleccionada' : phase === 'revealing' ? 'Revelando…' : phase === 'hidden' ? 'Descubre tu recompensa' : def ? `${owned === 0 ? 'Nueva carta' : 'Copia extra'} · ${RARITY_LABEL[def.rarity ?? 'COMMON']}` : 'Mejora permanente'}
    </div>
  </div>;
}

/** No ownership writes: confirmation delegates exactly once to the existing save action. */
export function MissionRewardChoice({ options, heroId, saving, onConfirm, confirmLabel, footer, masteryFeedback, reducedMotionOverride }: {
  options: RewardOption[]; heroId: string; saving: boolean; onConfirm(id: string): void;
  confirmLabel: string; footer?: string; masteryFeedback?: ReactNode; reducedMotionOverride?: boolean;
}) {
  const [state, dispatch] = useReducer(rewardRevealReducer, options.map(o => o.id), initialReveal);
  const systemReduced = useReducedRewardMotion();
  const reduced = reducedMotionOverride ?? systemReduced;
  const busy = revealBusy(state);
  useEffect(() => {
    if (!state.confirming || !state.picked) return;
    const id = state.picked;
    const timer = setTimeout(() => {
      onConfirm(id);
      // The store owns network busy/error/retry and idempotency. Allow its existing retry on failure.
      dispatch({ type: 'retry' });
    }, reduced ? 30 : 450);
    return () => clearTimeout(timer);
  }, [state.confirming, state.picked, onConfirm, reduced]);
  return <section className="result-card won reward-card mission-reward" data-confirming={state.confirming} data-reduced-motion={reduced || undefined} style={{ '--reward-center': (options.length - 1) / 2 } as CSSProperties} aria-label="Revelación de recompensas">
    <header><h2>Victoria</h2><p>Elige 1 recompensa</p><small>Revela las cartas y elige una para tu colección.</small></header>
    {masteryFeedback}
    <div className="mission-reward-options" role="group" aria-label="Recompensas por revelar">
      {options.map((option, index) => <RewardFace key={option.id} option={option} index={index} count={options.length} heroId={heroId}
        phase={state.faces[option.id]!} selected={state.picked === option.id} muted={!!state.picked && state.picked !== option.id}
        disabled={saving || state.confirming} selectLocked={busy} reduced={reduced}
        onReveal={() => dispatch({ type: 'reveal', id: option.id })}
        dispatch={dispatch}
        onSelect={() => dispatch({ type: 'select', id: option.id })} />)}
    </div>
    <footer><small>Puedes equiparla después desde Mazo.</small>{footer && <small>{footer}</small>}
      <button type="button" className="reward-confirm" disabled={!state.picked || busy || saving || state.confirming}
        onClick={() => dispatch({ type: 'confirm' })}>{saving ? 'Guardando…' : state.confirming ? 'Recompensa elegida…' : confirmLabel}</button>
    </footer>
  </section>;
}
