import type {GameContent} from '../../game';
const PUBLIC_NAMES:Readonly<Record<string,string>>={mage:'Mago',warrior:'Guerrero',summoner:'Invocador',shapeshifter:'Cambiaformas',archer:'Arquero'};
/** Public presentation fallback only; never expose a registry key as a champion's name. */
export function championLabel(content:GameContent,id:string){const name=content.heroes[id]?.name;return name&&name!==id?name:PUBLIC_NAMES[id]??'Campeón';}
