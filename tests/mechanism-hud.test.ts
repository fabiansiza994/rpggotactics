import { describe,it,expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameEngine,DEFAULT_CONTENT,encounterFor,type Command } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import victories from './fixtures/act3-victories.json';
import { InteractionPanelView } from '../src/presentation/mechanisms/InteractionPanel';
import { TemporaryHint } from '../src/presentation/mechanisms/TemporaryHint';

describe('compact mechanism HUD',()=>{
 it('keeps XXIII goal/progress concise and secondary inspection folded',()=>{
  const engine=new GameEngine(encounterFor(TEMPLE_CAMPAIGN,'w3_e03','mage'),DEFAULT_CONTENT);
  const html=renderToStaticMarkup(createElement(InteractionPanelView,{engine,state:engine.state,selected:null,card:null,busy:false,feedback:''}));
  expect(html).toContain('LOS TRES SELLOS');expect(html).toContain('SELLOS ACTIVOS 0/3');
  expect(html).not.toContain('Cómo leer los mecanismos');
  expect(html).not.toContain('Acércate a un mecanismo para interactuar');
  expect(html).toContain('<details class="mechanism-inspection">');
  expect(html).not.toContain('<details open');
 });
 it('exposes a legal push without changing the authoritative interaction',()=>{
  const run=victories.find(r=>r.encounterId==='w3_e03'&&r.heroId==='mage')!;
  const engine=new GameEngine(encounterFor(TEMPLE_CAMPAIGN,run.encounterId,'mage'),DEFAULT_CONTENT,run.seed);
  const at=run.commands.findIndex(c=>c.type==='INTERACT'&&'mechanismId' in c&&c.mechanismId==='statue-a');
  for(const c of run.commands.slice(0,at)) engine.dispatch(c as Command);
  const before=JSON.stringify(engine.state);
  const html=renderToStaticMarkup(createElement(InteractionPanelView,{engine,state:engine.state,selected:'statue-a',card:null,busy:false,feedback:''}));
  expect(html).toContain('EMPUJAR');expect(html).toContain('data-mechanism-id="statue-a"');
  expect(html).not.toMatch(/class="mechanism-action"[^>]*disabled/);
  expect(JSON.stringify(engine.state)).toBe(before);
 });
 it('fades onboarding over its last700ms and never enters gameplay state',()=>{
  const hint=new TemporaryHint();expect(hint.opacity).toBe(1);
  hint.tick(6150);expect(hint.opacity).toBeCloseTo(.5);expect(hint.visible).toBe(true);
  hint.tick(350);expect(hint.opacity).toBe(0);expect(hint.visible).toBe(false);
 });
});
