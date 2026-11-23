import {it,expect} from 'vitest';
import {MARKET_BOX_ULTRAS} from '../src/game/data/market-box-cards';
import {withArcher} from '../src/game/data/archer';
import {DEFAULT_CONTENT} from '../src/game';
import {makeEngine,mutable,setHand,ctxFor} from './helpers';
import {resolveGlyphs} from '../src/game/domain/combat/glyphs';
import {spawnSummon} from '../src/game/domain/summons/summons';
const content=withArcher(DEFAULT_CONTENT);
for(const card of MARKET_BOX_ULTRAS)it(`${card.id}: resolves its bounded existing effects without extra actions`,()=>{
 const e=makeEngine({hero:{heroId:card.heroId!,pos:{x:0,y:2}},enemies:[{id:'enemy',enemyId:'orc_warrior',pos:{x:2,y:2}}]},content);const s=mutable(e),hero=s.units.find(u=>u.id===s.player.heroId)!,enemy=s.units.find(u=>u.id==='enemy')!;hero.hp-=4;enemy.armor=0;
 setHand(e,[card.id]);s.player.energy=10;s.player.maxEnergy=10;const beforeHP=enemy.hp;
 let summon:typeof hero|undefined;if(card.id==='pack_concord'){summon=spawnSummon(ctxFor(e,[]),hero,'chicken',{x:1,y:2})??undefined;if(summon)summon.hp=Math.max(1,summon.hp-2);}
 const r=e.dispatch({type:'PLAY_CARD',cardUid:`test-${card.id}-0`,target:card.targeting.type==='SELF'?null:enemy.pos});expect(r.ok).toBe(true);expect(e.state.player.energy).toBe(10-card.cost);expect(e.state.player.discard.some(c=>c.cardId===card.id)).toBe(true);
 const heroAfter=e.state.units.find(u=>u.id===hero.id)!,enemyAfter=e.state.units.find(u=>u.id===enemy.id)!;
 if(card.id==='eternal_winter_heart'){expect(enemyAfter.hp).toBe(beforeHP);expect(e.state.glyphs?.[0]?.winterHeart?.phase).toBe(1);}
 if(card.id==='storm_crown'){expect(enemyAfter.hp).toBe(beforeHP-3);expect(enemyAfter.statuses.some(x=>x.id==='SLOWED')).toBe(true);}
 if(card.id==='pack_concord'){expect(summon).toBeDefined();expect(e.state.units.find(u=>u.id===summon!.id)!.shield).toBe(3);}
 if(card.id==='oath_of_steel'){expect(heroAfter.momentum!.value).toBe(1);expect(heroAfter.shield).toBe(4);}
 if(card.id==='hunters_patience'){expect(heroAfter.focus!.value).toBe(1);expect(heroAfter.shield).toBe(2);}
});
it('winter heart delays five damage regardless of ICE, without extending terrain',()=>{
 const e=makeEngine({enemies:[{id:'enemy',enemyId:'orc_warrior',pos:{x:2,y:2}}]},content),s=mutable(e);setHand(e,['eternal_winter_heart']);s.player.energy=10;const enemy=s.units.find(u=>u.id==='enemy')!;enemy.armor=0;s.board.tiles[2*s.board.width+2]!.terrain='ICE';const hp=enemy.hp;
 expect(e.dispatch({type:'PLAY_CARD',cardUid:'test-eternal_winter_heart-0',target:enemy.pos}).ok).toBe(true);expect(e.state.units.find(u=>u.id===enemy.id)!.hp).toBe(hp);for(let i=0;i<2;i++){mutable(e).round++;resolveGlyphs(ctxFor(e),'PLAYER');}expect(e.state.units.find(u=>u.id===enemy.id)!.hp).toBe(hp-5);expect(s.board.tiles[2*s.board.width+2]!.terrain).toBe('ICE');
});
