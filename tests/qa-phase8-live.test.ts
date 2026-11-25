import {it,expect} from 'vitest';import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{GameEngine,type GameState,type GameEvent,type Command,type PlayerProfile,type Unit,ownedFor,validateDeck,DECK_RULES,copyLimit}from'../src/game';
import{PVP_CONTENT as content}from'../server/src/pvp';import{DUEL_SCENARIO}from'../src/game/pvp/duel';
type Snapshot={code:string;version:number;matchId:string;game:GameState;events:GameEvent[];result:unknown;ack?:string};
type Tape={seat:number;version:number;game:GameState;events:GameEvent[];at:number};
type CaseProof={heroes:string[];played:string[];reconnect:boolean;sharedHpAgreement:boolean;events:GameEvent['type'][]};
type Proof={scope:string;cases:CaseProof[];pass?:boolean;browserObservation?:string};
const dir='qa/dark-light-phase8-20261123/',base='http://127.0.0.1:9026';
it.skipIf(process.env.RUN_PHASE8_LIVE!=='1')('authenticated legal PvP, two browser observers, real units and reconnect',async()=>{
 const accounts=JSON.parse(readFileSync(dir+'local-accounts.json','utf8'));const starter=JSON.parse(readFileSync(dir+'starter-decks.json','utf8'));const views:Snapshot[]=[],sockets:WebSocket[]=[],ack=new Map<string,number>();const errors:string[]=[],tape:Tape[]=[],proof:Proof={scope:'LOCAL authenticated HTTP/WebSocket + real Miniflare DO; existing fictional QA inventories only',cases:[]};let seq=0;
 const sleep=(n:number)=>new Promise(r=>setTimeout(r,n));async function until(fn:()=>unknown,label:string,ms=15000){const t=Date.now();while(!fn()){if(Date.now()-t>ms)throw Error('Timeout '+label);await sleep(30);}}
 async function api(i:number,path:string,body?:unknown){const u=new URL(base+'/api/tactics/'+path);u.searchParams.set('clientRelease','dark-light-1');u.searchParams.set('botProtocol','ranked-bots-1');const r=await fetch(u,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+accounts[i].token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const j=await r.json();expect(r.status,path+' '+JSON.stringify(j)).toBe(200);return j;}
 async function connect(i:number,code:string){sockets[i]?.close();delete views[i];const ticket=await api(i,'pvp/connect',{code}),u=new URL(base.replace('http:','ws:')+'/api/tactics/pvp/socket');for(const[k,v]of Object.entries({code,ticket:ticket.ticket,clientRelease:'dark-light-1',botProtocol:'ranked-bots-1'}))u.searchParams.set(k,String(v));const ws=new WebSocket(u);sockets[i]=ws;ws.addEventListener('message',e=>{const p=JSON.parse(e.data);if(p.type==='snapshot'){views[i]=p;if(p.game)tape.push({seat:i,version:p.version,game:p.game,events:p.events,at:Date.now()});if(p.ack)ack.set(p.ack,p.version);}else if(p.type==='ack')ack.set(p.id,p.version);else if(p.type==='error')errors.push(p.message);});await new Promise<void>((r,j)=>{ws.addEventListener('open',()=>r(),{once:true});ws.addEventListener('error',()=>j(Error('Local WS connection failed')),{once:true});});await until(()=>views[i]?.code===code,'connect');}
 async function action(i:number,command:Command){const id='phase8-'+(++seq),n=errors.length;sockets[i]!.send(JSON.stringify({id,version:views[i]!.version,command}));await until(()=>ack.has(id)||errors.length>n,'action');if(errors.length>n)throw Error(errors.at(-1));await until(()=>views[i]!.version>=ack.get(id)!,'snapshot');}
 function saveProgress(v:unknown){writeFileSync(dir+'live-progress.json',JSON.stringify(v,null,2));}
 const wanted:Record<string,string[]>={summoner:['dark_serpent_king','dark_scorpion_king','light_pact_fairy','dark_the_reaper','dark_dark_world','light_light_world','light_minor_blessing'],shapeshifter:['dark_abyssal_minotaur','wild_burst','dark_dark_world','light_minor_blessing'],mage:['thunder_hammer','fireball','magic_missile','glacier_claw','barrier','dark_silence_seal','light_minor_blessing']};
 async function deck(i:number,heroId:string){const profile=(await api(i,'state')).profile as PlayerProfile;const owned=ownedFor(profile,heroId,content),map=new Map<string,number>();let left=40;
 const add=(id:string,count:number)=>{const c=content.cards[id];if(!c||(c.heroId&&c.heroId!==heroId))return;const ultras=[...map].reduce((a,[id,n])=>a+(content.cards[id]!.rarity==='ULTRA'?n:0),0);const n=Math.min(left,count,owned(id)-(map.get(id)??0),copyLimit(c,DECK_RULES)-(map.get(id)??0),c.rarity==='ULTRA'?(DECK_RULES.maxUltraCards??40)-ultras:40);if(n>0){map.set(id,(map.get(id)??0)+n);left-=n;}};
 for(const id of wanted[heroId]??[])add(id,2);for(const e of starter[heroId]??[])add(e.cardId,e.count);const cards=[...map].map(([cardId,count])=>({cardId,count}));expect(left,'legal40 fill '+heroId).toBe(0);expect(validateDeck(cards,heroId,owned,content,DECK_RULES)).toEqual([]);const d=await api(i,'decks/'+heroId,{name:'Fase8 '+heroId,cards,requestId:'phase8-'+heroId+'-v1'});return d.deckId;}
 let code='';try{
  for(let i=0;i<2;i++){const old=await api(i,'pvp/active');if(old.code)await api(i,'pvp/leave',{code:old.code});}
  for(let caseNo=Number(process.env.PHASE8_CASE_START??0);caseNo<Number(process.env.PHASE8_CASE_COUNT??2);caseNo++){
   const heroIds=[caseNo?'shapeshifter':'summoner','mage'],decks=[await deck(0,heroIds[0]!),await deck(1,'mage')];
   const room=await api(0,'pvp/create',{heroId:heroIds[0],deckId:decks[0],mode:'DUEL'});code=room.code;await api(1,'pvp/join',{code,heroId:'mage',deckId:decks[1]});await connect(0,code);await connect(1,code);
   writeFileSync(dir+'live-room.json',JSON.stringify({api:base,code,caseNo,heroes:heroIds}));saveProgress({phase:'waiting-observers',caseNo,code});if(process.env.PHASE8_TRANSPORT_ONLY!=='1')await until(()=>existsSync(dir+'live-go-'+caseNo+(process.env.PHASE8_RUN??'')),'browser go',300000);else proof.browserObservation='NOT RUN: browser control unavailable; transport only';
   for(let i=0;i<2;i++)await api(i,'pvp/ready',{code,heroId:heroIds[i],deckId:decks[i]});await until(()=>views.every(v=>v?.game),'ready');saveProgress({phase:'waiting-renderers',caseNo});if(process.env.PHASE8_TRANSPORT_ONLY!=='1')await until(()=>existsSync(dir+'live-actions-'+caseNo+(process.env.PHASE8_RUN??'')),'renderer go',300000);
   const played=new Set<string>(),caseEvents:GameEvent[]=[];let reconnect=false;
   for(let turn=0;turn<40&&!views[0]?.result;turn++){
    const i=views.findIndex(v=>v.game?.phase==='PLAYER');expect(i).toBeGreaterThanOrEqual(0);
    for(let n=0;n<3&&!views[i]!.result;n++){
     if(views[i]!.game.responseWindow){const j=1-i;await action(j,{type:'SILENCE_RESPONSE',windowId:views[j]!.game.responseWindow!.id,pass:true});await sleep(2500);continue;}
     const game=views[i]!.game as GameState,e=GameEngine.fromSnapshot(game,content,DUEL_SCENARIO);const hero=game.units.find(u=>u.id===game.player.heroId)!;
     const hand=[...game.player.hand].sort((a,b)=>{const score=(id:string)=>(played.has(id)?0:100)+(wanted[hero.defId]?.includes(id)?30:0)+(['fireball','magic_missile','qa_wild_strike'].includes(id)?10:0);return score(b.cardId)-score(a.cardId);});let chosen:Command|undefined,cardId='';
     for(const card of hand){const def=content.cards[card.cardId]!;if(!def||def.responseOnly||def.discardHandCost||def.discardSearch||!wanted[heroIds[i]!]?.includes(card.cardId)&&!['qa_wild_strike','qa_horn_strike'].includes(card.cardId))continue;
      const targets=def.targeting.type==='SELF'?[null]:e.getValidTargets(card.uid).sort((a,b)=>{const score=(p:{x:number;y:number})=>{const u=game.units.find(u=>u.pos.x===p.x&&u.pos.y===p.y);return u?.kind==='SUMMON'&&u.faction!==hero.faction?0:u?.kind==='HERO'&&u.faction!==hero.faction?1:2;};return score(a)-score(b);});
      for(const target of targets){if(e.previewCard(card.uid,target).valid){chosen={type:'PLAY_CARD',cardUid:card.uid,target,...(card.cardId==='dark_scorpion_king'?{sacrificeHp:Math.ceil(hero.hp/2)}:{})};cardId=card.cardId;break;}}if(chosen)break;
     }
     if(!chosen)break;await action(i,chosen);played.add(cardId);await sleep(350);if(views[i]!.game.responseWindow)await action(1-i,{type:'SILENCE_RESPONSE',windowId:views[1-i]!.game.responseWindow!.id,pass:true});await sleep(2400);
     if(views[i]!.game.player.pendingCardChoice){const p=views[i]!.game.player.pendingCardChoice!;await action(i,{type:'RESOLVE_CARD_CHOICE',choiceUid:p.options[0]!.uid});await sleep(2400);}
     if(!reconnect&&views[i]!.game.units.some((u:Unit)=>u.summon||u.activeForm==='dark_abyssal_minotaur')){const before=views[0]!.matchId;await connect(0,code);await connect(1,code);expect(views[0]!.matchId).toBe(before);reconnect=true;}
    }
    if(views[i]!.result)break;
    const g=views[i]!.game as GameState,engine=GameEngine.fromSnapshot(g,content,DUEL_SCENARIO),hero=g.units.find(u=>u.id===g.player.heroId)!,rival=g.units.find(u=>u.kind==='HERO'&&u.id!==hero.id)!;
    const dist=(p:{x:number;y:number})=>Math.abs(p.x-rival.pos.x)+Math.abs(p.y-rival.pos.y);const move=engine.getLegalMoves().sort((a,b)=>dist(a.pos)-dist(b.pos)).find(m=>dist(m.pos)<dist(hero.pos)&&dist(m.pos)>=2);if(move){await action(i,{type:'MOVE_UNIT',unitId:hero.id,to:move.pos});await sleep(800);}
    const current=views[i]!.game as GameState;const excess=current.player.hand.length-(current.player.handSize??current.player.maxHandSize);let discardUid:string|undefined;if(excess>0)discardUid=[...current.player.hand].sort((a,b)=>Number(wanted[heroIds[i]!]?.includes(a.cardId)&&!played.has(a.cardId))-Number(wanted[heroIds[i]!]?.includes(b.cardId)&&!played.has(b.cardId)))[0]!.uid;
    expect(excess).toBeLessThanOrEqual(1);await action(i,{type:'END_TURN',...(discardUid?{discardUid}:{})});await sleep(1600);const recent=tape.filter(t=>t.seat===0).slice(-2).flatMap(t=>t.events);caseEvents.push(...recent);saveProgress({phase:'playing',caseNo,turn,played:[...played],reconnect,version:views[0]!.version});
   }
   proof.cases.push({heroes:heroIds,played:[...played],reconnect,sharedHpAgreement:views[0]!.game.units.every((u:Unit)=>views[1]!.game.units.some((v:Unit)=>v.id===u.id&&v.hp===u.hp)),events:[...new Set(caseEvents.map(e=>e.type))]});
   if(!views[0]!.result){sockets[0]!.send(JSON.stringify({type:'surrender'}));await until(()=>views[0]!.result,'controlled QA end');}
   for(let i=0;i<2;i++){sockets[i]?.close();await api(i,'pvp/leave',{code});}code='';writeFileSync(dir+'live-pvp-tape.json',JSON.stringify(tape));writeFileSync(dir+'live-pvp-proof.json',JSON.stringify(proof,null,2));
  }
  expect(errors).toEqual([]);expect(proof.cases.every((c:CaseProof)=>c.sharedHpAgreement)).toBe(true);proof.pass=true;writeFileSync(dir+'live-pvp-proof.json',JSON.stringify(proof,null,2));saveProgress({phase:'complete',cases:proof.cases});
 }finally{for(const s of sockets)s?.close();if(code)for(let i=0;i<2;i++)await api(i,'pvp/leave',{code}).catch(()=>{});writeFileSync(dir+'live-pvp-tape.json',JSON.stringify(tape));}
},900000);
