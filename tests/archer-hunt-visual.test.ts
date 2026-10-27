import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { SPECIAL_ARROW_VISUALS, veilStage } from '../src/presentation/assets/archerHuntVisuals';
import { FINAL_CARD_ART, CHARACTER_PAINTINGS, ENVIRONMENT_PAINTINGS } from '../src/presentation/assets/paintedAssets';
import { withArcher } from '../src/game/data/archer';
import { DEFAULT_CONTENT } from '../src/game/data';
import { makeEngine, p, setHand } from './helpers';
import { unitVisualId, unitVisualTint } from '../src/presentation/assets/visualIdentity';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';
import { ARCHER_HUNT_CARDS } from '../src/game/data/archer-hunt';

describe('Sendero visual contracts',()=>{
  const content=withArcher(DEFAULT_CONTENT);
  it('has independent local art for five arrows, three enemies and the forest',()=>{
    for(const {id} of ARCHER_HUNT_CARDS)expect(existsSync(`public${FINAL_CARD_ART[id]}`)).toBe(true);
    for(const id of ['veil_stalker','veil_guardian','veil_beast']){
      expect(unitVisualId(id)).toBe(id);expect(unitVisualTint(id)).toBe(0xffffff);
      expect(existsSync(`public${CHARACTER_PAINTINGS[id]}`)).toBe(true);
    }
    expect(existsSync(`public${ENVIRONMENT_PAINTINGS.veil_forest}`)).toBe(true);
  });
  it('keeps rarity intact and adds presentation-only premium to Rebound',()=>{
    for(const id of Object.keys(SPECIAL_ARROW_VISUALS))expect(content.cards[id]!.rarity).toBe(id==='rebound_arrow'?'RARE':'UNCOMMON');
    expect(premiumIdentity(content.cards.rebound_arrow!).treatment).toBe('subtle'); // Rare finish (super = Legendary)
    expect(veilStage('hunt_01_trail')).toBe('trail');expect(veilStage('hunt_09_guardian')).toBe('veil');
  });
  it.each([false,true])('projects real rebound damage only after each flight (reduced=%s)',reduced=>{
    const e=makeEngine({hero:{heroId:'archer',pos:p(0,2)},enemies:[
      {id:'a',enemyId:'orc_warrior',pos:p(3,2)},
      {id:'b',enemyId:'orc_warrior',pos:p(4,2)},
      {id:'c',enemyId:'orc_warrior',pos:p(4,3)},
    ]},content);
    const [uid]=setHand(e,['rebound_arrow']);
    const result=e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:p(3,2)});
    expect(result.ok).toBe(true);if(!result.ok)return;
    const before=JSON.stringify(result.events);
    const plan=compileTimeline(result.events,id=>content.cards[id]!.presentation.visualKey,reduced);
    const flights=plan.cues.filter(c=>c.kind==='projectile');expect(flights).toHaveLength(3);
    const hits=plan.cues.filter(c=>c.event.type==='UNIT_DAMAGED');
    expect(hits).toHaveLength(3);
    hits.forEach((h,i)=>expect(h.at).toBeGreaterThanOrEqual(flights[i]!.at+flights[i]!.duration));
    expect(hits[1]!.at).toBeGreaterThan(hits[0]!.at);expect(hits[2]!.at).toBeGreaterThan(hits[1]!.at);
    expect(JSON.stringify(result.events)).toBe(before);
  });
  it('uses native line icons instead of fallback asterisks',()=>{
    const source=readFileSync('src/presentation/pixi/UnitView.ts','utf8');
    for(const token of ["SLOWED: 'frost'","BURNING: 'flame'","POISONED: 'poison'","SMOKE_SCREEN: 'smoke'"])expect(source).toContain(token);
  });
});
