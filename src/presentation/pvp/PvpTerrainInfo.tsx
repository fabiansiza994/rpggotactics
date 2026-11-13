import {useState} from 'react';
import {createPortal} from 'react-dom';
import type {GameState} from '../../game';
import {TacticalOverview} from '../react/components/TacticalOverview';

/** The mobile entry lives in the existing right gutter, never on the picking surface. */
export function PvpTerrainInfo({name,state}:{name:string;state:Readonly<GameState>}) {
 const [open,setOpen]=useState(false);
 const contents=<><b>{name}</b><p>Cobertura ▰: −1 daño de proyectiles y ataques directos a distancia. Peligro △: 1 daño al final del turno del propietario. Arcano ◇: campeón +1 energía al iniciar su turno. Vacío: sin paso ni destinos; los proyectiles lo cruzan.</p><TacticalOverview state={state}/></>;
 return <><details className="pvp-terrain-info"><summary>Mapa y terreno</summary>{contents}</details>
 <button className="mobile-terrain-trigger" type="button" aria-label="Mapa y terreno" aria-haspopup="dialog" onClick={()=>setOpen(true)}>ⓘ</button>
 {open&&createPortal(<dialog className="mobile-terrain-overlay" aria-label="Mapa y terreno" ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={e=>{e.preventDefault();setOpen(false);}} onPointerDown={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section className="mobile-terrain-dialog" role="dialog" aria-modal="true" aria-label="Mapa y terreno"><header><h2>Mapa y terreno</h2><button type="button" autoFocus onClick={()=>setOpen(false)} aria-label="Cerrar mapa y terreno">×</button></header>{contents}</section></dialog>,document.body)}</>;
}
