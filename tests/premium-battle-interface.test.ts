import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {minimapCell} from '../src/presentation/react/components/TacticalOverview';
import {OpponentChampion} from '../src/presentation/battle/OpponentChampion';
import {PauseMenu} from '../src/presentation/react/components/PauseMenu';
import {makeEngine,mutable} from './helpers';
describe('Premium Battle Interface presentation contracts',()=>{
 for(const turn of [0,1,2,3])for(const [cols,rows] of [[7,5],[10,6]] as const)it(`minimap is a bijection and preserves neighbours ${cols}x${rows} turn${turn}`,()=>{
  const positions=[];for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)positions.push(minimapCell(x,y,cols,rows,turn));
  const width=turn%2?rows:cols,height=turn%2?cols:rows;
  expect(new Set(positions.map(p=>`${p.x}:${p.y}`)).size).toBe(cols*rows);
  expect(positions.every(p=>p.x>=0&&p.x<width&&p.y>=0&&p.y<height)).toBe(true);
  for(let y=0;y<rows;y++)for(let x=0;x<cols-1;x++){const a=minimapCell(x,y,cols,rows,turn),b=minimapCell(x+1,y,cols,rows,turn);expect(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)).toBe(1)}
 });
 it('localizes the public rival and shows its actual form and HP without private cards',()=>{
  const e=makeEngine(),s=mutable(e),own=s.units.find(u=>u.id===s.player.heroId)!;
  s.units.push({...structuredClone(own),id:'rival',defId:'shapeshifter',name:'shapeshifter',faction:'ENEMY',hp:7,maxHp:20,activeForm:'bear'});
  Object.defineProperty(s,'opponentHand',{get(){throw Error('private hand read')}});
  const html=renderToStaticMarkup(createElement(OpponentChampion,{state:s,content:e.content})),text=html.replace(/<[^>]*>/g,'');
  expect(text).toContain('Cambiaformas');expect(text).toContain('Oso');expect(text).toContain('7/20');expect(text).not.toContain('shapeshifter');expect(text).not.toMatch(/humano|bot|IA/);
 });
 it('surrender is confined to the existing pause menu and render never sends it',()=>{
  let calls=0;const html=renderToStaticMarkup(createElement(PauseMenu,{online:true,ranked:true,onExit:()=>{},onSurrender:()=>{calls++}}));
  expect(html).toContain('surrender-action');expect(html).toContain('Rendirse');expect(html).not.toContain('Sí, rendirme');expect(calls).toBe(0);
 });
});
