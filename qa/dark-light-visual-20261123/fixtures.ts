import {DEFAULT_CONTENT,GameEngine,createProfile,type GameState,type ScenarioDef,type Command} from '../../src/game';
import {withDarkLightRelease} from '../../src/game/data/dark-light';
import {withShapeshifterRelease} from '../../src/game/data/shapeshifter-release';
import {withArcher} from '../../src/game/data/archer';
import {createDuel,validateLoadout,DUEL_SCENARIO} from '../../src/game/pvp/duel';
import {applyStatus} from '../../src/game/domain/statuses/status-rules';
import {recoveryChoices} from '../../src/game/domain/cards/recovery';
import {defeatUnit} from '../../src/game/domain/combat/damage';
export const content=withDarkLightRelease(withShapeshifterRelease(withArcher(DEFAULT_CONTENT)));
export function visualFixture(cardId:string){
 const c=content.cards[cardId]!,heroId=c.heroId??'mage';
 let scenario:ScenarioDef={id:'visual-local',name:'QA local',description:'Arranged fixture',layout:['.......','.......','.......','.......','.......'],legend:{'.':{}},hero:{heroId,pos:{x:2,y:2}},structures:[],enemies:[{id:'enemy',enemyId:'orc_warrior',pos:{x:4,y:2}}],waves:[],objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42};
 let e=new GameEngine(scenario,content,42);
 if(['dark_shadow_hand','dark_profane_burial','dark_despair_tribute','dark_twisted_curse','dark_executioner_call'].includes(cardId)){
 const p=createProfile(content),l=validateLoadout(p,heroId,content),s=createDuel([l,l],47,'DUEL','classic',content);
 s.units.find(u=>u.id===s.player.heroId)!.pos={x:2,y:2};s.units.find(u=>u.id===s.duel!.other.heroId)!.pos={x:4,y:2};s.obstacles=[];
 e=GameEngine.fromSnapshot(s,content,DUEL_SCENARIO);scenario=DUEL_SCENARIO;
 }
 let s=e.state as GameState;s.player.energy=20;
 if(cardId==='light_beyond_call'){
 s.player.hand=[{uid:'dead-source',cardId:'summon_chicken'}];e.dispatch({type:'PLAY_CARD',cardUid:'dead-source',target:{x:3,y:2}});
 s=e.state as GameState;const chicken=s.units.find(u=>u.defId==='chicken');if(chicken)defeatUnit({state:s,content,emit:()=>{}},chicken);
 }
 s.player.energy=20;s.units.find(u=>u.id===s.player.heroId)!.hp-=4;
 s.player.hand=[{uid:'qa-cast',cardId},{uid:'payment',cardId:'fireball'},...(cardId==='dark_abyssal_minotaur'?[{uid:'qa-return',cardId:'wild_burst'}]:[])];
 s.player.deck=Array.from({length:8},(_,i)=>({uid:`draw-${i}`,cardId:'fireball'}));
 if(cardId!=='light_beyond_call')s.player.discard=[{uid:'grave-once',cardId:'fireball'},{uid:'grave-spent',cardId:'fireball',recoveredThisBattle:true}];
 if(cardId==='light_purifying_flash')applyStatus({state:s,content,emit:()=>{}},s.units.find(u=>u.id===s.player.heroId)!,'POISONED',3,'fixture');
 return {engine:e,scenario};
}
export function activation(e:GameEngine):Command{
 const card=e.state.player.hand.find(c=>c.uid==='qa-cast')!,def=e.content.cards[card.cardId]!;
 if(def.discardHandCost)return {type:'SEARCH_SUMMON',cardUid:card.uid,choiceUid:'payment'};
 if(def.discardSearch)return {type:'SEARCH_SUMMON',cardUid:card.uid,choiceUid:recoveryChoices(e.state,e.content)[0]?.uid??'grave-once'};
 const targets=e.getValidTargets(card.uid),target=targets.find(p=>p.x===3&&p.y===2)??targets[0]??null;
 const secondary=target&&def.targeting.type==='UNIT'&&def.targeting.adjacentStep?e.getSecondaryTargets(card.uid,target)[0]??undefined:undefined;
 return {type:'PLAY_CARD',cardUid:card.uid,target,secondary};
}
