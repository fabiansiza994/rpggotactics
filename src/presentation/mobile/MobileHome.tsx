import {useEffect,useState} from 'react';
import {activeDeck,heroProfile,deckSize,DECK_RULES,encounterOrder,encounterById} from '../../game';
import {rankFor} from '../../game/ranked/ranked';
import {PRESENTATION_CONTENT as content} from '../qa/shapeshifter/runtime';
import {championPortrait} from '../assets/champions';
import {ENVIRONMENT_PAINTINGS} from '../assets/paintedAssets';
import {campaignOfWorld,useBattleStore} from '../store/battleStore';
import {rankedApi,type RankedProfile} from '../ranked/rankedApi';
import {navigatePlay} from '../play/navigation';
import {syncCampaignContext} from '../play/context';
import {GameIcon} from '../react/components/GameIcon';
import {openAccountView} from '../react/components/Account';
export function MobileHome(){
 const profile=useBattleStore(s=>s.profile),account=useBattleStore(s=>s.account),world=useBattleStore(s=>s.campaignWorldId),runs=useBattleStore(s=>s.runs),worldRuns=useBattleStore(s=>s.worldRuns);
 const heroId=profile.selectedChampionId,hero=content.heroes[heroId];
 const campaign=campaignOfWorld(world),run=(campaign.id==='ascent'?runs[heroId]:worldRuns[campaign.id]?.[heroId])??null;
 const total=encounterOrder(campaign).length,completed=run?.completedEncounterIds.length??0;
 const encounter=run?encounterById(campaign,run.currentEncounterId):null;
 const deck=activeDeck(heroProfile(profile,heroId,content));
 const [ranked,setRanked]=useState<{username:string;value:RankedProfile}|null>(null);
 const username='username' in account?account.username:'';
 useEffect(()=>{syncCampaignContext(useBattleStore.getState());},[heroId]);
 useEffect(()=>{let alive=true;if(account.status==='READY')void rankedApi.me().then(r=>{if(alive&&r?.ok)setRanked({username,value:r.data});}).catch(()=>{});return()=>{alive=false;};},[account.status,username]);
 const rank=account.status==='READY'&&ranked?.username===username&&ranked.value.enabled?ranked.value:null;
 if(!hero)return <p>Selecciona un campeón para comenzar.</p>;
 const pvp=(queue?:'ranked')=>navigatePlay('pvp',queue?{queue}:{});
 return <section className="m2-home" aria-label="Inicio móvil"><div className="m2-greeting"><p className="m2-eyebrow">TU PRÓXIMA JUGADA</p><h1>La aventura continúa.</h1></div>
 <article className="m2-adventure" style={{backgroundImage:`linear-gradient(180deg,#07101b05,#0b1520ed 70%),url(${ENVIRONMENT_PAINTINGS.duel})`}}><div className="m2-adventure-copy"><span className="m2-eyebrow">CAMPAÑA · {campaign.name}</span><h2>{campaign.name}</h2><p>{run?.status==='CHOOSING_REWARD'?'Tu recompensa te espera.':run?.status==='COMPLETED'?'Una aventura completada.':encounter?.name??'Tu aventura comienza aquí.'}</p><div className="m2-progress-label"><span>{completed}/{total} encuentros completados</span><span>{Math.round(completed/Math.max(1,total)*100)} %</span></div><progress aria-label="Progreso de campaña" value={completed} max={total}/><button className="m2-primary" onClick={()=>navigatePlay('campaign')}>{run?'Continuar campaña':'Explorar campaña'} <GameIcon name="move"/></button></div></article>
 <button className="m2-champion" onClick={()=>useBattleStore.getState().openChampions()}><img src={championPortrait(heroId)} alt={hero.name}/><span><small>TU CAMPEÓN</small><strong>{hero.name}</strong><span>{deck.name} · {deckSize(deck.cards)}/{DECK_RULES.requiredSize} cartas</span></span><b aria-hidden="true">›</b></button>
 <div className="m2-section-heading"><h2>Entra en la arena</h2><small>JUEGA A TU RITMO</small></div><div className="m2-arena-grid"><button className="m2-arena" onClick={()=>pvp('ranked')}><GameIcon name="shield"/><strong>Ranked</strong><span>Cada decisión cuenta.</span><small>{rank?`${rankFor(rank.rp).label} · ${rank.rp} RP`:account.status==='READY'?'Consulta tu rango':'Requiere una cuenta'}</small><b>Competir <GameIcon name="move"/></b></button><button className="m2-arena m2-casual" onClick={()=>pvp()}><GameIcon name="melee"/><strong>Casual</strong><span>Prueba tu estrategia.</span><small>Sin puntos de rango</small><b>Jugar <GameIcon name="move"/></b></button></div>
 <div className="m2-section-heading"><h2>Tu siguiente paso</h2></div><button className="m2-collection-link" onClick={()=>navigatePlay('cards')}><GameIcon name="deck"/><span><strong>Prepara tu mazo</strong><small>Tus cartas. Tu estrategia.</small></span><GameIcon name="move"/></button>
 {account.status!=='READY'&&<p className="m2-guest">Progreso guardado en este dispositivo. <button onClick={()=>openAccountView('ENTRY')}>Cuenta y sincronización</button></p>}
 
 </section>;
}
