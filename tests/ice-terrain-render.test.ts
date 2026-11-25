import{it,expect}from'vitest';
import{Container,Texture}from'pixi.js';
import{EnvironmentEffects}from'../src/presentation/vfx/EnvironmentEffects';
import{GridProjection}from'../src/presentation/pixi/GridProjection';
import{makeEngine,mutable}from'./helpers';
class ReadyGround extends EnvironmentEffects{override async prepare(){if(!this.frames.length)this.frames=Array.from({length:16},()=>new Texture({source:Texture.WHITE.source}));}}
it('full-board frost is bounded, static, renewed without rebuild and pooled after thaw',()=>{
 const actors=new Container(),ground=new Container(),e=makeEngine(),proj=new GridProjection({cols:7,rows:5,tile:96,perspective:1.1,depth:.9});
 const fx=new ReadyGround(actors,ground,{center:p=>proj.getTileCenter(p),footprint:p=>proj.footprint(p),quad:p=>[...proj.getTilePolygon(p)],depth:p=>p.y});
 for(const t of mutable(e).board.tiles){t.terrain='ICE';t.terrainTurnsLeft=3;}fx.syncTerrain(e.state,proj);fx.tick(400);expect(fx.frostSnapshot).toMatchObject({active:35,allocated:35,transitions:0,updates:35});
 for(let i=0;i<1000;i++)fx.tick(16);expect(fx.frostSnapshot.updates).toBe(35);fx.syncTerrain(JSON.parse(JSON.stringify(e.state)),proj);fx.tick(400);expect(fx.frostSnapshot).toMatchObject({allocated:35,transitions:0,updates:35});
 mutable(e).board.tiles[0]!.terrain='NORMAL';fx.syncTerrain(e.state,proj);expect(fx.frostSnapshot.transitions).toBe(1);fx.tick(500);expect(fx.frostSnapshot.active).toBe(34);
 mutable(e).board.tiles[0]!.terrain='ICE';fx.syncTerrain(e.state,proj);fx.tick(400);expect(fx.frostSnapshot.allocated).toBe(35);
 const turn=new GridProjection({cols:7,rows:5,tile:96,perspective:1.1,depth:.9,quarterTurn:1});fx.syncTerrain(e.state,turn);fx.tick(400);expect(fx.frostSnapshot.active).toBe(35);expect(ground.children).toHaveLength(35);
 fx.destroy();expect(ground.children).toHaveLength(0);expect(fx.frostSnapshot.active).toBe(0);actors.destroy();ground.destroy();
});
