/** Legado Primordial: private QA only. Candidate values; no public registration or rewards. */
import type { CardDefinition, EffectDef, TargetingDef } from '../domain/cards/card';
export type LegacyCollection = 'bear_heart' | 'labyrinth_blood' | 'primal_instinct';
const self: TargetingDef = {type:'SELF'};
const melee: TargetingDef = {type:'UNIT',range:1,unitFilter:'ENEMY'};
const near: TargetingDef = {type:'UNIT',range:2,unitFilter:'ENEMY',requiresLineOfSight:true};
const ring: TargetingDef = {type:'SELF',area:{shape:'CROSS',radius:1,includeCenter:false}};
const damage=(amount:number,extra:Partial<Extract<EffectDef,{type:'DAMAGE'}>>={}):EffectDef=>
  ({type:'DAMAGE',amount,damageType:'PHYSICAL',to:'ENEMIES',...extra});
const shield=(amount:number):EffectDef=>({type:'SHIELD',amount,to:'CASTER'});
const heal=(amount:number):EffectDef=>({type:'HEAL',amount,to:'CASTER'});
const move=(amount:number):EffectDef=>({type:'GAIN_MOVE_POINTS',amount});
const draw:EffectDef={type:'DRAW',count:1};
const cleanse:EffectDef={type:'CLEANSE',to:'CASTER'};
const status=(status:'ROOTED'|'SEALED'|'CHALLENGED'|'SMOKE_SCREEN',to:'CASTER'|'ENEMIES'):EffectDef=>
  ({type:'APPLY_STATUS',status,duration:1,to});
const push=(distance:number,collisionDamage=0):EffectDef=>({type:'PUSH',distance,collisionDamage,to:'ENEMIES'});
const clear:EffectDef={type:'REMOVE_HAZARDS',on:'AREA'};
function card(collection:LegacyCollection,id:string,name:string,cost:number,category:CardDefinition['category'],
  rulesText:string,targeting:TargetingDef,effects:EffectDef[],beast?:EffectDef[]):CardDefinition {
  const group=collection==='bear_heart'?'bear':collection==='labyrinth_blood'?'minotaur':'universal';
  return {id:`qa_legacy_${id}`,name,cost,category,rulesText,targeting,effects,
    heroId:'shapeshifter',rarity:'COMMON',expansion:'shapeshifter_private_qa',
    tags:['shapeshifter-catalog',group,'primordial-legacy',collection],
    ...(group==='universal'?{formEffects:{HUMAN:effects,BEAST:beast!}}:{requiredForms:[group]}),
    presentation:{visualKey:`qa_legacy_${id}`,element:category==='DEFENSE'?'SHIELD':'FORCE'}};
}
export const PRIMORDIAL_LEGACY_CARDS: readonly CardDefinition[] = [
  card('bear_heart','thorn_wall','Muro de Zarzas',2,'DEFENSE',
    'Oso: gana 3 de escudo y enraíza durante 1 turno a los enemigos ortogonalmente adyacentes.',ring,[shield(3),status('ROOTED','ENEMIES')]),
  card('bear_heart','refuge','Instinto de Refugio',1,'DEFENSE',
    'Oso: gana 2 de escudo; si tienes la mitad de tu vida máxima o menos, gana 5 en total.',self,
    [{type:'SHIELD',amount:2,to:'CASTER',bonus:{when:{type:'CASTER_HP_AT_MOST_HALF'},amount:3}}]),
  card('bear_heart','purifying_claws','Garras Purificadoras',2,'ATTACK',
    'Oso: elimina tus estados negativos e inflige 3 de daño físico a un enemigo adyacente.',melee,[cleanse,damage(3)]),
  card('bear_heart','guardian_circle','Círculo del Guardián',2,'CONTROL',
    'Oso: inflige 1 de daño físico y Desafiado durante 1 turno a enemigos ortogonalmente adyacentes. Gana 2 de escudo.',ring,
    [damage(1),{type:'APPLY_STATUS',status:'CHALLENGED',duration:1,to:'ENEMIES',everyTarget:true},shield(2)]),
  card('bear_heart','sap_blood','Sangre de Savia',2,'DEFENSE',
    'Oso: recupera 2 HP y gana Cobertura de Humo durante 1 turno (reduce daño recibido según las reglas existentes).',self,
    [heal(2),status('SMOKE_SCREEN','CASTER')]),
  card('bear_heart','territorial_rejection','Rechazo Territorial',2,'CONTROL',
    'Oso: empuja 1 casilla a enemigos ortogonalmente adyacentes (colisión: 1 daño). Retira peligros de esas casillas.',ring,[push(1,1),clear]),
  card('labyrinth_blood','verdict_axe','Hacha del Veredicto',2,'ATTACK',
    'Minotauro: inflige 2 de daño físico adyacente; si el objetivo tiene 3 HP o menos, inflige 5 en su lugar. Armadura y escudo protegen.',melee,
    [damage(2,{finisher:{hpAtMost:3,amount:5}})]),
  card('labyrinth_blood','break_encirclement','Ruptura del Cerco',2,'ATTACK',
    'Minotauro: inflige 1 de daño físico ignorando armadura a enemigos ortogonalmente adyacentes y empújalos 1 casilla sin daño de colisión. Escudo protege.',ring,
    [damage(1,{attackKind:'PIERCING'}),push(1)]),
  card('labyrinth_blood','maze_mark','Marca del Laberinto',1,'CONTROL',
    'Minotauro: aplica Desafiado durante 1 turno a un enemigo a alcance 2 y atráelo 1 casilla, sin daño de colisión.',near,
    [status('CHALLENGED','ENEMIES'),{type:'PULL',distance:1,to:'ENEMIES'}]),
  card('labyrinth_blood','conqueror_march','Marcha del Conquistador',2,'MOVEMENT',
    'Minotauro: camina hasta 3 casillas caminables sin gastar movimiento y gana 2 de escudo.',{type:'STEP',range:3},[{type:'STEP_CASTER'},shield(2)]),
  card('labyrinth_blood','threshold_edge','Filo del Umbral',2,'ATTACK',
    'Minotauro: lanza un filo que inflige 2 de daño físico a enemigos en una línea recta de hasta 3 casillas. Atraviesa unidades; cobertura y bloqueos siguen sus reglas.',
    {type:'LINE',range:3,pierce:true},[damage(2,{attackKind:'RANGED'})]),
  card('labyrinth_blood','silent_horns','Cuernos del Silencio',2,'CONTROL',
    'Minotauro: inflige 2 de daño físico a un enemigo adyacente y aplica Sellado durante 1 turno.',melee,[damage(2),status('SEALED','ENEMIES')]),
  card('primal_instinct','lineage_pulse','Pulso del Linaje',1,'UTILITY',
    'Humano: roba 1 carta y recupera 1 HP. Bestia: gana 2 de escudo y recupera 1 movimiento.',self,[draw,heal(1)],[shield(2),move(1)]),
  card('primal_instinct','shedding_rite','Rito de Deslastre',1,'UTILITY',
    'Humano: elimina tus estados negativos y recupera 1 movimiento. Bestia: elimina tus estados negativos y gana 2 de escudo.',self,
    [cleanse,move(1)],[cleanse,shield(2)]),
  card('primal_instinct','hunt_echo','Eco de la Cacería',1,'CONTROL',
    'A alcance 2. Humano: aplica Sellado durante 1 turno. Bestia: inflige 1 de daño físico y Enraizado durante 1 turno.',near,
    [status('SEALED','ENEMIES')],[damage(1),status('ROOTED','ENEMIES')]),
  card('primal_instinct','skin_memory','Memoria de la Piel',2,'DEFENSE',
    'Humano: recupera 2 HP y roba 1 carta. Bestia: gana 3 de escudo y roba 1 carta.',self,[heal(2),draw],[shield(3),draw]),
  card('primal_instinct','ancestor_round','Ronda de los Ancestros',1,'UTILITY',
    'En casillas ortogonalmente adyacentes. Humano: retira peligros y roba 1 carta. Bestia: inflige 1 de daño físico a enemigos y recupera 1 HP.',ring,
    [clear,draw],[damage(1),heal(1)]),
  card('primal_instinct','untamed_bond','Vínculo Indómito',2,'CONTROL',
    'Contra enemigo adyacente. Humano: empújalo 2 casillas sin daño de colisión y gana 2 de escudo. Bestia: inflige 3 de daño físico y recupera 2 movimientos.',melee,
    [push(2),shield(2)],[damage(3),move(2)]),
];
