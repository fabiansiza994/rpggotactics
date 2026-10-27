import { createElement } from 'react';
import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT, type Unit } from '../src/game';
import { UnitInspection, inspectedUnitAt } from '../src/presentation/react/components/UnitInspection';
import { CHARACTER_ANIMATIONS, animationRegion, clipOffset } from '../src/presentation/pixi/characterAnimations';
const summon:Unit={id:'ally',defId:'ash_hound',name:'Sabueso de Ceniza',kind:'SUMMON',faction:'PLAYER',pos:{x:1,y:2},hp:3,maxHp:8,armor:1,shield:2,moveRange:3,statuses:[{id:'ROOTED',turnsLeft:2}],targetPreference:'HERO'};
describe('public summon inspection',()=>{
 it('picks either faction without targeting; selected cards always retain priority',()=>{
  const enemy={...summon,id:'enemy',faction:'ENEMY' as const,pos:{x:3,y:2}};
  expect(inspectedUnitAt([summon,enemy],[summon.pos],false)).toBe(summon);
  expect(inspectedUnitAt([summon,enemy],[enemy.pos],false)).toBe(enemy);
  expect(inspectedUnitAt([summon,enemy],[enemy.pos],true)).toBeNull();
  expect(inspectedUnitAt([summon],[{x:0,y:0}],false)).toBeNull();
 });
 it('displays current public HP, armor, shield, base damage, status and permanence',()=>{
  const html=renderToStaticMarkup(createElement(UnitInspection,{unit:summon,content:DEFAULT_CONTENT,onClose:()=>{}}));
  for(const text of ['Sabueso de Ceniza','3 / 8 HP','Daño base','Movimiento','Armadura','Escudo','Enraizado','Permanece hasta morir'])expect(html).toContain(text);
  expect(html).not.toContain('ownerId');
 });
 it('heroes and enemies can be inspected only outside targeting; movement priority remains in canvas',()=>{
  for(const kind of ['HERO','ENEMY'] as const){const u={...summon,kind};expect(inspectedUnitAt([u],[u.pos],false)).toBe(u);expect(inspectedUnitAt([u],[u.pos],true)).toBeNull();expect(renderToStaticMarkup(createElement(UnitInspection,{unit:u,content:DEFAULT_CONTENT,onClose:()=>{}}))).not.toContain('Daño base');}
 });
});
describe('ash hound authored rear subject extraction',()=>{
 it('excludes neighboring sketches for idle, walk, attack and hit while retaining the 256px canvas',()=>{
  const layout=CHARACTER_ANIMATIONS.ash_hound!;
  for(const motion of ['idle','walk','attack','hit','death'] as const)for(let i=0;i<layout.clips[motion]!.count;i++){
   const r=animationRegion(layout,motion,i,'back')!,cell=clipOffset(layout,motion,i)!;
   expect(r.orig).toEqual({x:0,y:0,width:256,height:256});expect(r.frame.x-cell.x+r.frame.width).toBeLessThanOrEqual(motion==='death'?184:140);
   expect(r.frame.y-cell.y).toBeGreaterThanOrEqual(56);expect(r.trim!.y).toBe(r.frame.y-cell.y);
  }
 });
 it('does not crop any other direction or unit',()=>{
  for(const view of ['front','left','right'])expect(animationRegion(CHARACTER_ANIMATIONS.ash_hound!,'idle',0,view)?.trim).toBeUndefined();
  expect(animationRegion(CHARACTER_ANIMATIONS.infernal_imp!,'idle',0,'back')?.trim).toBeUndefined();
 });
});
