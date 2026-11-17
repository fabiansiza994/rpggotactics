import {it,expect} from 'vitest';
import {ORIGINAL_ORIGINS_CARD_IDS,LEGACY_ORIGINS_CARD_IDS,ORIGINS_CARD_IDS,MARKET_EXPANSIONS} from '../src/game/store/market-expansions';
import {context,packs} from '../qa/market-20/demo-state';
import {primaryMarketExpansionId} from '../src/game/store/market-primary';
import {rarityOf} from '../src/game';
it('preserves all historical cards while arcane-only pool excludes reserved acquisition',()=>{
 expect(ORIGINAL_ORIGINS_CARD_IDS).toHaveLength(96);expect(LEGACY_ORIGINS_CARD_IDS).toHaveLength(40);
 expect(ORIGINAL_ORIGINS_CARD_IDS.every(id=>!!context.content.cards[id])).toBe(true);
 expect(ORIGINS_CARD_IDS).toHaveLength(22);expect(new Set(ORIGINS_CARD_IDS).size).toBe(22);
 const pack=packs.find(o=>o.id==='booster_origins_arcanos_x1')!;
 const counts:Record<string,number>={};
 for(const c of pack.contents){if(c.kind!=='CARD')throw Error('card expected');expect(primaryMarketExpansionId(c.cardId)).toBe('origins_arcanos');const def=context.content.cards[c.cardId]!;expect(['RANKED_TRACK','RANKED_PREMIUM','ENCOUNTER_REWARD','WORLD_REWARD']).not.toContain(def.acquisition?.source);const r=rarityOf(def);counts[r]=(counts[r]??0)+1;}
 expect(counts).toEqual({COMMON:14,UNCOMMON:4,RARE:2,LEGENDARY:1});
 expect(MARKET_EXPANSIONS[0]?.freePacksPerPlayer).toBe(5);
 expect(MARKET_EXPANSIONS.slice(1).every(e=>e.freePacksPerPlayer===undefined)).toBe(true);
});
