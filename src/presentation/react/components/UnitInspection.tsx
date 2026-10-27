import { useEffect, useRef } from 'react';
import type { GameContent, Unit, Pos } from '../../../game';
import { statusEffect } from '../../combat/statusPresentation';
import { STATUS_LABEL } from '../../assets/statusLabels';
import '../../../styles/unit-inspection.css';
import { summonCapacityOf } from '../../../game/domain/summons/summons';

/** Only occupied public board positions; targeting always keeps the existing input route. */
export function inspectedUnitAt(units:readonly Unit[], positions:readonly Pos[], targeting:boolean):Unit|null {
  if(targeting)return null;
  for(const pos of positions){const unit=units.find(u=>u.pos.x===pos.x&&u.pos.y===pos.y);if(unit && unit.kind!=='STRUCTURE')return unit;}
  return null;
}
const ROLES:Record<string,string>={SCOUT:'Explorador',SKIRMISHER:'Ataque y retirada',GUARD:'Guardián',RANGED:'Ataque a distancia',PRESSURE:'Presión cuerpo a cuerpo'};
export function UnitInspection({unit,content,units,onClose}:{unit:Unit;content:GameContent;units?:readonly Unit[];onClose():void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=dialog.current;if(el&&!el.open)el.showModal();return()=>el?.close();},[]);
  const moveBonus=unit.statuses.reduce((n,s)=>n+(content.statuses[s.id]?.summonMoveBonus??0),0);
  const summon=unit.kind==='SUMMON'?content.summons?.[unit.defId]:undefined;
  // Summon capacity is public (PvP rivals see Vínculo Prohibido's bonus too).
  const capacity=unit.kind==='HERO'?summonCapacityOf(content,unit):0, capacityUsed=(units??[]).reduce((n,u)=>n+(u.summon?.ownerId===unit.id?u.summon.capacityCost:0),0);
  return <dialog ref={dialog} className="unit-inspection" aria-label={`Información de ${unit.name}`} onCancel={e=>{e.preventDefault();onClose();}}>
    <header><div><small>{unit.faction==='PLAYER'?'Aliado':'Enemigo'}{summon?' · Invocación':''}</small><h2>{unit.name}</h2></div><button autoFocus type="button" aria-label="Cerrar información de unidad" onClick={onClose}>×</button></header>
    <dl><div><dt>Vida</dt><dd>{unit.hp} / {unit.maxHp} HP</dd></div>{summon&&<div><dt>Daño base</dt><dd>{summon.damage}</dd></div>}<div><dt>Movimiento</dt><dd>{unit.moveRange}{moveBonus>0?` + ${moveBonus}`:''}</dd></div><div><dt>Armadura</dt><dd>{unit.armor}</dd></div>{unit.shield>0&&<div><dt>Escudo</dt><dd>{unit.shield}</dd></div>}{capacity>0&&<div><dt>Capacidad de invocación</dt><dd>{units?`${capacityUsed} / `:''}{capacity}{unit.summonCapacityBonus?` (+${unit.summonCapacityBonus} Vínculo Prohibido)`:''}</dd></div>}</dl>
    {summon&&<><p>{ROLES[summon.behavior??'']??'Invocación'}{summon.attackRange?` · Alcance ${summon.attackRange}`:''}</p><p className="unit-inspection-note">Permanece hasta morir, ser retirado por un efecto o terminar el combate.</p></>}
    <h3>Estados activos</h3>{unit.statuses.length?<ul>{unit.statuses.map((status,i)=><li key={`${status.id}-${i}`}><strong>{STATUS_LABEL[status.id]}</strong> · {content.statuses[status.id]?.permanent ? 'Hasta que se retire' : `${status.turnsLeft} turno(s)`}<p>{statusEffect(content.statuses[status.id])}</p></li>)}</ul>:<p>Sin estados activos.</p>}
  </dialog>;
}
