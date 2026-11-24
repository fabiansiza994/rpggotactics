import {describe,it,expect} from 'vitest';
import {ctxFor,makeEngine,mutable,p} from './helpers';
import {recoveryChoices,recoverToHand} from '../src/game/domain/cards/recovery';
import {resurrectionChoices,resurrectChosen,beginResurrection} from '../src/game/domain/cards/resurrection';
import {resolveCardChoice} from '../src/game/domain/cards/card-choice';
import {spawnSummon} from '../src/game/domain/summons/summons';
import {PVP_CONTENT} from '../server/src/pvp';
import {rankedBotCatalog} from '../server/src/rankedBotCatalog';
import {shapeshifterCardGroup} from '../src/game/data/shapeshifter-catalog';
import type {Env} from '../server/src/db';

function setup(){const e=makeEngine({hero:{heroId:'summoner',pos:p(0,2)}}),s=mutable(e),ctx=ctxFor(e);s.player.hand=[];s.player.deck=[];s.player.discard=[{uid:'source',cardId:'summon_chicken'}];s.deadSummonSources=[{ownerId:s.player.heroId,cardUid:'source',summonId:'chicken'}];return{e,s,ctx,owner:s.units.find(u=>u.id===s.player.heroId)!};}
describe('UID exclusivity across grave recovery and resurrection',()=>{
 it.each(['hand','deck','altar','banished'] as const)('rejects an instance occupied in %s without mutation',zone=>{const {e,s,ctx}=setup();s.player[zone]=[{uid:'source',cardId:'summon_chicken'}];expect(recoveryChoices(s,e.content)).toEqual([]);expect(resurrectionChoices(ctx)).toEqual([]);const before=JSON.stringify(s);expect(recoverToHand(ctx,'source','ANY_ONCE')).toBeUndefined();expect(resurrectChosen(ctx,'source',p(1,3))).toBe(false);expect(JSON.stringify(s)).toBe(before);});
 it('excludes a living summon source even after an earlier recorded death',()=>{const {e,s,ctx,owner}=setup();expect(spawnSummon(ctx,owner,'chicken',p(1,2),'source')).not.toBeNull();expect(recoveryChoices(s,e.content)).toEqual([]);expect(resurrectionChoices(ctx)).toEqual([]);const before=JSON.stringify(s);expect(recoverToHand(ctx,'source','ANY_ONCE')).toBeUndefined();expect(resurrectChosen(ctx,'source',p(1,3))).toBe(false);expect(JSON.stringify(s)).toBe(before);});
 it('revalidates an offered resurrection after reconnect when its source becomes active',()=>{const {s,ctx,owner}=setup();beginResurrection(ctx,p(1,3),'light_beyond_call');expect(s.player.pendingCardChoice?.options).toHaveLength(1);expect(spawnSummon(ctx,owner,'chicken',p(1,2),'source')).not.toBeNull();const restored=JSON.parse(JSON.stringify(s));const connected={...ctx,state:restored};const before=JSON.stringify(restored);for(let i=0;i<2;i++)expect(resolveCardChoice(connected,'source').ok).toBe(false);expect(JSON.stringify(restored)).toBe(before);});
 it('preserves a legitimate dead source and permits exactly one recovery',()=>{const {s,ctx}=setup();expect(resurrectionChoices(ctx).map(c=>c.uid)).toEqual(['source']);expect(resurrectChosen(ctx,'source',p(1,3))).toBe(true);expect(resurrectChosen(ctx,'source',p(2,3))).toBe(false);expect(s.units.filter(u=>u.summon?.sourceCardUid==='source')).toHaveLength(1);expect(s.player.discard).toHaveLength(0);});
 it('does not grant a fresh recovery to an already consumed source',()=>{const {e,s,ctx}=setup();s.player.discard[0]!.recoveredThisBattle=true;expect(recoveryChoices(s,e.content)).toEqual([]);expect(resurrectionChoices(ctx)).toEqual([]);});
});
describe('Expansion transformations preserve their own catalog contract',()=>{
 it('preserves Minotauro Abisal tags, existing transformation group and two copies',()=>{const c=PVP_CONTENT.cards.dark_abyssal_minotaur!;expect(c.heroId).toBe('shapeshifter');expect(c.maxCopies).toBe(2);expect(c.tags.every(t=>typeof t==='string')).toBe(true);expect(shapeshifterCardGroup(c)).toBe('transformation');});
 it('keeps all tags valid through the public bot catalog including the approved published expansion',()=>{const env={SHAPESHIFTER_ENABLED:'1',FREE_CATALOG_ENABLED:'1',TACTICAL_CARDS_ENABLED:'1',ARSENAL_CARDS_ENABLED:'1',SUMMONER_RITUALS_ENABLED:'1'} as Env;expect(()=>rankedBotCatalog(PVP_CONTENT,env)).not.toThrow();const c=rankedBotCatalog(PVP_CONTENT,env);expect(Object.values(c.cards).every(c=>c.tags.every(t=>typeof t==='string'))).toBe(true);expect(c.cards.dark_abyssal_minotaur).toMatchObject({heroId:'shapeshifter',maxCopies:2});});
 it('retains existing bear/minotaur catalog groups and never adds an expansion card to the starter grant',()=>{expect(shapeshifterCardGroup(PVP_CONTENT.cards.qa_bear_shove!)).toBe('bear');expect(shapeshifterCardGroup(PVP_CONTENT.cards.qa_iron_cleave!)).toBe('minotaur');expect(PVP_CONTENT.heroes.shapeshifter!.starterCollection?.some(c=>c.cardId==='dark_abyssal_minotaur')).toBe(false);});
});
