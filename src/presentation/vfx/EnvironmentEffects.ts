import {Container,Graphics,Sprite,Text} from 'pixi.js';
import type { GameState } from '../../game';
import type { GridProjection } from '../pixi/GridProjection';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';

type Kind = 'torch' | 'FIRE';
type Patch = { key: string; kind: Kind; x: number; y: number; w: number; h: number; depth: number };
type Live = Patch & { born: number; ended?: number; painted: boolean };
export const environmentFade = (age: number, remaining?: number) =>
  Math.max(0, Math.min(1, age / 350, remaining === undefined ? 1 : remaining / 450));
/** Permanent ambience and authoritative terrain share the existing bounded atlas pool.
 * No commands, timers, RNG, filters or new ticker. Ground effects never capture input.
 */
export class EnvironmentEffects extends PaintedEffectPool {
  private clock = 0;
  private live = new Map<string, Live>();
  wake = 1;
  private readonly frost = new Map<number,{root:Container;art:Sprite;cracks:Graphics;turns:Text;born:number;ended?:number;key:string}>();
  private readonly frostFree: Array<{root:Container;art:Sprite;cracks:Graphics;turns:Text}> = [];
  private readonly frostTransitions=new Set<number>();
  private readonly frostNeedsTexture=new Set<number>();
  private frostCreated=0;
  private frostUpdates=0;
  private frostGround:Container;
  get frostSnapshot(){return {active:this.frost.size,allocated:this.frostCreated,transitions:this.frostTransitions.size,updates:this.frostUpdates};}

  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    super(actors, ground, geometry, 'environment', 160);this.frostGround=ground;
  }
  get requested() {
    return true;
  }
  syncTorches(points: Array<{ x: number; y: number; scale: number; depth: number }>) {
    this.sync(
      'torch',
      points.map((p, i) => ({
        key: `torch:${i}`,
        kind: 'torch',
        x: p.x,
        y: p.y,
        w: 44 * p.scale,
        h: 52 * p.scale,
        depth: p.depth,
      })),
    );
  }
  syncTerrain(state: Readonly<GameState>, proj: GridProjection) {
    this.syncFrost(state,proj);
    const patches: Patch[] = [];
    state.board.tiles.forEach((tile, i) => {
      if (tile.terrain !== 'FIRE') return;
      const pos = { x: i % state.board.width, y: Math.floor(i / state.board.width) },
        p = proj.getTileCenter(pos),
        f = proj.footprint(pos);
      patches.push({
        key: `tile:${i}:${tile.terrain}`,
        kind: tile.terrain,
        x: p.x,
        y: p.y,
        w: f.w * 0.66,
        h: f.h * 0.66,
        depth: proj.depthAtPoint(p),
      });
    });
    this.sync('tile', patches);
  }
  /** Existing illustrated atlas, one static patch per cell. Only transitions tick. */
  private syncFrost(state:Readonly<GameState>,proj:GridProjection){
    const active=new Set<number>();
    state.board.tiles.forEach((tile,i)=>{
      if(tile.terrain!=='ICE')return;
      active.add(i);let item=this.frost.get(i);
      if(!item){const reuse=this.frostFree.pop();const art=reuse?.art??new Sprite(),cracks=reuse?.cracks??new Graphics(),turns=reuse?.turns??new Text({text:'',style:{fontFamily:'system-ui, sans-serif',fontSize:12,fontWeight:'700',fill:0xffe0b0,stroke:{color:0x0a0d12,width:3}}}),root=reuse?.root??new Container();
        if(!reuse){root.addChild(art,cracks,turns);this.frostCreated++;}
        root.eventMode='none';root.alpha=this.reduced?.78:0;this.frostGround.addChild(root);
        item={root,art,cracks,turns,born:this.clock,key:''};this.frost.set(i,item);this.frostTransitions.add(i);this.frostNeedsTexture.add(i);
      }
      if(item.ended!==undefined){delete item.ended;item.born=this.clock;this.frostTransitions.add(i);}
      const p={x:i%state.board.width,y:Math.floor(i/state.board.width)},c=proj.getTileCenter(p),f=proj.footprint(p);
      const text=tile.terrainTurnsLeft===null?'':String(tile.terrainTurnsLeft);if(item.turns.text!==text)item.turns.text=text;
      const key=`${c.x}:${c.y}:${f.w}:${f.h}`;
      if(item.key!==key){item.key=key;this.frostUpdates++;item.art.anchor.set(.5);item.art.position.set(c.x,c.y);item.art.width=f.w*.95;item.art.height=f.h*.94;item.art.alpha=.78;
        item.cracks.clear();const poly=proj.getInsetPolygon(p,.08);item.cracks.poly(poly.flatMap(v=>[v.x,v.y])).stroke({color:0xc5f4ff,width:.8,alpha:.32});
        // Stable fracture/edge variation, no game RNG and no per-frame geometry allocation.
        const a=poly[i%4]!,b=poly[(i+2)%4]!;item.cracks.moveTo(a.x,a.y).lineTo(c.x+(i%3-1)*f.w*.12,c.y).lineTo(b.x,b.y).stroke({color:0xe8fcff,width:1,alpha:.38});
        item.turns.anchor.set(1,0);item.turns.scale.set(f.w/96);const corner=proj.project(p.x+.94,p.y+.06);item.turns.position.set(corner.x,corner.y);
        item.root.zIndex=proj.depthAtPoint(c)-1;
      }
    });
    for(const [i,item]of this.frost)if(!active.has(i)&&item.ended===undefined){item.ended=this.clock;this.frostTransitions.add(i);}
    this.beginBatch();void this.prepare();
  }
  private sync(prefix: string, patches: Patch[]) {
    const keys = new Set(patches.map((p) => p.key));
    for (const [key, p] of this.live)
      if (key.startsWith(prefix) && !keys.has(key) && p.ended === undefined) p.ended = this.clock;
    for (const patch of patches) {
      const old = this.live.get(patch.key);
      if (old) {
        Object.assign(old, patch);
        old.ended = undefined;
      } else this.live.set(patch.key, { ...patch, born: this.clock, painted: false });
    }
    this.beginBatch();
    void this.prepare();
  }
  private paint(p: Live) {
    const phase = (p.x * 0.013 + p.y * 0.007) % 6;
    const fade = () =>
      environmentFade(
        this.clock - p.born,
        p.ended === undefined ? undefined : 450 - (this.clock - p.ended),
      ) * (p.kind === 'torch' ? this.wake : 1);
      const torch = p.kind === 'torch';
      this.sprite(
        [12],
        p,
        p.w * 1.5,
        Infinity,
        (_, s) => {
          s.position.set(p.x, p.y + (torch ? (30 * p.w) / 44 : 0));
          s.width = p.w * (torch ? 2.8 : 1);
          s.height = torch ? p.w * 1.1 : p.h;
          s.alpha =
            fade() * (this.reduced ? 0.22 : 0.22 + 0.025 * Math.sin(this.clock / 670 + phase));
        },
        true,
        true,
        p.key,
      );
      const count = torch || this.mobile ? 1 : 2;
      for (let i = 0; i < count; i++)
        this.sprite(
          [0],
          p,
          p.w,
          Infinity,
          (_, s) => {
            const t = this.clock / 1000 + phase + i * 1.7;
            const idx = this.reduced ? 0 : Math.floor(t * 6) % 4;
            s.texture = this.frames[(idx + 4) % 4]!;
            s.anchor.set(0.5, 0.96);
            s.position.set(
              p.x + (i - (count - 1) / 2) * p.w * 0.22,
              p.y + (torch ? 0 : p.h * 0.12),
            );
            s.width = p.w * (torch ? 0.85 : 0.48);
            s.height =
              (torch ? p.h : p.w * 0.54) * (this.reduced ? 1 : 1 + 0.045 * Math.sin(t * 5.1));
            s.rotation = this.reduced ? 0 : Math.sin(t * 3.7) * 0.025;
            s.alpha = fade() * 0.88;
            s.zIndex = p.depth + 0.1;
          },
          false,
          false,
          p.key,
        );
      if (!this.mobile)
        this.sprite(
          [8],
          p,
          p.w,
          Infinity,
          (_, s) => {
            const t = (this.clock / 2400 + phase) % 1;
            s.texture = this.frames[8 + Math.floor(t * 4)]!;
            s.position.set(p.x + Math.sin(t * 5) * p.w * 0.08, p.y - p.w * (0.5 + t * 0.5));
            s.width = p.w * 0.65;
            s.height = p.w * 0.8;
            s.alpha = this.reduced ? 0 : fade() * 0.1 * Math.sin(t * Math.PI);
            s.zIndex = p.depth + 0.2;
          },
          false,
          false,
          p.key,
        );
    this.sprite(
      [13],
      p,
      p.w * 0.38,
      Infinity,
      (_, s) => {
        const t = (((this.clock / 1900 + phase) % 1) + 1) % 1;
        s.position.set(p.x + Math.sin(t * 5 + phase) * p.w * 0.12, p.y - t * p.w * 0.55);
        s.width = p.w * 0.32;
        s.height = p.w * 0.42;
        s.alpha = this.reduced ? 0 : fade() * 0.3 * Math.sin(t * Math.PI);
        s.zIndex = p.depth + 0.3;
      },
      false,
      true,
      p.key,
    );
    p.painted = true;
  }
  override tick(ms: number) {
    this.clock += Math.max(0, ms);
    // Assign shared atlas frames once after async loading; no per-cell emitter or new texture.
    if(this.ready)for(const i of this.frostNeedsTexture){const item=this.frost.get(i);if(item){const w=item.art.width,h=item.art.height;item.art.texture=this.frames[4+i%4]!;item.art.width=w;item.art.height=h;}this.frostNeedsTexture.delete(i);}
    for(const i of this.frostTransitions){const item=this.frost.get(i);if(!item){this.frostTransitions.delete(i);continue;}
      if(item.ended!==undefined&&this.clock-item.ended>=450){item.root.removeFromParent();this.frostFree.push(item);this.frost.delete(i);this.frostTransitions.delete(i);continue;}
      item.root.alpha=this.reduced?(item.ended===undefined?1:0):environmentFade(this.clock-item.born,item.ended===undefined?undefined:450-(this.clock-item.ended));
      if(item.ended===undefined&&this.clock-item.born>=350)this.frostTransitions.delete(i);
    }
    for (const [key, p] of this.live) {
      if (p.ended !== undefined && this.clock - p.ended >= 450) {
        this.clearGroup(key);
        this.live.delete(key);
      } else if (this.ready && !p.painted) this.paint(p);
    }
    super.tick(ms);
  }
  override clear() {
    super.clear();
    this.live.clear();
    for(const item of this.frost.values()){item.root.removeFromParent();this.frostFree.push(item);}
    this.frost.clear();this.frostTransitions.clear();this.frostNeedsTexture.clear();
  }
  override destroy(){
    super.destroy();for(const item of this.frostFree)item.root.destroy({children:true});this.frostFree.length=0;
  }
}
