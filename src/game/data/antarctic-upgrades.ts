import type {CardDefinition} from '../domain/cards/card';
type Upgrade=NonNullable<CardDefinition['worldFrozenUpgrade']>;
export const ANTARCTIC_UPGRADES:Record<string,Upgrade>={
 frozen_step:{targeting:{type:'STEP',range:3},effects:[{type:'ICE_WALK',duration:3}],rulesText:'Desplázate hasta 3 casillas legales, dejando ICE durante 3 rondas en el recorrido real.'},
 sudden_frost:{effects:[{type:'CREATE_TERRAIN',terrain:'ICE',duration:2,on:'AREA',standableOnly:true,iceExitBonus:2}],rulesText:'La zona 2×2 de Escarcha dura 2 rondas; salir de sus casillas cuesta +2 PM (coste total 3 por paso).'},
 slippery_ground:{effects:[{type:'ICE_LINE',duration:2,slideSteps:2}],rulesText:'La línea ICE permite hasta 2 casillas adicionales de deslizamiento forzado; nunca encadena otro deslizamiento.'},
 shatter_ice:{effects:[{type:'SHATTER_ICE',energy:2}],rulesText:'Destruye una casilla ICE temporal propia y recupera 2 energía, sin superar el máximo.'},
 frost_mantle:{effects:[{type:'APPLY_STATUS',status:'FROST_MANTLE',duration:2,to:'CASTER',power:-1}],rulesText:'Anula por completo el primer desplazamiento forzado recibido y se consume. No cambia teleports ni movimiento voluntario.'},
 ice_prison:{effects:[{type:'APPLY_STATUS',status:'ICE_PRISON',duration:1,to:'ENEMIES'},{type:'APPLY_STATUS',status:'FROZEN',duration:1,to:'ENEMIES'}],rulesText:'El próximo turno: -2 PM (mínimo 1); además Congelado añade +1 PM al próximo movimiento voluntario, sin impedir otras acciones.'},
 arcane_skating:{effects:[{type:'APPLY_STATUS',status:'ARCANE_SKATING',duration:1,to:'CASTER',power:6}],rulesText:'Este turno, hasta 6 pasos continuos exclusivamente sobre ICE son gratuitos. Abandonar el hielo termina el beneficio; no se reinicia.'},
 permafrost:{effects:[{type:'APPLY_STATUS',status:'PERMAFROST',duration:4,to:'ENEMIES'}],rulesText:'Congela a un enemigo durante 4 turnos: -1 PM (mínimo 1) y 1 daño ICE al inicio de cada turno. Reaplicar renueva sin acumular.'},
 glacial_reflection:{effects:[{type:'APPLY_STATUS',status:'GLACIAL_REFLECTION',duration:2,to:'CASTER',power:3}],rulesText:'El primer ataque hostil a distancia reduce su daño en 3, hiela la casilla válida del atacante y consume Reflejo, incluso con daño 0.'},
 avalanche:{effects:[{type:'AVALANCHE',distance:3,freezeOnIce:true}],rulesText:'Empuja 3 casillas a las unidades de la zona. Si terminan sobre ICE: -1 PM en su próximo turno y Congelado.'},
 winter_domain:{targeting:{type:'SELF',area:{shape:'SQUARE',radius:1}},effects:[{type:'CREATE_TERRAIN',terrain:'ICE',duration:5,on:'AREA',standableOnly:true}],rulesText:'Crea una zona ICE de hasta 3×3 casillas transitables alrededor del Mago durante 5 rondas.'},
 frost_comet:{effects:[{type:'DAMAGE',amount:2,damageType:'ICE',to:'ENEMIES'},{type:'APPLY_STATUS',status:'ROOTED',duration:2,to:'ENEMIES'}],rulesText:'El cometa conserva su daño y enraíza durante 2 turnos en vez de 1.'},
 frost_nova:{targeting:{type:'SELF',area:{shape:'SQUARE',radius:2,includeCenter:false}},rulesText:'La Nova conserva su daño y control, pero alcanza un cuadrado de radio 2 alrededor del Mago.'},
 glacial_field:{effects:[{type:'CREATE_TERRAIN',terrain:'ICE',duration:4,on:'AREA',standableOnly:true}],rulesText:'El campo glacial mantiene su línea orientable de 3 casillas y dura 4 rondas.'},
 glacial_shell:{effects:[{type:'SHIELD',amount:8,to:'CASTER'}],rulesText:'Gana 8 de escudo hasta tu próximo turno, sin aplicar el auto-Enraizado.'},
 ice_wall:{effects:[{type:'CREATE_OBSTACLE',obstacleId:'ice_wall',duration:3,on:'AREA'}],rulesText:'El muro conserva sus tres casillas y orientación; dura 3 rondas y sigue siendo contrarrestable.'},
 ice_arrow:{effects:[{type:'DAMAGE',amount:2,damageType:'PHYSICAL',to:'ENEMIES',attackKind:'RANGED'},{type:'APPLY_STATUS',status:'SLOWED',duration:3,to:'ENEMIES'}],rulesText:'Conserva daño y alcance; Ralentizado dura 3 turnos en vez de 2.'},
 glacial_storm:{effects:[{type:'DAMAGE',amount:3,damageType:'ICE',to:'ENEMIES'},{type:'CREATE_TERRAIN',terrain:'ICE',duration:3,on:'AREA',standableOnly:true,whileWorldFrozen:true}],rulesText:'La tormenta inflige 3 por enemigo en la línea de hasta 4 y deja ICE sostenido por tu Mundo Gélido. Al terminar el clima reanuda sus 3 rondas restantes; no sobrescribe terrenos incompatibles.'},
 glacier_claw:{effects:[{type:'APPLY_STATUS',status:'GLACIER_CLAW',duration:3,to:'ENEMIES',power:1}],rulesText:'La garra inmoviliza durante 3 turnos del objetivo. No impide atacar ni jugar cartas. Un impacto FIRE válido la rompe.'},
 snow_soldier:{rulesText:'Máximo 2 Soldados de Nieve por dueño mientras su Mundo Gélido esté activo. Al expirar, los existentes permanecen y el límite para nuevas invocaciones vuelve a 1. Mientras su dueño tenga Mundo Gélido, el Soldado no pierde duración y usa Bola de Nieve a distancia 1. Cuando el clima expira reanuda el derretimiento restante, sin resetearlo.'},
 snow_war:{rulesText:'Cada disparo evalúa Mundo Gélido: alcance global con línea de visión mientras esté activo; al expirar vuelve a alcance 5. No permite otras cartas ATTACK.'},
};
export const withWorldUpgrade=(card:CardDefinition):CardDefinition=>ANTARCTIC_UPGRADES[card.id]?{...card,worldFrozenUpgrade:ANTARCTIC_UPGRADES[card.id]}:card;
