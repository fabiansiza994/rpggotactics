import { ActionAvailability } from '../../react/components/ActionAvailability';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardDefinition, EffectCondition, GameContent, GameState, Pos } from '../../../game';
import { archerCardForecast, archerHud, type ArcherForecast } from '../../../game/domain/archer-view';
import { hasLineOfSight } from '../../../game/domain/board/line-of-sight';
import { queryContext } from '../../../game/domain/context';
import { useBattleStore } from '../../store/battleStore';
import '../../../styles/archer.css';

/**
 * Archer HUD (reads the authoritative state through domain/archer-view.ts; never decides rules):
 * Concentración meter, Presa chip and the card-selection forecast (§14 of the visual pass).
 */
export function ArcherHudLine({ state, content }: { state: Readonly<GameState>; content: GameContent }) {
  const hud = archerHud(state, content);
  if (!hud) return null;
  return (
    <>
      <ConcentrationMeter value={hud.focus.value} max={hud.focus.max} />
      <div className="archer-prey-chip" data-qa="archer-prey" data-on={!!hud.prey} title={hud.prey?.tooltip ?? 'Sin Presa: usa Ojo del Cazador.'}>
        <PreySight />
        {hud.prey ? (
          <span>
            Presa: {hud.prey.name} · {hud.prey.distance} cas.
            {hud.prey.inOptimalRange && <b> · Óptima</b>}
            {!hud.prey.inLineOfSight && ' · sin visión'}
          </span>
        ) : (
          <span>Sin Presa</span>
        )}
      </div>
      <ArcherForecastPanel state={state} content={content} />
    </>
  );
}

function ConcentrationMeter({ value, max }: { value: number; max: number }) {
  const previous = useRef(value);
  const [change, setChange] = useState<{ kind: 'gain' | 'spend'; n: number } | null>(null);
  useEffect(() => {
    if (value !== previous.current) setChange((c) => ({ kind: value > previous.current ? 'gain' : 'spend', n: (c?.n ?? 0) + 1 }));
    previous.current = value;
  }, [value]);
  const full = value >= max;
  return (
    <div
      className="focus-meter"
      data-qa="archer-focus"
      data-full={full || undefined}
      data-change={change?.kind}
      key={change?.n ?? 0}
      role="meter"
      aria-label={`Concentración ${value} de ${max}${full ? ': disparo potenciado listo' : ''}`}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      title="Concentración: se gana con cartas (Presa, Distancia Óptima 3–4), nunca pasivamente. Con 3: Tiro al Corazón."
    >
      <span className="focus-label">CONC</span>
      <span className="focus-pips" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <svg key={i} className={`focus-pip${i < value ? ' is-on' : ''}`} viewBox="0 0 12 16">
            <path d="M6 0 12 11 6 8.4 0 11Z" />
            <path d="M6 8.4V16" />
          </svg>
        ))}
      </span>
      <span className="focus-value">
        {value}/{max}
        {full && <em className="focus-ready">LISTO</em>}
      </span>
    </div>
  );
}

const PreySight = () => (
  <svg className="prey-sight" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5" />
    <path d="M8 0v4M8 12v4M0 8h4M12 8h4" />
    <circle cx="8" cy="8" r="1.4" className="dot" />
  </svg>
);

type Check = { required?: boolean; label: string; ok: boolean | null; detail?: string };
const conditionsOf = (def: CardDefinition): EffectCondition[] =>
  def.effects.flatMap((fx) => [
    ...(fx.type === 'DAMAGE' ? [...[fx.bonus?.when ?? []].flat(), ...(fx.focusGain?.when ?? [])] : []),
    ...(fx.type === 'GAIN_FOCUS' ? (fx.when ?? []) : []),
  ]);

/** Pure: the forecast rows for a card on an (optional) aimed tile. Exported for tests. */
export function forecastRows(state: Readonly<GameState>, content: GameContent, def: CardDefinition, aim: Pos | null, f: ArcherForecast | null) {
  const hero = state.units.find((u) => u.id === state.player.heroId)!;
  const focus = hero.focus ?? { value: 0, max: 3 };
  const prey = state.units.find((u) => u.statuses.some((s) => s.id === 'PREY' && s.sourceId === hero.id));
  const conds = conditionsOf(def);
  const has = (t: EffectCondition['type']) => conds.some((c) => c.type === t);
  const dmg = def.effects.find((fx) => fx.type === 'DAMAGE');
  const target = f?.targetId ? state.units.find((u) => u.id === f.targetId) : undefined;
  const checks: Check[] = [];
  if (has('TARGET_IS_PREY')) checks.push({ label: 'Presa', ok: f ? f.targetIsPrey : null });
  if (has('TARGET_IN_OPTIMAL_RANGE'))
    checks.push({ label: 'Distancia Óptima', ok: f ? f.inOptimalRange : null, detail: f?.distance != null ? `${f.distance}` : '3–4' });
  const pct = conds.find((c): c is Extract<EffectCondition, { type: 'TARGET_HP_AT_MOST_PCT' }> => c.type === 'TARGET_HP_AT_MOST_PCT');
  if (pct) checks.push({ label: `Vida ≤${pct.pct}%`, ok: target ? target.hp * 100 <= target.maxHp * pct.pct : f ? false : null, detail: target ? `${target.hp}/${target.maxHp}` : undefined });
  // Movement cards: judged at the destination.
  const dest = def.targeting.type === 'STEP' ? aim : null;
  if (has('CASTER_NOT_ADJACENT_TO_ENEMY'))
    checks.push({ label: 'Sin enemigo adyacente', ok: dest && f ? !state.units.some((u) => u.kind !== 'STRUCTURE' && u.faction !== hero.faction && Math.abs(u.pos.x - dest.x) + Math.abs(u.pos.y - dest.y) === 1) : null });
  if (has('PREY_IN_LINE_OF_SIGHT'))
    checks.push({ label: 'Visión de tu Presa', ok: !prey ? false : dest && f ? hasLineOfSight(queryContext(state as GameState, content), dest, prey.pos) : null });
  if (has('PREY_IN_OPTIMAL_RANGE'))
    checks.push({ label: 'Óptima respecto a tu Presa', ok: !prey ? false : f ? f.inOptimalRange : null, detail: f?.distance != null ? `${f.distance}` : undefined });
  if (def.focusCost) checks.push({ required: true, label: `Concentración ${focus.value}/${focus.max}`, ok: focus.value >= def.focusCost, detail: `necesita ${def.focusCost}` });
  if (def.targeting.type === 'LINE' && def.targeting.focusPierce)
    checks.push(f?.pierces
      ? { label: 'Atraviesa', ok: true, detail: `−${def.targeting.focusPierce}` }
      : { label: focus.value >= def.targeting.focusPierce ? 'Apunta al de detrás para atravesar' : `Atravesar: ${def.targeting.focusPierce} Concentración`, ok: null });
  let result: string | null = null;
  if (dmg && dmg.type === 'DAMAGE') {
    if (f) {
      const amount = f.conditionMet && f.conditionalDamage !== null ? f.conditionalDamage : (f.baseDamage ?? dmg.amount);
      result = `${amount} daño${f.pierces ? ' a 2 objetivos' : ''}${f.targetId && f.predictedHpLoss !== amount ? ` (−${f.predictedHpLoss} PV)` : ''}`;
    }
  } else if (def.effects.some((fx) => fx.type === 'APPLY_STATUS' && fx.status === 'PREY'))
    result = f?.targetId ? (prey && prey.id !== f.targetId ? `Nueva Presa (reemplaza a ${prey.name})` : 'Marcada como Presa') : null;
  else if (def.effects.some((fx) => fx.type === 'PLACE_TRAP')) result = aim ? 'Trampa: 1 daño + Enraizado al entrar' : null;
  const usesFocus = !!def.focusCost || (def.targeting.type === 'LINE' && !!def.targeting.focusPierce) ||
    def.effects.some((fx) => fx.type === 'GAIN_FOCUS' || (fx.type === 'DAMAGE' && !!fx.focusGain));
  const focusLine = f && usesFocus
    ? f.focus.spend || f.focus.gain
      ? `${f.focus.gain ? `+${f.focus.gain}` : `−${f.focus.spend}`} Concentración → ${f.focus.after}/${f.focus.max}`
      : 'No gana Concentración'
    : null;
  return {
    name: def.name,
    base: dmg && dmg.type === 'DAMAGE' ? dmg.amount : null,
    boosted: dmg && dmg.type === 'DAMAGE' && dmg.bonus ? dmg.amount + dmg.bonus.amount : null,
    checks,
    result,
    focusLine,
  };
}

function ArcherForecastPanel({ state, content }: { state: Readonly<GameState>; content: GameContent }) {
  const selected = useBattleStore((s) => s.selectedCardUid);
  const aim = useBattleStore((s) => s.aim?.pos ?? null);
  const def = selected ? content.cards[state.player.hand.find((c) => c.uid === selected)?.cardId ?? ''] : undefined;
  if (!selected || !def || def.heroId !== 'archer' || state.phase !== 'PLAYER' || typeof document === 'undefined') return null;
  const target = def.targeting.type === 'SELF' ? null : aim;
  const f = target || def.targeting.type === 'SELF' ? archerCardForecast(state, content, selected, target) : null;
  const rows = forecastRows(state, content, def, target, f);
  return createPortal(
    <aside className="archer-forecast" data-qa="archer-forecast" aria-live="polite">
      <header>{rows.name}</header>
      {rows.base !== null && (
        <p className="af-damage">
          Daño <b>{rows.base}</b>
          {rows.boosted !== null && <> · potenciado <b className="af-boost">{rows.boosted}</b></>}
        </p>
      )}
      {rows.checks.length > 0 && (
        <ul>
          {rows.checks.map(c => <ActionAvailability key={c.label}
            state={c.required && c.ok === false ? 'BLOCKED' : c.ok === true ? 'BONUS_AVAILABLE' : 'BONUS_NOT_ACTIVE'}
            required={c.required} label={c.label} detail={c.detail} />)}
        </ul>
      )}
      {rows.result && <p className="af-result">Resultado: <b>{rows.result}</b></p>}
      {rows.focusLine && <p className="af-focus">{rows.focusLine}</p>}
      {f && f.statuses.length > 0 && (
        <p className="af-status" data-qa="archer-status-forecast">
          {f.statuses.map((s) => `${s.name} ${s.turns} turno${s.turns === 1 ? '' : 's'}`).join(' · ')}
        </p>
      )}
      {f && f.terrain.length > 0 && (
        <p className="af-terrain" data-qa="archer-terrain-forecast">
          {f.notes.find((n) => f.terrain.some((t) => n.startsWith(t.name)))}
        </p>
      )}
      {f && content.cards[f.cardId]?.effects.some((fx) => fx.type === 'DAMAGE' && !!fx.rebound) && (
        <p className="af-rebound" data-qa="archer-rebound">
          {f.notes.find((n) => n.startsWith('Rebote')) ?? 'Rebote'}
        </p>
      )}
      {!f && <p className="af-hint">Elige un objetivo</p>}
    </aside>,
    document.body,
  );
}
