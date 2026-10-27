import '../../../styles/summon-capacity.css';
import '../../../styles/forbidden-bond.css';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { GameEngine, GameState } from '../../../game';
import { summonCapacityView } from '../../../game/domain/summons/capacity-view';

/**
 * «Capacidad de invocación: X / 2» — capacity POINTS, not creatures (02_MVP_RULES §17.1).
 * Everything is read from the rendered state through `summonCapacityView` (= `summonUsage`), so
 * the meter can never drift from the rules. One segment per point; a creature that holds two
 * points spans two segments. Tap/click/focus opens the explanation (hover too on desktop).
 */
export function SummonCapacityMeter({ state, engine }: { state: Readonly<GameState>; engine: GameEngine }) {
  const cap = summonCapacityView(state, engine.content, engine.heroId);
  const [open, setOpen] = useState(false);
  const popId = useId();
  const root = useRef<HTMLDivElement>(null);
  // Discreet "+N libre" when points come back (death, recall, sacrifice). Keyed so each release replays.
  // A restart or a new battle (history shrinks / engine changes) also empties the board: no cue then.
  const previous = useRef({ used: cap.used, max: cap.max, engine, history: engine.history.length });
  const [freed, setFreed] = useState<{ n: number; amount: number } | null>(null);
  // Vínculo Prohibido: «Capacidad de invocación +1» when the maximum grows during the battle.
  const [grown, setGrown] = useState<{ n: number; amount: number } | null>(null);
  useEffect(() => {
    const before = previous.current;
    const sameBattle = before.engine === engine && engine.history.length >= before.history;
    if (sameBattle && cap.used < before.used) {
      const amount = before.used - cap.used;
      setFreed((f) => ({ n: (f?.n ?? 0) + 1, amount }));
    } else if (!sameBattle) setFreed(null);
    if (sameBattle && cap.max > before.max) {
      const amount = cap.max - before.max;
      setGrown((g) => ({ n: (g?.n ?? 0) + 1, amount }));
    } else if (!sameBattle) setGrown(null);
    previous.current = { used: cap.used, max: cap.max, engine, history: engine.history.length };
  }, [cap.used, cap.max, engine, state]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (cap.max <= 0) return null;

  // One block per creature, as wide as the points it holds; then one empty block per free point.
  const blocks: { key: string; name?: string; span: number }[] = cap.occupants.map((o) => ({
    key: o.unitId,
    name: o.name,
    span: o.cost,
  }));
  for (let i = 0; i < cap.free; i++) blocks.push({ key: `free-${i}`, span: 1 });

  return (
    <div className="summon-meter-wrap" ref={root} data-open={open || undefined}>
      <button
        type="button"
        className="summon-meter"
        data-used={cap.used}
        data-max={cap.max}
        data-full={cap.free === 0 || undefined}
        data-bonus={cap.bonus || undefined}
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`Capacidad de invocación: ${cap.used} de ${cap.max} puntos usados`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span className="summon-meter-label" aria-hidden="true">
          Capacidad
        </span>
        <span className="summon-meter-slots" aria-hidden="true">
          {blocks.map((b) => (
            <span
              key={b.key}
              className="summon-meter-slot"
              data-taken={!!b.name || undefined}
              style={{ '--span': b.span } as CSSProperties}
            >
              {b.name && (
                <>
                  <span className="summon-meter-name">{b.name}</span>
                  <span className="summon-meter-initial">{b.name.charAt(0)}</span>
                </>
              )}
            </span>
          ))}
        </span>
        <span className="summon-meter-value" aria-hidden="true">
          {cap.used}/{cap.max}
        </span>
      </button>
      {grown && (
        <span key={`grown-${grown.n}`} className="summon-meter-grown" role="status">
          Capacidad de invocación +{grown.amount}
        </span>
      )}
      {freed && (
        <span key={freed.n} className="summon-meter-freed" role="status">
          +{freed.amount} libre
        </span>
      )}
      <div id={popId} className="summon-meter-pop" role="note">
        <strong>
          Capacidad de invocación: {cap.used} / {cap.max}
        </strong>
        {cap.bonus > 0 && (
          <p className="summon-meter-bonus">
            +{cap.bonus} {cap.bonus === 1 ? 'punto' : 'puntos'} de Vínculo Prohibido durante este combate.
          </p>
        )}
        {cap.occupants.length ? (
          <ul>
            {cap.occupants.map((o) => (
              <li key={o.unitId}>
                <span>{o.name}</span>
                <span className="summon-meter-cost">
                  {o.cost} {o.cost === 1 ? 'punto' : 'puntos'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Ninguna invocación activa.</p>
        )}
        <p>
          Cuenta puntos, no criaturas. Pollo, Zorro, Tortuga y Cuervo ocupan 1; Lobo y criaturas de
          ritual ocupan 2. Si una invocación muere o la retiras, sus puntos quedan libres al instante.
        </p>
      </div>
    </div>
  );
}
