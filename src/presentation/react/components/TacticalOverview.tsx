import {useEffect,useState} from 'react';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import { markedPrey } from '../../cards/tacticalPresentation';
import { type GameState } from '../../../game';

export function minimapCell(x:number,y:number,cols:number,rows:number,turn:number){return turn===1?{x:y,y:cols-1-x}:turn===2?{x:cols-1-x,y:rows-1-y}:turn===3?{x:rows-1-y,y:x}:{x,y};}
/** Read-only board overview, derived from the existing scenario state. */
export function TacticalOverview({ state }: { state: Readonly<GameState> }) {
  const { board, units, obstacles } = state;
  const [turn,setTurn]=useState(()=>Number(document.querySelector('.board-host')?.getAttribute('data-camera-turn'))||0);
  useEffect(()=>{const change=(event:Event)=>{const t=(event as CustomEvent<{turn:number}>).detail?.turn;if(typeof t==='number')setTurn(t);};window.addEventListener('battle-camera-change',change);return()=>window.removeEventListener('battle-camera-change',change);},[]);
  const columns=turn%2?board.height:board.width;
  const tiles=board.tiles.map((tile,index)=>({tile,index,visual:minimapCell(index%board.width,Math.floor(index/board.width),board.width,board.height,turn)})).sort((a,b)=>a.visual.y-b.visual.y||a.visual.x-b.visual.x);
  const pickupAt = new Map(
    state.collectibles.filter((c) => !c.collected).map((c) => [`${c.pos.x}:${c.pos.y}`, c]),
  );
  const unitAt = new Map(units.map((unit) => [`${unit.pos.x}:${unit.pos.y}`, unit]));
  const obstacleAt = new Set(obstacles.map(({ pos }) => `${pos.x}:${pos.y}`));
  const label = (x: number, y: number) => {
    const tile = board.tiles[y * board.width + x];
    const unit = unitAt.get(`${x}:${y}`);
    if (unit) return `${unit.name}, ${unit.hp}/${unit.maxHp} HP${markedPrey(unit) ? ", presa marcada" : ""}`;
    if (obstacleAt.has(`${x}:${y}`)) return 'Obstáculo';
    const pickup = pickupAt.get(`${x}:${y}`);
    if (pickup) return pickup.kind === 'ORB' ? 'Orbe arcano' : 'Página del grimorio';
    if (state.dominion?.nodes.some((n) => n.pos.x === x && n.pos.y === y)) return 'Nodo de Dominio';
    if (tile?.terrain === 'OBJECTIVE') return 'Salida';
    if(tile?.terrain === 'LAVA')return 'Lava permanente · peligro';
    if(tile?.terrain === 'FIRE')return 'Fuego temporal';
    return tile?.terrain === 'BLOCKED' ? 'Terreno bloqueado' : (tile?.terrain ?? 'Casilla');
  };

  return (
    <aside className="tactical-overview" aria-label="Vista táctica del campo de batalla" role="img">
      <div className="tactical-overview-title">Minimapa <small title="Orientación de la cámara; las coordenadas del combate no cambian">{turn*90}°</small></div>
      <div
        className="tactical-map"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {tiles.map(({tile,index}) => {
          const x = index % board.width;
          const y = Math.floor(index / board.width);
          const unit = unitAt.get(`${x}:${y}`);
          const terrain = tile.terrain.toLowerCase().replaceAll('_', '-');
          const node = state.dominion?.nodes.some((n) => n.pos.x === x && n.pos.y === y);
          const faction = unit?.kind === 'STRUCTURE' ? 'objective' : unit?.faction.toLowerCase();
          const obstacle = obstacleAt.has(`${x}:${y}`);
          const pickup = pickupAt.get(`${x}:${y}`);
          return (
            <span
              key={`${x}:${y}`}
              className={`tactical-map-cell terrain-${terrain}${unit && DEFAULT_CONTENT.enemies[unit.defId]?.rank === 'BOSS' ? ' is-boss' : ''}${faction ? ` unit-${faction}` : ''}${obstacle ? ' has-obstacle' : ''}${
                pickup ? ` has-pickup pickup-${pickup.kind.toLowerCase()}` : ''
              }`}
              title={label(x, y)}
            >
              {node && !unit && <b aria-hidden="true">◇</b>}
              {(unit || obstacle) && <i aria-hidden="true" />}
              {pickup && !unit && <b aria-hidden="true" />}
            </span>
          );
        })}
      </div>
      <div className="tactical-map-legend" aria-hidden="true">
        <span>
          <i className="unit-player" /> Héroe / aliados
        </span>
        <span>
          <i className="unit-enemy" /> Enemigo
        </span>
        <span>
          <i className="unit-objective" /> Objetivo
        </span>
        {pickupAt.size > 0 && (
          <span>
            <i className="unit-pickup" /> Reliquia
          </span>
        )}
      </div>
    </aside>
  );
}
