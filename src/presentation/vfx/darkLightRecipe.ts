import {DARK_LIGHT_CARDS} from '../../game/data/dark-light';
/** Read existing contracts for presentation only; never resolve or predict an outcome. */
const cards=new Map(DARK_LIGHT_CARDS.map(c=>[c.id,c]));
export function darkLightTheme(id:string){return cards.has(id)?(id.startsWith('light_')?'LIGHT':'DARK'):null;}
export function lightFrameGroup(id:string):number{
 const effects=cards.get(id)?.effects??[];
 if(effects.some(e=>e.type==='SHIELD')||['light_protective_light','light_guardian_vigil'].includes(id))return 4;
 if(effects.some(e=>e.type==='HEAL'||e.type==='CLEANSE_ONE_MINOR'))return 8;
 if(effects.some(e=>e.type==='DRAW'||e.type==='REDRAW_HAND'||e.type==='CHOOSE_TOP_TO_BOTTOM'||e.type==='RECOVER_RANDOM_TO_DECK')||['light_grace_call','light_beyond_call'].includes(id))return 12;
 return 0;
}
