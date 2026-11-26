import {describe,expect,it} from 'vitest';
import {deckRoute,type DeckRouteContext} from '../server/src/decks';
import {memoryD1,addAccount} from './support/d1';
import {competitiveFixture} from './support/competitive-profile';
import {createPlayer} from '../server/src/repo';
import {DEFAULT_CONTENT} from '../src/game';
async function fixture(){const db=memoryD1({bots:true}),user=addAccount(db,'registered'),{profile,cards}=competitiveFixture();await createPlayer(db,user.id,'registered',profile,[],{source:'STARTER',importedAt:null,now:100});const ctx:DeckRouteContext={db,userId:user.id,profile,content:DEFAULT_CONTENT,now:1000,body:{cards,format:'COMPETITIVE'},usable:()=>null,reload:async()=>profile,respond:async extra=>Response.json(extra)};return {db,user,ctx};}
describe('Registered Ranked deck is stable across tabs/devices',()=>{
 it.each(['SEARCHING','MATCHED'])('blocks saving and deletion during %s, allows unrelated decks and expired tickets',async phase=>{
 const{db,user,ctx}=await fixture();
 if(phase==='MATCHED')db.sql.prepare('INSERT INTO tactics_pvp_rooms(code,player_a,created_at,expires_at) VALUES(?,?,?,?)').run('QAROOM01',user.id,500,5000);
 db.sql.prepare('INSERT INTO tactics_ranked_queue(user_id,hero_id,deck_id,joined_at,expires_at,room_code) VALUES(?,?,?,?,?,?)').run(user.id,'mage','competitive',500,5000,phase==='MATCHED'?'QAROOM01':null);
 expect((await deckRoute('PUT','/api/tactics/decks/mage/competitive',ctx))?.status).toBe(409);
 expect((await deckRoute('DELETE','/api/tactics/decks/mage/competitive',ctx))?.status).toBe(409);
 expect((await deckRoute('PUT','/api/tactics/decks/mage/main',ctx))?.status).toBe(200);
 db.sql.prepare('DELETE FROM tactics_ranked_queue WHERE user_id=?').run(user.id);
 expect((await deckRoute('PUT','/api/tactics/decks/mage/competitive',ctx))?.status).toBe(200);
 });
 it.each(['EXPIRED','FINISHED'])('permits editing after an authoritative %s room',async status=>{
 const{db,user,ctx}=await fixture();
 db.sql.prepare('INSERT INTO tactics_pvp_rooms(code,player_a,created_at,expires_at,finished_at) VALUES(?,?,?,?,?)').run('QADONE01',user.id,100,status==='EXPIRED'?500:5000,status==='FINISHED'?800:null);
 db.sql.prepare('INSERT INTO tactics_ranked_queue(user_id,hero_id,deck_id,joined_at,expires_at,room_code) VALUES(?,?,?,?,?,?)').run(user.id,'mage','competitive',100,5000,'QADONE01');
 expect((await deckRoute('PUT','/api/tactics/decks/mage/competitive',ctx))?.status).toBe(200);
 });
 it('keeps mutation guards inside the transaction when another request joins after preflight',async()=>{
 const{db,user,ctx}=await fixture();const before=db.sql.prepare('SELECT card_id,count FROM tactics_deck_cards WHERE user_id=? AND deck_id=? ORDER BY card_id').all(user.id,'competitive');ctx.body.name='Changed during race';const batch=db.batch.bind(db);let inserted=false;
 db.batch=async statements=>{if(!inserted){inserted=true;db.sql.prepare('INSERT INTO tactics_ranked_queue(user_id,hero_id,deck_id,joined_at,expires_at) VALUES(?,?,?,?,?)').run(user.id,'mage','competitive',500,5000);}return batch(statements);};
 const r=await deckRoute('PUT','/api/tactics/decks/mage/competitive',ctx);expect(r?.status).toBe(409);
 const after=db.sql.prepare('SELECT card_id,count FROM tactics_deck_cards WHERE user_id=? AND deck_id=? ORDER BY card_id').all(user.id,'competitive');
 expect(after).toEqual(before);expect(db.sql.prepare('SELECT name FROM tactics_decks WHERE user_id=? AND deck_id=?').get(user.id,'competitive')?.name).toBe('QA40');
 });
});
