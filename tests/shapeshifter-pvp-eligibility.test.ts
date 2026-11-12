import { DEFAULT_CONTENT } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { describe, expect, it } from 'vitest';
import { handle } from '../server/src/index';
import { serverLoadout, PVP_CONTENT } from '../server/src/pvp';
import { memoryD1, addAccount } from './support/d1';
import { createProfile } from '../src/game';
import { createDuel, applyDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { pvpChampionRestriction } from '../src/presentation/pvp/eligibility';

const flags = { WARRIOR_ENABLED:'1', ARCHER_ENABLED:'1', SHAPESHIFTER_ENABLED:'1' };
describe('released champions share PvP eligibility',()=>{
 it.each(['mage','summoner','warrior','shapeshifter','archer'])('%s has a valid authoritative loadout and no obsolete UI restriction',async heroId=>{
  const db=memoryD1({legacyProfiles:true});try{
   const a=addAccount(db,'tactics_qa_a'), env={DB:db,...flags};
   await handle(new Request('http://localhost/api/tactics/profile',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:'{}'}),env);
   if(heroId==='warrior')db.sql.prepare('UPDATE tactics_profiles SET campaign_best = 6 WHERE user_id = ?').run(a.id);
   if(['warrior','shapeshifter'].includes(heroId))await handle(new Request('http://localhost/api/tactics/champions/unlock',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({heroId})}),env);
   const result=await serverLoadout(env,{userId:a.id,username:'tactics_qa_a'},heroId);
   expect(result instanceof Response ? await result.text():result.loadout.heroId).toBe(heroId);
   expect(pvpChampionRestriction(heroId)).toBeUndefined();
   if(heroId==='shapeshifter')expect((await serverLoadout({...env,SHAPESHIFTER_ENABLED:'0'},{userId:a.id,username:'tactics_qa_a'},heroId)) instanceof Response).toBe(true);
  }finally{db.sql.close();}
 });
 it.each(['mage','summoner','warrior','shapeshifter'])('bear and minotaur survive deterministic replay and both seat views versus %s',opponent=>{
  const profile=createProfile(PVP_CONTENT);
  let state=createDuel([validateLoadout(profile,'shapeshifter',PVP_CONTENT),validateLoadout(profile,opponent,PVP_CONTENT)],42,'DUEL','classic',PVP_CONTENT,true);
  if(state.player.heroId!==state.duel!.champions[0])state=applyDuel(state,{type:'END_TURN'},PVP_CONTENT).state;
  for(const [cardId,form] of [['qa_bear_form','bear'],['qa_minotaur_form','minotaur']]){
   state.player.energy=10;state.player.hand=[{uid:'form',cardId:cardId!}];
   const command={type:'PLAY_CARD' as const,cardUid:'form',target:null};
   const result=applyDuel(state,command,PVP_CONTENT);
   expect(result).toEqual(applyDuel(JSON.parse(JSON.stringify(state)),command,PVP_CONTENT));state=result.state;
   expect(state.units.find(u=>u.id===state.player.heroId)!.activeForm).toBe(form);
   for(const seat of [0,1] as const)expect(duelView(state,seat,PVP_CONTENT).units.find(u=>u.id===state.player.heroId)!.activeForm).toBe(form);
  }
 });
});

// Release boundary: these local expansions must never ride along with the eligibility fix.
it('preserves Release 1 and excludes pending Nature expansion',()=>{
 const excluded=['grasping_roots','venom_thorns','vital_sap','entangled_forest','rebirth_bloom'];
 for(const id of excluded)expect(PVP_CONTENT.cards[id]).toBeUndefined();
 expect(PVP_CONTENT.cards.arcane_surge!.heroId).toBe('mage');
 expect(PVP_CONTENT.qaCombatDepth).toBeUndefined();
});
it('unlocked availability does not grant a locked account or a foreign deck access',async()=>{
 const db=memoryD1({legacyProfiles:true});try{
  const a=addAccount(db,'tactics_qa_a'),env={DB:db,...flags};
  const request=(path:string,body:unknown)=>handle(new Request('http://localhost/api/tactics/'+path,{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
  await request('profile',{});
  const locked=await serverLoadout(env,{userId:a.id,username:'tactics_qa_a'},'shapeshifter');expect(locked).toBeInstanceOf(Response);expect((locked as Response).status).toBe(403);
  await request('champions/unlock',{heroId:'shapeshifter'});
  await expect(serverLoadout(env,{userId:a.id,username:'tactics_qa_a'},'not-released')).rejects.toThrow('Unknown hero definition');
  const foreign=await serverLoadout(env,{userId:a.id,username:'tactics_qa_a'},'shapeshifter','foreign-deck');expect(foreign).toBeInstanceOf(Response);expect((foreign as Response).status).toBe(404);
 }finally{db.sql.close();}
});

it('the release adapter preserves every already-published non-Shapeshifter card and champion',()=>{
 const published=withArcher(DEFAULT_CONTENT);
 for(const [id,card] of Object.entries(published.cards))if(card.heroId!=='shapeshifter')expect(PVP_CONTENT.cards[id]).toEqual(card);
 for(const [id,hero] of Object.entries(published.heroes))if(id!=='shapeshifter')expect(PVP_CONTENT.heroes[id]).toEqual(hero);
 for(const [id,status] of Object.entries(published.statuses))expect(PVP_CONTENT.statuses[id as keyof typeof published.statuses]).toEqual(status);
 expect(PVP_CONTENT.defaultHeroId).toBe(published.defaultHeroId);
});
