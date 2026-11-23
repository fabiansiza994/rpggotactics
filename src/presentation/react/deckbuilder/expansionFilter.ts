import type {GameContent} from '../../../game';
import {MARKET_EXPANSIONS} from '../../../game/store/market-expansions';
import {primaryMarketExpansionId} from '../../../game/store/market-primary';
/** Base means the real starter collection, not a newly invented commercial expansion. */
export const BASE_COLLECTION = 'STARTER';
const starterPools=new WeakMap<GameContent,Set<string>>();
function starterIds(content:GameContent){let ids=starterPools.get(content);if(!ids){ids=new Set(Object.values(content.heroes).flatMap(h=>[...h.deck,...(h.starterCollection??[])].map(e=>e.cardId)));starterPools.set(content,ids);}return ids;}
export function matchesEditorExpansion(cardId:string,expansion:string|undefined,content?:GameContent){return !expansion||expansion==='ALL'||(expansion===BASE_COLLECTION?!!content&&starterIds(content).has(cardId):primaryMarketExpansionId(cardId)===expansion);}
export function editorExpansionOptions(cardIds:readonly string[]){const present=new Set(cardIds.map(primaryMarketExpansionId));return MARKET_EXPANSIONS.filter(e=>e.cardIds.length>0&&(e.public!==false||present.has(e.id)));}
