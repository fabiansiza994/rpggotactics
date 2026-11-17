import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {DEFAULT_CONTENT} from '../src/game';
import {ANTARCTIC_UPGRADES} from '../src/game/data/antarctic-upgrades';
import {FINAL_CARD_ART} from '../src/presentation/assets/paintedAssets';
const ids=[...Object.keys(ANTARCTIC_UPGRADES).filter(id=>id!=='ice_arrow'),'absolute_zero'];
it('exports the 21 real eligible Antarctic cards and their actual climate semantics',()=>{
 expect(ids).toHaveLength(21);
 const rows=ids.map(id=>{const c=DEFAULT_CONTENT.cards[id]!;expect(c).toBeTruthy();if(id!=='absolute_zero')expect(c.worldFrozenUpgrade).toBeTruthy();return{id,name:c.name,cost:c.cost,rarity:c.rarity,normal:c.rulesText,world:c.worldFrozenUpgrade?.rulesText??'Estado climático de 10 turnos propios; no se puede renovar mientras siga activo.',art:FINAL_CARD_ART[id]};});
 const dir='qa/antarctic-final-20261116';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/MATRIX.json',JSON.stringify(rows,null,2));
 const risk=(id:string)=>id==='glacial_storm'?'ICE ligado al dueño: se retira al expirar/eliminar su clima, sin cambiar terreno base.':id==='glacier_claw'?'ROOT: bloquea marcha/Blink voluntario; conserva empujes y teleports forzados existentes; FIRE y limpieza lo retiran.':id==='snow_war'?'Bloquea categoría ATTACK, no toda carta CONTROL con daño. Un disparo por fin de turno; visión requerida incluso con alcance global.':id==='snow_soldier'?'Apariencia completa no restaura HP ni duración; FIRE sigue derrotándolo.':'Interacción ya existente conservada, sin nuevo buff en este pase.';
 writeFileSync(dir+'/MATRIX.md','# Magia Antártica: 21 cartas elegibles\n\nGenerado desde las definiciones reales del candidato. Flecha de Hielo (Arquero, recompensa no vendible) queda documentada fuera de este conjunto; no se cambia su propiedad ni rareza.\n\n| Carta | Normal | Mundo Gélido: interacción actual | Riesgo / regla preservada |\n|---|---|---|---|\n'+rows.map(r=>`| ${r.name} (${r.id}) | ${r.normal} | ${r.world} | ${risk(r.id)} |`).join('\n')+'\n');
});
