import type {CardDefinition} from './card';
/** Authored gameplay tag, independent of artwork, market family or the human's inventory. */
export const isThunderCard=(card:CardDefinition):boolean=>card.tags.includes('thunder');
