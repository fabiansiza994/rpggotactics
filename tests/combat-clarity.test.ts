import { withArcher } from '../src/game/data/archer';
import { createElement } from 'react';
import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameEngine,DEFAULT_CONTENT,SCENARIOS_BY_ID } from '../src/game';
import { combatPhase } from '../src/presentation/combat/clarity';
import { ActionAvailability } from '../src/presentation/react/components/ActionAvailability';
import { CardPattern } from '../src/presentation/react/components/CardPattern';
import { linkedPlacement } from '../src/presentation/mechanisms/LinkedAction';
import { statusEffect,statusIcon } from '../src/presentation/combat/statusPresentation';
import { forecastRows } from '../src/presentation/qa/archer/ArcherHud';
import { TurnPanel } from '../src/presentation/react/components/Hud';
import { useMechanismPlayback,presentMechanisms } from '../src/presentation/mechanisms/mechanismPlayback';
describe('combat clarity display contract',()=>{
 const state=new GameEngine(Object.values(SCENARIOS_BY_ID)[0]!,DEFAULT_CONTENT).state;
 it('never exposes player control while any presentation lock is active',()=>{
  expect(combatPhase({...state,phase:'PLAYER'},true)).toBe('RESOLVING');
  expect(combatPhase({...state,phase:'ENEMY'},false)).toBe('ENEMY_TURN');
  expect(combatPhase({...state,phase:'PLAYER'},false)).toBe('PLAYER_TURN');
  const html=renderToStaticMarkup(createElement(TurnPanel,{state,scenarioName:'QA',displayPhase:'RESOLVING'}));
  expect(html).toContain('Resolviendo');expect(html).not.toContain('Tu turno');
 });
 it('keeps snapshots for ordinary fights as well as mechanisms without mutating the engine',()=>{
  const before=JSON.stringify(state);presentMechanisms(state);
  expect(useMechanismPlayback.getState().state).toBe(state);expect(JSON.stringify(state)).toBe(before);
 });
 it('does not style inactive optional bonuses as a blocked requirement',()=>{
  const html=renderToStaticMarkup(createElement(ActionAvailability,{state:'BONUS_NOT_ACTIVE',label:'Visión de tu Presa'}));
  expect(html).toContain('Bono no activo');expect(html).not.toContain('✕');
  expect(renderToStaticMarkup(createElement(ActionAvailability,{state:'BLOCKED',label:'Concentración',required:true}))).toContain('Impide jugar');
 });
 it('labels caster origin differently from a remote target',()=>{
  expect(renderToStaticMarkup(createElement(CardPattern,{targeting:{type:'SELF'}}))).toContain('punto = origen');
  expect(renderToStaticMarkup(createElement(CardPattern,{targeting:{type:'UNIT',range:3,unitFilter:'ENEMY'}}))).toContain('contorno = objetivo');
 });
 it('uses named icons and content-derived status explanations',()=>{
  expect(statusIcon('BURNING')).toBe('flame');expect(statusIcon('FORTIFIED')).toBe('shield');
  expect(statusEffect(DEFAULT_CONTENT.statuses.BURNING)).toContain('daño');
  expect(statusEffect(DEFAULT_CONTENT.statuses.FORTIFIED)).toContain('2');
 });
 it('places context actions outside cells and rejects gutters covered by controls',()=>{
  const board={left:180,right:560,top:80,bottom:250};
  const p=linkedPlacement({x:300,y:160},board,{width:740,height:360},[]);
  expect(p).not.toBeNull();expect(p!.x+136).toBeLessThan(board.left);
  expect(linkedPlacement({x:300,y:160},board,{width:740,height:360},[{left:0,right:740,top:0,bottom:360}])).toBeNull();
 });
 it('keeps archer damage conditions optional and focus costs mandatory',()=>{
  const content=withArcher(DEFAULT_CONTENT);
  const rows=forecastRows(state,content,content.cards.heart_shot!,null,null);expect(rows.checks.some(c=>c.required)).toBe(true);
  expect(forecastRows(state,content,content.cards.stalker_step!,null,null).checks.every(c=>!c.required)).toBe(true);
 });
});
