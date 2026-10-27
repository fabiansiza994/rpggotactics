import { validateCatalog } from '../src/game/store/store';
import { ownedCatalogMilestones } from '../src/presentation/catalog/CatalogCatchup';
import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {existsSync,statSync} from 'node:fs';
import {DEFAULT_CONTENT,createProfile,grantCard,DECK_RULES} from '../src/game';
import {withArcher} from '../src/game/data/archer';
import {withShapeshifterRelease} from '../src/game/data/shapeshifter-release';
import {FREE_CATALOG,FREE_CATALOG_NEW_CARDS,FREE_CATALOG_EXPANSION} from '../src/game/data/free-catalog';
import {catalogFactsFrom,discoverRarities} from '../src/game/collection/free-catalog';
import {DiscoverRaritiesView} from '../src/presentation/catalog/FreeCatalog';
import {CatalogRewardView,newlyOwnedCatalogRows,masteryLegendaryName} from '../src/presentation/catalog/CatalogRewards';
import {cardRarityFinish} from '../src/presentation/cards/premiumTreatment';
import {FINAL_CARD_ART} from '../src/presentation/assets/paintedAssets';
import {STORE_CATALOG} from '../src/game/data/store-catalog';
import {makeEngine,mutable,p,setHand,unit} from './helpers';
const base=withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const content={...base,releasedExpansions:[...(base.releasedExpansions??[]),FREE_CATALOG_EXPANSION]};
const facts=catalogFactsFrom({runs:()=>[],worldHistory:{},masteryXp:()=>0});
describe('free catalog art/UI',()=>{
 it('assigns twelve distinct optimized final paintings',()=>{
  expect(FREE_CATALOG_NEW_CARDS).toHaveLength(12);
  const paths=FREE_CATALOG_NEW_CARDS.map(c=>FINAL_CARD_ART[c.id]!);
  expect(new Set(paths).size).toBe(12);
  for(const path of paths){expect(path).toMatch(/^\/art\/free-catalog\//);expect(existsSync('public'+path)).toBe(true);expect(statSync('public'+path).size).toBeLessThan(250000);}
 });
 it('shows all20cards including locked stats and unlock methods; never changes gameplay',()=>{
  const profile=createProfile(content);let count=0;const before=JSON.stringify(content);
  for(const heroId of Object.keys(FREE_CATALOG)){
   const rows=discoverRarities(content,profile,heroId,facts);expect(rows).toHaveLength(4);count+=rows.length;
   const html=renderToStaticMarkup(createElement(DiscoverRaritiesView,{rows,content}));
   expect(html).toContain('Descubre las rarezas');expect(html).toContain('Bloqueada');expect(html).toContain('Maestría 7');
   expect(html).not.toContain('data-art-pending');
   for(const row of rows){expect(html).toContain(row.name);expect(row.rulesText.length).toBeGreaterThan(10);}
  }
  expect(count).toBe(20);expect(JSON.stringify(content)).toBe(before);
 });
 it('reserves super finish for Legendary, Ultra finish for Ultra, Showcase cosmetic only',()=>{
  for(const c of FREE_CATALOG_NEW_CARDS){expect(cardRarityFinish(c)).toBe(c.rarity==='ULTRA'?'ultra':c.rarity==='LEGENDARY'?'super':'rare');}
  const c=content.cards.arcane_pull!;expect(cardRarityFinish({...c,presentation:{...c.presentation,premiumTreatment:'showcase'}})).toBe('secret');expect(c.rarity).toBe('RARE');
 });
 it('reveals only newly owned rewards, while retroactive baseline produces no repeat',()=>{
  const before=createProfile(content);const grant=grantCard(before,'mage','archmage_eruption',content);if(!grant.ok)throw Error('grant');
  const rows=newlyOwnedCatalogRows(content,before,grant.profile,'mage');expect(rows.map(r=>r.cardId)).toEqual(['archmage_eruption']);
  const html=renderToStaticMarkup(createElement(CatalogRewardView,{row:rows[0]!,content}));expect(html).toContain('ACTO COMPLETADO');expect(html).toContain('NUEVA CARTA ULTRA');
  expect(newlyOwnedCatalogRows(content,grant.profile,grant.profile,'mage')).toEqual([]);
  expect(ownedCatalogMilestones(grant.profile,content)).toContain('archmage_eruption');
  expect(ownedCatalogMilestones(grant.profile,base)).toEqual([]);
  expect(masteryLegendaryName('mage',6,7,content)).toBe('Detonación Elemental');expect(masteryLegendaryName('mage',7,8,content)).toBeNull();
 });
 it('retains approved packs at510 with guaranteed free routes for reused catalog cards',()=>{
  for(const [id,card] of [['pack_summoner_alpha_hunt','mark_prey'],['pack_warrior_guardbreaker','challenge']]){
   const offer=STORE_CATALOG.find(o=>o.id===id)!;expect(offer.price).toBe(510);
   expect(offer.contents.some(c=>c.kind==='CARD'&&c.cardId===card)).toBe(true);
   const route=Object.values(FREE_CATALOG).flat().find(e=>e.cardId===card)!;
   expect(route.unlock.type).toBe('ENCOUNTER_CLEAR');
  }
  expect(content.cards.mark_prey).toBeDefined();expect(content.cards.challenge).toBeDefined();
 });
 it('allows catalog packs only with a real guaranteed route and released set',()=>{
  const card=content.cards.elemental_detonation!;
  const template=STORE_CATALOG.find(o=>o.heroId==='mage')!;
  const offer={...template,id:'qa_catalog_offer',contents:[{kind:'CARD' as const,cardId:card.id,copies:1}],featuredCardId:card.id,ritualPreview:undefined};
  expect(validateCatalog([offer],{content,rules:DECK_RULES,cosmetics:{}})).toEqual([]);
  expect(validateCatalog([offer],{content:base,rules:DECK_RULES,cosmetics:{}})).toContainEqual(expect.objectContaining({code:'UNRELEASED_CARD'}));
  const fake={...card,id:'unknown_free_card'};
  expect(validateCatalog([{...offer,contents:[{kind:'CARD',cardId:fake.id,copies:1}],featuredCardId:fake.id}],{content:{...content,cards:{...content.cards,[fake.id]:fake}},rules:DECK_RULES,cosmetics:{}})).toContainEqual(expect.objectContaining({code:'EXCLUSIVE_CARD'}));
 });
 it('normal Desafío remains a single targeted enemy',()=>{
  const engine=makeEngine({layout:Array(5).fill('.....'),hero:{heroId:'warrior',pos:p(2,2)},enemies:[{id:'a',enemyId:'orc_warrior',pos:p(1,2)},{id:'b',enemyId:'orc_warrior',pos:p(3,2)}]},content);
  mutable(engine).player.energy=10;const [uid]=setHand(engine,['challenge']);
  const result=engine.dispatch({type:'PLAY_CARD',cardUid:uid!,target:p(1,2)});expect(result.ok).toBe(true);
  expect(unit(engine,'a').statuses.some(s=>s.id==='CHALLENGED')).toBe(true);expect(unit(engine,'b').statuses.some(s=>s.id==='CHALLENGED')).toBe(false);
 });
 it('Círculo del Guardián challenges all surviving adjacent enemies',()=>{
  const engine=makeEngine({layout:Array(5).fill('.....'),hero:{heroId:'shapeshifter',pos:p(2,2)},enemies:[{id:'a',enemyId:'orc_warrior',pos:p(1,2)},{id:'b',enemyId:'orc_warrior',pos:p(3,2)}]},content);
  unit(engine,engine.heroId).activeForm='bear';mutable(engine).player.energy=10;
  const [uid]=setHand(engine,['qa_legacy_guardian_circle']);const result=engine.dispatch({type:'PLAY_CARD',cardUid:uid!,target:null});expect(result.ok).toBe(true);
  expect(['a','b'].every(id=>unit(engine,id).statuses.some(s=>s.id==='CHALLENGED'&&s.sourceId===engine.heroId))).toBe(true);
 });
});
