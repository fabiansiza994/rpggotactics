import {describe,it,expect} from 'vitest';
import {GameEngine,DEFAULT_CONTENT} from '../src/game';
import {ctxFor,makeEngine,mutable,p,setHand,unit} from './helpers';
import {ARCHER_HUNT_CARDS} from '../src/game/data/archer-hunt';
import {ANTARCTIC_UPGRADES} from '../src/game/data/antarctic-upgrades';
import {worldFrozenCard} from '../src/game/domain/cards/world-frozen';
import {expireTurnStartStatuses,applyStatus} from '../src/game/domain/statuses/status-rules';
import {effectiveMoveRange} from '../src/game/domain/board/occupancy';
import {dealDamage} from '../src/game/domain/combat/damage';
import {snowTurnEnd} from '../src/game/domain/combat/snow';
import {createTerrain} from '../src/game/domain/terrain/terrain-rules';
import {tileAt} from '../src/game/domain/board/board';
import {loadApprovedClawAtlas,CLAW_ASSET_STATUS} from '../src/presentation/pixi/GlacierClawView';
const setup=()=>{const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)},enemies:[{id:'orc',enemyId:'orc_warrior',pos:p(3,2)}]});mutable(e).player.energy=30;unit(e,'orc').hp=unit(e,'orc').maxHp=100;return e;};
const cast=(e:GameEngine,id:string,to:ReturnType<typeof p>|null=null)=>{const [uid]=setHand(e,[id]);return e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:to});};
const restore=(e:GameEngine)=>GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);
const status=(e:GameEngine,id:string)=>unit(e,e.heroId).statuses.find(s=>s.id===id);
describe('Mundo Gélido: contrato y mejoras centralizadas',()=>{
 it('preserves ID, cost4/max2 and ten own starts without global movement penalty',()=>{let e=setup();expect(DEFAULT_CONTENT.cards.absolute_zero).toMatchObject({name:'Mundo Gélido',cost:4,maxCopies:2});expect(cast(e,'absolute_zero').ok).toBe(true);expect(status(e,'ABSOLUTE_ZERO')?.turnsLeft).toBe(10);expect(effectiveMoveRange(ctxFor(e),unit(e,'orc'),3)).toBe(3);e=restore(e);for(let i=0;i<9;i++)expireTurnStartStatuses(ctxFor(e),unit(e,e.heroId));expect(status(e,'ABSOLUTE_ZERO')?.turnsLeft).toBe(1);expireTurnStartStatuses(ctxFor(e),unit(e,e.heroId));expect(status(e,'ABSOLUTE_ZERO')).toBeUndefined();});
 it('rejects second copy before payment and never refreshes on reconnect',()=>{let e=setup();cast(e,'absolute_zero');const energy=e.state.player.energy;e=restore(e);expect(cast(e,'absolute_zero').ok).toBe(false);expect(e.state.player.energy).toBe(energy);expect(status(e,'ABSOLUTE_ZERO')?.turnsLeft).toBe(10);expect(e.state.player.hand).toHaveLength(1);});
 for(const id of Object.keys(ANTARCTIC_UPGRADES))it(`${id}: base unchanged; upgrade resolves only from owner status`,()=>{const e=setup(),card=(DEFAULT_CONTENT.cards[id]??ARCHER_HUNT_CARDS.find(c=>c.id===id))!;expect(card).toBeTruthy();expect(worldFrozenCard(card,unit(e,e.heroId))).toBe(card);cast(e,'absolute_zero');const enhanced=worldFrozenCard(card,unit(e,e.heroId));expect(enhanced.worldFrozenActive).toBe(true);expect(enhanced.rulesText).toBe(ANTARCTIC_UPGRADES[id]!.rulesText);expect(card.worldFrozenActive).toBeUndefined();});
 it('does not buff unrelated cards or terrain already present',()=>{const e=setup();createTerrain(ctxFor(e),p(2,2),'ICE',2,e.heroId);cast(e,'absolute_zero');expect(tileAt(e.state.board,p(2,2))?.terrainTurnsLeft).toBe(2);const card=DEFAULT_CONTENT.cards.blink!;expect(worldFrozenCard(card,unit(e,e.heroId))).toBe(card);});
 it('upgraded domain creates nine cells with duration5 and permafrost cap8',()=>{const e=setup();cast(e,'absolute_zero');expect(cast(e,'winter_domain').ok).toBe(true);expect(e.state.board.tiles.filter(t=>t.terrain==='ICE')).toHaveLength(9);expect(tileAt(e.state.board,p(1,2))?.terrainTurnsLeft).toBe(5);cast(e,'permafrost',p(1,2));expect(tileAt(e.state.board,p(1,2))?.terrainTurnsLeft).toBe(8);});
 it('storm applies real damage and temporary/climate-owned ICE along actual line',()=>{for(const enhanced of [false,true]){const e=setup();unit(e,'orc').armor=0;if(enhanced)cast(e,'absolute_zero');expect(cast(e,'glacial_storm',p(5,2)).ok).toBe(true);expect(unit(e,'orc').hp).toBe(enhanced?97:98);expect(tileAt(e.state.board,p(3,2))?.terrainTurnsLeft).toBe(3);expect(tileAt(e.state.board,p(3,2))?.frozenWorldOwnerId).toBe(enhanced?e.heroId:undefined);}});
});
describe('Garra: autoridad y reconstrucción',()=>{
 for(const enhanced of [false,true])it(`duration ${enhanced?3:2}, reconnect and FIRE break`,()=>{let e=setup();if(enhanced)cast(e,'absolute_zero');expect(cast(e,'glacier_claw',p(3,2)).ok).toBe(true);e=restore(e);const foe=unit(e,'orc');expect(foe.statuses.find(s=>s.id==='GLACIER_CLAW')?.turnsLeft).toBe(enhanced?3:2);dealDamage(ctxFor(e),foe,1,e.heroId,'ICE','DIRECT_RANGED');expect(foe.statuses.some(s=>s.id==='GLACIER_CLAW')).toBe(true);dealDamage(ctxFor(e),foe,1,e.heroId,'PHYSICAL','RANGED',undefined,'FIRE');expect(foe.statuses.some(s=>s.id==='GLACIER_CLAW')).toBe(false);});
 it('claw blocks movement and blink but permits defensive cards',()=>{const e=setup();applyStatus(ctxFor(e),unit(e,e.heroId),'GLACIER_CLAW',2,'orc');expect(e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:p(1,1)}).ok).toBe(false);expect(cast(e,'blink',p(1,1)).ok).toBe(false);expect(cast(e,'frost_mantle').ok).toBe(true);});
 it('unapproved animation assets fail closed without loading rejected draft',async()=>{expect(CLAW_ASSET_STATUS).toBe('CANDIDATE');expect(await loadApprovedClawAtlas('/does-not-exist.json',false)).toBeUndefined();});
});
describe('Nieve: duración, límites, acciones y reconexión',()=>{
 it('soldier has independent cap1, melt5 and valid FIRE destruction',()=>{let e=setup();expect(cast(e,'snow_soldier',p(2,1)).ok).toBe(true);let soldier=e.state.units.find(u=>u.defId==='snow_soldier')!;expect(soldier).toMatchObject({hp:5,summon:{meltTurnsLeft:5}});const energy=e.state.player.energy;expect(cast(e,'snow_soldier',p(1,1)).ok).toBe(false);expect(e.state.player.energy).toBe(energy);e=restore(e);soldier=e.state.units.find(u=>u.defId==='snow_soldier')!;soldier.shield=99;dealDamage(ctxFor(e),soldier,1,'orc','FIRE','DIRECT_RANGED');expect(soldier.hp).toBe(0);});
 it('melt pauses under world and resumes remaining age, not five fresh turns',()=>{const e=setup();cast(e,'snow_soldier',p(2,1));let soldier=e.state.units.find(u=>u.defId==='snow_soldier')!;snowTurnEnd(ctxFor(e),soldier);expect(soldier.summon?.meltTurnsLeft).toBe(4);cast(e,'absolute_zero');soldier=e.state.units.find(u=>u.defId==='snow_soldier')!;snowTurnEnd(ctxFor(e),soldier);expect(soldier.summon?.meltTurnsLeft).toBe(4);unit(e,e.heroId).statuses=[];for(let i=0;i<4;i++)snowTurnEnd(ctxFor(e),soldier);expect(e.state.units.some(u=>u.id===soldier.id)).toBe(false);});
 it('Snow War shoots once per turn; reconnect cannot duplicate it and attack cards are blocked',()=>{let e=setup();unit(e,'orc').armor=0;cast(e,'snow_war');expect(cast(e,'arcane_burst',p(3,2)).ok).toBe(false);expect(cast(e,'frost_mantle').ok).toBe(true);snowTurnEnd(ctxFor(e),unit(e,e.heroId));expect(unit(e,'orc').hp).toBe(98);e=restore(e);snowTurnEnd(ctxFor(e),unit(e,e.heroId));expect(unit(e,'orc').hp).toBe(98);expect(status(e,'SNOW_WAR')?.turnsLeft).toBe(5);});
});
describe('Mejoras ejecutadas por motor, no solo descripción',()=>{
 for(const enhanced of [false,true]){
  const prep=()=>{const e=setup();if(enhanced)cast(e,'absolute_zero');return e;};
  it(`Manto and Reflejo persist power (${enhanced})`,()=>{let e=prep();cast(e,'frost_mantle');cast(e,'glacial_reflection');e=restore(e);expect(status(e,'FROST_MANTLE')?.power).toBe(enhanced?-1:undefined);expect(status(e,'GLACIAL_REFLECTION')?.power).toBe(enhanced?3:undefined);});
  it(`Prisión and Cometa duration/control (${enhanced})`,()=>{const e=prep();cast(e,'ice_prison',p(3,2));expect(unit(e,'orc').statuses.some(s=>s.id==='FROZEN')).toBe(enhanced);cast(e,'frost_comet',p(3,2));expect(unit(e,'orc').statuses.find(s=>s.id==='ROOTED')?.turnsLeft).toBe(enhanced?2:1);});
  it(`Shell shield and drawback (${enhanced})`,()=>{const e=prep();cast(e,'glacial_shell');expect(unit(e,e.heroId).shield).toBe(enhanced?8:6);expect(status(e,'ROOTED')!==undefined).toBe(!enhanced);});
  it(`Escarcha tile cost metadata (${enhanced})`,()=>{const e=prep();cast(e,'sudden_frost',p(2,1));expect(tileAt(e.state.board,p(2,1))?.iceExitBonus).toBe(enhanced?2:undefined);});
  it(`Skating free budget (${enhanced})`,()=>{const e=prep();cast(e,'arcane_skating');expect(status(e,'ARCANE_SKATING')?.power).toBe(enhanced?6:undefined);});
  it(`Paso range and real path terrain (${enhanced})`,()=>{const e=prep();unit(e,'orc').pos=p(6,4);const result=cast(e,'frozen_step',p(4,2));expect(result.ok).toBe(enhanced);if(enhanced)expect(tileAt(e.state.board,p(2,2))?.terrainTurnsLeft).toBe(3);});
 }
});
