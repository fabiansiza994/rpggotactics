import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DEFAULT_CONTENT} from '../src/game';
import {withArcher} from '../src/game/data/archer';
import {DIALOGUE_LIBRARY} from '../src/game/data/dialogue';
import {campaignDialogue} from '../src/game/dialogue/dialogue';
import {BOSS_DIALOGUE_IDS,BOSS_DIALOGUE_VARIANTS,DIALOGUE_PORTRAITS,portraitVariantFor} from '../src/presentation/dialogue/portraitVariants';
import {speakerView} from '../src/presentation/dialogue/speakers';
import {DialogueOverlay} from '../src/presentation/dialogue/DialogueOverlay';
const content=withArcher(DEFAULT_CONTENT);
const encounters=['ascent_10_colossus','w2_e10','hunt_05_stalker','hunt_09_guardian','hunt_10_veil_beast'];
describe('boss and elite dialogue portraits',()=>{
 it('registers 25 unique optimized dialogue-only WebPs',()=>{
  const hashes=new Set<string>();
  for(const id of BOSS_DIALOGUE_IDS){expect(Object.keys(DIALOGUE_PORTRAITS[id]!)).toEqual([...BOSS_DIALOGUE_VARIANTS]);
   for(const variant of BOSS_DIALOGUE_VARIANTS){const url=DIALOGUE_PORTRAITS[id]![variant]!;expect(url).toContain('/dialogue-portraits/bosses/');const bytes=readFileSync('public'+url);expect(bytes.subarray(0,4).toString()).toBe('RIFF');expect(bytes.subarray(8,12).toString()).toBe('WEBP');expect(statSync('public'+url).size).toBeLessThan(120_000);hashes.add(createHash('sha256').update(bytes).digest('hex'));}
  }expect(hashes.size).toBe(25);
 });
 it('uses boss-specific ordered fallbacks without changing champion behavior',()=>{
  for(const id of BOSS_DIALOGUE_IDS){
   const neutral={neutral:'/neutral'};
   for(const variant of BOSS_DIALOGUE_VARIANTS)expect(portraitVariantFor(id,variant,{[id]:neutral})?.variant).toBe('neutral');
   expect(portraitVariantFor(id,'angry',{[id]:{threatening:'/threat',neutral:'/neutral'}})?.variant).toBe('threatening');
   expect(portraitVariantFor(id,'defeated',{[id]:{wounded:'/hurt',neutral:'/neutral'}})?.variant).toBe('wounded');
   expect(portraitVariantFor(id,'wounded',{[id]:{threatening:'/threat'}})).toBeNull();
  }
  expect(portraitVariantFor('mage','defeated',{mage:{serious:'/serious',neutral:'/neutral'}})?.variant).toBe('serious');
 });
 it('maps actual threats, anger and defeat lines for all five enemies, preserving narrative speakers',()=>{
  BOSS_DIALOGUE_IDS.forEach((id,i)=>{
   const intro=campaignDialogue(DIALOGUE_LIBRARY,{heroId:'archer',encounterId:encounters[i]!,tier:'BOSS',phase:'intro'})!;
   expect(intro.lines.filter(l=>l.speaker===id).map(l=>l.portraitVariant)).toEqual(['threatening','angry']);
   for(const line of intro.lines.filter(l=>l.speaker==='narrator'))expect(speakerView(content,line.speaker,undefined,line.portraitVariant).portrait).toBeUndefined();
   const outro=campaignDialogue(DIALOGUE_LIBRARY,{heroId:'archer',encounterId:encounters[i]!,tier:'BOSS',phase:'outro'})!;
   expect(outro.lines.find(l=>l.speaker===id)?.portraitVariant).toBe('defeated');
   for(const sequence of [intro,outro]){const html=renderToStaticMarkup(createElement(DialogueOverlay,{sequence,content,mode:'modal',onClose:()=>{}}));expect(html).toContain(`/dialogue-portraits/bosses/${id}/`);expect(html).toContain('dialogue-next');expect(html).toContain('data-side="right"');}
  });
 });
 it('leaves every preexisting combat and champion art file byte-identical',()=>{
  const frozen=JSON.parse(readFileSync('qa/dialogue-expressions-bosses/frozen-art.sha256.json','utf8')) as Record<string,string>;
  expect(Object.keys(frozen).filter(p=>p.startsWith('public/art/dialogue-portraits/'))).toHaveLength(30);
  for(const [path,digest]of Object.entries(frozen))expect(createHash('sha256').update(readFileSync(path)).digest('hex'),path).toBe(digest);
 });
});
