import {useState} from 'react';
import {createPortal} from 'react-dom';
import type {GameContent,GameState} from '../../game';
import {TacticalOverview} from '../react/components/TacticalOverview';
import {GameIcon} from '../react/components/GameIcon';
/** Existing tactical information, exposed through one accessible trigger in either layout. */
export function PvpTerrainInfo({name,state,content}:{name:string;state:Readonly<GameState>;content?:GameContent}){
 const [open,setOpen]=useState(false);
 const types=[...new Set(state.board.tiles.map(t=>t.terrain))];
 const contents=<><h3>{name}</h3>{content?<ul className="terrain-facts">{types.map(type=>{const t=content.terrain[type];return <li key={type}><strong>{t.name}</strong>: {!t.walkable?'sin paso':t.exitCostBonus?`coste adicional al salir: ${t.exitCostBonus} PM`:'paso normal'}{t.endTurnDamage>0&&` · ${t.endTurnDamage} daño al terminar turno`}{t.rangedReduction?` · reduce ${t.rangedReduction} daño a distancia`:''}{t.startEnergyBonus?` · +${t.startEnergyBonus} energía al empezar turno`:''}{t.blocksLineOfSight?' · bloquea visión':''}</li>})}</ul>:<p>Cobertura: −1 daño a distancia. Peligro: 1 daño al final del turno. Arcano: +1 energía al iniciar turno. Vacío: sin paso.</p>}
 {state.obstacles.length>0&&<p>Obstáculos presentes: {state.obstacles.length}. Se conservan sus reglas de paso y visión.</p>}
 {state.units.some(u=>u.statuses.some(s=>s.id==='ABSOLUTE_ZERO'))&&<p>Mundo Gélido activo: se aplican las reglas existentes de hielo de su propietario.</p>}
 {state.board.tiles.some(t=>t.terrainTurnsLeft!==null)&&<details><summary>Terreno temporal</summary><ul>{state.board.tiles.flatMap((t,i)=>t.terrainTurnsLeft===null?[]:[<li key={i}>{content?.terrain[t.terrain].name??t.terrain} · casilla {i%state.board.width+1},{Math.floor(i/state.board.width)+1} · {t.terrainTurnsLeft} rondas</li>])}</ul></details>}
 <TacticalOverview state={state}/></>;
 return <><button className="terrain-access" type="button" aria-label="Mapa y terreno" aria-haspopup="dialog" title={name} onClick={()=>setOpen(true)}><GameIcon name="tile"/><span>Mapa y terreno</span><span aria-hidden="true">›</span></button>
 {open&&createPortal(<dialog className="mobile-terrain-overlay" aria-label="Mapa y terreno" ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={e=>{e.preventDefault();setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section className="mobile-terrain-dialog"><header><h2>Mapa y terreno</h2><button type="button" autoFocus onClick={()=>setOpen(false)} aria-label="Cerrar mapa y terreno">×</button></header>{contents}</section></dialog>,document.body)}</>;
}
