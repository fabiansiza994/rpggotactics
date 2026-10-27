import { SHAPESHIFTER_CATALOG_DECKS } from '../../../game/data/shapeshifter-catalog';
import { useState } from 'react';
import { useBattleStore } from '../../store/battleStore';
import { qaOpening, setQaOpening, qaDepthRules, setQaDepth } from './realBattle';
import type { OpeningPolicy } from './session';
export function RealQaControls() {
  const [depth, setDepth] = useState(() => qaDepthRules() || null);
  const [opening, setOpening] = useState(qaOpening);
  const [message, setMessage] = useState(
    'Perfil aislado · campaña privada · sin cuentas ni PvP público',
  );
  const form = useBattleStore(
    (s) => s.state?.units.find((u) => u.defId === 'shapeshifter')?.activeForm,
  );
  return (
    <aside
      className="panel"
      style={{
        padding: '8px 16px',
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 20000,
        maxWidth: 'calc(100vw - 16px)',
        background: '#101b29',
      }}
      aria-label="QA Cambiaformas"
    >
      <details>
        <summary>QA local · Cambiaformas</summary>{' '}
        <label>
          Profundidad QA (próximo combate){' '}
          <select
            value={depth?.formCounter ?? 'off'}
            onChange={(e) => {
              const mode = e.target.value as 'off' | 'perHit' | 'oncePerRound';
              setQaDepth(mode);
              setDepth(qaDepthRules() || null);
            }}
          >
            <option value="off">Reglas anteriores</option>
            <option value="perHit">Espalda + contraataque por golpe</option>
            <option value="oncePerRound">Espalda + contraataque por ronda</option>
          </select>
        </label>
        <label>
          Apertura del próximo combate{' '}
          <select
            value={opening}
            onChange={(e) => {
              const value = e.target.value as OpeningPolicy;
              setOpening(value);
              setQaOpening(value);
            }}
          >
            <option value="normal">Normal</option>
            <option value="guaranteed">Una transformación garantizada</option>
          </select>
        </label>{' '}
        <button
          onClick={() =>
            setMessage(
              useBattleStore.getState().resumeQaBattle()
                ? 'Combate reconstruido por replay.'
                : 'No hay combate QA válido guardado.',
            )
          }
        >
          Reanudar combate QA
        </button>
        <p>Presets QA: sustituyen el mazo guardado del Cambiaformas, sin cambiar colección.</p>
        {Object.entries(SHAPESHIFTER_CATALOG_DECKS).map(([id, deck]) => (
          <button
            key={id}
            onClick={() => {
              void useBattleStore
                .getState()
                .saveDeck('shapeshifter', deck)
                .then((result) =>
                  setMessage(
                    result.ok ? `Mazo ${id} guardado.` : 'No se pudo guardar el preset QA.',
                  ),
                );
            }}
          >
            Cargar {id === 'hybrid' ? 'híbrido' : id === 'bear' ? 'Oso' : 'Minotauro'}
          </button>
        ))}
        <span>
          {' '}
          · Forma: {form ?? 'humanoide'} · {message}
        </span>
      </details>
    </aside>
  );
}
