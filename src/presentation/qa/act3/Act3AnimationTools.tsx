import { useEffect, useState } from 'react';
import type { BattleCanvas } from '../../pixi/BattleCanvas';
import type { CharacterMotion } from '../../pixi/CharacterAnimator';
import type { Unit } from '../../../game';
/** Explicit, visible local lab controls. Pose playback never dispatches a game command. */
export function Act3AnimationTools({
  units,
  canvas,
}: {
  units: readonly Unit[];
  canvas: () => BattleCanvas | null;
}) {
  const [open, setOpen] = useState(false),
    [id, setId] = useState(''),
    [status, setStatus] = useState('');
  const target =
    units.find((u) => u.id === id) ?? units.find((u) => u.faction === 'ENEMY') ?? units[0];
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      const s = target && canvas()?.qaAnimationSnapshot(target.id);
      const perf = canvas()?.qaFeelSnapshot();
      setStatus(
        s
          ? `${s.artVariant} · ${s.motion} · frame ${s.frame + 1} · ${s.facing} · ${Math.round(perf?.fps ?? 0)} FPS · ${perf?.particles ?? 0}/64 partículas`
          : 'Cargando sprite',
      );
    }, 150);
    return () => clearInterval(timer);
  }, [open, target, canvas]);
  const pose = (motion: CharacterMotion) => {
    if (target) canvas()?.qaPlayCharacterAnimation(target.id, motion, 240);
  };
  return (
    <aside
      className="act3-animation-tools"
      style={{
        position: 'fixed',
        left: 8,
        top: 48,
        zIndex: 90,
        maxWidth: 'calc(100vw - 220px)',
        background: '#101c28ed',
        border: '1px solid #a7905b',
        padding: 6,
        fontSize: 12,
      }}
    >
      <button onClick={() => setOpen(!open)}>QA animaciones {open ? '−' : '+'}</button>
      {open && (
        <>
          <select
            aria-label="Unidad de animación QA"
            value={target?.id ?? ''}
            onChange={(e) => setId(e.target.value)}
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id} · {u.defId}
              </option>
            ))}
          </select>
          <div>
            {(['idle', 'walk', 'run', 'attack', 'hit', 'death'] as const).map((m) => (
              <button key={m} onClick={() => pose(m)}>
                {m}
              </button>
            ))}
          </div>
          <div>
            {(['N', 'S', 'W', 'E'] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  if (target)
                    canvas()?.qaFaceTarget(target.id, {
                      x: target.pos.x + (d === 'W' ? -1 : d === 'E' ? 1 : 0),
                      y: target.pos.y + (d === 'N' ? -1 : d === 'S' ? 1 : 0),
                    });
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <output aria-label="Estado de animación QA">{status}</output>
          <p style={{ margin: 0 }}>Poses visuales; reiniciar batalla después de death.</p>
        </>
      )}
    </aside>
  );
}
