import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DEFAULT_CONTENT} from '../src/game';
import {withArcher} from '../src/game/data/archer';
import {withShapeshifterRelease} from '../src/game/data/shapeshifter-release';
import {DIALOGUE_LIBRARY} from '../src/game/data/dialogue';
import {campaignDialogue,pvpIntro,pvpOutro,type DialogueLibrary} from '../src/game/dialogue/dialogue';
import {CHAMPION_DIALOGUE_IDS,CHAMPION_DIALOGUE_VARIANTS,DIALOGUE_PORTRAITS,portraitVariantFor} from '../src/presentation/dialogue/portraitVariants';
import {speakerView} from '../src/presentation/dialogue/speakers';
import {DialogueOverlay} from '../src/presentation/dialogue/DialogueOverlay';
import {PvpVictoryLines} from '../src/presentation/dialogue/DialogueGates';
const content=withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const heroes=CHAMPION_DIALOGUE_IDS;
describe('real dialogue portrait expressions',()=>{
 it('registers 30 individual optimized WebPs, six per champion, with unique image bytes',()=>{
  const digests=new Set<string>();
  expect(heroes).toHaveLength(5);
  for(const id of heroes){expect(Object.keys(DIALOGUE_PORTRAITS[id]!)).toEqual([...CHAMPION_DIALOGUE_VARIANTS]);
   for(const variant of CHAMPION_DIALOGUE_VARIANTS){const url=DIALOGUE_PORTRAITS[id]![variant]!;const path='public'+url;const bytes=readFileSync(path);expect(bytes.subarray(0,4).toString()).toBe('RIFF');expect(bytes.subarray(8,12).toString()).toBe('WEBP');expect(statSync(path).size).toBeLessThan(120_000);digests.add(createHash('sha256').update(bytes).digest('hex'));}
  }expect(digests.size).toBe(30);
 });
 it('honors explicit variant, uses neutral by default and serious/neutral for missing variants',()=>{
  expect(speakerView(content,'archer',undefined,'angry').portrait).toContain('/archer/angry.webp');
  expect(speakerView(content,'archer').portrait).toContain('/archer/neutral.webp');
  expect(portraitVariantFor('x','amused',{x:{serious:'/s',neutral:'/n'}})).toEqual({src:'/s',variant:'serious'});
  expect(portraitVariantFor('x','angry',{x:{neutral:'/n'}})).toEqual({src:'/n',variant:'neutral'});
  expect(portraitVariantFor('unknown','angry')).toBeNull();expect(speakerView(content,'veil_beast',undefined,'angry').portrait).toBe('/art/dialogue-portraits/bosses/veil_beast/angry.webp');
 });
 it('maps every resolved PvP matchup/mirror, winner and loser without rerolling lines',()=>{
  for(const a of heroes)for(const b of heroes){const sequence=pvpIntro(DIALOGUE_LIBRARY,{heroes:[a,b],matchKey:'expressions-fixed'})!;for(const line of sequence.lines)expect(CHAMPION_DIALOGUE_VARIANTS).toContain(line.portraitVariant);
   const outro=pvpOutro(DIALOGUE_LIBRARY,{heroes:[a,b],matchKey:'expressions-fixed',winnerSeat:0})!;expect(outro.lines[0]!.portraitVariant).toBe('confident');expect(outro.lines[1]!.portraitVariant).toBe('wounded');
  }
 });
 it('maps campaign intro/outro in all three campaigns; explicit image choice wins over old acting tag',()=>{
  for(const encounterId of Object.keys(DIALOGUE_LIBRARY.campaign))for(const phase of ['intro','outro'] as const){const sequence=campaignDialogue(DIALOGUE_LIBRARY,{heroId:'archer',encounterId,tier:'NORMAL',phase});for(const line of sequence?.lines??[])expect(line.portraitVariant).toBeDefined();}
  const lib:DialogueLibrary={...DIALOGUE_LIBRARY,campaign:{test:{intro:[{speaker:'HERO',text:'uno',expression:'angry',portraitVariant:'amused'},{speaker:'HERO',text:'dos'}]}}};
  const lines=campaignDialogue(lib,{heroId:'archer',encounterId:'test',tier:'NORMAL',phase:'intro'})!.lines;
  expect(lines.map(l=>l.portraitVariant)).toEqual(['amused','neutral']);expect(lines.map(l=>l.text)).toEqual(['uno','dos']);
 });
 it('uses expression image requests for active dialogue and victory without changing settings/gates',()=>{
  const sequence=pvpIntro(DIALOGUE_LIBRARY,{heroes:['mage','archer'],matchKey:'expressions-fixed'})!;
  const html=renderToStaticMarkup(createElement(DialogueOverlay,{sequence,content,mode:'ambient',sideOf:l=>l.seat===0?'left':'right',onClose:()=>{}}));expect(html).toContain('data-requested-portrait="/art/dialogue-portraits/');
  const result=renderToStaticMarkup(createElement(PvpVictoryLines,{content,heroes:['mage','archer'],matchKey:'expressions-fixed',winnerSeat:0}));expect(result).toContain('/mage/confident.webp');expect(result).toContain('/archer/wounded.webp');
 });
});
