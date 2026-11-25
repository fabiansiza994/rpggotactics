import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {handle as oldHandle} from './fixtures/pre-winter-handler.js';
import {DEFAULT_CONTENT as OLD_CONTENT} from './fixtures/pre-winter-handler.js';
import {DEFAULT_CONTENT,createProfile} from '../src/game';
import {createPlayer} from './fixtures/pre-winter-handler.js';
import {loadWinterPlayer,publicLegacyCampaigns} from '../server/src/winterCampaign';
import {memoryD1,addAccount} from './support/d1';
it('must not enroll an encounter committed after cutover by an old request waiting for its body',async()=>{
 const db=memoryD1({legacyProfiles:true,storyTransition:false}),a=addAccount(db,'late-admission-fictional');
 await createPlayer(db,a.id,'late-admission-fictional',createProfile(DEFAULT_CONTENT),[],{source:'STARTER',importedAt:null,now:500});
 let entered!:()=>void,release!:(s:string)=>void;
 const reading=new Promise<void>(r=>entered=r),body=new Promise<string>(r=>release=r);
 const req=new Request('https://qa.local/api/tactics/campaign/start',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:'{}'});
 Object.defineProperty(req,'text',{value:()=>{entered();return body;}});
 const pending=oldHandle(req,{DB:db},{content:OLD_CONTENT,now:()=>1000,seed:()=>912});
 await reading;
 db.sql.exec(readFileSync(new URL('../server/migrations/0035_tactics_story_transition.sql',import.meta.url),'utf8'));
 const atCut=(await loadWinterPlayer(db,a.id,DEFAULT_CONTENT))!;
 expect(atCut.runs.mage??null).toBeNull();
 expect(publicLegacyCampaigns(atCut)).toEqual({});
 release(JSON.stringify({heroId:'mage',campaignId:'ascent'}));
 const response=await pending;
 expect(response.status).toBe(500); // The pinned old handler maps the trigger abort to its existing generic error.
 const after=(await loadWinterPlayer(db,a.id,DEFAULT_CONTENT))!;
 expect(after.runs.mage??null).toBeNull();
 expect(Object.keys(publicLegacyCampaigns(after)),'No encounter existed at cutover; old request-start time must not confer eligibility').toEqual([]);
});
