import type {GameEvent} from '../src/game/domain/events';
import {makeEngine,mutable,ctxFor,p} from './helpers';
import {actSummons,spawnSummon} from '../src/game/domain/summons/summons';
import {describe,it,expect} from 'vitest';
import {CONTENT_RELEASE,LEGACY_CONTENT_RELEASE,supportsRoomRelease,roomConnectionRelease} from '../src/game/pvp/content-release';
import {contentTransition} from '../server/src/contentTransition';
import {createDuel,validateLoadout,applyDuel} from '../src/game/pvp/duel';
import {createProfile,DEFAULT_CONTENT} from '../src/game';
import {beastsEnabled} from '../src/game/domain/combat/beasts-release';
import {memoryD1} from './support/d1';
import {compatibleReadySeats} from '../server/src/pvp';

describe('Bestiary content release and non-destructive drain',()=>{
 it('only two updated seats can start; bots share the same required marker',()=>{
  expect(compatibleReadySeats([{clientRelease:CONTENT_RELEASE},{clientRelease:CONTENT_RELEASE}])).toBe(true);
  expect(compatibleReadySeats([{clientRelease:CONTENT_RELEASE},{clientRelease:LEGACY_CONTENT_RELEASE}])).toBe(false);
  expect(supportsRoomRelease(LEGACY_CONTENT_RELEASE,CONTENT_RELEASE)).toBe(false);
  expect(supportsRoomRelease(CONTENT_RELEASE,LEGACY_CONTENT_RELEASE)).toBe(true);
 });
 it('old persisted games remain legacy through serialization and subsequent turns',()=>{
  const profile=createProfile(DEFAULT_CONTENT);let state=createDuel([validateLoadout(profile,'mage'),validateLoadout(profile,'summoner')],7);
  expect(beastsEnabled(state)).toBe(true);delete state.duel!.beastsRelease;
  state=JSON.parse(JSON.stringify(state));expect(beastsEnabled(state)).toBe(false);
  state=applyDuel(state,{type:'END_TURN'}).state;expect(beastsEnabled(state)).toBe(false);
 });
 it('drain blocks admissions including automatic bot polling, but not existing game recovery or exit',()=>{
  const db=memoryD1();try{const env={DB:db,CONTENT_RELEASE_DRAIN:'1',RELEASE2_CLIENT_REQUIRED:'1'};
   for(const path of ['pvp/create','pvp/join','pvp/ready','pvp/rematch','ranked/queue','ranked/bot']){
    expect(contentTransition(new Request(`https://qa/api/tactics/${path}?clientRelease=${CONTENT_RELEASE}`),env)?.status).toBe(503);
   }
   for(const release of [CONTENT_RELEASE,LEGACY_CONTENT_RELEASE])for(const path of ['pvp/connect','pvp/socket','pvp/active','pvp/state','pvp/leave']){
    expect(contentTransition(new Request(`https://qa/api/tactics/${path}?clientRelease=${release}`),env)).toBeNull();
   }
   expect(contentTransition(new Request(`https://qa/api/tactics/pvp/ready?clientRelease=${LEGACY_CONTENT_RELEASE}`),{...env,CONTENT_RELEASE_DRAIN:'0'})?.status).toBe(426);
  }finally{db.sql.close();}
 });
});

describe('Legacy persisted rooms keep the previous summon actions',()=>{
 it.each(['wolf','turtle','raven'])('%s cannot emit new beast states/events in an old room',species=>{
  const engine=makeEngine({hero:{heroId:'summoner',pos:p(0,0)}}),state=mutable(engine),events:GameEvent[]=[],ctx=ctxFor(engine,events);
  const hero=state.units[0]!,prey=state.units.find(u=>u.id==='orc-1')!;prey.pos=p(4,2);prey.hp=5;prey.maxHp=40;
  const summon=spawnSummon(ctx,hero,species,p(3,2))!;state.round=summon.summon!.readyRound;
  state.duel={champions:[hero.id,prey.id],active:0,other:structuredClone(state.player),turns:0};
  actSummons(ctx);expect(prey.statuses).toEqual([]);expect(state.lifeFeathers??[]).toEqual([]);
  expect(events.some(e=>['WOLF_PURSUIT','RAVEN_SCAVENGER','LIFE_FEATHER_CREATED'].includes(e.type))).toBe(false);
  if(species==='raven')expect(prey.hp).toBe(4);
 });
});

it('negotiates the persisted room marker, including the previous Worker response',()=>{
 expect(roomConnectionRelease(undefined)).toBe(LEGACY_CONTENT_RELEASE);
 expect(roomConnectionRelease(LEGACY_CONTENT_RELEASE)).toBe(LEGACY_CONTENT_RELEASE);
 expect(roomConnectionRelease(CONTENT_RELEASE)).toBe(CONTENT_RELEASE);
 expect(()=>roomConnectionRelease('future-release')).toThrow('CLIENT_UPDATE_REQUIRED');
});
