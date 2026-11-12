import type { CardDefinition, EffectDef, TargetingDef } from '../domain/cards/card';

/** Ten additions, normal mage reward pools. No starter edits, grants or ownership migration. */
const electrical = (amount: number, impactOnly = false): EffectDef => ({
  type: 'DAMAGE', amount, damageType: 'ARCANE', to: 'ENEMIES', electrical: true, impactOnly,
});
const status = (id: Extract<EffectDef, {type: 'APPLY_STATUS'}>['status'], duration: number, to: 'CASTER' | 'ENEMIES' = 'CASTER'): EffectDef => ({
  type: 'APPLY_STATUS', status: id, duration, to,
});
const enemy = (range: number): TargetingDef => ({type: 'UNIT', range, unitFilter: 'ENEMY', requiresLineOfSight: true});
const self: TargetingDef = {type: 'SELF'};
const make = (id: string, name: string, cost: number, rarity: CardDefinition['rarity'], category: CardDefinition['category'], targeting: TargetingDef, rulesText: string, effects: EffectDef[]): CardDefinition => ({
  id, name, heroId: 'mage', cost, rarity, category, targeting, rulesText, effects,
  tags: ['thunder', 'mage-elements', 'thunder-expansion'],
  presentation: {visualKey: id, element: 'THUNDER', castAnimation: 'cast'},
});
export const MAGE_THUNDER_EXPANSION: CardDefinition[] = [
  make('fulminating_spear', 'Lanza Fulminante', 3, 'RARE', 'ATTACK',
    {type: 'LINE', range: 4, pierce: true},
    'Inflige 2 de daño mágico eléctrico a cada enemigo en una línea ortogonal de 4 casillas. Perfora unidades; los obstáculos detienen la línea.', [electrical(2)]),
  make('voltaic_armor', 'Armadura de Voltios', 2, 'UNCOMMON', 'DEFENSE', self,
    'Gana 3 de escudo hasta tu próximo turno. Responde una sola vez a un ataque de un enemigo adyacente con 1 de daño mágico. No encadena contraataques.',
    [{type: 'SHIELD', amount: 3, to: 'CASTER'}, status('VOLTAIC_ARMOR', 1)]),
  make('lightning_step', 'Paso Relámpago', 2, 'UNCOMMON', 'MOVEMENT',
    {type: 'TILE', range: 3, tileFilter: 'EMPTY', requiresLineOfSight: true},
    'Teletranspórtate a una casilla libre a distancia 3 con visión. No concede PM ni acciones adicionales. Activa las trampas del destino.', [{type: 'TELEPORT_CASTER'}]),
  make('storm_orb', 'Orbe de Tormenta', 3, 'RARE', 'TERRAIN',
    {type: 'TILE', range: 3, tileFilter: 'NOT_BLOCKED', requiresLineOfSight: true, area: {shape: 'SQUARE', radius: 2}},
    'Coloca un orbe con zona cuadrada de radio 2. Al inicio de tus próximos 2 turnos inflige 1 de daño mágico a un máximo de 2 enemigos dentro, en orden de casilla. No persigue ni bloquea. Un orbe propio sustituye al anterior.',
    [{type: 'PLACE_GLYPH', glyphId: 'thunder_orb', damage: 1, damageType: 'ARCANE', activations: 2, maxTargets: 2}]),
  make('conductive_mark', 'Marca Conductora', 1, 'COMMON', 'CONTROL', enemy(4),
    'Marca un enemigo a distancia 4 con visión. El próximo daño directo de una carta eléctrica que lo alcance inflige +1 y consume la marca, incluso si absorbe el daño. Dura 2 turnos del objetivo; no se acumula ni renueva.', [status('CONDUCTIVE_MARK', 2, 'ENEMIES')]),
  make('thunder_hammer', 'Martillo del Trueno', 3, 'RARE', 'ATTACK',
    {type: 'CROSS', range: 2, radius: 1, requiresLineOfSight: true},
    'Inflige 2 de daño mágico eléctrico al objetivo central y una onda de 1 a los enemigos en la cruz de radio 1, incluido el centro. Armadura y escudo se aplican a cada impacto.',
    [electrical(2, true), electrical(1)]),
  make('static_field', 'Campo Estático', 2, 'UNCOMMON', 'TERRAIN',
    {type: 'CROSS', range: 3, radius: 1, requiresLineOfSight: true},
    'Electrifica una cruz de radio 1 durante tus próximos 2 inicios de turno. Inflige 1 de daño mágico a los enemigos que permanezcan dentro en cada activación. No inmoviliza. Un campo propio sustituye al anterior.',
    [{type: 'PLACE_GLYPH', glyphId: 'thunder_static', damage: 1, damageType: 'ARCANE', activations: 2}]),
  make('electric_frenzy', 'Frenesí Eléctrico', 1, 'UNCOMMON', 'UTILITY', self,
    'Hasta el final de tu próximo turno, tus ataques infligen +1 y recibes +1 de los ataques enemigos. No afecta daño de terreno, estados ni contraataques. No se acumula ni renueva.', [status('ELECTRIC_FRENZY', 2)]),
  make('lightning_wall', 'Muralla de Rayos', 2, 'RARE', 'TERRAIN',
    {type: 'TILE', range: 3, tileFilter: 'NOT_BLOCKED', requiresLineOfSight: true, area: {shape: 'WALL', radius: 1}},
    'Coloca hasta 3 segmentos eléctricos sobre casillas libres durante 2 rondas. Cada segmento descarga 2 de daño mágico al primer enemigo que lo cruza y se consume. Detiene ese recorrido al entrar, pero no enraíza ni bloquea la casilla; aliados no lo activan.',
    [{type: 'PLACE_TRAP', trapId: 'lightning_wall', damage: 2, damageType: 'ARCANE', rootOnTrigger: false, rounds: 2, on: 'AREA'}]),
  make('storm_avatar', 'Avatar de la Tormenta', 4, 'LEGENDARY', 'UTILITY', self,
    'Gana 2 de escudo hasta tu próximo turno. Hasta el final de tu próximo turno, tus cartas de daño eléctrico directo infligen +1 por objetivo e impacto. No modifica tu forma, PM, energía ni turnos. No se acumula ni renueva.',
    [{type: 'SHIELD', amount: 2, to: 'CASTER'}, status('STORM_AVATAR', 2)]),
];

// Guaranteed authored boss offer; no retroactive login grant and no change to global rarity weights.
MAGE_THUNDER_EXPANSION.find(c=>c.id==='storm_avatar')!.acquisition = {source:'ENCOUNTER_REWARD',worldId:'world_3'};
