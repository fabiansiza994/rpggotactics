import {ENVIRONMENT_PAINTINGS} from '../assets/paintedAssets';
import {ChampionContext} from '../play/ChampionContext';
import {navigatePlay} from '../play/navigation';
import {GameIcon} from '../react/components/GameIcon';

export const MOBILE_MODES=[
 {id:'campaign',title:'Campaña',copy:'Continúa tu aventura y recupera tu progreso.',art:ENVIRONMENT_PAINTINGS.duel,icon:'arcane'},
 {id:'ranked',title:'Ranked',copy:'Pon a prueba tu mazo y asciende en la clasificación.',art:ENVIRONMENT_PAINTINGS.fracture,icon:'shield'},
 {id:'casual',title:'Casual',copy:'Un duelo amistoso, sin puntos de rango.',art:ENVIRONMENT_PAINTINGS.sanctuary,icon:'melee'},
 {id:'skirmish',title:'Escaramuza',copy:'Desafíos tácticos con objetivos especiales.',art:ENVIRONMENT_PAINTINGS.sanctuary,icon:'target'},
 {id:'stories',title:'Historias',copy:'Descubre las aventuras de tus campeones.',art:ENVIRONMENT_PAINTINGS.veil_forest,icon:'deck'},
] as const;
export function chooseMobileMode(id:typeof MOBILE_MODES[number]['id']){
 return id==='ranked'?navigatePlay('pvp',{queue:'ranked'}):id==='casual'?navigatePlay('pvp'):navigatePlay(id);
}
export function MobilePlay(){return <section className="m2-play"><header className="m2-section-title"><small>ELIGE TU PRÓXIMA BATALLA</small><h1>Jugar</h1><p>Cada aventura empieza con una decisión.</p></header><div className="m2-mode-list" aria-label="Modos de juego">{MOBILE_MODES.map(mode=><button key={mode.id} className="m2-mode" data-mode={mode.id} onClick={()=>chooseMobileMode(mode.id)}><img src={mode.art} alt=""/><GameIcon name={mode.icon}/><span><strong>{mode.title}</strong><small>{mode.copy}</small></span><b aria-hidden="true">→</b></button>)}</div><div className="m2-loadout"><ChampionContext/></div></section>;}
