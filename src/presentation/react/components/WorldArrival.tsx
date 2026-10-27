import { useState } from 'react';

/** Cosmetic act handoff: never blocks a command or changes a run. */
export function WorldArrival({ worldId }: { worldId: string }) {
  const [previous, setPrevious] = useState(worldId);
  const [visible, setVisible] = useState(false);
  if (previous !== worldId) {
    setPrevious(worldId);
    setVisible(worldId === 'world_2' || worldId === 'archer_act_1');
  }
  return visible ? (
    <div
      className="world-arrival"
      aria-hidden="true"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setVisible(false);
      }}
    >
      <span>{worldId === 'archer_act_1' ? 'ACTO I · ARQUERO' : 'ACTO II'}</span>
      <strong>{worldId === 'archer_act_1' ? 'SENDERO DEL CAZADOR' : 'REINO INFERNAL'}</strong>
      <small>{worldId === 'archer_act_1' ? 'Sigue el rastro entre la niebla del Velo' : 'Las puertas de ceniza se abren'}</small>
    </div>
  ) : null;
}
