import{it,expect}from'vitest';
import{DEFAULT_CONTENT,DECK_RULES,fallbackDiscardUid}from'../src/game';
import{createDuel,applyDuel}from'../src/game/pvp/duel';
import{validateDeck}from'../src/game/collection/deck-rules';
import{planBot,botObservation}from'../src/game/ai/ranked-bot';
import{botIdentity}from'../src/game/ai/ranked-bot-policy';
import{RevealLedger}from'../src/presentation/cards/arcaneReveal';
it('real bot decisions emit one eligible Ultra presentation without changing authoritative damage',()=>{
 const ids=['absolute_zero','absolute_zero','eternal_winter_heart','storm_crown','storm_crown','arcane_confluence','arcane_confluence',...Array(3).fill('barrier'),...Array(3).fill('glacial_field'),...Array(3).fill('sudden_frost'),...Array(3).fill('frozen_step'),...Array(3).fill('phase_step'),...Array(3).fill('blink'),...Array(2).fill('arcane_skating'),...Array(2).fill('permafrost'),'winter_call'];
 const deck=Object.entries(ids.reduce((a:Record<string,number>,id)=>(a[id]=(a[id]??0)+1,a),{})).map(([cardId,count])=>({cardId,count}));
 expect(validateDeck(deck,'mage',()=>3,DEFAULT_CONTENT,DECK_RULES)).toEqual([]);
 const load={heroId:'mage',cards:deck};let ultras=0;
 for(const seed of[17,37,59]){let s=createDuel([load,load],seed),lastTurn=-1,actions=0;const ledgers=[new RevealLedger(),new RevealLedger()];
  for(let n=0;n<160&&!s.outcome;n++){const seat=s.duel!.active;if(lastTurn!==s.duel!.turns){lastTurn=s.duel!.turns;actions=0;}const end={type:'END_TURN' as const,discardUid:fallbackDiscardUid(s)??undefined};const p=actions++>12?{command:end}:planBot(botObservation(s,seat,DEFAULT_CONTENT),DEFAULT_CONTENT,{...botIdentity('ultra-qa',0,seed,0),heroId:'mage',level:3,seed:seed+n*113},{clock:()=>0,maxNodes:256});const result=applyDuel(s,p.command),before=JSON.stringify(result.state);const count=result.events.filter(e=>e.type==='CARD_PLAYED'&&DEFAULT_CONTENT.cards[e.cardId]?.rarity==='ULTRA').length;
   for(let viewer=0;viewer<2;viewer++){const batch={key:`bot:${seed}:${n}`,live:true};expect(ledgers[viewer]!.claim(result.events,id=>DEFAULT_CONTENT.cards[id],batch,false,'full').size).toBe(count);expect(ledgers[viewer]!.claim(result.events,id=>DEFAULT_CONTENT.cards[id],batch,false,'full').size).toBe(0);}
   expect(JSON.stringify(result.state)).toBe(before);for(const e of result.events)if(e.type==='UNIT_DAMAGED'){const target=result.state.units.find(u=>u.id===e.unitId);if(target&&result.events.filter(x=>x.type==='UNIT_DAMAGED'&&x.unitId===e.unitId).at(-1)===e)expect(target.hp).toBe(e.hpAfter);}s=result.state;ultras+=count;if(ultras>0)break;
  }if(ultras>0)break;
 }
 expect(ultras).toBeGreaterThan(0);
},30000);
