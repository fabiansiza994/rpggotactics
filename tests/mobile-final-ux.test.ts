import {describe,it,expect,vi,afterEach} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {visibleCollectionCopy,rankedAccessRequired,storeCategories,mobileScenarioName} from '../src/presentation/mobile/mobileUx';
import {RankedAccess} from '../src/presentation/mobile/RankedAccess';
import {navigatePlay,readPlayMode} from '../src/presentation/play/navigation';
import {createProfile,DEFAULT_CONTENT,heroProfile,activeDeck,DECK_RULES,deckBuilderView} from '../src/game';
afterEach(()=>vi.unstubAllGlobals());
describe('owned collection is independent from deck availability',()=>{
 it('shows an owned Fireball when all three copies are equipped without changing the engine view',()=>{const profile=createProfile(DEFAULT_CONTENT);const hero=heroProfile(profile,'mage',DEFAULT_CONTENT);const cards=activeDeck(hero).cards;const before=JSON.stringify(profile);const view=deckBuilderView(profile,'mage',cards,DEFAULT_CONTENT,DECK_RULES);const fire=view.collection.find(c=>c.cardId==='fireball')!;expect(fire.ownedCopies).toBe(3);expect(fire.deckCopies).toBe(3);expect(fire.availableCopies).toBe(0);expect(visibleCollectionCopy('owned',fire.ownedCopies,fire.availableCopies)).toBe(true);expect(visibleCollectionCopy('available',fire.ownedCopies,fire.availableCopies)).toBe(false);expect(JSON.stringify(profile)).toBe(before);});
 it.each([[0,0,false,false],[5,2,true,true],[2,0,true,false]])('classifies owned%s/available%s without granting copies',(owned,available,all,add)=>{expect(visibleCollectionCopy('owned',owned as number,available as number)).toBe(all);expect(visibleCollectionCopy('available',owned as number,available as number)).toBe(add);});
});
describe('ranked intent and authentication presentation',()=>{
 it.each(['GUEST','CONNECTING','OFFLINE','NEEDS_IMPORT'])('keeps %s out of a misleading private lobby',status=>expect(rankedAccessRequired(true,true,false,status)).toBe(true));
 it('releases the gate after valid login but never interrupts an active battle or desktop',()=>{expect(rankedAccessRequired(true,true,false,'READY')).toBe(false);expect(rankedAccessRequired(true,true,true,'GUEST')).toBe(false);expect(rankedAccessRequired(false,true,false,'GUEST')).toBe(false);expect(rankedAccessRequired(true,false,false,'GUEST')).toBe(false);});
 it('keeps the ranked URL intact across the access decision and recovery state',()=>{const update=(href:string|URL)=>{const u=new URL(href);vi.stubGlobal('location',{href:u.href,search:u.search});};update('https://qa.invalid/play?payment=return');vi.stubGlobal('history',{pushState:vi.fn((_a,_b,url)=>update(url))});vi.stubGlobal('window',{dispatchEvent:vi.fn()});navigatePlay('pvp',{queue:'ranked'});expect(rankedAccessRequired(true,true,false,'GUEST')).toBe(true);expect(readPlayMode()).toBe('pvp');expect(new URL(location.href).searchParams.get('queue')).toBe('ranked');expect(rankedAccessRequired(true,true,false,'READY')).toBe(false);expect(location.search).toContain('queue=ranked');expect(location.search).toContain('payment=return');});
 it('renders an explicit login and registration choice rather than private room controls',()=>{const html=renderToStaticMarkup(createElement(RankedAccess));expect(html).toContain('Inicia sesión para jugar Ranked');expect(html).toContain('Iniciar sesión');expect(html).toContain('Crear cuenta');expect(html).not.toContain('Crear partida privada');const waiting=renderToStaticMarkup(createElement(RankedAccess,{connecting:true}));expect(waiting).toContain('Recuperando tu sesión');expect(waiting).toContain('disabled');});
});
describe('store category selection does not change quotes or desktop grouping',()=>{
 const categories=[{id:'FEATURED'},{id:'MAGE'},{id:'DEALS'}];
 it('shows one category on mobile, including featured, and retains every desktop category',()=>{expect(storeCategories(categories,true,null)).toEqual([categories[0]]);expect(storeCategories(categories,true,'MAGE')).toEqual([categories[1]]);expect(storeCategories(categories,false,'MAGE')).toEqual(categories.slice(1));});
 it('recovers from stale categories after refresh and handles empty catalogues',()=>{expect(storeCategories(categories,true,'expired')).toEqual([categories[0]]);expect(storeCategories([],true,'expired')).toEqual([]);});
 it('retains input objects for server-provided content rather than editing commercial data',()=>{const before=JSON.stringify(categories);expect(storeCategories(categories,true,'DEALS')[0]).toBe(categories[2]);expect(JSON.stringify(categories)).toBe(before);});
 it('localizes scenario labels without modifying IDs or unknown names',()=>{expect(mobileScenarioName('First Blood')).toBe('Primera sangre');expect(mobileScenarioName('Crystal Guard')).toBe('Guardia de cristal');expect(mobileScenarioName('Escape')).toBe('La huida');expect(mobileScenarioName('Arena especial')).toBe('Arena especial');});
});
