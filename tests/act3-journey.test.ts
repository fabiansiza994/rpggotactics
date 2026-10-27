import { describe,it,expect } from 'vitest';
import { Container, RenderTexture } from 'pixi.js';
import { Act3Journey, adjacentTempleSegment, journeyPose } from '../src/presentation/pixi/Act3Journey';
describe('Act III visual journey',()=>{
  it('requires a won segment and the authored adjacent successor',()=>{
    expect(adjacentTempleSegment('w3_e01','w3_e02',true)).toBe(true);
    expect(adjacentTempleSegment('w3_e01','w3_e02',false)).toBe(false);
    expect(adjacentTempleSegment('w3_e01','w3_e03',true)).toBe(false);
    // Act III is one act of ten now: XXVI hands over to XXVII; nothing follows XXX.
    expect(adjacentTempleSegment('w3_e06','w3_e07',true)).toBe(true);
    expect(adjacentTempleSegment('w3_e10','w3_e11',true)).toBe(false);
    expect(adjacentTempleSegment('e01','e02',true)).toBe(false);
  });
  it('slides forward and clamps a short smooth transition',()=>{
    expect(journeyPose(0,800)).toEqual({outgoing:-0,incoming:800,done:false});
    expect(journeyPose(180,800)).toEqual({outgoing:-400,incoming:400,done:false});
    expect(journeyPose(999,800)).toEqual({outgoing:-800,incoming:0,done:true});
  });
  it('holds local input only while active and releases the one owned snapshot',()=>{
    const field=new Container(),stage=new Container(),calls:boolean[]=[];
    const journey=new Act3Journey(field,stage,b=>calls.push(b));
    const texture=RenderTexture.create({width:8,height:8});
    journey.start(texture,800,400); expect(stage.children).toHaveLength(1);expect(field.x).toBe(800);
    journey.tick(180,false,800);expect(field.x).toBe(400);
    journey.tick(180,false,800);expect(field.x).toBe(0);expect(stage.children).toHaveLength(0);
    expect(texture.destroyed).toBe(true);expect(calls).toEqual([true,false]);
    journey.finish();expect(calls).toHaveLength(2);
  });
  for(const reduced of [true,false])it(`cancels safely on reduced motion or viewport change (${reduced})`,()=>{
    const field=new Container(),stage=new Container();const journey=new Act3Journey(field,stage,()=>{});
    journey.start(RenderTexture.create({width:8,height:8}),800,400);
    journey.tick(0,reduced,reduced?800:740);
    expect(journey.active).toBe(false);expect(field.x).toBe(0);expect(stage.children).toHaveLength(0);
  });
});
