import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { DEFAULT_CONTENT, createProfile, parseProfileSave, serializeProfile, DECK_RULES, ownedFor, deckStatus, activeDeck, heroProfile } from '../src/game';
import { ARCHER_CARDS, withArcher } from '../src/game/data/archer';
import { asNewPlayer, chooseStartingChampion, isChampionUnlocked, recordCampaignBest, pendingChampionUnlock, claimChampionUnlock } from '../src/game/collection/champion-unlocks';
import { handle } from '../server/src/index';
import { archerAllowed } from '../server/src/warriorRelease';
import { releasedContent } from '../server/src/ritualRelease';
import { PVP_CONTENT } from '../server/src/pvp';
import type { Env } from '../server/src/db';
import { memoryD1, addAccount } from './support/d1';
import { STORE_CATALOG } from '../src/game/data/store-catalog';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { validateLoadout, createDuel, applyDuel, duelView } from '../src/game/pvp/duel';
import { endTurn } from './helpers';

function dbWithPvp() {
  const db = memoryD1({ legacyProfiles: true });
  for (const file of ['0004_pvp.sql','0005_pvp_dominion.sql','0006_pvp_maps.sql','0009_tactics_social.sql','0010_pvp_room_started.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${file}`, import.meta.url),'utf8'));
  return db;
}
function api(env: Env, token: string, method: string, path: string, body?: unknown) {
  return handle(new Request(`https://api.test/api/tactics${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}

describe('Archer release preparation', () => {
  it('requires a server release flag or authenticated QA allowlist; defaults remain off', () => {
    const DB = memoryD1();
    expect(archerAllowed({DB}, 'tactics_qa_a')).toBe(false);
    expect(archerAllowed({DB, ARCHER_QA:'1'}, 'ordinary')).toBe(false);
    expect(archerAllowed({DB, ARCHER_QA:'1'}, 'tactics_qa_a')).toBe(true);
    expect(archerAllowed({DB, ARCHER_ENABLED:'1'}, 'ordinary')).toBe(true);
    expect(releasedContent(DEFAULT_CONTENT,{DB}).heroes.archer).toBeUndefined();
    expect(releasedContent(DEFAULT_CONTENT,{DB, ARCHER_QA:'1'}).heroes.archer).toBeDefined();
    expect(readFileSync('server/wrangler.toml','utf8')).toMatch(/ARCHER_ENABLED = "1"/);
  });
  it('owns a legal starter, supports existing profiles and persists without modifying Mage', () => {
    const content = withArcher(DEFAULT_CONTENT), old = createProfile(DEFAULT_CONTENT);
    const loaded = parseProfileSave(serializeProfile(old), content);
    expect(loaded.status).toBe('OK');
    if (loaded.status !== 'OK') return;
    expect(loaded.profile.heroes.mage).toEqual(old.heroes.mage);
    const h = heroProfile(loaded.profile, 'archer', content);
    expect(deckStatus(activeDeck(h).cards,'archer',ownedFor(loaded.profile,'archer',content),content,DECK_RULES).issues).toEqual([]);
    expect(activeDeck(h).cards.reduce((n,c)=>n+c.count,0)).toBe(30);
    const chosen = chooseStartingChampion(asNewPlayer(createProfile(content)), 'archer', ['mage','archer']);
    expect(chosen).toMatchObject({ok:false,error:'NOT_AVAILABLE'});
    if(chosen.ok) expect(isChampionUnlocked(chosen.profile,'archer')).toBe(true);
    expect(parseProfileSave(serializeProfile(loaded.profile),content)).toMatchObject({status:'OK',profile:loaded.profile});
  });
  it('every card uses a distinct, optimized final WebP rather than fallback SVG', () => {
    const paths = ARCHER_CARDS.map(c=>FINAL_CARD_ART[c.id]);
    expect(new Set(paths).size).toBe(9);
    for (const path of paths) {
      expect(path).toMatch(/^\/art\/archer-cards\/.*\.webp$/);
      expect(statSync(`public${path}`).size).toBeLessThan(100_000);
    }
  });
  it('server exposes the champion only to released accounts, persists decks and permits shared main acts', async () => {
    const db = dbWithPvp(), qa = addAccount(db,'tactics_qa_a'), other = addAccount(db,'ordinary');
    const env = {DB:db, ARCHER_QA:'1'};
    for (const account of [qa,other]) expect((await api(env,account.token,'POST','/profile',{})).status).toBe(200);
    const qaState = await (await api(env,qa.token,'GET','/state')).json() as {championsAvailable:string[]};
    const otherState = await (await api(env,other.token,'GET','/state')).json() as {championsAvailable:string[]};
    expect(qaState.championsAvailable).toContain('archer');
    expect(otherState.championsAvailable).not.toContain('archer');
    expect((await api(env,other.token,'PUT','/champion',{championId:'archer'})).status).toBe(403);
    expect((await api(env,qa.token,'POST','/campaign/start',{heroId:'archer'})).status).toBe(200);
    const deck = withArcher(DEFAULT_CONTENT).heroes.archer!.deck;
    expect((await api(env,qa.token,'PUT','/decks/archer/main',{cards:deck})).status).toBe(200);
    expect((await api(env,other.token,'PUT','/decks/archer/main',{cards:deck})).status).toBe(403);
    const selected = await api(env,qa.token,'PUT','/champion',{championId:'archer'});
    expect(selected.status).toBe(200);
    expect(await (await api(env,qa.token,'GET','/state')).json()).toMatchObject({profile:{selectedChampionId:'archer'}});
  });
  it.each(['mage','warrior','summoner','archer'])('authoritative room catalog supports Archer vs %s and hides opponent hands', (rival) => {
    const profile = createProfile(PVP_CONTENT);
    // Existing Warrior unlock milestone, without changing the champion's deck or stats.
    profile.champions = { mode:'LEGACY',startingChampionId:null,unlocks:[],campaignBest:6 };
    const loads = [validateLoadout(profile,'archer',PVP_CONTENT), validateLoadout(profile,rival,PVP_CONTENT)] as const;
    const initial = createDuel([...loads],13,'DUEL','classic',PVP_CONTENT);
    const result = applyDuel(initial,endTurn(initial),PVP_CONTENT);
    expect(result.state.units.filter(u=>u.kind==='HERO').map(u=>u.defId)).toEqual(['archer',rival]);
    expect(applyDuel(structuredClone(initial),endTurn(initial),PVP_CONTENT).state).toEqual(result.state);
    for(const seat of [0,1] as const) {
      const view = duelView(result.state,seat,PVP_CONTENT);
      expect(view.player.heroId).toBe(seat===0?'champion-a':'champion-b');
      expect(view.duel).toBeUndefined();
    }
  });
});

it.each(['mage','warrior','summoner','archer'])('Worker create/join/ready restores an Archer room against %s', async rival => {
  const db = dbWithPvp(), a = addAccount(db,'tactics_qa_a'), b = addAccount(db,'tactics_qa_b');
  const data = new Map<string,unknown>();
  let ready = Promise.resolve();
  const ctx = {
    storage: { get: async (key:string)=>structuredClone(data.get(key)), put: async (key:string,value:unknown)=>{ data.set(key,structuredClone(value)); }, setAlarm:async()=>{},deleteAlarm:async()=>{} },
    blockConcurrencyWhile: (fn:()=>Promise<unknown>)=>{ ready=fn().then(()=>{});return ready; },
    getWebSockets:()=>[], acceptWebSocket:()=>{},
  };
  const { PvPMatchRoom } = await import('../server/src/pvp');
  const env:Env = { DB:db, ARCHER_QA:'1', WARRIOR_ENABLED:'1' };
  let room = new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],env);
  env.PVP_ROOMS = { idFromName: (name:string)=>name, get:()=>({fetch:async(req:Request)=>{await ready;return room.fetch(req);}}) };
  for (const who of [a,b]) {
    expect((await api(env,who.token,'POST','/profile',{})).status).toBe(200);
    db.sql.prepare('UPDATE tactics_profiles SET campaign_best=6 WHERE user_id=?').run(who.id);
  }
  expect((await api({...env,ARCHER_QA:'0'},a.token,'POST','/pvp/create',{heroId:'archer'})).status).toBe(403);
  let body: {code:string};
  if (rival === 'mage') {
    expect((await api(env,a.token,'PUT','/champion',{championId:'archer'})).status).toBe(200);
    expect((await api(env,a.token,'POST','/social/requests',{username:'tactics_qa_b'})).status).toBe(200);
    expect((await api(env,b.token,'POST','/social/requests/accept',{username:'tactics_qa_a'})).status).toBe(200);
    const invitation = await api(env,a.token,'POST','/social/invites',{username:'tactics_qa_b'});
    expect(invitation.status).toBe(200);
    const {invite} = await invitation.json() as {invite:{inviteId:string}};
    const accepted = await api(env,b.token,'POST',`/social/invites/${invite.inviteId}/accept`,{});
    expect(accepted.status).toBe(200);
    body = await accepted.json() as {code:string};
  } else {
    const created = await api(env,a.token,'POST','/pvp/create',{heroId:'archer'});
    expect(created.status).toBe(200);
    body = await created.json() as {code:string};
    expect((await api(env,b.token,'POST','/pvp/join',{code:body.code,heroId:rival})).status).toBe(200);
  }
  const saved = data.get('room') as {members:{offlineAt:number|null}[]};
  saved.members.forEach(m=>m.offlineAt=null); // authenticated WS seats, as in existing room harness
  room = new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],env);
  await ready;
  expect((await api(env,a.token,'POST','/pvp/ready',{code:body.code,heroId:'archer'})).status).toBe(200);
  const joined = await api(env,b.token,'POST','/pvp/ready',{code:body.code,heroId:rival});
  expect(joined.status).toBe(200);
  expect((data.get('room') as {game:{units:{defId:string}[]}}).game.units.map(u=>u.defId)).toContain('archer');
});


describe('Archer automatic free release', () => {
  const content = withArcher(DEFAULT_CONTENT), available = ['mage','summoner','warrior','archer'];
  it('new and existing accounts own it without a grant, payment or campaign progress', () => {
    for(const profile of [asNewPlayer(createProfile(content)),createProfile(content)]) {
      expect(isChampionUnlocked(profile,'archer')).toBe(true);
      expect(profile.champions?.unlocks.some(u=>u.heroId==='archer')).not.toBe(true);
      expect(claimChampionUnlock(profile,'archer',available)).toMatchObject({ok:true,unlock:null,profile});
    }
    expect(JSON.stringify(STORE_CATALOG)).not.toContain('archer');
  });
  it('cannot replace the campaign anchor or consume a campaign milestone', () => {
    const fresh = asNewPlayer(createProfile(content));
    expect(chooseStartingChampion(fresh,'archer',available)).toMatchObject({ok:false,error:'NOT_AVAILABLE'});
    const start = chooseStartingChampion(fresh,'mage',available);
    expect(start.ok).toBe(true);
    if(!start.ok) return;
    expect(start.profile.champions?.startingChampionId).toBe('mage');
    expect(pendingChampionUnlock(recordCampaignBest(start.profile,3),available)?.options).toEqual(['summoner','warrior']);
    const second=claimChampionUnlock(recordCampaignBest(start.profile,3),'summoner',available);
    expect(second.ok).toBe(true);
    if(second.ok) expect(pendingChampionUnlock(recordCampaignBest(second.profile,6),available)?.options).toEqual(['warrior']);
  });
  it('normal new accounts receive the starter and can save/select Archer when production switch is on', async () => {
    const DB=memoryD1(), account=addAccount(DB,'fresh_archer');
    const env={DB,ARCHER_ENABLED:'1'};
    expect((await api(env,account.token,'POST','/profile',{})).status).toBe(200);
    expect((await api(env,account.token,'POST','/champions/start',{heroId:'archer'})).status).toBe(403);
    expect((await api(env,account.token,'POST','/champions/start',{heroId:'mage'})).status).toBe(200);
    expect((await api(env,account.token,'PUT','/champion',{championId:'archer'})).status).toBe(200);
    expect((await api(env,account.token,'PUT','/decks/archer/main',{cards:content.heroes.archer!.deck})).status).toBe(200);
    expect((await api(env,account.token,'POST','/campaign/start',{heroId:'archer'})).status).toBe(200);
    const denied=await api(env,account.token,'POST','/campaign/start',{heroId:'archer',campaignId:'archer_hunt'});
    expect(await denied.json()).toMatchObject({error:{code:'WORLD_LOCKED'}});
    expect((await api({...env,ARCHER_ENABLED:'0'},account.token,'PUT','/champion',{championId:'archer'})).status).not.toBe(200);
    expect((await api(env,account.token,'POST','/campaign/start',{heroId:'mage'})).status).toBe(200);
  });
});
