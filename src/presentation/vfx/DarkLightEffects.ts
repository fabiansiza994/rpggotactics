import {darkLightTheme,lightFrameGroup} from './darkLightRecipe';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CardDefinition, Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import { catalogPremiumEnabled } from './catalogRecipes';
import { rasterRevealCard } from '../cards/revealCardTexture';

class Radiance extends PaintedEffectPool {
 get requested(){return catalogPremiumEnabled();}
 show(at:Pos,frames:readonly number[],duration:number){const p=this.lifted(at,.38),w=this.geometry.footprint(at).w;
 this.blendedSprite(frames,p,w*1.65,duration,(t,s)=>{s.alpha=Math.min(1,t*7)*Math.min(1,(1-t)*5);s.rotation=this.reduced?0:Math.sin(t*Math.PI)*.08;},false,true);}
}
interface Face { texture: Texture; strips: Texture[] }
/** One existing illustrated pool and presentation clock; no renderer, ticker or per-frame textures. */
export class DarkLightEffects extends PaintedEffectPool {
  private readonly radiance: Radiance;
  private readonly cardRoot = new Container({ eventMode: 'none' });
  private readonly cardStrips = Array.from({ length: 8 }, () => new Sprite());
  private readonly faces = new Map<string, Face>();
  private readonly jobs = new Map<string, Promise<void>>();
  private active: { cardId: string; age: number; duration: number; x: number; y: number } | null = null;
  private disposedFaces = false;
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    super(actors, ground, geometry, 'dark-light-smoke', 24, 'png');
    this.radiance=new Radiance(actors,ground,geometry,'dark-light-radiance',20,'png');
    this.cardRoot.visible = false;
    for (const sprite of this.cardStrips) { sprite.anchor.set(.5); sprite.eventMode = 'none'; this.cardRoot.addChild(sprite); }
    actors.addChild(this.cardRoot);
  }
  get requested() { return catalogPremiumEnabled(); }
  async prepareThemes(ids:readonly string[]){
   if(ids.some(id=>darkLightTheme(id)==='LIGHT'))await this.radiance.prepare();
   if(ids.some(id=>darkLightTheme(id)==='DARK'))await this.prepare();
  }
  theme(cardId:string,at:Pos,duration:number,impact=false):boolean{
   if(!this.requested)return false;
   if(darkLightTheme(cardId)==='LIGHT'&&this.radiance.ready){
    const group=lightFrameGroup(cardId);
    this.radiance.show(at,Array.from({length:4},(_,i)=>group+i),duration);return true;
   }
   if(darkLightTheme(cardId)==='DARK'&&this.ready){
    const p=this.lifted(at,impact ? .35 : .2),w=this.geometry.footprint(at).w;
    this.blendedSprite(impact?[8,9,10,11,12,13,14,15]:[0,1,2,3,4,5,6,7],p,w*(impact?1.6:1.25),duration,(t,s)=>{s.alpha=Math.min(1,t*7)*Math.min(1,(1-t)*5)*.85;s.tint=0xb58cdb;},false,false);return true;
   }return false;
  }
  override beginBatch(){super.beginBatch();this.radiance.beginBatch();}
  async prepareCards(cards: readonly CardDefinition[]): Promise<void> {
    if (!this.requested || this.disposedFaces) return;
    await Promise.all([this.prepare(), ...cards.map(card => {
      if (this.faces.has(card.id)) return Promise.resolve();
      const pending = this.jobs.get(card.id); if (pending) return pending;
      const job = rasterRevealCard(card, 320).then(canvas => {
        if (this.disposedFaces) return;
        const texture = Texture.from(canvas);
        const strips = Array.from({ length: 8 }, (_, i) => {
          const y = Math.round(i * canvas.height / 8), end = Math.round((i + 1) * canvas.height / 8);
          return new Texture({ source: texture.source, frame: new Rectangle(0, y, canvas.width, end - y) });
        });
        this.faces.set(card.id, { texture, strips });
        for (const key of this.faces.keys()) {
          if (this.faces.size <= 4) break;
          if (key !== this.active?.cardId && key !== card.id) this.releaseFace(key);
        }
      }).finally(() => this.jobs.delete(card.id));
      this.jobs.set(card.id, job); return job;
    })]);
  }
  private releaseFace(id: string) {
    const face = this.faces.get(id); if (!face) return;
    for (const strip of face.strips) strip.destroy(false);
    face.texture.destroy(true); this.faces.delete(id);
  }
  cursedCard(cardId: string, at: Pos, duration: number): void {
    const face = this.faces.get(cardId); if (!face || !this.requested) return;
    const ground = this.geometry.center(at), scale = this.geometry.footprint(at).w / 96;
    this.active = { cardId, age: 0, duration: Math.max(1, duration), x: ground.x, y: ground.y - 102 * scale };
    this.cardRoot.zIndex = this.geometry.depth(ground) + 90;
    this.cardRoot.visible = true;
    face.strips.forEach((texture, index) => { this.cardStrips[index]!.texture = texture; });
    this.advanceCard(0);
  }
  curseSmoke(at: Pos, duration: number): void {
    const ground = this.geometry.center(at), scale = this.geometry.footprint(at).w / 96;
    const center = { x: ground.x, y: ground.y - 100 * scale };
    this.sprite(Array.from({ length: 16 }, (_, index) => index), center, 185 * scale, duration, (t, sprite) => {
      sprite.alpha = Math.min(1, t * 8) * Math.max(0, 1 - Math.max(0, t - .7) / .3);
      sprite.tint = 0x66506e;
      sprite.rotation = Math.sin(t * Math.PI) * .04;
      sprite.zIndex = this.geometry.depth(ground) + 100;
    }, false, false);
  }
  private advanceCard(ms: number): void {
    const active = this.active; if (!active) return;
    active.age += ms;
    const t = Math.min(1, active.age / active.duration), face = this.faces.get(active.cardId);
    if (!face || t >= 1) { this.active = null; this.cardRoot.visible = false; return; }
    const split = this.reduced ? 0 : Math.max(0, (t - .4) / .6);
    const scale = 110 / face.texture.width;
    this.cardRoot.position.set(active.x, active.y);
    this.cardRoot.rotation = this.reduced ? 0 : Math.sin(t * Math.PI) * -.06;
    this.cardRoot.scale.set(scale * (1 - split * .25), scale);
    this.cardStrips.forEach((sprite, index) => {
      const top = Math.round(index * face.texture.height / 8), height = face.strips[index]!.height;
      sprite.position.set(Math.sin(index * 2.17) * split * 42, top + height / 2 - face.texture.height / 2 + split * (index - 3.5) * 12);
      sprite.rotation = split * Math.sin(index * 1.9) * .18;
      sprite.alpha = Math.min(1, t * 7) * (1 - split);
    });
  }
  override tick(ms: number): void { super.tick(ms); this.radiance.reduced=this.reduced;this.radiance.tick(ms);this.advanceCard(ms); }
  override clear(): void { super.clear(); this.radiance.clear();this.active = null; this.cardRoot.visible = false; }
  override destroy(): void {
    this.disposedFaces = true; this.clear(); this.cardRoot.destroy({ children: true });
    for (const id of [...this.faces.keys()]) this.releaseFace(id);
    this.radiance.destroy();super.destroy();
  }
  get radianceResources(){return this.radiance.snapshot;}
  get cardResources() { return { faces: this.faces.size, pending: this.jobs.size, active: !!this.active }; }
}
