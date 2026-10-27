import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PRIMORDIAL_LEGACY_CARDS } from '../src/game/data/primordial-legacy';
import { PRIMORDIAL_LEGACY_CARD_ART } from '../src/presentation/assets/primordialLegacyCards';
import { SHAPESHIFTER_CARD_ART } from '../src/presentation/assets/shapeshifterCards';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
describe('Legado Primordial final illustrated assets',()=>{
  it('maps eighteen individually generated paintings to the correct cards and WebP files',()=>{
    const metadata=JSON.parse(readFileSync('qa/primordial-legacy/art/assets.json','utf8')) as {id:string;width:number;height:number;bytes:number;sha256:string;target:string}[];
    expect(metadata).toHaveLength(18);
    expect(Object.keys(PRIMORDIAL_LEGACY_CARD_ART).sort()).toEqual(PRIMORDIAL_LEGACY_CARDS.map(c=>c.id).sort());
    const hashes=new Set<string>();
    for(const card of PRIMORDIAL_LEGACY_CARDS){
      const path='public'+SHAPESHIFTER_CARD_ART[card.id];expect(existsSync(path)).toBe(true);
      const data=readFileSync(path),hash=createHash('sha256').update(data).digest('hex');hashes.add(hash);
      expect(data.toString('ascii',0,4)).toBe('RIFF');expect(data.toString('ascii',8,12)).toBe('WEBP');
      expect(data.length).toBeLessThan(200_000);
      expect(metadata.find(m=>m.id===card.id)).toMatchObject({target:path,width:640,height:960,bytes:data.length,sha256:hash});
    }
    expect(hashes.size).toBe(18);
  });
  it('preserves all thirty approved paintings byte for byte',()=>{
    const protectedArt=JSON.parse(readFileSync('qa/primordial-legacy/art/protected.json','utf8')) as Record<string,string>;
    expect(Object.keys(protectedArt)).toHaveLength(30);
    for(const [path,hash]of Object.entries(protectedArt))expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
    expect(Object.keys(SHAPESHIFTER_CARD_ART)).toHaveLength(48);
  });
  it('renders all eighteen using the existing final art renderer in private QA',async()=>{
    vi.stubEnv('MODE','shapeshifterqa');vi.stubEnv('DEV',true);vi.stubGlobal('location',{hostname:'127.0.0.1'});vi.resetModules();
    const {SpellArt}=await import('../src/presentation/react/components/SpellArt');
    for(const c of PRIMORDIAL_LEGACY_CARDS){
      const html=renderToStaticMarkup(createElement(SpellArt,{cardId:c.id,spell:c.id}));
      expect(html).toContain(`src="${PRIMORDIAL_LEGACY_CARD_ART[c.id]}"`);
      expect(html).toContain('data-final-art="true"');expect(html).not.toContain('ARTE PENDIENTE');
    }
  });
  it('does not release these paintings or champion through production content',async()=>{
    vi.stubEnv('MODE','production');vi.stubEnv('DEV',false);vi.stubGlobal('location',{hostname:'rpg-go-tactics.com'});vi.resetModules();
    const {PRESENTATION_CONTENT}=await import('../src/presentation/qa/shapeshifter/runtime');
    const {FINAL_CARD_ART}=await import('../src/presentation/assets/paintedAssets');
    expect(PRESENTATION_CONTENT.heroes.shapeshifter).toBeUndefined();
    for(const c of PRIMORDIAL_LEGACY_CARDS){expect(PRESENTATION_CONTENT.cards[c.id]).toBeUndefined();expect(FINAL_CARD_ART[c.id]).toBeUndefined();}
  });
});
