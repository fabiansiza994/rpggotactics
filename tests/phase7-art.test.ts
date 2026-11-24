import {darkLightTheme,lightFrameGroup} from '../src/presentation/vfx/darkLightRecipe';
import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {DARK_LIGHT_CARD_ART,DARK_LIGHT_UNIT_ART} from '../src/presentation/assets/darkLightArt';
import {DARK_LIGHT_CARDS} from '../src/game/data/dark-light';
import {HAMMER_TIMING,hammerDescent} from '../src/presentation/vfx/thunderHammerRecipe';
import {compileTimeline} from '../src/presentation/vfx/spellTimeline';
import type {GameEvent} from '../src/game';
it('all thirty cards resolve to their own original painting without changing card contracts',()=>{
 expect(Object.keys(DARK_LIGHT_CARD_ART).sort()).toEqual(DARK_LIGHT_CARDS.map(c=>c.id).sort());
 for(const c of DARK_LIGHT_CARDS){expect(c.maxCopies).toBe(2);const p=DARK_LIGHT_CARD_ART[c.id]!;expect(p).toContain(c.id);expect(existsSync('public'+p)).toBe(true);}
});
it('four new atlases have 24 distinct authored cells and transparent safe margins',()=>{
 const audit=JSON.parse(readFileSync('qa/dark-light-phase7-20261123/ASSET_AUDIT.json','utf8'));
 for(const id of ['dark_abyssal_minotaur','dark_serpent_king','dark_scorpion_king','light_pact_fairy']){const a=audit[id];expect(a.width).toBe(1536);expect(a.height).toBe(1024);expect(a.cells).toHaveLength(24);expect(new Set(a.cells.map((c:{sha256:string})=>c.sha256)).size).toBe(24);expect(a.transparentFraction).toBeGreaterThan(.3);for(const c of a.cells){expect(c.bounds[0]).toBeGreaterThan(0);expect(c.bounds[1]).toBeGreaterThan(0);expect(c.bounds[2]).toBeLessThan(256);expect(c.bounds[3]).toBeLessThan(256);}expect(DARK_LIGHT_UNIT_ART[id]).toContain('/v7/');}
});
it('hammer is readable before accelerating, remains bounded and uses presentation timing only',()=>{
 expect(HAMMER_TIMING.travel).toBeGreaterThanOrEqual(500);expect(hammerDescent(0)).toBe(0);expect(hammerDescent(.18)).toBeGreaterThan(0);expect(hammerDescent(1)).toBe(1);expect(hammerDescent(0,true)).toBe(1);
 expect(hammerDescent(.9)-hammerDescent(.8)).toBeGreaterThan(hammerDescent(.4)-hammerDescent(.3));
 let last=0;for(let t=0;t<=1;t+=.01){const x=hammerDescent(t);expect(x).toBeGreaterThanOrEqual(last);expect(x).toBeLessThanOrEqual(1);last=x;}
});
it('negation renders only the confirmed public cancelled card, never a spell or damage cue',()=>{
 const event={type:'CARD_NEGATED',cardUid:'x',cardId:'fireball',casterId:'a',responderId:'b'} as GameEvent;const before=JSON.stringify(event);
 for(const reduced of [false,true]){const p=compileTimeline([event],()=> 'fireball',reduced);expect(p.cues.map(c=>c.key)).toEqual(['negate-card','negate-seal']);expect(p.cues.every(c=>c.kind==='event')).toBe(true);expect(p.duration).toBeGreaterThan(0);}
 expect(JSON.stringify(event)).toBe(before);
});

it('draw/recovery are never illustrated as healing and Fairy creates no attack or healing cue',()=>{expect(lightFrameGroup('light_restoring_grace')).toBe(12);expect(lightFrameGroup('light_grace_call')).toBe(12);expect(lightFrameGroup('light_minor_blessing')).toBe(8);expect(lightFrameGroup('light_pact_fairy')).toBe(0);expect(darkLightTheme('fireball')).toBeNull();expect(darkLightTheme('light_fake')).toBeNull();});
