import {expect,it,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {DEFAULT_CONTENT,copyLimit,validateDeck,DECK_RULES} from '../src/game';
import {PVP_CONTENT} from '../server/src/pvp';
import {rankedBotCatalog} from '../server/src/rankedBotCatalog';
import {playableBotChampions,BOT_CHAMPION_SUPPORT} from '../server/src/botChampions';
import {botStarterDeck} from '../src/game/ai/ranked-bot-deck';
import {memoryD1,addAccount} from './support/d1';
import {handle} from '../server/src/index';
import type {Env} from '../server/src/db';
const flags={RANKED_BOTS_ENABLED:'1',RANKED_PRESEASON_ENABLED:'1',SHAPESHIFTER_ENABLED:'1',FREE_CATALOG_ENABLED:'1',SUMMONER_RITUALS_ENABLED:'1',TACTICAL_CARDS_ENABLED:'1',ARSENAL_CARDS_ENABLED:'1'};
it('proves the deployed 30-card gate hides all bots while their actual 40-card decks are legal',()=>{
 const env=flags as Env,c=rankedBotCatalog(PVP_CONTENT,env);
 const before=BOT_CHAMPION_SUPPORT.filter(id=>!validateDeck(c.heroes[id]!.deck,id,k=>c.cards[k]?copyLimit(c.cards[k]!,DECK_RULES):0,c,DECK_RULES).length);
 expect(BOT_CHAMPION_SUPPORT.filter(id=>!validateDeck(c.heroes[id]!.deck,id,k=>c.cards[k]?copyLimit(c.cards[k]!,DECK_RULES):0,c,{...DECK_RULES,requiredSize:30,legacySize:20}).length)).toEqual(['mage','summoner','shapeshifter']);expect(before).toEqual([]);expect(playableBotChampions(env,PVP_CONTENT)).toEqual(['mage','summoner','shapeshifter']);
 for(const id of BOT_CHAMPION_SUPPORT){expect(c.heroes[id]!.deck.reduce((n,e)=>n+e.count,0)).toBe(30);const d=botStarterDeck(c,id);expect(d.reduce((n,e)=>n+e.count,0)).toBe(40);expect(validateDeck(d,id,k=>c.cards[k]?copyLimit(c.cards[k]!,DECK_RULES):0,c,DECK_RULES)).toEqual([]);}
 const mageIds=new Set(c.heroes.mage!.deck.map(e=>e.cardId));const limited={...PVP_CONTENT,cards:Object.fromEntries(Object.entries(PVP_CONTENT.cards).filter(([id,card])=>card.heroId!=='mage'||mageIds.has(id)))};
 expect(playableBotChampions(env,limited)).toContain('mage'); // Neutral copies can now fill the legal40 deck.
});
it('prepares fictitious local accounts and isolated SQLite schema for real local WebSocket QA',async()=>{
 const db=memoryD1();for(const f of ['0004_pvp.sql','0005_pvp_dominion.sql','0006_pvp_maps.sql','0009_tactics_social.sql','0010_pvp_room_started.sql','0019_tactics_pvp_history.sql','0030_tactics_ranked_bots.sql'])db.sql.exec(readFileSync(new URL('../server/migrations/'+f,import.meta.url),'utf8'));
 const accounts=[];for(const name of ['bots40_local_a','bots40_local_b']){const a=addAccount(db,name);const res=await handle(new Request('https://local/api/tactics/profile',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:'{}'}),{DB:db,...flags} as Env,{content:DEFAULT_CONTENT,now:()=>Date.now(),seed:()=>7});expect(res.status).toBe(200);accounts.push({username:name,token:a.token});}
 const quote=(v:unknown)=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const objects=db.sql.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all();let dump='PRAGMA foreign_keys=OFF;\n';for(const o of objects)dump+=o.sql+';\n';
 for(const o of objects.filter(o=>o.type==='table')){const rows=db.sql.prepare('SELECT * FROM "'+o.name+'"').all();for(const row of rows)dump+='INSERT INTO "'+o.name+'" VALUES('+Object.values(row).map(quote).join(',')+');\n';}
 mkdirSync('qa/ranked-bots-hotfix-20261123',{recursive:true});writeFileSync('qa/ranked-bots-hotfix-20261123/local-fixture.sql',dump);writeFileSync('qa/ranked-bots-hotfix-20261123/local-accounts.json',JSON.stringify(accounts));db.sql.close();
});

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RankedPanel} from '../src/presentation/ranked/RankedViews';
import {botIdentity} from '../src/game/ai/ranked-bot-policy';
import type {RankedQueueState} from '../src/presentation/ranked/rankedApi';
it('renders neutral automatic search without IA confirmation even for a cached offer',()=>{
 const profile={enabled:true as const,rp:0,wins:0,losses:0,draws:0,milestones:[],queue:{state:'IDLE' as const}};
 const queue:RankedQueueState={state:'SEARCHING',heroId:'mage',since:Date.now(),botOffer:{identity:botIdentity('ui',0,7),rewards:{rpDelta:10,xp:22,lossRp:0,abandonRp:0,lossXp:15,restrictions:[]}}};
 const props={profile,queue,busy:false,error:'',blocked:null,championName:'Mago',onSearch:()=>{},onCancel:()=>{},onAcceptBot:()=>{}};
 const offered=renderToStaticMarkup(createElement(RankedPanel,props));expect(offered).not.toContain('Aceptar rival IA');expect(offered).not.toContain('Seguir buscando rival humano');expect(offered).toContain('Buscando rival');
 expect(renderToStaticMarkup(createElement(RankedPanel,{...props,queue:{state:'SEARCHING',heroId:'mage',since:Date.now()}}))).not.toContain('Aceptar rival IA');
 expect(renderToStaticMarkup(createElement(RankedPanel,{...props,queue:{state:'MATCHED',code:'ABCD1234'}}))).not.toContain('Aceptar rival IA');
});

vi.mock('../src/presentation/cloud/session',()=>({loadSession:()=>({token:'fictitious-local-only',username:'local'})}));
vi.mock('../src/presentation/cloud/http',()=>({request:vi.fn(async()=>({ok:true,data:{queue:{state:'MATCHED',code:'TEST0001'}}}))}));
import {request} from '../src/presentation/cloud/http';
import {rankedApi} from '../src/presentation/ranked/rankedApi';
it('the manual client API sends the explicit acceptance marker without changing the ticket',async()=>{
 await rankedApi.acceptBot(12345);
 expect(request).toHaveBeenCalledWith(expect.any(String),'/api/tactics/ranked/bot',expect.objectContaining({method:'POST',body:{since:12345,acceptance:'MANUAL'}}));
});
