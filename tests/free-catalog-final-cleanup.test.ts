import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, type GameState } from '../src/game';
import { BASTION_CASES, bastionFixture, golemFixture } from '../src/presentation/qa/freeCatalog/finalCleanupFixtures';
import { CHARACTER_ANIMATIONS, clipOffset } from '../src/presentation/pixi/characterAnimations';

describe('final local QA arrangements use existing rules',()=>{
 it.each(BASTION_CASES)('%s plays the real Bastion, including actual duel state',kind=>{
  const f=bastionFixture(kind),engine=GameEngine.fromSnapshot(f.state,DEFAULT_CONTENT,f.scenario);
  const target=engine.state.units.find(u=>u.id!==engine.heroId)!;
  for(const card of [...engine.state.player.hand]) {
   const r=engine.dispatch({type:'PLAY_CARD',cardUid:card.uid,target:card.cardId==='guard'?null:target.pos});expect(r.ok).toBe(true);
  }
  const expected={low:1,medium:4,high:6,combo:4,armor:2,pvp:4}[kind];
  expect(engine.state.units.find(u=>u.id===target.id)!.hp).toBe(30-expected);
  if(kind==='pvp')expect(engine.state.duel).toBeDefined();
  expect(engine.state.player.energy).toBe(kind==='combo'?1:2);
 });
 it('Ultra spawns own visual, serializes/restores and replays deterministically',()=>{
  const f=golemFixture();
  const engines=[0,1].map(()=>GameEngine.fromSnapshot(structuredClone(f.state),DEFAULT_CONTENT,f.scenario));
  for(const engine of engines) {
   expect(engine.dispatch({type:'PLAY_CARD',cardUid:'qa-ultra',target:{x:3,y:2}}).ok).toBe(true);
   const golem=engine.state.units.find(u=>u.defId==='pact_golem')!;expect(golem.hp).toBe(16);
   const restored=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(engine.state)) as GameState,DEFAULT_CONTENT,f.scenario);
   expect(restored.state).toEqual(engine.state);
   expect(DEFAULT_CONTENT.summons!.pact_golem!.visualKey).toBe('pact_golem');
  }
  expect(engines[0]!.state).toEqual(engines[1]!.state);
 });
 it('authored golem states and all four directions use complete dedicated cells',()=>{
  const layout=CHARACTER_ANIMATIONS.pact_golem!;expect(layout).toBeDefined();
  expect(Object.keys(layout.directionalUrls!)).toEqual(['front','back','left','right']);
  for(const motion of ['idle','walk','run','attack','hit','death','arrival'] as const){
   const clip=layout.clips[motion]!;expect(clip.count).toBeGreaterThan(motion==='hit'?0:1);
   expect(clipOffset(layout,motion,clip.count-1)).not.toBeNull();
  }
  expect(layout.clips.death!.terminal).toBe(true);
 });
});
