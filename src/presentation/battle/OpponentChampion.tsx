import {championLabel} from './championLabel';
import type {GameContent,GameState} from '../../game';
import {CharacterPortrait} from '../react/components/CharacterPortrait';
import {unitVisualId} from '../assets/visualIdentity';
import {Bar} from '../react/components/Hud';
import {statusChipText,statusChipTitle} from '../react/format';
import {formVisual} from '../qa/shapeshifter/visuals';
/** Only the public hero unit; never the opponent's profile, deck or hidden cards. */
export function OpponentChampion({state,content}:{state:Readonly<GameState>;content:GameContent}){
 const rival=state.units.find(u=>u.kind==='HERO'&&u.id!==state.player.heroId);
 if(!rival)return null;
 return <section className="panel premium-rival" aria-label="Campeón rival">
 <div className="rival-portrait"><CharacterPortrait unit={unitVisualId(rival.defId)}/></div>
 <div className="rival-vitals"><small>Rival</small><h2>{championLabel(content,rival.defId)}</h2>
 {rival.defId==='shapeshifter'&&rival.activeForm&&<span className="rival-form">{formVisual(rival.activeForm).label}</span>}
 <Bar label="HP" value={rival.hp} max={rival.maxHp} kind="hp"/>
 {rival.shield>0&&<span className="status-chip">Escudo {rival.shield}</span>}
 <div className="statuses">{rival.statuses.map((status,i)=><span key={`${status.id}:${i}`} className="status-chip" title={statusChipTitle(status)}>{statusChipText(status)}</span>)}</div>
 </div></section>;
}
