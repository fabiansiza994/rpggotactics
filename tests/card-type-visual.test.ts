import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { shapeshifterCatalog } from '../src/game/data/shapeshifter-catalog';
import { TEMPLE_REWARD_CARDS } from '../src/game/data/temple-rewards';
import { cardVisualType, CARD_TYPE_VISUALS } from '../src/presentation/cards/cardType';
import { CardTypeVisual } from '../src/presentation/react/components/CardTypeVisual';

describe('card type presentation independent from rarity',()=>{
  const content=shapeshifterCatalog(withArcher(DEFAULT_CONTENT));
  const cards=Object.values({...withShapeshifterRelease(withArcher(DEFAULT_CONTENT)).cards,...content.cards,...Object.fromEntries(TEMPLE_REWARD_CARDS.map(c=>[c.id,c]))});
  it('audits the full public and QA catalog without modifying any definition',()=>{
    const before=JSON.stringify(cards);
    const audit=cards.map(card=>({id:card.id,name:card.name,type:cardVisualType(card),rarity:card.rarity??'COMMON',category:card.category}));
    expect(audit.length).toBeGreaterThan(100);
    expect(audit.every(row=>row.type in CARD_TYPE_VISUALS)).toBe(true);
    expect(new Set(audit.map(row=>row.type)).size).toBe(5);
    expect(JSON.stringify(cards)).toBe(before);
    mkdirSync('qa/card-type-visual', { recursive: true });
    writeFileSync('qa/card-type-visual/catalog-audit.json',JSON.stringify(audit,null,2)+'\n');
  });
  it('classifies Cuidar bandada as protection and every Act III reward',()=>{
    expect(cardVisualType(content.cards.nurture!)).toBe('defense');
    expect(cardVisualType(content.cards.ice_wall!)).toBe('defense');
    for(const card of TEMPLE_REWARD_CARDS) expect(CARD_TYPE_VISUALS[cardVisualType(card)]).toBeDefined();
  });
  it('uses actual summoning effects, never just summon-related tags',()=>{
    expect(cardVisualType(content.cards.summon_chicken!)).toBe('summon');
    expect(cardVisualType(content.cards.pack_call!)).not.toBe('summon');
  });
  it('ritual pieces take precedence over their secondary effect',()=>{
    for(const card of cards.filter(c=>c.ritualPiece)) expect(cardVisualType(card)).toBe('ritual');
  });
  it('does not change type for common/rare or premium treatment',()=>{
    const card=content.cards.summon_chicken!;
    for(const rarity of ['COMMON','RARE'] as const) {
      const variant={...card,rarity};
      expect(cardVisualType(variant)).toBe('summon');
      const html=renderToStaticMarkup(createElement(CardTypeVisual,{card:variant}));
      expect(html).toContain('data-card-type="summon"');
      expect(html).toContain('Invocación');
      expect(html).not.toContain('foil');
    }
  });
  it('supports explicit presentation metadata without id-specific code',()=>{
    const card=content.cards.nurture!;
    expect(cardVisualType({...card,presentation:{...card.presentation,cardType:'tactic'}})).toBe('tactic');
  });
});
