import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {withArcher} from '../src/game/data/archer';
import {DEFAULT_CONTENT} from '../src/game';
import {DIALOGUE_LIBRARY} from '../src/game/data/dialogue';
import {pvpIntro,campaignDialogue} from '../src/game/dialogue/dialogue';
import {dialogueCast,DialogueOverlay} from '../src/presentation/dialogue/DialogueOverlay';
import {speakerView} from '../src/presentation/dialogue/speakers';
const content=withArcher(DEFAULT_CONTENT);
describe('tactical dialogue presentation',()=>{
 it('keeps both seats for mirrors and never changes the authored sequence',()=>{
  const sequence=pvpIntro(DIALOGUE_LIBRARY,{heroes:['archer','archer'],matchKey:'fixed'})!;const before=JSON.stringify(sequence);
  const cast=dialogueCast(sequence,content,l=>l.seat===0?'left':'right');expect(cast.map(x=>x.line?.seat)).toEqual([0,1]);
  const html=renderToStaticMarkup(createElement(DialogueOverlay,{sequence,content,mode:'ambient',sideOf:l=>l.seat===0?'left':'right',onClose:()=>{}}));
  expect(html.match(/class="dialogue-actor"/g)).toHaveLength(2);expect(html).not.toContain('aria-modal="true"');expect(JSON.stringify(sequence)).toBe(before);
 });
 it('renders modal controls inside the speech panel and stages the actual boss art',()=>{
  const sequence=campaignDialogue(DIALOGUE_LIBRARY,{encounterId:'hunt_10_veil_beast',tier:'BOSS',heroId:'archer',phase:'intro'})!;
  const html=renderToStaticMarkup(createElement(DialogueOverlay,{sequence,content,mode:'modal',onClose:()=>{}}));
  expect(html).toContain('aria-modal="true"');expect(html).toContain('/art/dialogue-portraits/bosses/veil_beast/threatening.webp');expect(html).toContain('Narrador');
  expect(html.indexOf('dialogue-skip')).toBeGreaterThan(html.indexOf('dialogue-box'));expect(html).toContain('dialogue-next');
 });
 it('reuses existing art for the five priority enemies without external assets',()=>{
  for(const id of ['veil_stalker','veil_guardian','veil_beast','stone_colossus','forge_king'])expect(speakerView(content,id).portrait).toMatch(/^\/art\//);
 });
 it('shares the same narrative/controls across finishes and exposes accessible scene progress',()=>{
  const sequence=pvpIntro(DIALOGUE_LIBRARY,{heroes:['archer','mage'],matchKey:'same-content'})!;
  const render=(visualVariant:'comic'|'tactical')=>renderToStaticMarkup(createElement(DialogueOverlay,{sequence,content,mode:'ambient',visualVariant,onClose:()=>{}}));
  const comic=render('comic'),tactical=render('tactical');
  expect(comic).toContain('data-variant="comic"');expect(tactical).toContain('data-variant="tactical"');
  expect(comic.replace('data-variant="comic"','')).toBe(tactical.replace('data-variant="tactical"',''));
  expect(comic).toContain(`aria-label="Paso 1 de ${sequence.lines.length}"`);
  expect(comic).toContain('dialogue-portrait-stack');expect(comic).toContain('dialogue-next');
 });

});
