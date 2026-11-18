import {it,expect} from 'vitest';
import {DEFAULT_CONTENT,DECK_RULES,copyLimit,validateDeck,createProfile} from '../src/game';
import {marketFixture} from './support/marketReorg';
import {makeEngine,mutable,p,setHand,ctxFor} from './helpers';
import {getValidTargets} from '../src/game/domain/cards/targeting';
import {dealDamage} from '../src/game/domain/combat/damage';
import {createDuel,validateLoadout,duelView,applyDuel} from '../src/game/pvp/duel';
const snow=DEFAULT_CONTENT.cards.snow_soldier!;
for(const n of [1,2,3])it(`snow soldier ${n} copies: shared editor and server agree`,async()=>{
 const f=await marketFixture();try{
 f.db.sql.prepare("INSERT INTO tactics_player_cards(user_id,hero_id,card_id,copies,acquired,source,unlocked_at) VALUES(?,'*','snow_soldier',3,99,'QA_LOCAL',0)").run(f.account.id);
 const profile=(await f.call('GET','/state')).data.profile,deck=profile.heroes.mage.decks.find((d:{id:string})=>d.id===profile.heroes.mage.activeDeckId);
 const cards=[...deck.cards.map((c:{cardId:string,count:number})=>c.cardId==='magic_missile'?{...c,count:c.count-n}:c).filter((c:{count:number})=>c.count>0),{cardId:'snow_soldier',count:n}];
 expect(validateDeck(cards,'mage',()=>100,DEFAULT_CONTENT,DECK_RULES).some(i=>i.code==='COPY_LIMIT')).toBe(n===3);
 const r=await f.call('PUT',`/decks/mage/${deck.id}`,{cards});expect(r.status).toBe(n===3?422:200);
 if(n<3){const saved=(await f.call('GET','/state')).data.profile.heroes.mage.decks.find((d:{id:string})=>d.id===deck.id);expect(saved.cards.find((c:{cardId:string})=>c.cardId==='snow_soldier').count).toBe(n);}
 }finally{f.db.sql.close();}});
it('only card limit changes; one active soldier and its mechanics remain',()=>{
 expect(snow).toMatchObject({id:'snow_soldier',maxCopies:2,rarity:'RARE',cost:3,effects:[{type:'SUMMON',summonId:'snow_soldier'}]});
 expect(copyLimit(DEFAULT_CONTENT.cards.avalanche!,DECK_RULES)).toBe(1);expect(copyLimit({...snow,unique:true},DECK_RULES)).toBe(1);
 const e=makeEngine();mutable(e).player.energy=30;const ids=setHand(e,['snow_soldier','snow_soldier']);expect(e.dispatch({type:'PLAY_CARD',cardUid:ids[0]!,target:p(1,2)}).ok).toBe(true);expect(e.dispatch({type:'PLAY_CARD',cardUid:ids[1]!,target:p(2,2)}).ok).toBe(false);
 const first=e.state.units.find(u=>u.defId==='snow_soldier')!;expect(first).toMatchObject({hp:5,maxHp:5,moveRange:2});dealDamage(ctxFor(e),first,5,'orc-1','PHYSICAL','DIRECT_MELEE');
 expect(e.dispatch({type:'PLAY_CARD',cardUid:ids[1]!,target:p(2,2)}).ok).toBe(true);
});
it('PvP consumes both distinct hand UIDs legally and retains them across snapshot recovery',()=>{
 const profile=createProfile(DEFAULT_CONTENT),d=createDuel([validateLoadout(profile,'mage'),validateLoadout(profile,'mage')],42);d.player.energy=30;d.player.hand=[{cardId:'snow_soldier',uid:'snow-a'},{cardId:'snow_soldier',uid:'snow-b'}];
 const targets=getValidTargets({state:d,content:DEFAULT_CONTENT,emit:()=>{}},d.units.find(u=>u.id===d.player.heroId)!,snow.targeting);
 const r=applyDuel(d,{type:'PLAY_CARD',cardUid:'snow-a',target:targets[0]!});expect(r.state.player.hand.some(c=>c.uid==='snow-a')).toBe(false);
 const first=r.state.units.find(u=>u.defId==='snow_soldier')!;dealDamage({state:r.state,content:DEFAULT_CONTENT,emit:()=>{}},first,5,r.state.units.find(u=>u.kind==='HERO'&&u.id!==r.state.player.heroId)!.id,'PHYSICAL','DIRECT_MELEE');const restored=JSON.parse(JSON.stringify(r.state));expect(duelView(restored,d.duel!.active).player.hand.some(c=>c.uid==='snow-b')).toBe(true);const second=applyDuel(restored,{type:'PLAY_CARD',cardUid:'snow-b',target:targets[0]!});expect(second.state.player.hand.some(c=>c.uid==='snow-b')).toBe(false);for(const seat of [0,1] as const)expect(duelView(second.state,seat).units.filter(u=>u.defId==='snow_soldier'&&u.hp>0)).toHaveLength(1);
});
