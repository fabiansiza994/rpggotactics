import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, createProfile, serializeProfile, parseProfileSave, ownedFor, validateDeck, DECK_RULES, type GameState } from '../src/game';
import { shapeshifterCatalog, SHAPESHIFTER_STARTER } from '../src/game/data/shapeshifter-catalog';
import { PRIMORDIAL_LEGACY_CARDS as cards } from '../src/game/data/primordial-legacy';
import { SHAPESHIFTER_QA_SCENARIO as SC } from '../src/game/data/shapeshifter-qa';
import { effectsForCard } from '../src/game/domain/cards/form-effects';
import { formNature } from '../src/game/domain/transformations/transformations';
import type { CardDefinition } from '../src/game';
const base=shapeshifterCatalog(DEFAULT_CONTENT);
const content={...base, transformations:{...base.transformations,
  future_beast:{id:'future_beast',name:'Fixture futura',armorBonus:0},
  future_human:{id:'future_human',name:'Humanoide alternativo',armorBonus:0,nature:'HUMAN' as const}},
  heroes:{...base.heroes,shapeshifter:{...base.heroes.shapeshifter!,
    transformationForms:[...base.heroes.shapeshifter!.transformationForms!,'future_beast','future_human']}}};
function fixture(card:CardDefinition,form:string|null) {
  const s=structuredClone(new GameEngine(SC,content,13).state) as GameState;
  const h=s.units.find(u=>u.id===s.player.heroId)!, enemy=s.units.find(u=>u.kind==='ENEMY')!;
  h.pos={x:2,y:2}; h.hp=10;h.maxHp=20;h.armor=0;h.shield=0;h.activeForm=form??undefined;
  h.statuses=[]; enemy.pos={x:3,y:2};enemy.hp=enemy.maxHp=20;enemy.armor=0;enemy.shield=0;enemy.statuses=[];
  s.units=s.units.filter(u=>u===h||u===enemy);s.intents=[];s.obstacles=[];s.collectibles=[];
  s.player.energy=4;s.player.movePoints=0;s.player.hand=[{uid:'legacy',cardId:card.id}];
  return {s,h,enemy};
}
function resolve(card:CardDefinition,form:string|null) {
  const {s,h}=fixture(card,form), effects=effectsForCard(content,h,card);
  if(effects.some(e=>e.type==='CLEANSE')) h.statuses=[{id:'BURNING',turnsLeft:2}];
  const original=JSON.stringify(s);
  const engine=GameEngine.fromSnapshot(s,content,SC), replay=GameEngine.fromSnapshot(JSON.parse(original),content,SC);
  const target=card.targeting.type==='SELF'?null:card.targeting.type==='STEP'?engine.getValidTargets('legacy')[0]!:{x:3,y:2};
  const command={type:'PLAY_CARD' as const,cardUid:'legacy',target};
  const result=engine.dispatch(command);
  expect(result.ok).toBe(true);
  expect(replay.dispatch(command)).toEqual(result);expect(replay.state).toEqual(engine.state);
  const hero=engine.state.units.find(u=>u.id===h.id)!;
  expect(engine.state.player.energy).toBe(4-card.cost);
  expect(engine.state.player.discard.some(c=>c.cardId===card.id)).toBe(true);
  if(effects.some(e=>e.type==='DAMAGE'))expect(result.events.some(e=>e.type==='UNIT_DAMAGED')).toBe(true);
  if(effects.some(e=>e.type==='SHIELD'))expect(hero.shield).toBeGreaterThan(0);
  if(effects.some(e=>e.type==='HEAL'))expect(hero.hp).toBeGreaterThan(10);
  if(effects.some(e=>e.type==='DRAW'))expect(result.events.some(e=>e.type==='CARD_DRAWN')).toBe(true);
  if(effects.some(e=>e.type==='GAIN_MOVE_POINTS'))expect(engine.state.player.movePoints).toBeGreaterThan(0);
  if(effects.some(e=>e.type==='CLEANSE'))expect(hero.statuses).toEqual([]);
  if(effects.some(e=>e.type==='APPLY_STATUS'))expect(result.events.some(e=>e.type==='STATUS_APPLIED')).toBe(true);
  if(effects.some(e=>e.type==='PUSH'||e.type==='PULL'))expect(result.events.some(e=>e.type==='UNIT_PUSHED')).toBe(true);
  if(effects.some(e=>e.type==='STEP_CASTER'))expect(hero.pos).not.toEqual({x:2,y:2});
  return {engine,result,hero};
}
describe('Legado Primordial private expansion',()=>{
  it('registers 18 unique cards, six per collection, 48 total; no exact duplicate signatures',()=>{
    expect(cards).toHaveLength(18);expect(new Set(cards.map(c=>c.id)).size).toBe(18);
    for(const tag of ['bear_heart','labyrinth_blood','primal_instinct'])expect(cards.filter(c=>c.tags.includes(tag))).toHaveLength(6);
    const all=Object.values(base.cards).filter(c=>c.heroId==='shapeshifter');expect(all).toHaveLength(48);
    const signature=(c:CardDefinition)=>JSON.stringify([c.targeting,c.effects,c.formEffects??null]);
    for(const c of cards)expect(all.filter(x=>signature(x)===signature(c))).toHaveLength(1);
    expect(base.heroes.shapeshifter!.deck).toEqual(SHAPESHIFTER_STARTER);
    expect(SHAPESHIFTER_STARTER.reduce((n,e)=>n+e.count,0)).toBe(30);
    expect(SHAPESHIFTER_STARTER.some(e=>cards.some(c=>c.id===e.cardId))).toBe(false);
    for(const [id,c]of Object.entries(DEFAULT_CONTENT.cards))expect(base.cards[id]).toEqual(c);
    expect(DEFAULT_CONTENT.heroes.shapeshifter).toBeUndefined();
    for(const [id,h]of Object.entries(DEFAULT_CONTENT.heroes))expect(base.heroes[id]).toEqual(h);
    expect(DEFAULT_CONTENT.cards[cards[0]!.id]).toBeUndefined();
  });
  it.each(cards.filter(c=>!c.formEffects))('$name resolves its existing primitives and replays',card=>{
    resolve(card,card.requiredForms![0]!);
    const {s}=fixture(card,null), engine=GameEngine.fromSnapshot(s,content,SC),before=JSON.stringify(engine.state);
    expect(engine.getCardPlayability('legacy')).toMatchObject({playable:false,reason:'FORM_REQUIRED'});
    expect(engine.dispatch({type:'PLAY_CARD',cardUid:'legacy',target:null}).ok).toBe(false);
    expect(JSON.stringify(engine.state)).toBe(before);
  });
  it.each(cards.filter(c=>c.formEffects).flatMap(card=>[null,'bear','minotaur','future_beast','future_human'].map(form=>({card,form}))))(
    '$card.name in $form selects one complete branch and replays',({card,form})=>{
      const {h}=fixture(card,form), nature=form==='future_human'||!form?'HUMAN':'BEAST';
      expect(formNature(content,h)).toBe(nature);
      expect(effectsForCard(content,h,card)).toEqual(card.formEffects![nature]);
      const result=resolve(card,form);
      if(card.id.endsWith('lineage_pulse')) {
        expect(result.hero.hp).toBe(nature==='HUMAN'?11:10);
        expect(result.hero.shield).toBe(nature==='BEAST'?2:0);
      }
    });
  it('handles legacy/missing form metadata without hardcoded names',()=>{
    const {h}=fixture(cards[12]!,'future_beast');expect(formNature(content,h)).toBe('BEAST');
    h.activeForm='unregistered';expect(formNature(content,h)).toBe('HUMAN');
    delete h.activeForm;expect(formNature(content,h)).toBe('HUMAN');
  });
  it('gives new and existing QA profiles three owned copies, legal deck limits and persistence',()=>{
    const profile=createProfile(base);
    const old=structuredClone(profile);
    for(const c of cards)delete old.heroes.shapeshifter!.collection[c.id];
    const parsed=parseProfileSave(serializeProfile(old),base);expect(parsed.status).toBe('OK');
    if(parsed.status!=='OK')return;
    for(const c of cards)expect(parsed.profile.heroes.shapeshifter!.collection[c.id]!.copies).toBe(3);
    expect(parsed.profile.heroes.shapeshifter!.decks).toEqual(old.heroes.shapeshifter!.decks);
    const deck=[...SHAPESHIFTER_STARTER.filter(e=>e.cardId!=='qa_wild_strike'),{cardId:cards[0]!.id,count:3}];
    expect(validateDeck(deck,'shapeshifter',ownedFor(profile,'shapeshifter',base),base,DECK_RULES)).toEqual([]);
    expect(validateDeck([...deck.slice(0,-1),{cardId:cards[0]!.id,count:4}],'shapeshifter',ownedFor(profile,'shapeshifter',base),base,DECK_RULES).some(e=>e.code==='COPY_LIMIT')).toBe(true);
    expect(validateDeck(deck,'mage',ownedFor(profile,'mage',base),base,DECK_RULES).some(e=>e.code==='WRONG_HERO')).toBe(true);
    parsed.profile.heroes.shapeshifter!.decks[0]!.cards=deck;
    const reload=parseProfileSave(serializeProfile(parsed.profile),base);
    expect(reload.status).toBe('OK');if(reload.status==='OK')expect(reload.profile.heroes.shapeshifter!.decks[0]!.cards).toEqual(deck);
  });
  it('resolves low HP shield, finisher threshold and cleanses real hazards',()=>{
    const refuge=cards.find(c=>c.id.endsWith('_refuge'))!;
    expect(resolve(refuge,'bear').hero.shield).toBe(5);
    const verdict=cards.find(c=>c.id.endsWith('_verdict_axe'))!, f=fixture(verdict,'minotaur');
    f.enemy.hp=3;const engine=GameEngine.fromSnapshot(f.s,content,SC);
    const r=engine.dispatch({type:'PLAY_CARD',cardUid:'legacy',target:f.enemy.pos});
    expect(r.events.find(e=>e.type==='UNIT_DAMAGED')).toMatchObject({rawAmount:5,hpLost:3});
    const cleanup=cards.find(c=>c.id.endsWith('_ancestor_round'))!, t=fixture(cleanup,null);
    const tile=t.s.board.tiles[2*t.s.board.width+3]!;tile.terrain='FIRE';tile.terrainTurnsLeft=2;
    const e=GameEngine.fromSnapshot(t.s,content,SC);const out=e.dispatch({type:'PLAY_CARD',cardUid:'legacy',target:null});
    expect(out.ok).toBe(true);expect(out.events.some(e=>e.type==='TERRAIN_REMOVED')).toBe(true);
  });
});
