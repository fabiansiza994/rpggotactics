import type {RuleContext} from '../context';
import type {GameState} from '../state';
import type {Unit} from '../entities/unit';
import {manhattan,samePos,comparePos,type Pos} from '../core/position';
import {nextRandom} from '../core/rng';
import {allPositions,tileAt} from '../board/board';
import {canEnter,terrainDefAt} from '../board/occupancy';
import {healUnit,dealDamage} from './damage';
import {applyStatus} from '../statuses/status-rules';
import {setEnergy} from '../cards/deck';
import {createTerrain} from '../terrain/terrain-rules';

/** Existing rooms without this marker retain their certified rules. No network protocol change. */
export const scoutSiegeEnabled=(s:GameState):boolean=>s.duel?s.duel.scoutSiegeRelease===true:s.scoutSiegeRelease!==false;
export function activeScoutResources(s:GameState):NonNullable<GameState['scoutResources']>{
 return s.outcome?[]:(s.scoutResources??[]).filter(r=>r.expiresRound>s.round&&s.units.some(u=>u.id===r.ownerId&&u.hp>0));
}
export function pruneScoutResources(s:GameState):void{if(s.scoutResources)s.scoutResources=activeScoutResources(s);}
export function discoverScoutResource(ctx:RuleContext,fox:Unit,path:readonly Pos[]):void{
 const s=ctx.state;pruneScoutResources(s);
 if(!scoutSiegeEnabled(s)||fox.defId!=='fox'||fox.kind!=='SUMMON'||!fox.summon||!s.units.includes(fox)||fox.hp<=0||path.length<2||samePos(path[0]!,path.at(-1)!)||s.round<fox.summon.readyRound)return;
 const f=fox.summon;
 if(f.scoutRollRound===s.round||s.round<(f.scoutReadyRound??0))return;
 f.scoutRollRound=s.round;
 const resources=s.scoutResources??[];
 if(resources.filter(r=>r.ownerId===f.ownerId).length>=2)return;
 const cells=allPositions(s.board).filter(p=>manhattan(p,fox.pos)===1&&canEnter(ctx,p)&&!terrainDefAt(ctx,p)?.isHazard&&!resources.some(r=>samePos(r.pos,p))).sort(comparePos);
 if(!cells.length||nextRandom(s)>=.3)return;
 const roll=nextRandom(s),kind=roll<.5?'HEAL':roll<.8?'ARMOR':'ENERGY';
 const pos=cells[Math.floor(nextRandom(s)*cells.length)]!;
 const resource={id:`scout-${s.nextId++}`,ownerId:f.ownerId,foxId:fox.id,kind,pos:{...pos},expiresRound:s.round+2} as const;
 (s.scoutResources??=[]).push(resource);f.scoutReadyRound=s.round+2;
 ctx.emit({type:'SCOUT_RESOURCE_CREATED',...resource});
}
export function collectScoutResources(ctx:RuleContext,unit:Unit,path:readonly Pos[]):void{
 const s=ctx.state;pruneScoutResources(s);if(!scoutSiegeEnabled(s)||!s.units.includes(unit)||unit.hp<=0)return;
 for(const r of [...(s.scoutResources??[])]){
  const owner=s.units.find(u=>u.id===r.ownerId);
  if(!owner||!path.some(p=>samePos(p,r.pos))||!(unit.id===owner.id||unit.summon?.ownerId===owner.id))continue;
  if(r.kind==='HEAL'&&unit.hp>=unit.maxHp)continue;
  const player=s.player.heroId===owner.id?s.player:s.duel?.other.heroId===owner.id?s.duel.other:undefined;
  if(r.kind==='ENERGY'&&(!player||player.energy>=player.maxEnergy))continue;
  s.scoutResources=s.scoutResources!.filter(x=>x.id!==r.id);
  if(r.kind==='HEAL')healUnit(ctx,unit,2,r.id);
  else if(r.kind==='ARMOR')applyStatus(ctx,unit,'SCOUT_PROTECTION',1,r.id);
  else if(player===s.player)setEnergy(ctx,Math.min(player.energy+1,player.maxEnergy));
  else if(player)player.energy=Math.min(player.energy+1,player.maxEnergy);
  ctx.emit({type:'SCOUT_RESOURCE_COLLECTED',resourceId:r.id,unitId:r.kind==='ENERGY'?owner.id:unit.id,pos:r.pos,kind:r.kind});
 }
}
export function drakeScorch(ctx:RuleContext,dragon:Unit,pos:Pos):void{
 if(!scoutSiegeEnabled(ctx.state))return;
 // A residue must not downgrade an existing hazard or climate effect.
 const tile=tileAt(ctx.state.board,pos);if(!tile||terrainDefAt(ctx,pos)?.isHazard||tile.frozenWorldOwnerId)return;
 if(createTerrain(ctx,pos,'FIRE',1,dragon.id))tile.drakeFireHitIds=[];
}
export function enterDrakeFire(ctx:RuleContext,unit:Unit,path:readonly Pos[]):Pos[]{
 const traversed:Pos[]=[];
 for(const pos of path){
  if(!ctx.state.units.includes(unit))break;
  traversed.push(pos);
  const tile=tileAt(ctx.state.board,pos);if(tile?.terrain!=='FIRE'||!tile.drakeFireHitIds||tile.drakeFireHitIds.includes(unit.id))continue;
  if(unit.kind==='ENEMY'&&ctx.content.enemies[unit.defId]?.hazardImmune)continue;
  tile.drakeFireHitIds.push(unit.id);
  const endpoint=unit.pos;unit.pos={...pos};
  dealDamage(ctx,unit,1,'terrain:drake-fire','FIRE');
  if(ctx.state.units.includes(unit))unit.pos=endpoint;
 }
 return traversed;
}
