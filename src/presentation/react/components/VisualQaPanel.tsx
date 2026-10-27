import { useState } from 'react';
import { createEngine } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import { visualSettings } from '../../vfx/visualSettings';

const SPELLS = [
  'fireball',
  'magic_missile',
  'blink',
  'ice_wall',
  'frost_nova',
  'barrier',
  'force_push',
  'arcane_burst',
  'arcane_surge',
  'phase_step',
  'flame_tile',
  'dispel',
];

/** Opt-in dev-only QA. Finds a legitimate starting seed; never edits a hand or game state. */
export function VisualQaPanel() {
  const [spell, setSpell] = useState('fireball');
  const [scenario, setScenario] = useState('crystal_guard');
  const [seed, setSeed] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [reduced, setReduced] = useState(false);
  const busy = useBattleStore((s) => s.playbackBusy);
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('vfx-qa')) return null;
  const prepare = () => {
    for (let value = 1; value <= 500; value++) {
      const engine = createEngine(scenario, value);
      if (engine.state.player.hand.some((c) => c.cardId === spell)) {
        useBattleStore.getState().startScenario(scenario, value);
        setSeed(value);
        return;
      }
    }
  };
  return (
    <aside className="visual-qa" aria-label="QA visual">
      <strong>QA visual · desarrollo</strong>
      <label>
        Escenario{' '}
        <select
          aria-label="Escenario QA"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        >
          <option value="first_blood">First Blood</option>
          <option value="crystal_guard">Crystal Guard</option>
          <option value="escape">Escape</option>
        </select>
      </label>
      <label>
        Carta{' '}
        <select aria-label="Carta QA" value={spell} onChange={(e) => setSpell(e.target.value)}>
          {SPELLS.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      <button onClick={prepare}>Preparar carta</button>
      <label>
        Velocidad{' '}
        <select
          aria-label="Velocidad visual QA"
          disabled={busy}
          value={speed}
          onChange={(e) => {
            const value = Number(e.target.value);
            visualSettings.timeScale = value;
            setSpeed(value);
          }}
        >
          <option value="1">1×</option>
          <option value="0.2">0.2× inspección</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={reduced}
          disabled={busy}
          onChange={(e) => {
            visualSettings.reducedEffects = e.target.checked;
            setReduced(e.target.checked);
          }}
        />{' '}
        Efectos reducidos QA
      </label>
      <span>
        {busy ? 'Playback' : 'Listo'}
        {seed !== null ? ` · seed ${seed}` : ''}
      </span>
    </aside>
  );
}
