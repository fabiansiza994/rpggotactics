import type { CSSProperties } from 'react';
import type { GameState, Pos, Unit } from '../../../game';
import { CHARACTER_PAINTINGS } from '../../assets/paintedAssets';
import { facingFor, formStyle, formVisual, type VisualBatch, type VisualCue } from './visuals';

function FormActor({
  unit,
  cue,
  serial,
  units,
}: {
  unit: Unit;
  cue?: VisualCue;
  serial: number;
  units: readonly Unit[];
}) {
  const visual = formVisual(unit.activeForm),
    previous = formVisual(cue?.previousForm);
  return (
    <div
      className="qa-form-actor"
      data-form={visual.id}
      data-motion={cue?.motion ?? 'idle'}
      data-idle={visual.idleMotion}
      data-reveal={visual.reveal}
      style={formStyle(visual)}
      aria-label={`${visual.label}: ${unit.hp} vida`}
    >
      <span className="qa-ground-ring" />
      <div
        key={`${serial}-${cue?.motion ?? 'idle'}`}
        className="qa-form-stage"
        style={{ '--facing': facingFor(unit, units) } as CSSProperties}
      >
        {cue?.motion === 'transform' && (
          <img className="qa-form-previous" src={previous.poses.idle} alt="" draggable={false} />
        )}
        <div className="qa-form-current">
          <div className="qa-form-body">
            <img
              className="qa-form-idle"
              src={visual.poses.idle}
              alt={visual.label}
              draggable={false}
            />
            {cue && cue.motion !== 'transform' && (
              <img
                className="qa-form-action"
                src={visual.poses[cue.motion]}
                alt=""
                draggable={false}
              />
            )}
          </div>
        </div>
        {cue?.motion === 'transform' && (
          <>
            <span className="qa-rune-ring" aria-hidden="true">
              ᛉ · ᚷ · ᛟ · ᚨ · ᚷ · ᛉ
            </span>
            <span className="qa-form-impact" aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  );
}

export function FormBoard({
  state,
  targets,
  moves,
  selected,
  batch,
  onTile,
}: {
  state: Readonly<GameState>;
  targets: readonly Pos[];
  moves: readonly Pos[];
  selected: boolean;
  batch: VisualBatch;
  onTile(pos: Pos): void;
}) {
  const units = [...state.units, ...batch.ghosts];
  return (
    <div className="qa-board-wrap">
      <div
        className="lab-board qa-painted-board"
        style={{ gridTemplateColumns: `repeat(${state.board.width},minmax(32px,1fr))` }}
        aria-label="Tablero táctico"
      >
        {state.board.tiles.map((tile, i) => {
          const pos = { x: i % state.board.width, y: Math.floor(i / state.board.width) },
            u = state.units.find((u) => u.pos.x === pos.x && u.pos.y === pos.y),
            obstacle = state.obstacles.find((o) => o.pos.x === pos.x && o.pos.y === pos.y);
          const legal = [...targets, ...moves].some((p) => p.x === pos.x && p.y === pos.y);
          return (
            <button
              key={i}
              className={legal ? 'is-legal' : ''}
              disabled={!!state.outcome || !!obstacle || tile.terrain === 'BLOCKED'}
              aria-label={`Casilla ${pos.x},${pos.y}${u ? `, ${u.name}, ${u.hp} vida` : ''}`}
              onClick={() => onTile(pos)}
            >
              {obstacle ? (
                <img
                  className="qa-obstacle"
                  src="/art/checkpoint05/materials/pillar.webp"
                  alt="Obstáculo"
                />
              ) : (
                <span aria-hidden="true">·</span>
              )}
            </button>
          );
        })}
        <div className="qa-actor-layer" aria-hidden="false">
          {units.map((unit) => (
            <div
              key={unit.id}
              className="qa-unit-anchor"
              data-unit-id={unit.id}
              data-selected={(unit.kind === 'HERO' && selected) || undefined}
              style={{
                left: `${((unit.pos.x + 0.5) * 100) / state.board.width}%`,
                top: `${((unit.pos.y + 1) * 100) / state.board.height}%`,
                width: `${125 / state.board.width}%`,
                zIndex: unit.pos.y + 1,
              }}
            >
              {unit.kind === 'HERO' ? (
                <FormActor
                  unit={unit}
                  cue={batch.cues[unit.id]}
                  serial={batch.serial}
                  units={state.units}
                />
              ) : (
                <img
                  className="qa-enemy-art"
                  src={CHARACTER_PAINTINGS[unit.defId]}
                  alt={unit.name}
                  draggable={false}
                />
              )}
              <span className="qa-unit-vitals">
                {unit.hp} HP · ◇{unit.armor}
                {unit.shield > 0 ? ` · ▣${unit.shield}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
