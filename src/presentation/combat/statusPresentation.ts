import type { StatusId } from '../../game';
import type { StatusDef } from '../../game/domain/statuses/status';
import type { IconName } from '../assets/iconPaths';
export function statusIcon(id: StatusId): IconName {
  return ({PERMAFROST:'frost',SCOUT_PROTECTION:'shield',DRAKE_BURN:'flame',GLACIER_CLAW:'frost',SNOW_WAR:'frost',ABSOLUTE_ZERO:'frost',FROZEN:'frost',FROST_MANTLE:'shield',GLACIAL_REFLECTION:'shield',ARCANE_SKATING:'move',ICE_PRISON:'frost',AVALANCHE_SLOW:'frost',THUNDER_INCARNATION:'energy',ARCANE_INVERSION:'arcane',BURNING:'flame',BLEEDING:'melee',POISONED:'poison',TURTLE_HOBBLE_1:'move',TURTLE_HOBBLE_2:'move',SLOWED:'frost',ROOTED:'tile',STUNNED:'wait',FORTIFIED:'shield',SMOKE_SCREEN:'smoke',RELIC_BURDEN:'move',CHALLENGED:'target',PREY:'prey',MARKED_PREY:'prey',RIPOSTE:'melee'} as Partial<Record<StatusId,IconName>>)[id] ?? 'arcane';
}
export function statusEffect(def: StatusDef): string {
  const effects:string[]=[];
  if(def.id==='LIGHT_PROTECTION')return 'Reduce 1 el siguiente daño válido; se consume o expira al inicio del próximo turno del lanzador';
  if(def.id==='LIGHT_VIGIL')return 'Bloquea un estado menor; se consume o expira al inicio del próximo turno del lanzador';
  if(def.damageToHealingCap)effects.push(`Primera instancia de daño por turno → hasta ${def.damageToHealingCap} PV; no consume escudo`);
  if(def.thunderEconomy)effects.push('Primera eléctrica −1 energía; cada eléctrica +1 PM; desplazamiento adyacente opcional una vez por turno');
  if(def.outgoingDamageBonus) effects.push(`Ataques +${def.outgoingDamageBonus}`);
  if(def.incomingDamageBonus) effects.push(`Daño recibido de ataques +${def.incomingDamageBonus}`);
  if(def.electricalDamageBonus) effects.push(`Cartas eléctricas +${def.electricalDamageBonus}`);
  if(def.receivedElectricalBonus) effects.push(`Próxima carta eléctrica recibida +${def.receivedElectricalBonus}; se consume`);
  if(def.tickDamage) effects.push(`${def.tickDamage} de daño ${def.tick === 'TURN_START' ? 'al comenzar' : 'al terminar'} su turno`);
  if(def.preventsMovement) effects.push('Impide caminar; no impide desplazamientos forzados');
  if(def.preventsActions) effects.push('Impide actuar');
  if(def.incomingDamageReduction) effects.push(`Reduce ${def.incomingDamageReduction} el daño de ataques recibidos`);
  if(def.outgoingDamageReduction) effects.push(`Reduce ${def.outgoingDamageReduction} el daño de sus ataques`);
  if(def.moveReduction) effects.push(`Movimiento −${def.moveReduction}`);
  if(def.armorBonus)effects.push(`Armadura +${def.armorBonus} hasta el inicio de su próximo turno`);
  if(def.counterDamage) effects.push(`Contraataque de ${def.counterDamage} contra un golpe adyacente`);
  if(def.summonDamageBonus) effects.push(`Ataques de invocación +${def.summonDamageBonus}`);
  if(def.summonMoveBonus) effects.push(`Movimiento de invocación +${def.summonMoveBonus}`);
  if(def.summonPreyDamageBonus) effects.push(`Daño contra Presa +${def.summonPreyDamageBonus}`);
  if(def.preyMark) effects.push('Las invocaciones del lanzador priorizan esta presa');
  if(def.taunt) effects.push(`Prioriza al desafiante; daño contra otros −${def.tauntPenalty ?? 0}`);
  if(def.suppressesHitRiders) effects.push('Suprime los efectos adicionales de sus ataques');
  if(def.hpFloor) effects.push(`Su vida no puede bajar de ${def.hpFloor}`);
  if(def.onFormChange) effects.push(`Al cambiar de forma: +${def.onFormChange.shield} escudo y +${def.onFormChange.movePoints} movimiento`);
  if(def.distantHitMomentum) effects.push(`El primer impacto lejano aporta +${def.distantHitMomentum} Impulso`);
  return effects.join(' · ') || ({RELIC_BURDEN:'Porta la reliquia: movimiento −1',PREY:'Objetivo de los bonos de Presa del Arquero',SMOKE_SCREEN:'Protección de humo frente a ataques lejanos'} as Partial<Record<StatusId,string>>)[def.id] || def.name;
}
