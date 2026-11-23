import {describe,it,expect} from 'vitest';
import {individualCopies,PLANNED_COMPETITIVE_DECK_SIZE} from '../src/presentation/react/deckbuilder/individualCopies';
import {DEFAULT_CONTENT,DECK_RULES,createProfile,heroProfile,activeDeck,ownedFor,editDeck,deckSize} from '../src/game';
describe('individual-copy deck presentation',()=>{
 it('represents each deck copy separately in stable order',()=>expect(individualCopies([{cardId:'fireball',count:3},{cardId:'blink',count:2}],80)).toEqual([{cardId:'fireball',copy:0},{cardId:'fireball',copy:1},{cardId:'fireball',copy:2},{cardId:'blink',copy:0},{cardId:'blink',copy:1}]));
 it('bounds large collections without truncating inventory or changing input',()=>{const input=[{cardId:'fireball',count:100000}];expect(individualCopies(input,80)).toHaveLength(80);expect(input[0]!.count).toBe(100000);expect(individualCopies(input,160)).toHaveLength(160);});
 it('never creates missing copies',()=>expect(individualCopies([{cardId:'a',count:0}],80)).toEqual([]));
 it('announces future competitive 40 without changing current or story rules',()=>{expect(PLANNED_COMPETITIVE_DECK_SIZE).toBe(40);expect(DECK_RULES.requiredSize).toBe(30);});
 it('add/remove uses real ownership validation and preserves profile until saved',()=>{const profile=createProfile(DEFAULT_CONTENT),saved=activeDeck(heroProfile(profile,'mage',DEFAULT_CONTENT)),original=structuredClone(profile),owned=ownedFor(profile,'mage',DEFAULT_CONTENT),cardId=saved.cards[0]!.cardId;const removed=editDeck(saved.cards,{type:'REMOVE_CARD',cardId},'mage',owned,DEFAULT_CONTENT,DECK_RULES);expect(removed.ok).toBe(true);if(!removed.ok)return;expect(deckSize(removed.deck)).toBe(29);const added=editDeck(removed.deck,{type:'ADD_CARD',cardId},'mage',owned,DEFAULT_CONTENT,DECK_RULES);expect(added.ok).toBe(true);if(added.ok)expect(deckSize(added.deck)).toBe(30);expect(profile).toEqual(original);});
});

it('40-card rendering is supported independently of authoritative validation',()=>{const copies=individualCopies([{cardId:'a',count:20},{cardId:'b',count:20}],80);expect(copies).toHaveLength(40);expect(copies.at(-1)).toEqual({cardId:'b',copy:19});expect(DECK_RULES.requiredSize).toBe(30);});
