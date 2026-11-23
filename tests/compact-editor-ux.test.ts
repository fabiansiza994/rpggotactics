import{describe,it,expect}from'vitest';
import{collectionCopies,individualCopies}from'../src/presentation/react/deckbuilder/individualCopies';
import{browseCollection,EMPTY_QUERY,isFiltered}from'../src/presentation/react/deckbuilder/collectionView';
import{editorExpansionOptions,BASE_COLLECTION}from'../src/presentation/react/deckbuilder/expansionFilter';
import{DEFAULT_CONTENT,createProfile,ownedFor}from'../src/game';
import{primaryMarketExpansionId}from'../src/game/store/market-primary';
import{MARKET_EXPANSIONS}from'../src/game/store/market-expansions';
describe('compact editor collection identities',()=>{
 for(const n of [1,4,8,100])it(`shows one entry with actual ownership ×${n}, without deck capping`,()=>{const input=[{cardId:'blink',count:n}];expect(collectionCopies(input,80)).toEqual([{cardId:'blink',copy:0,count:n}]);expect(input[0]!.count).toBe(n);});
 it('keeps variants distinct by ID, omits zero ownership and paginates distinct cards',()=>{expect(collectionCopies([{cardId:'blink',count:8},{cardId:'blink_ii',count:4},{cardId:'missing',count:0}],80)).toHaveLength(2);expect(collectionCopies([{cardId:'blink',count:100000},{cardId:'blink_ii',count:4}],1)).toEqual([{cardId:'blink',copy:0,count:100000}]);});
 it('deck still renders every copy separately',()=>expect(individualCopies([{cardId:'blink',count:3}],80)).toHaveLength(3));
});
describe('editor filters use existing expansion membership',()=>{
 const cards=Object.values(DEFAULT_CONTENT.cards),profile=createProfile(DEFAULT_CONTENT),owned=ownedFor(profile,'mage',DEFAULT_CONTENT),lookup=(id:string)=>({copies:owned(id),acquired:0});
 it('returns precisely the real Thunder IDs, with no extra assignments',()=>{const result=browseCollection(cards,lookup,{...EMPTY_QUERY,expansion:'thunder_god'},DEFAULT_CONTENT);expect(result.length).toBeGreaterThan(0);expect(new Set(result.map(c=>c.id))).toEqual(new Set(cards.filter(c=>primaryMarketExpansionId(c.id)==='thunder_god').map(c=>c.id)));});
 it.each(['COMMON','UNCOMMON','RARE','LEGENDARY','ULTRA']as const)('combines Thunder, rarity %s, cost and text without resetting query',rarity=>{const q={...EMPTY_QUERY,expansion:'thunder_god',rarities:[rarity],costs:['3+'as const],text:'tor'};const original=structuredClone(q);const r=browseCollection(cards,lookup,q,DEFAULT_CONTENT);expect(r.every(c=>primaryMarketExpansionId(c.id)==='thunder_god'&&c.rarity===rarity&&c.cost>=3&&c.name.toLowerCase().includes('tor'))).toBe(true);expect(q).toEqual(original);});
 it('base collection derives only from existing hero starters',()=>{const ids=new Set(Object.values(DEFAULT_CONTENT.heroes).flatMap(h=>[...h.deck,...(h.starterCollection??[])].map(e=>e.cardId)));expect(new Set(browseCollection(cards,lookup,{...EMPTY_QUERY,expansion:BASE_COLLECTION},DEFAULT_CONTENT).map(c=>c.id))).toEqual(ids);});
 it('uses names and IDs from the catalog and marks/clears an active filter',()=>{const opts=editorExpansionOptions(cards.map(c=>c.id));expect(opts.length).toBeGreaterThanOrEqual(6);expect(opts.every(e=>MARKET_EXPANSIONS.includes(e))).toBe(true);expect(isFiltered({...EMPTY_QUERY,expansion:'thunder_god'})).toBe(true);expect(isFiltered(EMPTY_QUERY)).toBe(false);});
 it('returns no unknown expansion cards and keeps unlocked semantics composable',()=>{expect(browseCollection(cards,lookup,{...EMPTY_QUERY,expansion:'not-an-expansion'},DEFAULT_CONTENT)).toEqual([]);const r=browseCollection(cards,lookup,{...EMPTY_QUERY,expansion:'thunder_god',ownership:'UNLOCKED'},DEFAULT_CONTENT);expect(r.every(c=>owned(c.id)>0)).toBe(true);});
});

// Render the actual shared grid; deck and collection intentionally have different semantics.
import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';import{CompactCardGrid}from'../src/presentation/react/deckbuilder/CompactCardGrid';
it('renders an actual ownership badge, a single collection face and unmodified deck faces',()=>{const props={cards:DEFAULT_CONTENT.cards,selected:null,onInspect:()=>{},onDragStart:()=>{},onDragEnd:()=>{}};const entries=[{cardId:'blink',count:8}];const html=renderToStaticMarkup(createElement(CompactCardGrid,{...props,entries,context:'collection'}));expect(html.match(/<li[^>]*data-card-id="blink"/g)).toHaveLength(1);expect(html).toContain('×8');expect(html).toContain('8 copias poseídas');const deck=renderToStaticMarkup(createElement(CompactCardGrid,{...props,entries:[{cardId:'blink',count:3}],context:'deck'}));expect(deck.match(/<li[^>]*data-card-id="blink"/g)).toHaveLength(3);expect(deck).not.toContain('db-owned-badge');});

it('keeps all six real commercial expansions selectable even for a champion with no matching cards',()=>{expect(editorExpansionOptions(['blink']).filter(e=>e.status==='AVAILABLE').map(e=>e.id)).toEqual(MARKET_EXPANSIONS.filter(e=>e.status==='AVAILABLE'&&e.public!==false).map(e=>e.id));});
