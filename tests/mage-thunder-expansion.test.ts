import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine } from '../src/game';
import { MAGE_THUNDER_EXPANSION } from '../src/game/data/mage-thunder-expansion';
import { MAGE_THUNDER_CORE as MAGE_NATURE_THUNDER } from '../src/game/data/mage-thunder-core';
import { applyStatus, decrementStatuses } from '../src/game/domain/statuses/status-rules';
import { attackDamage } from '../src/game/domain/combat/attack-modifiers';
import { dealDamage } from '../src/game/domain/combat/damage';
import { resolveGlyphs } from '../src/game/domain/combat/glyphs';
import { springTrap, placeTrap } from '../src/game/domain/combat/traps';
import { teleportUnit } from '../src/game/domain/combat/movement';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';
function battle() {
 const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)},enemies:[{id:'a',enemyId:'orc_warrior',pos:p(3,2)},{id:'b',enemyId:'orc_warrior',pos:p(4,2)}]});
 mutable(e).player.energy=30;for(const u of mutable(e).units){u.hp=u.maxHp=30;u.armor=0;}return e;
}
function cast(e:ReturnType<typeof battle>,id:string,target:ReturnType<typeof p>|null=null){const [cardUid]=setHand(e,[id]);return e.dispatch({type:'PLAY_CARD',cardUid:cardUid!,target});}
describe('Ten thunder additions, shared authoritative domain',()=>{
 it('exactly fifteen thunder cards; five originals retain separate definitions',()=>{
  expect(MAGE_NATURE_THUNDER.filter(c=>c.tags.includes('thunder'))).toHaveLength(5);
  expect(MAGE_THUNDER_EXPANSION).toHaveLength(10);
  expect(new Set([...MAGE_THUNDER_EXPANSION,...MAGE_NATURE_THUNDER].map(c=>c.id)).size).toBe(15);
 });
 it.each(MAGE_THUNDER_EXPANSION)('$id registered, mage-only, no free inventory grants',c=>{
  expect(DEFAULT_CONTENT.cards[c.id]).toBe(c);expect(c.heroId).toBe('mage');if(c.id==='storm_avatar')expect(c.acquisition).toEqual({source:'ENCOUNTER_REWARD',worldId:'world_3'});else expect(c.acquisition).toBeUndefined();expect(c.cost).toBeGreaterThan(0);
 });
 it.each(MAGE_THUNDER_EXPANSION)('$id resolves through actual card command',c=>{
  const e=battle();const target=c.targeting.type==='SELF'?null:c.id==='lightning_step'?p(2,1):p(3,2);
  expect(cast(e,c.id,target).ok).toBe(true);
 });
 it('pierces multiple enemies without hitting allies',()=>{const e=battle();cast(e,'fulminating_spear',p(2,2));expect(unit(e,'a').hp).toBe(28);expect(unit(e,'b').hp).toBe(28);expect(unit(e,e.heroId).hp).toBe(30);});
 it('armor responds only once and never loops counters',()=>{
  const e=battle();unit(e,'a').pos=p(2,2);cast(e,'voltaic_armor');const ctx=ctxFor(e),h=unit(e,e.heroId),a=unit(e,'a');
  applyStatus(ctx,a,'VOLTAIC_ARMOR',1,a.id);dealDamage(ctx,h,2,a.id,'PHYSICAL');expect(a.hp).toBe(29);expect(h.hp).toBe(30);
  dealDamage(ctx,h,2,a.id,'PHYSICAL');expect(a.hp).toBe(29);expect(h.statuses.some(s=>s.id==='VOLTAIC_ARMOR')).toBe(false);
 });
 it('teleport rejects occupied / out-of-range destinations and grants no MP',()=>{
  const e=battle(),mp=e.state.player.movePoints;expect(cast(e,'lightning_step',p(3,2)).ok).toBe(false);expect(cast(e,'lightning_step',p(6,4)).ok).toBe(false);
  expect(cast(e,'lightning_step',p(2,1)).ok).toBe(true);expect(e.state.player.movePoints).toBe(mp);expect(unit(e,e.heroId).pos).toEqual(p(2,1));
 });
 it('mark consumes on electrical shield contact, not physical damage',()=>{
  const e=battle();cast(e,'conductive_mark',p(3,2));let a=unit(e,'a');dealDamage(ctxFor(e),a,1,e.heroId,'PHYSICAL');expect(a.statuses.some(s=>s.id==='CONDUCTIVE_MARK')).toBe(true);
  a.shield=10;cast(e,'thunder_discharge',a.pos);a=unit(e,'a');expect(a.shield).toBe(6);expect(a.statuses.some(s=>s.id==='CONDUCTIVE_MARK')).toBe(false);
  cast(e,'thunder_discharge',a.pos);expect(unit(e,'a').shield).toBe(3);
 });
 it('mark never stacks or refreshes',()=>{const e=battle();cast(e,'conductive_mark',p(3,2));decrementStatuses(ctxFor(e),unit(e,'a'));cast(e,'conductive_mark',p(3,2));expect(unit(e,'a').statuses.filter(s=>s.id==='CONDUCTIVE_MARK')).toEqual([{id:'CONDUCTIVE_MARK',turnsLeft:1}]);});
 it.each(['storm_orb','static_field'])('%s has exactly two owner activations and replaces itself',id=>{
  const e=battle();cast(e,id,p(3,2));cast(e,id,p(3,2));const ctx=ctxFor(e);expect(e.state.glyphs).toHaveLength(1);
  resolveGlyphs(ctx,'ENEMY');expect(e.state.glyphs?.[0]?.activationsLeft).toBe(2);
  resolveGlyphs(ctx,'PLAYER');expect(unit(e,'a').hp).toBe(29);resolveGlyphs(ctx,'PLAYER');expect(unit(e,'a').hp).toBe(28);expect(e.state.glyphs).toBeUndefined();
  resolveGlyphs(ctx,'PLAYER');expect(unit(e,'a').hp).toBe(28);
 });
 it('glyphs expire even with no targets and fizzle when owner dies',()=>{
  const e=battle();cast(e,'storm_orb',p(0,0));resolveGlyphs(ctxFor(e),'PLAYER');resolveGlyphs(ctxFor(e),'PLAYER');expect(e.state.glyphs).toBeUndefined();
  cast(e,'static_field',p(3,2));mutable(e).units=mutable(e).units.filter(u=>u.id!==e.heroId);resolveGlyphs(ctxFor(e),'PLAYER');expect(unit(e,'a').hp).toBe(30);expect(e.state.glyphs).toBeUndefined();
 });
 it('hammer center receives two distinct bounded hits, neighbor only secondary',()=>{const e=battle();cast(e,'thunder_hammer',p(3,2));expect(unit(e,'a').hp).toBe(27);expect(unit(e,'b').hp).toBe(29);});
 it('frenzy grants no energy, no MP and expires after two owner ends',()=>{
  const e=battle();cast(e,'electric_frenzy');cast(e,'electric_frenzy');const h=unit(e,e.heroId),a=unit(e,'a'),ctx=ctxFor(e);expect(h.statuses.filter(s=>s.id==='ELECTRIC_FRENZY')).toHaveLength(1);
  expect(attackDamage(ctx,h,a,2)).toBe(3);expect(attackDamage(ctx,a,h,2)).toBe(3);decrementStatuses(ctx,h);decrementStatuses(ctx,h);expect(attackDamage(ctx,h,a,2)).toBe(2);
 });
 it('wall charges are one-shot, allied-safe and never root',()=>{
  const e=battle(),ctx=ctxFor(e),h=unit(e,e.heroId),a=unit(e,'a');placeTrap(ctx,h,p(2,2),'lightning_wall',2,2,'ARCANE',false);
  teleportUnit(ctx,h,p(2,2),h.id);expect(e.state.traps).toHaveLength(1);teleportUnit(ctx,h,p(1,2),h.id);
  teleportUnit(ctx,a,p(2,2),h.id);expect(a.hp).toBe(28);expect(a.statuses).toEqual([]);expect(springTrap(ctx,a)).toBe(false);
 });
 it('avatar preserves champion identity, resources and old electrical overload',()=>{
  const e=battle(),h=unit(e,e.heroId),mp=e.state.player.movePoints;cast(e,'storm_avatar');cast(e,'arcane_overload');cast(e,'thunder_discharge',p(3,2));expect(unit(e,'a').hp).toBe(25);
  cast(e,'thunder_discharge',p(3,2));expect(unit(e,'a').hp).toBe(21);expect(h.activeForm).toBeUndefined();expect(h.defId).toBe('mage');expect(e.state.player.movePoints).toBe(mp);
 });
 it.each(MAGE_THUNDER_EXPANSION)('$id deterministic after snapshot restoration',c=>{
  const e=battle();const [cardUid]=setHand(e,[c.id]);const snap=structuredClone(e.state);const restored=GameEngine.fromSnapshot(snap,e.content,e.scenario);
  const cmd={type:'PLAY_CARD' as const,cardUid:cardUid!,target:c.targeting.type==='SELF'?null:c.id==='lightning_step'?p(2,1):p(3,2)};
  expect(restored.dispatch(cmd)).toEqual(e.dispatch(cmd));expect(restored.state).toEqual(e.state);
 });
});

import { browseCollection, EMPTY_QUERY } from '../src/presentation/react/deckbuilder/collectionView';
import { cardsForHero, createProfile, DECK_RULES, ownedFor, ownedCard, rollReward } from '../src/game';
import { TEMPLE_PHASE3_ENCOUNTERS } from '../src/game/data/temple-phase3-encounters';
import { cardRecipe } from '../src/presentation/vfx/catalogRecipes';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { THUNDER_ADDITION_IDS } from '../src/presentation/vfx/thunderExpansionRecipe';
describe('Thunder acquisition, previews and persistence',()=>{
 it('all twenty nature/thunder cards remain visible locked in the Mage collection without starter edits',()=>{
  const p=createProfile(DEFAULT_CONTENT),owned=ownedFor(p,'mage',DEFAULT_CONTENT);
  const list=browseCollection(cardsForHero(DEFAULT_CONTENT,'mage'),id=>ownedCard(p,'mage',id,DEFAULT_CONTENT),{...EMPTY_QUERY,ownership:'LOCKED'}).map(c=>c.id);
  for(const c of [...MAGE_NATURE_THUNDER,...MAGE_THUNDER_EXPANSION]){expect(list).toContain(c.id);expect(owned(c.id)).toBe(0);}
 });
 it('Avatar is an authored XXX mage reward, never granted at login or selected for other champions',()=>{
  const encounter=TEMPLE_PHASE3_ENCOUNTERS.find(e=>e.id==='w3_e10')!;
  const input={content:DEFAULT_CONTENT,heroId:'mage',owned:()=>0,pity:0,rules:DECK_RULES,poolId:'BOSS' as const,seed:42,count:3,authored:encounter.rewards.cards};
  expect(rollReward(input).options).toContainEqual(expect.objectContaining({cardId:'storm_avatar',rarity:'LEGENDARY'}));
  expect(rollReward({...input,heroId:'warrior'}).options.some(o=>'cardId'in o&&o.cardId==='storm_avatar')).toBe(false);
 });
 it.each(['storm_orb','static_field'])('%s survives JSON snapshot with its remaining count',id=>{
  const e=battle();cast(e,id,p(3,2));resolveGlyphs(ctxFor(e),'PLAYER');
  const restored=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);
  resolveGlyphs(ctxFor(restored),'PLAYER');resolveGlyphs(ctxFor(e),'PLAYER');expect(restored.state).toEqual(e.state);expect(restored.state.glyphs).toBeUndefined();
 });
 it.each(MAGE_THUNDER_EXPANSION)('$id uses an on-demand electrical recipe; contacts never precede the spell impact',card=>{
  const e=battle();const result=cast(e,card.id,card.targeting.type==='SELF'?null:card.id==='lightning_step'?p(2,1):p(3,2));
  if(!result.ok)throw Error('cast rejected');
  const recipe=cardRecipe(card,result.events,e.heroId);expect(recipe.bank).toBe('thunder-premium');expect(recipe.variant).toBe(card.id);
  const timeline=compileTimeline(result.events,id=>DEFAULT_CONTENT.cards[id]!.presentation.visualKey,false);
  const impact=timeline.cues.find(c=>c.kind==='spellImpact')!.at;
  expect(timeline.cues.filter(c=>c.event.type==='UNIT_DAMAGED').every(c=>c.at>=impact)).toBe(true);
  expect(THUNDER_ADDITION_IDS).toContain(card.id);
 });
});

import { ASCENT_CAMPAIGN, replayBattle, currentEncounter, createRun } from '../src/game';
import { endTurn } from './helpers';
describe('Real campaign encounter / replay, with an explicitly equipped test deck',()=>{
 it.each(MAGE_THUNDER_EXPANSION)('$id plays in El Ascenso I and replays identical accepted commands',card=>{
  const mage=DEFAULT_CONTENT.heroes.mage!;
  const deck=mage.deck.map(c=>({...c}));deck[0]!.count--;const content={...DEFAULT_CONTENT,heroes:{...DEFAULT_CONTENT.heroes,mage:{...mage,deck:[...deck,{cardId:card.id,count:1}]}}};
  const encounter=currentEncounter(ASCENT_CAMPAIGN,createRun(ASCENT_CAMPAIGN,content,42,'mage'));
  let e:GameEngine|undefined,seed:number;
  for(seed=1;seed<100;seed++){const candidate=new GameEngine(encounter,content,seed);if(candidate.state.player.hand.some(c=>c.cardId===card.id)){e=candidate;break;}}
  expect(e).toBeDefined();const engine=e!;const uid=engine.state.player.hand.find(c=>c.cardId===card.id)!.uid;
  if(card.targeting.type!=='SELF'){
   const enemy=engine.state.units.find(u=>u.faction==='ENEMY')!;
   const moves=engine.getLegalMoves().sort((a,b)=>(Math.abs(a.pos.x-enemy.pos.x)+Math.abs(a.pos.y-enemy.pos.y))-(Math.abs(b.pos.x-enemy.pos.x)+Math.abs(b.pos.y-enemy.pos.y)));
   if(moves[0])expect(engine.dispatch({type:'MOVE_UNIT',unitId:engine.heroId,to:moves[0].pos}).ok).toBe(true);
  }
  const target=card.targeting.type==='SELF'?null:engine.getValidTargets(uid)[0];expect(target!==undefined).toBe(true);
  expect(engine.dispatch({type:'PLAY_CARD',cardUid:uid,target:target??null}).ok).toBe(true);
  if(engine.state.phase!=='ENDED')expect(engine.dispatch(endTurn(engine)).ok).toBe(true);
  const replay=replayBattle(encounter,content,seed,engine.history);expect(replay.rejectedAt).toBeNull();expect(replay.state).toEqual(engine.state);
 });
});

it('the limited Orb reaches distant diagonals that Static Field does not cover',()=>{
 const orb=battle();unit(orb,'b').pos=p(5,4);cast(orb,'storm_orb',p(3,2));resolveGlyphs(ctxFor(orb),'PLAYER');expect(unit(orb,'b').hp).toBe(29);
 const field=battle();unit(field,'b').pos=p(5,4);cast(field,'static_field',p(3,2));resolveGlyphs(ctxFor(field),'PLAYER');expect(unit(field,'b').hp).toBe(30);
});

it('Avatar and a conductive secondary target work on Chain Lightning hops without duplicating marks',()=>{
 const e=battle();cast(e,'conductive_mark',p(4,2));cast(e,'storm_avatar');cast(e,'chain_lightning',p(3,2));
 expect(unit(e,'a').hp).toBe(27);expect(unit(e,'b').hp).toBe(27);expect(unit(e,'b').statuses.some(s=>s.id==='CONDUCTIVE_MARK')).toBe(false);
 cast(e,'chain_lightning',p(3,2));expect(unit(e,'a').hp).toBe(24);expect(unit(e,'b').hp).toBe(25);
});
