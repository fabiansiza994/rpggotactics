import type { StatusId } from '../../game';
import type { StatusDef } from '../../game/domain/statuses/status';
import type { IconName } from '../assets/iconPaths';
export function statusIcon(id: StatusId): IconName {
  return ({BURNING:'flame',POISONED:'poison',SLOWED:'frost',ROOTED:'tile',STUNNED:'wait',FORTIFIED:'shield',SMOKE_SCREEN:'smoke',RELIC_BURDEN:'move',CHALLENGED:'target',PREY:'prey',MARKED_PREY:'prey',RIPOSTE:'melee'} as Partial<Record<StatusId,IconName>>)[id] ?? 'arcane';
}
export function statusEffect(def: StatusDef): string {
  const effects:string[]=[];
  if(def.tickDamage) effects.push(`${def.tickDamage} de daño ${def.tick === 'TURN_START' ? 'al comenzar' : 'al terminar'} su turno`);
  if(def.preventsMovement) effects.push('Impide caminar; no impide desplazamientos forzados');
  if(def.preventsActions) effects.push('Impide actuar');
  if(def.incomingDamageReduction) effects.push(`Reduce ${def.incomingDamageReduction} el daño de ataques recibidos`);
  if(def.outgoingDamageReduction) effects.push(`Reduce ${def.outgoingDamageReduction} el daño de sus ataques`);
  if(def.moveReduction) effects.push(`Movimiento −${def.moveReduction}`);
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
