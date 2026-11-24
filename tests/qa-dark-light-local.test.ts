import {it,expect} from 'vitest';
import {writeFileSync,readFileSync} from 'node:fs';
import {memoryD1,addAccount} from './support/d1';
import {handle} from '../server/src/index';
import {DEFAULT_CONTENT,DECK_RULES,copyLimit,validateDeck} from '../src/game';
import {PVP_CONTENT} from '../server/src/pvp';
import {DARK_LIGHT_CARDS} from '../src/game/data/dark-light';
import type {Env} from '../server/src/db';
it('prepares isolated fictional accounts and legal owned40 for real local WebSockets',async()=>{
 const db=memoryD1({legacyProfiles:true});for(const file of ['0004_pvp.sql','0005_pvp_dominion.sql','0006_pvp_maps.sql','0009_tactics_social.sql','0010_pvp_room_started.sql','0019_tactics_pvp_history.sql','0030_tactics_ranked_bots.sql'])db.sql.exec(readFileSync(new URL('../server/migrations/'+file,import.meta.url),'utf8'));
 const cards:{cardId:string,count:number}[]=[];
 for(const id of ['dark_silence_seal','dark_twisted_curse','fireball','arcane_surge','light_second_chance','light_destiny_rebirth'])cards.push({cardId:id,count:2});
 for(const c of Object.values(PVP_CONTENT.cards).filter(c=>c.heroId==='mage'&&!c.expansion&&!c.unique&&!cards.some(e=>e.cardId===c.id)).sort((a,b)=>a.cost-b.cost||a.id.localeCompare(b.id))){const count=Math.min(copyLimit(c,DECK_RULES),40-cards.reduce((n,e)=>n+e.count,0));if(count>0)cards.push({cardId:c.id,count});}
 expect(validateDeck(cards,'mage',()=>100,PVP_CONTENT,DECK_RULES)).toEqual([]);expect(cards.reduce((n,e)=>n+e.count,0)).toBe(40);
 const accounts=[];
 for(const username of ['dark_light_local_a','dark_light_local_b']){
  const account=addAccount(db,username);const env={DB:db,FREE_CATALOG_ENABLED:'1',SHAPESHIFTER_ENABLED:'1',SUMMONER_RITUALS_ENABLED:'1',TACTICAL_CARDS_ENABLED:'1',ARSENAL_CARDS_ENABLED:'1'} as Env;
  const res=await handle(new Request('https://local/api/tactics/profile',{method:'POST',headers:{Authorization:'Bearer '+account.token,'Content-Type':'application/json'},body:'{}'}),env,{content:DEFAULT_CONTENT,now:()=>Date.now(),seed:()=>7});expect(res.status).toBe(200);
  // TEST-ONLY fixture ownership in in-memory SQLite. No user or remote DB is accessed.
  for(const e of [...cards,...DARK_LIGHT_CARDS.map(c=>({cardId:c.id,count:2}))]){const c=PVP_CONTENT.cards[e.cardId]!;db.sql.prepare("INSERT INTO tactics_player_cards(user_id,hero_id,card_id,copies,acquired,source,unlocked_at) VALUES(?,?,?,?,0,'LOCAL_IMPORT',0) ON CONFLICT(user_id,hero_id,card_id) DO UPDATE SET copies=MAX(copies,excluded.copies)").run(account.id,c.heroId??'*',c.id,e.count);}
  // Leave historical defaults alone; the real deck API will save a new QA deck on startup.
  accounts.push({username,token:account.token});
 }
 const quote=(v:unknown)=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const objects=db.sql.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all();let dump='PRAGMA foreign_keys=OFF;\n';for(const o of objects)dump+=o.sql+';\n';for(const o of objects.filter(o=>o.type==='table'))for(const row of db.sql.prepare('SELECT * FROM "'+o.name+'"').all())dump+='INSERT INTO "'+o.name+'" VALUES('+Object.values(row).map(quote).join(',')+');\n';
 writeFileSync('qa/dark-light-functional-20261123/local-fixture.sql',dump);writeFileSync('qa/dark-light-functional-20261123/local-accounts.json',JSON.stringify(accounts));writeFileSync('qa/dark-light-functional-20261123/local-deck.json',JSON.stringify(cards));db.sql.close();
});
