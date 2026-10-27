import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {DEFAULT_CONTENT,DECK_RULES} from '../src/game/data';
import {UNLEASHED_HUNT,UNLEASHED_HUNT_EXPANSION,withUnleashedHuntQa} from '../src/game/data/unleashed-hunt';
import {spawnSummon,actSummons} from '../src/game/domain/summons/summons';
import {applyStatus,decrementStatuses} from '../src/game/domain/statuses/status-rules';
import {defeatUnit} from '../src/game/domain/combat/damage';
import {GameEngine} from '../src/game/engine/GameEngine';
import {replayBattle} from '../src/game/engine/replay';
import {createProfile,ownedFor} from '../src/game/collection/profile';
import {createDuel,applyDuel,duelView,validateLoadout} from '../src/game/pvp/duel';
import {premiumIdentity} from '../src/presentation/cards/premiumTreatment';
import {STATUS_LABEL} from '../src/presentation/assets/statusLabels';
import {playBattle} from './support/bot';
import {makeEngine,mutable,ctxFor,setHand,p,scenario,endTurn} from './helpers';
const setup=()=>{const e=makeEngine({layout:Array(5).fill('............'),hero:{heroId:'summoner',pos:p(0,2)},enemies:[{id:'target',enemyId:'orc_warrior',pos:p(11,2)}]});const ctx=ctxFor(e);const hero=mutable(e).units.find(u=>u.kind==='HERO')!;const summon=spawnSummon(ctx,hero,'war_drake',p(1,2))!;summon.summon!.readyRound=1;return{e,ctx,hero,summon};};
const remaining=(u:ReturnType<typeof setup>['summon'])=>u.statuses.find(s=>s.id==='UNLEASHED_HUNT')?.turnsLeft??0;
describe('Cacería Desatada',()=>{
 it('is rare cost2 one copy, released for acquisition; QA owned copy without starter change',()=>{
  expect(UNLEASHED_HUNT.cost).toBe(2);expect(UNLEASHED_HUNT.rarity).toBe('RARE');expect(DECK_RULES.maxCopiesByRarity.RARE).toBe(1);
  expect(DEFAULT_CONTENT.releasedExpansions??[]).toContain(UNLEASHED_HUNT_EXPANSION);
  const qa=withUnleashedHuntQa(DEFAULT_CONTENT);expect(qa.heroes.summoner!.deck).toEqual(DEFAULT_CONTENT.heroes.summoner!.deck);
  expect(ownedFor(createProfile(qa),'summoner',qa)('unleashed_hunt')).toBe(1);
 });
 it('accepts only own allied summons, never champions or enemies',()=>{
  const {e,hero,summon}=setup();const foe=mutable(e).units.find(u=>u.id==='target')!;foe.pos=p(2,3);
  const [uid]=setHand(e,['unleashed_hunt']);const targets=e.getValidTargets(uid!);
  expect(targets).toContainEqual(summon.pos);expect(targets).not.toContainEqual(hero.pos);expect(targets).not.toContainEqual(foe.pos);
  const before=JSON.stringify(e.state);expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:hero.pos}).ok).toBe(false);expect(JSON.stringify(e.state)).toBe(before);
  expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:summon.pos}).ok).toBe(true);
 });
 it('+2 lasts exactly3 eligible activations; skipped newborn time does not consume it',()=>{
  const {ctx,summon}=setup();applyStatus(ctx,summon,'UNLEASHED_HUNT',3,'hero');summon.summon!.readyRound=2;
  actSummons(ctx);decrementStatuses(ctx,summon);expect(remaining(summon)).toBe(3);
  for(const expected of[2,1,0]){ctx.state.round++;const x=summon.pos.x;actSummons(ctx);expect(summon.pos.x-x).toBeGreaterThanOrEqual(0);decrementStatuses(ctx,summon);expect(remaining(summon)).toBe(expected);}
 });
 it('war drake crosses 4 cells with +2 versus 2 unbuffed (base move 2), without changing damage or armor',()=>{
  const base=setup(),buff=setup();applyStatus(buff.ctx,buff.summon,'UNLEASHED_HUNT',3,buff.hero.id);
  actSummons(base.ctx);actSummons(buff.ctx);expect(base.summon.pos.x).toBe(3);expect(buff.summon.pos.x).toBe(5);
  expect(buff.summon.armor).toBe(base.summon.armor);expect(buff.ctx.content.summons!.war_drake!.damage).toBe(DEFAULT_CONTENT.summons!.war_drake!.damage);
 });
 it('prepares one +1 only after real movement ending within2; consumes then renews it, never stacks',()=>{
  const {ctx,summon,hero}=setup();const enemy=ctx.state.units.find(u=>u.id==='target')!;enemy.pos=p(6,2);applyStatus(ctx,summon,'UNLEASHED_HUNT',3,hero.id);
  actSummons(ctx);expect(summon.pos.x).toBe(4);expect(summon.statuses.filter(s=>s.id==='HUNT_PURSUIT')).toHaveLength(1);
  enemy.pos=p(10,2);ctx.state.round++;actSummons(ctx);expect(summon.pos.x).toBe(8);expect(summon.statuses.filter(s=>s.id==='HUNT_PURSUIT')).toHaveLength(1);
  ctx.state.round++;actSummons(ctx);expect(summon.statuses.some(s=>s.id==='HUNT_PURSUIT')).toBe(false);expect(remaining(summon)).toBe(0);
 });
 it('checks proximity at movement end even if the subsequent normal attack kills that enemy',()=>{
  const {ctx,summon,hero}=setup();const enemy=ctx.state.units.find(u=>u.id==='target')!;enemy.pos=p(6,2);enemy.hp=3;enemy.armor=0;
  applyStatus(ctx,summon,'UNLEASHED_HUNT',3,hero.id);actSummons(ctx);
  expect(ctx.state.units.some(u=>u.id===enemy.id)).toBe(false);expect(summon.statuses.some(s=>s.id==='HUNT_PURSUIT')).toBe(true);
 });
 it('refreshes3 without duplicating +2 or prepared +1',()=>{
  const {ctx,summon,hero}=setup();applyStatus(ctx,summon,'UNLEASHED_HUNT',1,hero.id);applyStatus(ctx,summon,'HUNT_PURSUIT',1,hero.id);applyStatus(ctx,summon,'UNLEASHED_HUNT',3,hero.id);
  expect(remaining(summon)).toBe(3);expect(summon.statuses).toHaveLength(2);
 });
 it('stunned eligible activation counts, consumes pending bonus and never generates another; death/recall leaves no state',()=>{
  const {ctx,summon,hero}=setup();applyStatus(ctx,summon,'UNLEASHED_HUNT',3,hero.id);applyStatus(ctx,summon,'HUNT_PURSUIT',1,hero.id);applyStatus(ctx,summon,'STUNNED',1,hero.id);actSummons(ctx);expect(remaining(summon)).toBe(2);expect(summon.statuses.some(s=>s.id==='HUNT_PURSUIT')).toBe(false);
  defeatUnit(ctx,summon);expect(ctx.state.units).not.toContain(summon);const replacement=spawnSummon(ctx,hero,'war_drake',p(2,2))!;expect(replacement.statuses).toEqual([]);
 });
 it('JSON restoration preserves both states and the next deterministic activation',()=>{
  const {e,ctx,summon,hero}=setup();applyStatus(ctx,summon,'UNLEASHED_HUNT',3,hero.id);applyStatus(ctx,summon,'HUNT_PURSUIT',1,hero.id);
  const restored=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);actSummons(ctx);actSummons(ctxFor(restored));expect(restored.state).toEqual(e.state);
 });
 it('accepted command replay is identical server-side',()=>{
  const sc=scenario({hero:{heroId:'summoner',pos:p(0,2)}});const content={...DEFAULT_CONTENT,heroes:{...DEFAULT_CONTENT.heroes,summoner:{...DEFAULT_CONTENT.heroes.summoner!,deck:[{cardId:'summon_chicken',count:1},{cardId:'unleashed_hunt',count:1}]}}};const e=new GameEngine(sc,content,21);const card=e.state.player.hand.find(c=>c.cardId==='summon_chicken')!;
  expect(e.dispatch({type:'PLAY_CARD',cardUid:card.uid,target:p(1,2)}).ok).toBe(true);const hunt=e.state.player.hand.find(c=>c.cardId==='unleashed_hunt')!;expect(e.dispatch({type:'PLAY_CARD',cardUid:hunt.uid,target:p(1,2)}).ok).toBe(true);expect(e.dispatch(endTurn(e)).ok).toBe(true);
  const replay=replayBattle(sc,content,21,e.history);expect(replay.rejectedAt).toBeNull();expect(replay.state).toEqual(e.state);
 });
 it('PvP snapshots for both seats retain public durations; faction swaps do not consume twice',()=>{
  const profile=createProfile(DEFAULT_CONTENT);let s=createDuel([validateLoadout(profile,'summoner'),validateLoadout(profile,'mage')],7);
  if(s.player.heroId!=='champion-a')s=applyDuel(s,{type:'END_TURN'}).state;
  const owner=s.units.find(u=>u.id===s.player.heroId)!;owner.pos=p(1,2);const ctx={state:s,content:DEFAULT_CONTENT,emit:()=>{}};const summon=spawnSummon(ctx,owner,'war_drake',p(2,2))!;summon.summon!.readyRound=s.round;applyStatus(ctx,summon,'UNLEASHED_HUNT',3,owner.id);
  s=applyDuel(s,{type:'END_TURN'}).state;expect(s.units.find(u=>u.id===summon.id)?.statuses.find(x=>x.id==='UNLEASHED_HUNT')?.turnsLeft).toBe(2);
  for(const seat of[0,1] as const)expect(duelView(s,seat).units.find(u=>u.id===summon.id)?.statuses.find(x=>x.id==='UNLEASHED_HUNT')?.turnsLeft).toBe(2);
  s=applyDuel(s,{type:'END_TURN'}).state;expect(s.units.find(u=>u.id===summon.id)?.statuses.find(x=>x.id==='UNLEASHED_HUNT')?.turnsLeft).toBe(2);
 });
 it('QA bot values sustained mobility for a distant slow drake',()=>{const {e}=setup();setHand(e,['unleashed_hunt']);playBattle(e,1);expect(e.history.some(c=>c.type==='PLAY_CARD'&&c.cardUid.includes('unleashed_hunt'))).toBe(true);});
 it('own final art, rare showcase and visible status counters are wired',()=>{
  expect(existsSync('public/art/summoner-cards/unleashed_hunt.webp')).toBe(true);expect(premiumIdentity(UNLEASHED_HUNT).treatment).toBe('showcase');expect(STATUS_LABEL.HUNT_PURSUIT).toContain('+1 MOV');expect(readFileSync('src/presentation/pixi/UnitView.ts','utf8')).toContain('Cacería +2 MOV');
 });
});
