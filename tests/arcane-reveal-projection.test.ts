import{DEFAULT_CONTENT}from'../src/game';
import{createDuel,validateLoadout}from'../src/game/pvp/duel';
import{createProfile}from'../src/game';
import {describe,it,expect} from 'vitest';
import {revealCorners,revealWarmupCards} from '../src/presentation/pixi/ArcaneRevealView';
describe('Ultra projected mesh',()=>{
 it('preserves face dimensions without rotation',()=>expect(revealCorners(300,420,0,0,0,1)).toEqual([-150,-210,150,-210,150,210,-150,210]));
 it('projects depth rather than merely rotating a flat sprite',()=>{const c=revealCorners(300,420,50,12,0,1);expect(c.every(Number.isFinite)).toBe(true);expect(Math.abs(c[3]!-c[1]!)).toBeGreaterThan(5);expect(Math.abs(c[2]!-c[0]!)).toBeLessThan(300);});
 it('is stable through an entire turn including edge-on',()=>{for(let yaw=-180;yaw<=180;yaw++){const c=revealCorners(350,489,yaw,12,-8,1);expect(c.every(Number.isFinite)).toBe(true);expect(Math.max(...c.map(Math.abs))).toBeLessThan(1000);}});
});

it('prepares public champion definitions, not PvP unit IDs',()=>{const load=validateLoadout(createProfile(DEFAULT_CONTENT),'mage'),state=createDuel([load,load],42);expect(state.units.some(u=>u.id==='champion-a')).toBe(true);expect(revealWarmupCards(DEFAULT_CONTENT,state)).toContain('absolute_zero');expect(revealWarmupCards(DEFAULT_CONTENT,state)).toContain('eternal_winter_heart');});
