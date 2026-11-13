import { describe, it, expect } from 'vitest';
import { handOverflow, handArrivalCenter } from '../src/presentation/react/handScroll';
describe('hand viewport', () => {
 it.each([1,4,6,7,10])('exposes both ends for %s full size cards without altering their size', n => {
  const width=600, content=n*154+Math.max(0,n-1)*10+56;
  expect(handOverflow(0,width,content)).toEqual({before:false,after:content>width+2});
  expect(handOverflow(Math.max(0,content-width),width,content)).toEqual({before:content>width+2,after:false});
 });
 it('ignores fractional rounding and negative elastic overscroll',()=>{
  expect(handOverflow(-1,600,601)).toEqual({before:false,after:false});
  expect(handOverflow(399.4,600,1000)).toEqual({before:true,after:false});
 });
 it('indicates both directions when midway through a long hand',()=>expect(handOverflow(200,600,1800)).toEqual({before:true,after:true}));
 it('keeps visible draw arrival coordinates exact',()=>expect(handArrivalCenter(420,154,100,900)).toBe(420));
 it('lands an offscreen last card inside the hand, clear of end turn',()=>expect(handArrivalCenter(1800,154,100,900)).toBe(823));
 it('lands an offscreen first card at the visible left edge',()=>expect(handArrivalCenter(-200,154,100,900)).toBe(177));
 it('handles a viewport narrower than a card',()=>expect(handArrivalCenter(800,154,100,200)).toBe(150));
});
