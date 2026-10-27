import { CatalogEffects } from './CatalogEffects';
import { MageEffects } from './MageEffects';
import { REACTION_COLOR, type HitReaction } from './hitReactions';
import { BastionEffects } from './BastionEffects';
import { PactSummonEffects } from './PactSummonEffects';
import { FireballEffects } from './FireballEffects';
import { ICON_PATHS } from '../assets/iconPaths';
import { Container, Graphics, GraphicsPath, Text } from 'pixi.js';
import type { Pos } from '../../game';
import { specialArrow as arrowVisual } from '../assets/archerHuntVisuals';

export type Family = 'FIRE' | 'ICE' | 'ARCANE' | 'BARRIER' | 'FORCE';
export const ELEMENTS = {
  FIRE: { core: 0xffefbd, light: 0xffad42, edge: 0xe34722 },
  ICE: { core: 0xf0fdff, light: 0x9aebff, edge: 0x4596c0 },
  ARCANE: { core: 0xf2dfff, light: 0xc39bff, edge: 0x7253e3 },
  BARRIER: { core: 0xfff4c4, light: 0xf5d27d, edge: 0xb58a48 },
  FORCE: { core: 0xf2f8ff, light: 0xb9dbe8, edge: 0x7292aa },
} satisfies Record<Family, { core: number; light: number; edge: number }>;

type Point = { x: number; y: number };

/**
 * Geometry the effects draw against. In the game it is backed by GridProjection, so every effect
 * follows the projected tile surface; a bare centre function keeps the flat 96px test fixture.
 */
export interface FxGeometry {
  /** Ground anchor of a cell (projected tile centre). */
  center(p: Pos): Point;
  /** Local projected tile size at a cell. */
  footprint(p: Pos): { w: number; h: number };
  /** Projected tile polygon, shrunk by `inset` cells. */
  quad(p: Pos, inset: number): Point[];
  /** Y-sort key for a world point (actors and projectiles share it). */
  depth(point: Point): number;
}

const TILE = 96;
/** Reference body height for effects that sit on a figure (chest, head, staff). */
const BODY = TILE * 1.22;

function flatGeometry(center: (p: Pos) => Point): FxGeometry {
  return {
    center,
    footprint: () => ({ w: TILE, h: TILE }),
    quad: (p, inset) => {
      const c = center(p),
        h = TILE * (0.5 - inset);
      return [
        { x: c.x - h, y: c.y - h },
        { x: c.x + h, y: c.y - h },
        { x: c.x + h, y: c.y + h },
        { x: c.x - h, y: c.y + h },
      ];
    },
    depth: (point) => point.y,
  };
}

const flat = (points: readonly Point[]) => points.flatMap((p) => [p.x, p.y]);

type Animation = {
  age: number;
  duration: number;
  update: (t: number) => void;
  cleanup: () => void;
};
type Particle = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  family: Family;
};

/** Shared animation clock, bounded Graphics/Text pools and 96 recycled particle records. */
export class ElementEffects {
  readonly catalog: CatalogEffects;
  readonly fireball: FireballEffects;
  readonly mage: MageEffects;
  private readonly reactionCancels = new Map<string, () => void>();
  readonly bastion: BastionEffects;
  readonly pactSummon: PactSummonEffects;
  private animations: Animation[] = [];
  private readonly freeGraphics: Graphics[] = [];
  private readonly freeText: Text[] = [];
  private graphicsCount = 0;
  private textCount = 0;
  private readonly particleArt = new Graphics();
  private readonly ambientArt = new Graphics();
  private readonly particles: Particle[] = Array.from({ length: 96 }, () => ({
    alive: false,
    age: 0,
    life: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 1,
    family: 'FIRE',
  }));
  private fireTiles: Pos[] = [];
  private ambientClock = 0;
  private clock = 0;
  private readonly numbers = new Map<string, { text: Text; amount: number }>();
  private readonly lanes = new Map<string, number>();
  reduced = false;
  private readonly geometry: FxGeometry;
  private readonly ground: Container;

  /**
   * @param layer        effects above actors (bursts, numbers, particles)
   * @param projectiles  Y-sorted actor layer: projectiles take a depth from their ground track
   * @param geometry     projection-backed geometry (or a flat centre function)
   * @param ground       decals on the tile surface, below actors (glyphs, areas, light, embers)
   */
  constructor(
    private readonly layer: Container,
    private readonly projectiles: Container,
    geometry: FxGeometry | ((p: Pos) => Point),
    ground?: Container,
  ) {
    this.geometry = typeof geometry === 'function' ? flatGeometry(geometry) : geometry;
    this.ground = ground ?? layer;
    this.catalog = new CatalogEffects(projectiles, this.ground, this.geometry);
    this.fireball = new FireballEffects(projectiles, this.ground, this.geometry);
    this.mage = new MageEffects(projectiles, this.ground, this.geometry);
    this.bastion = new BastionEffects(projectiles, this.ground, this.geometry);
    this.pactSummon = new PactSummonEffects(projectiles, this.ground, this.geometry);
    this.ground.addChild(this.ambientArt);
    this.layer.addChild(this.particleArt);
    this.layer.eventMode = 'none';
    this.ground.eventMode = 'none';
    this.projectiles.eventMode = 'none';
  }

  /** Ground anchor (projected tile centre). */
  readonly center = (p: Pos): Point => this.geometry.center(p);

  /** A point on a standing figure: k = 0 feet, 0.5 chest, 1 head. Scales with the row. */
  lift(p: Pos, k: number): Point {
    const c = this.geometry.center(p),
      s = this.geometry.footprint(p).w / TILE;
    return { x: c.x, y: c.y - BODY * k * s };
  }

  private surface(p: Pos): { sx: number; sy: number } {
    const f = this.geometry.footprint(p);
    return { sx: f.w / TILE, sy: f.h / TILE };
  }

  animate(
    duration: number,
    update: (t: number) => void,
    cleanup: () => void = () => {},
  ): () => void {
    update(0);
    const animation = { age: 0, duration, update, cleanup };
    this.animations.push(animation);
    return () => {
      const index = this.animations.indexOf(animation);
      if (index >= 0) {
        this.animations.splice(index, 1);
        cleanup();
      }
    };
  }

  private graphic(layer = this.layer): Graphics | null {
    const g =
      this.freeGraphics.pop() ??
      (this.graphicsCount < 48 ? (this.graphicsCount++, new Graphics()) : null);
    if (!g) return null;
    g.clear();
    g.position.set(0);
    g.zIndex = 0;
    g.scale.set(1);
    g.rotation = 0;
    g.alpha = 1;
    g.tint = 0xffffff;
    layer.addChild(g);
    return g;
  }
  private release(g: Graphics): void {
    g.removeFromParent();
    g.clear();
    this.freeGraphics.push(g);
  }

  /** Short pooled bond: no persistent link, blur, particle loop or new renderer. */
  tacticalBond(from:Pos,to:Pos,boosted=false):void {
    const g=this.graphic();if(!g)return;
    const a=this.lift(from,.45),b=this.lift(to,.45);
    g.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color:boosted?0xe4cfff:0xa890c5,width:boosted?2:1.2,alpha:.8});
    g.circle(b.x,b.y,boosted?8:5).stroke({color:0xc4a1e4,width:1.2});
    this.animate(this.reduced?80:220,t=>{g.alpha=1-t;},()=>this.release(g));
  }
  /** A finite, pooled violet impulse; the prepared cue has a distinct crimson core. */
  unleashedHunt(pos: Pos, prepared = false): void {
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .16), scale = this.surface(pos).sx;
    g.position.set(c.x, c.y); g.scale.set(scale);
    g.ellipse(0, 0, 29, 12).stroke({color: prepared ? 0xdc94bc : 0xb88aef, width: 2, alpha: .9});
    for (let i = -1; i <= 1; i++) {
      const x = i * 13;
      g.moveTo(x - 5, 4).lineTo(x, -7).lineTo(x + 5, 4)
        .stroke({color: 0xe8d7ff, width: 2, alpha: .9});
      if (!prepared) g.moveTo(x, -9).lineTo(x + 4, -32)
        .stroke({color: 0xae72e5, width: 1.5, alpha: .65});
    }
    this.animate(this.reduced ? 110 : prepared ? 260 : 420, t => {
      g.alpha = 1 - t;
      if (!this.reduced) { g.scale.set(scale * (1 + t * .24)); g.y = c.y - t * 9 * scale; }
    }, () => this.release(g));
  }

  bindingWard(pos:Pos,boosted:boolean):void {
    const g=this.graphic();if(!g)return;
    const c=this.lift(pos,.45),{sx}=this.surface(pos);g.position.set(c.x,c.y);g.scale.set(sx);
    g.ellipse(0,0,boosted?27:22,34).stroke({color:boosted?0xdac0f5:0xa890c5,width:boosted?2.5:1.6,alpha:.85});
    if(boosted)g.poly([0,-22,9,-12,0,-2,-9,-12,0,-22]).stroke({color:0xe4cfff,width:1.4});
    this.animate(this.reduced?100:280,t=>{g.alpha=1-t;},()=>this.release(g));
  }
  preyCue(pos:Pos):void {
    const g=this.graphic();if(!g)return;
    const c=this.lift(pos,.85),{sx}=this.surface(pos);g.position.set(c.x-12*sx,c.y-28*sx);g.scale.set(sx);
    g.path(new GraphicsPath(ICON_PATHS.prey)).stroke({color:0xe5cfff,width:2});
    this.animate(this.reduced?80:180,t=>{g.alpha=1-t;},()=>this.release(g));
  }

  /**
   * Vínculo Prohibido, three pooled beats (finite, no new ticker):
   * gather  — dark arcane energy coils around the Summoner while the card is presented;
   * sacrifice — a crimson/violet column rises from the chest as the HP is paid;
   * seal    — a ground circle with three sockets locks in, the third one crimson (the new point).
   */
  forbiddenBond(pos: Pos, stage: 'gather' | 'sacrifice' | 'seal', duration?: number): void {
    const g = stage === 'seal' ? this.graphic(this.ground) : this.graphic();
    if (!g) return;
    const scale = this.surface(pos), reduced = this.reduced;
    if (stage === 'gather') {
      const c = this.lift(pos, .5);
      g.position.set(c.x, c.y); g.scale.set(scale.sx);
      for (let i = 0; i < 3; i++) g.ellipse(0, 0, 30 - i * 5, 44 - i * 8).stroke({ color: i === 1 ? 0x6f4bd8 : 0x2a1f66, width: 2.4 - i * .5, alpha: .9 });
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        g.moveTo(Math.cos(a) * 34, Math.sin(a) * 48).lineTo(Math.cos(a + .5) * 18, Math.sin(a + .5) * 26).stroke({ color: 0xa98bff, width: 1.4, alpha: .75 });
      }
      this.animate(duration ?? (reduced ? 80 : 420), t => {
        g.alpha = reduced ? 1 - t : Math.sin(Math.PI * Math.min(.99, t * .9 + .1));
        if (!reduced) { g.rotation = t * 1.1; g.scale.set(scale.sx * (1.25 - t * .35)); }
      }, () => this.release(g));
      return;
    }
    if (stage === 'sacrifice') {
      const feet = this.lift(pos, .05), chest = this.lift(pos, .55);
      g.position.set(chest.x, chest.y); g.scale.set(scale.sx);
      g.circle(0, 0, 10).fill({ color: 0xff3d6e, alpha: .85 });
      g.circle(0, 0, 18).stroke({ color: 0xff8fa8, width: 2, alpha: .8 });
      for (let k = 0; k < 2; k++)
        for (let i = 0; i < 14; i++) {
          const u = i / 14, a = u * 9 + k * Math.PI, x = Math.sin(a) * (8 + u * 16), y = -u * 70;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
      g.stroke({ color: 0xff4d7a, width: 2, alpha: .85 });
      g.moveTo(0, 0).lineTo(0, (feet.y - chest.y) / scale.sx).stroke({ color: 0x8a5cff, width: 3, alpha: .55 });
      this.sparksAt(chest.x, chest.y, 'FIRE', reduced ? 1 : 6, 14);
      this.animate(duration ?? (reduced ? 120 : 520), t => {
        g.alpha = 1 - t * t;
        if (!reduced) { g.y = chest.y - t * 14 * scale.sx; g.scale.set(scale.sx * (1 + t * .2)); }
      }, () => this.release(g));
      return;
    }
    const c = this.center(pos);
    g.position.set(c.x, c.y);
    g.circle(0, 0, 38).stroke({ color: 0xd7b269, width: 1.4, alpha: .8 }).circle(0, 0, 31).stroke({ color: 0x9a72ff, width: 2.4 });
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 - Math.PI / 2, x = Math.cos(a) * 34, y = Math.sin(a) * 34, color = i === 2 ? 0xff4d7a : 0xc6b0ff;
      g.poly([x, y - 7, x + 7, y, x, y + 7, x - 7, y]).fill({ color, alpha: .9 }).stroke({ color: 0xf2e2b0, width: 1 });
    }
    g.poly([0, -31, 27, 15.5, -27, 15.5, 0, -31]).stroke({ color: 0xb48cff, width: 1.2, alpha: .7 });
    this.animate(duration ?? (reduced ? 160 : 620), t => {
      const k = reduced ? 1 : .6 + Math.min(1, t * 2.2) * .45;
      g.scale.set(scale.sx * k, scale.sy * k);
      g.alpha = t < .7 ? 1 : 1 - (t - .7) / .3;
      if (!reduced) g.rotation = (1 - t) * -.6;
    }, () => this.release(g));
  }

  /** Arsenal showcase accents use the existing bounded graphics pool and finite ticker. */
  arsenalShowcase(pos: Pos, key: 'silence_seal' | 'alpha_instinct' | 'guard_breaker'): void {
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .55), scale = this.surface(pos).sx;
    g.position.set(c.x, c.y); g.scale.set(scale);
    if (key === 'silence_seal') {
      g.circle(0, 0, 23).circle(0, 0, 17).stroke({ color:0x8be9ed, width:1.6 });
      g.poly([0,-28,23,0,0,28,-23,0,0,-28]).stroke({color:0xd7faff,width:1.4});
      g.moveTo(-12,-6).lineTo(12,-6).moveTo(-12,6).lineTo(12,6).stroke({color:0x8be9ed,width:2});
    } else if (key === 'alpha_instinct') {
      g.ellipse(0,0,24,30).stroke({color:0xc99beb,width:2});
      for (let i=0;i<3;i++) g.moveTo(-12+i*10,-14).lineTo(-18+i*10,14).stroke({color:0xd57a95,width:2.5});
    } else {
      g.poly([-4,-22,-20,-16,-15,6,-5,16,-1,5,-8,-3,-4,-22]).stroke({color:0xd9c08c,width:2});
      g.poly([4,-22,20,-16,15,6,5,16,1,5,8,-3,4,-22]).stroke({color:0xd9c08c,width:2});
      this.sparksAt(c.x,c.y,'FIRE',this.reduced?1:5,16);
    }
    this.animate(this.reduced?90:260,t=>{g.alpha=1-t;if(!this.reduced)g.scale.set(scale*(.9+t*.18));},()=>this.release(g));
  }

  /** Temporary fire fissure: ground cracks first, heat flash second; never terrain mutation. */
  magmaFissure(tiles: readonly Pos[], stage: 'windup' | 'impact'): void {
    for (const pos of tiles) {
      const g = this.graphic(this.ground); if (!g) continue;
      const c = this.center(pos), {sx,sy} = this.surface(pos);
      g.position.set(c.x,c.y); g.scale.set(sx,sy);
      const crack = [-30,12,-17,3,-5,6,2,-8,15,-3,30,-14];
      g.poly(crack,false).stroke({color:stage === 'windup' ? 0xe99b56 : 0xffd18b,width:stage === 'windup' ? 2 : 4});
      g.poly(crack,false).stroke({color:0xff722a,width:10,alpha:.18});
      this.animate(this.reduced ? 100 : stage === 'windup' ? 150 : 270,t=>{g.alpha=this.reduced?.7:Math.sin(Math.PI*Math.min(.99,t+.12));},()=>this.release(g));
      if(stage==='impact') {this.light(pos,'FIRE');this.sparksAt(c.x,c.y,'FIRE',this.reduced?1:3,12);}
    }
  }

  primordialBite(from: Pos, to: Pos): void {
    this.charge(from, 'ARCANE', this.reduced ? 20 : 45);
    let struck = false;
    this.animate(this.reduced ? 40 : 180, t => {
      if (struck || t < .25) return;
      struck = true;
      this.streak(from, to);
      this.burst(to, 'FIRE', false, this.reduced ? 60 : 110);
      this.glyph(to, 'ARCANE', this.reduced ? 60 : 110, 18);
    }, () => {});
  }

  ashBite(from: Pos, to: Pos): void {
    this.streak(from,to); this.burst(to,'FIRE',false,this.reduced?80:140);
    const c=this.center(to);this.sparksAt(c.x,c.y,'FIRE',this.reduced?1:4,10);
  }

  glyph(pos: Pos, family: Family, duration = 260, radius = 30): void {
    const g = this.graphic(this.ground);
    if (!g) return;
    const c = this.center(pos),
      { sx, sy } = this.surface(pos),
      colors = ELEMENTS[family];
    g.circle(0, 0, radius).stroke({ color: colors.light, width: 2 });
    if (family === 'ICE') {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        g.moveTo(0, 0)
          .lineTo(Math.cos(a) * radius, Math.sin(a) * radius)
          .stroke({ color: colors.core, width: 1 });
      }
    } else {
      g.circle(0, 0, radius * 0.75).stroke({ color: colors.edge, width: 1 });
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2,
          x = Math.cos(a) * radius,
          y = Math.sin(a) * radius;
        g.poly([x, y - 4, x + 3, y, x, y + 4, x - 3, y]).fill(colors.core);
      }
    }
    // Drawn as a circle, flattened onto the projected tile surface around the ground anchor.
    g.position.set(c.x, c.y);
    this.animate(
      duration,
      (t) => {
        const k = this.reduced ? 1 : 0.45 + t * 0.75;
        g.scale.set(k * sx, k * sy);
        g.alpha = Math.sin(Math.PI * Math.min(0.99, t + 0.08)) * 0.85;
      },
      () => this.release(g),
    );
  }

  /** Local surface light only: no screen overlay, blend filters or new ticker. */
  light(pos: Pos, family: Family): void {
    const g = this.graphic(this.ground);
    if (!g) return;
    const c = this.center(pos),
      { sx, sy } = this.surface(pos),
      color = ELEMENTS[family].light;
    for (let i = 3; i > 0; i--)
      g.ellipse(c.x, c.y, (24 + i * 15) * sx, (24 + i * 15) * sy).fill({
        color,
        alpha: this.reduced ? 0.016 : 0.055,
      });
    this.animate(
      220,
      (t) => {
        g.alpha = 1 - t;
      },
      () => this.release(g),
    );
  }

  charge(pos: Pos, family: Family, duration: number): void {
    const g = this.graphic();
    if (!g) return;
    const c = this.center(pos),
      colors = ELEMENTS[family];
    g.circle(0, 0, 18).fill({ color: colors.edge, alpha: 0.16 });
    g.circle(0, 0, 9).fill({ color: colors.light, alpha: 0.7 });
    g.circle(0, 0, 4).fill(colors.core);
    // Staff tip of the 3/4 caster (CHARACTER_RENDER_CONTRACT: staff hand on screen right).
    const s = this.surface(pos).sx;
    g.position.set(c.x + 31 * s, c.y - BODY * 0.92 * s);
    this.animate(
      duration,
      (t) => {
        g.scale.set(0.35 + t * 0.9);
        g.alpha = 0.4 + t * 0.6;
      },
      () => this.release(g),
    );
  }

  projectile(from: Pos, to: Pos, family: Family, duration: number, origin?: Point): void {
    const g = this.graphic(this.projectiles);
    if (!g) return;
    // Release may start at the caster’s hand; target and depth still follow the ground track.
    const ga = this.center(from),
      gb = this.center(to),
      a = origin ?? this.lift(from, 0.55),
      b = this.lift(to, 0.45),
      color = ELEMENTS[family];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const fire = family === 'FIRE';
    g.poly([-44, 0, -9, -9, 7, 0, -9, 9]).fill({ color: color.edge, alpha: 0.3 });
    g.poly([-29, 0, -5, -5, 9, 0, -5, 5]).fill({ color: color.light, alpha: 0.85 });
    g.circle(0, 0, fire ? 11 : 6).fill(color.light);
    g.circle(2, -1, fire ? 6 : 3).fill(color.core);
    g.rotation = angle;
    let emitted = -1;
    this.animate(
      duration,
      (t) => {
        g.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        g.zIndex = this.geometry.depth({
          x: ga.x + (gb.x - ga.x) * t,
          y: ga.y + (gb.y - ga.y) * t + 1,
        });
        if (!this.reduced && Math.floor(t * 6) !== emitted) {
          emitted = Math.floor(t * 6);
          this.sparksAt(g.x, g.y, family, fire ? 3 : 1, 12);
        }
      },
      () => this.release(g),
    );
  }

  /** Physical shaft/fletching: uses the shared actor layer, pool and animation clock. */
  physicalArrow(from: Pos, to: Pos, duration: number, origin?: Point): void {
    const g = this.graphic(this.projectiles);
    if (!g) return;
    const a = origin ?? this.lift(from, .55), b = this.lift(to, .5);
    const ga = this.center(from), gb = this.center(to);
    g.moveTo(-24, 0).lineTo(8, 0).stroke({color:0xa77c4b,width:2});
    g.poly([12,0,4,-3,4,3]).fill(0xe0ddcf);
    g.poly([-24,0,-29,-4,-20,-2,-17,0,-20,2,-29,4]).fill(0xaaa2a8);
    g.rotation = Math.atan2(b.y-a.y,b.x-a.x);
    this.animate(duration,t=>{
      g.position.set(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
      g.zIndex=this.geometry.depth({x:ga.x+(gb.x-ga.x)*t,y:ga.y+(gb.y-ga.y)*t+1});
    },()=>this.release(g));
  }

  physicalArrowImpact(pos: Pos): void {
    const g=this.graphic(this.projectiles);
    if(!g)return;
    const p=this.lift(pos,.5);
    g.position.set(p.x,p.y);g.zIndex=this.geometry.depth(this.center(pos));
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5;
      g.moveTo(Math.cos(a)*4,Math.sin(a)*4).lineTo(Math.cos(a)*10,Math.sin(a)*10);
    }
    g.stroke({color:0xc9b58a,width:1.5});
    this.animate(this.reduced?70:130,t=>{g.alpha=1-t;},()=>this.release(g));
  }

  /** Physical shaft plus a bounded, angle-correct elemental wake; shared graphics clock/pool. */
  specialArrow(from: Pos, to: Pos, key: string, duration: number, origin?: Point): void {
    this.physicalArrow(from, to, duration, origin);
    const visual = arrowVisual(key), g = this.graphic(this.projectiles);
    if (!visual || !g) return;
    const a = origin ?? this.lift(from,.5), b = this.lift(to,.5);
    g.moveTo(-36,0).lineTo(6,0).stroke({color:visual.color,alpha:.65,width:3});
    g.circle(6,0,3).fill({color:visual.color,alpha:.85});
    g.rotation=Math.atan2(b.y-a.y,b.x-a.x);
    this.animate(duration,t=>{
      g.position.set(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
      g.zIndex=this.geometry.depth(this.center({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t}));
      g.alpha=this.reduced ? .5 : .8;
    },()=>this.release(g));
  }

  specialArrowImpact(pos: Pos, key: string, tiles: readonly Pos[] = [pos]): void {
    const visual=arrowVisual(key);
    if(!visual)return;
    this.physicalArrowImpact(pos);
    const g=this.graphic(); if(!g)return;
    const p=this.lift(pos,.35);g.position.set(p.x,p.y);
    if(key==='smoke_arrow') {
      g.position.set(0,0);
      for(const tile of tiles){const c=this.center(tile),s=this.geometry.footprint(tile);
        g.ellipse(c.x,c.y-s.h*.12,s.w*.38,s.h*.3).fill({color:0x777081,alpha:.2});}
    } else if(key==='ice_arrow') {
      for(let i=0;i<6;i++){const a=i*Math.PI/3;
        g.poly([Math.cos(a)*7,Math.sin(a)*7,Math.cos(a)*25,Math.sin(a)*25,Math.cos(a+.15)*14,Math.sin(a+.15)*14]).fill({color:visual.color,alpha:.75});}
    } else {
      g.circle(0,0,14).stroke({color:visual.color,width:2,alpha:.8});
      for(let i=0;i<5;i++)g.circle(Math.cos(i*1.3)*17,Math.sin(i*1.3)*13,2).fill(visual.color);
    }
    this.animate(this.reduced?100:260,t=>{g.alpha=1-t;if(key!=='smoke_arrow')g.scale.set(.7+t*.5);},()=>this.release(g));
  }

  veilImpact(tiles: readonly Pos[], claws: boolean): void {
    this.area(tiles,'ARCANE',this.reduced?90:220);
    for(const tile of tiles){const g=this.graphic();if(!g)return;
      const p=this.lift(tile,claws?.3:0);g.position.set(p.x,p.y);
      if(claws)for(const x of [-9,0,9])g.moveTo(x-6,-16).lineTo(x+6,14).stroke({color:0xccb4e8,alpha:.8,width:2});
      else g.ellipse(0,0,30,12).stroke({color:0xb79ad5,alpha:.8,width:2});
      this.animate(this.reduced?80:220,t=>{g.alpha=1-t;},()=>this.release(g));
    }
  }

  // ── Archer (hunter identity: violet + gold accents, moss/bark naturals; never a sci-fi beam) ──
  /** Ojo del Cazador / Presa: a broken ring closes onto the target, then one soft pulse. */
  huntReticle(pos: Pos, strong = false): void {
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .5), { sx } = this.surface(pos);
    g.position.set(c.x, c.y); g.scale.set(sx);
    this.animate(this.reduced ? 120 : strong ? 420 : 340, t => {
      const r = 34 - 18 * Math.min(1, t * 1.6);
      g.clear();
      for (let k = 0; k < 4; k++) {
        const a0 = k * Math.PI / 2 + .3 + t * .6;
        g.arc(0, 0, r, a0, a0 + Math.PI / 2 - .6).stroke({ color: 0xc8a6ff, width: strong ? 2.4 : 1.8, alpha: 1 - t * .5 });
        g.moveTo(Math.cos(a0 - .3) * (r + 6), Math.sin(a0 - .3) * (r + 6)).lineTo(Math.cos(a0 - .3) * (r - 3), Math.sin(a0 - .3) * (r - 3));
      }
      g.stroke({ color: 0xe2c27a, width: 1.4, alpha: 1 - t * .4 });
      if (t > .55) g.circle(0, 0, 4 + (t - .55) * 26).stroke({ color: 0xeadbff, width: 1.5, alpha: (1 - t) * 1.8 });
    }, () => this.release(g));
  }
  /** Concentración gained (+) or spent (−) over the Archer: a rising / dissolving arrowhead. */
  focusTick(pos: Pos, gained: boolean, full: boolean): void {
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .95), { sx } = this.surface(pos);
    g.position.set(c.x, c.y); g.scale.set(sx);
    g.poly([0, -9, 6, 4, 0, 1, -6, 4]).fill({ color: gained ? 0xb58cf2 : 0x4f7a43 }).stroke({ color: full ? 0xe2c27a : 0xeadbff, width: 1.2 });
    if (full) g.circle(0, -2, 13).stroke({ color: 0xe2c27a, width: 1.4, alpha: .8 });
    this.animate(this.reduced ? 90 : 360, t => { g.alpha = 1 - t; g.y = c.y + (gained ? -14 : 8) * t; }, () => this.release(g));
  }
  /** Tiro al Corazón (perfect): violet gathering ring at the bow before the release. */
  focusCharge(pos: Pos, duration: number): void {
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .55), { sx } = this.surface(pos);
    g.position.set(c.x, c.y); g.scale.set(sx);
    this.animate(this.reduced ? 80 : duration, t => {
      g.clear();
      g.circle(0, 0, 30 - 20 * t).stroke({ color: 0xc8a6ff, width: 1.6 + t * 1.5, alpha: .35 + t * .6 });
      for (let k = 0; k < 3; k++) {
        const a = k * 2.094 + t * 3, r = 26 * (1 - t);
        g.circle(Math.cos(a) * r, Math.sin(a) * r, 2).fill({ color: 0xeadbff, alpha: .9 });
      }
    }, () => this.release(g));
  }
  /** Thin dashed sight line Archer → Presa (aim, not a beam). */
  aimLine(from: Pos, to: Pos, duration: number): void {
    const g = this.graphic(this.ground); if (!g) return;
    const a = this.lift(from, .55), b = this.lift(to, .5);
    const n = 9;
    for (let i = 0; i < n; i += 2) {
      const t0 = i / n, t1 = (i + 1) / n;
      g.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
    }
    g.stroke({ color: 0xc8a6ff, width: 1.3, alpha: .8 });
    this.animate(this.reduced ? 80 : duration, t => { g.alpha = t < .7 ? 1 : (1 - t) / .3; }, () => this.release(g));
  }
  /**
   * A physical arrow with a violet trail. `passAt`: Flecha Perforante went THROUGH that unit —
   * a first impact flashes there mid-flight and the shaft continues to `to`.
   */
  trailedArrow(from: Pos, to: Pos, duration: number, origin?: Point, passAt?: Pos, strong = false): void {
    const trail = this.graphic(this.projectiles);
    if (!trail) return;
    const a = origin ?? this.lift(from, .55), b = this.lift(to, .5);
    const ga = this.center(from), gb = this.center(to);
    const pass = passAt ? Math.min(.95, Math.max(.05,
      Math.hypot(this.center(passAt).x - ga.x, this.center(passAt).y - ga.y) / Math.max(1, Math.hypot(gb.x - ga.x, gb.y - ga.y)))) : null;
    let passed = false;
    this.physicalArrow(from, to, duration, origin);
    this.animate(duration + (this.reduced ? 0 : 140), t => {
      const k = Math.min(1, t * (duration + (this.reduced ? 0 : 140)) / Math.max(1, duration));
      trail.clear();
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      const tail = Math.max(0, k - (strong ? .55 : .4));
      trail.moveTo(a.x + (b.x - a.x) * tail, a.y + (b.y - a.y) * tail).lineTo(x, y)
        .stroke({ color: 0xb58cf2, width: strong ? 3.2 : 2.2, alpha: (k >= 1 ? 1 - (t - .8) * 5 : .75) });
      trail.moveTo(a.x + (b.x - a.x) * Math.max(tail, k - .15), a.y + (b.y - a.y) * Math.max(tail, k - .15)).lineTo(x, y)
        .stroke({ color: 0xf2e8ff, width: 1, alpha: .8 });
      trail.zIndex = this.geometry.depth({ x: ga.x + (gb.x - ga.x) * k, y: ga.y + (gb.y - ga.y) * k + 1 });
      if (pass !== null && !passed && k >= pass) {
        passed = true;
        this.physicalArrowImpact(passAt!);
        this.pierceMark(passAt!);
      }
    }, () => this.release(trail));
  }
  /** "Atravesado": a violet slash ring at the first unit an empowered arrow went through. */
  pierceMark(pos: Pos): void {
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .5), { sx } = this.surface(pos);
    g.position.set(c.x, c.y); g.scale.set(sx);
    g.ellipse(0, 0, 16, 9).stroke({ color: 0xc8a6ff, width: 2 });
    g.moveTo(-18, 6).lineTo(18, -6).stroke({ color: 0xf2e8ff, width: 1.6 });
    this.animate(this.reduced ? 90 : 260, t => { g.alpha = 1 - t; g.scale.set(sx * (1 + t * .3)); }, () => this.release(g));
  }
  /** Tiro al Corazón impact: perfect = violet heart-rune burst + gold reticle; normal = clean hard hit. */
  heartImpact(pos: Pos, perfect: boolean): void {
    this.physicalArrowImpact(pos);
    const g = this.graphic(); if (!g) return;
    const c = this.lift(pos, .5), { sx } = this.surface(pos);
    g.position.set(c.x, c.y); g.scale.set(sx);
    if (perfect) {
      g.moveTo(0, 10).bezierCurveTo(-18, -2, -10, -16, 0, -7).bezierCurveTo(10, -16, 18, -2, 0, 10)
        .stroke({ color: 0xeadbff, width: 2 }).fill({ color: 0x7c58c9, alpha: .55 });
      g.circle(0, 0, 22).stroke({ color: 0xe2c27a, width: 1.6 });
      this.sparksAt(c.x, c.y, 'ARCANE', this.reduced ? 1 : 10, 26);
    } else {
      g.circle(0, 0, 14).stroke({ color: 0xf2ecdc, width: 2 });
    }
    this.animate(this.reduced ? 100 : perfect ? 420 : 220, t => { g.alpha = 1 - t; g.scale.set(sx * (1 + t * (perfect ? .7 : .35))); }, () => this.release(g));
  }
  /** Trampa de Zarzas placed: thorns sprout in a ring on the tile (the marker itself is a board overlay). */
  trapSet(pos: Pos): void {
    const g = this.graphic(this.ground); if (!g) return;
    const c = this.center(pos), { sx, sy } = this.surface(pos);
    g.position.set(c.x, c.y);
    this.animate(this.reduced ? 90 : 320, t => {
      g.clear();
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, r = 26 * sx, h = 12 * sy * Math.sin(Math.min(1, t * 1.4) * Math.PI / 2);
        const x = Math.cos(a) * r, y = Math.sin(a) * r * .5;
        g.moveTo(x, y).lineTo(x * .9, y - h).stroke({ color: k % 2 ? 0x9fbf6a : 0x6b4a2b, width: 2, alpha: 1 - t * .6 });
      }
    }, () => this.release(g));
  }
  /** Trap sprung: roots burst up around the victim; the persistent snare is the ROOTED view. */
  trapSprung(pos: Pos): void {
    const g = this.graphic(); if (!g) return;
    const c = this.center(pos), { sx, sy } = this.surface(pos);
    g.position.set(c.x, c.y);
    this.animate(this.reduced ? 120 : 380, t => {
      g.clear();
      const grow = Math.sin(Math.min(1, t * 1.8) * Math.PI / 2);
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2 + .2, r = 24 * sx, x = Math.cos(a) * r, y = Math.sin(a) * r * .45;
        const h = (30 + (k % 3) * 9) * sy * grow;
        g.moveTo(x, y).quadraticCurveTo(x * .4, y - h * .6, x * .15, y - h)
          .stroke({ color: k % 2 ? 0x6f9a52 : 0x6b4a2b, width: 3 - k % 2, alpha: 1 - Math.max(0, t - .7) / .3 });
      }
      g.ellipse(0, 0, 30 * sx * grow, 12 * sy * grow).stroke({ color: 0xc8a6ff, width: 1.4, alpha: 1 - t });
    }, () => this.release(g));
    if (!this.reduced) this.sparksAt(c.x, c.y - 10, 'BARRIER', 6, 22);
  }
  /** Paso del Acechador / Retirada: low moss-and-shadow marks fading along the walked tiles. */
  stalkerTrail(path: readonly Pos[], retreat: boolean): void {
    path.forEach((p, i) => {
      const g = this.graphic(this.ground); if (!g) return;
      const c = this.center(p), { sx, sy } = this.surface(p);
      g.position.set(c.x, c.y);
      g.ellipse(0, 0, 18 * sx, 7 * sy).fill({ color: 0x0b120c, alpha: .45 });
      g.poly([-5 * sx, -2 * sy, 0, -7 * sy, 5 * sx, -2 * sy, 0, 3 * sy]).fill({ color: retreat ? 0x6f9a52 : 0x8e6bd1, alpha: .75 });
      const delay = this.reduced ? 0 : i * 110;
      this.animate(delay + (this.reduced ? 120 : 520), t => {
        const k = (t * (delay + (this.reduced ? 120 : 520)) - delay) / (this.reduced ? 120 : 520);
        g.alpha = k < 0 ? 0 : 1 - k;
      }, () => this.release(g));
    });
  }

  area(tiles: readonly Pos[], family: Family, duration = 260, anchor?: Pos): void {
    const g = this.graphic(this.ground);
    if (!g) return;
    const color = ELEMENTS[family];
    for (const tile of tiles) {
      const c = this.center(tile),
        { sx, sy } = this.surface(tile);
      g.poly(flat(this.geometry.quad(tile, 0.09)))
        .fill({ color: color.edge, alpha: 0.12 })
        .stroke({ color: color.light, width: 2, alpha: 0.85 });
      if (family === 'ICE') {
        g.moveTo(c.x - 25 * sx, c.y + 22 * sy)
          .lineTo(c.x, c.y)
          .lineTo(c.x + 27 * sx, c.y - 26 * sy)
          .moveTo(c.x, c.y)
          .lineTo(c.x + 20 * sx, c.y + 18 * sy)
          .stroke({ color: color.core, width: 1.5 });
      } else {
        g.poly([
          c.x,
          c.y - 16 * sy,
          c.x + 12 * sx,
          c.y,
          c.x,
          c.y + 16 * sy,
          c.x - 12 * sx,
          c.y,
        ]).stroke({
          color: color.light,
          width: 2,
        });
      }
      if (anchor && family === 'ARCANE') {
        const a = this.center(anchor);
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: color.light, width: 3, alpha: 0.45 });
      }
      if (!this.reduced) this.sparksAt(c.x, c.y, family, 3, 18);
    }
    this.animate(
      duration,
      (t) => {
        g.alpha = 1 - t * t;
      },
      () => this.release(g),
    );
  }

  burst(pos: Pos, family: Family, strong = false, duration = 180): void {
    const g = this.graphic();
    if (!g) return;
    const c = this.lift(pos, 0.38),
      ground = this.center(pos),
      { sx, sy } = this.surface(pos),
      colors = ELEMENTS[family];
    g.circle(0, 0, strong ? 26 : 17).fill({ color: colors.edge, alpha: 0.25 });
    g.circle(0, 0, strong ? 17 : 10).fill({ color: colors.light, alpha: 0.8 });
    g.circle(0, 0, 7).fill(colors.core);
    g.circle(0, 0, 26).stroke({ color: colors.light, width: 2 });
    g.position.set(c.x, c.y);
    this.animate(
      duration,
      (t) => {
        g.scale.set(this.reduced ? 0.7 : 0.3 + t * 1.25);
        g.alpha = (1 - t) * (this.reduced ? 0.5 : 1);
      },
      () => this.release(g),
    );
    this.sparksAt(c.x, c.y, family, this.reduced ? 2 : strong ? 16 : 8, strong ? 58 : 34);
    if (family === 'FIRE') {
      const scorch = this.graphic(this.ground);
      if (scorch) {
        scorch.ellipse(ground.x, ground.y, 30 * sx, 30 * sy).fill({ color: 0x2b110e, alpha: 0.5 });
        this.animate(
          420,
          (t) => {
            scorch.alpha = 1 - t;
          },
          () => this.release(scorch),
        );
      }
    }
  }

  /** Martial guard: angular steel/gold crest at the shield arm, never the Mage's bubble. */
  sweepArc(pos: Pos): void {
    const g = this.graphic();
    if (!g) return;
    const p = this.lift(pos, 0.28),
      duration = this.reduced ? 100 : 200;
    this.animate(
      duration,
      (t) => {
        g.clear();
        g.arc(p.x, p.y, 28, Math.PI * 0.1, Math.PI * (this.reduced ? 1.6 : 0.1 + 1.5 * t)).stroke({
          color: 0xe5d0a3,
          width: 2,
          alpha: 1 - t,
        });
      },
      () => this.release(g),
    );
  }

  martialGuard(pos: Pos, side = 1, breaking = false): void {
    const g = this.graphic();
    if (!g) return;
    const c = this.lift(pos, 0.48),
      scale = this.surface(pos).sx;
    g.poly([0, -20, 15, -12, 12, 8, 0, 22, -12, 8, -15, -12])
      .fill({ color: 0x4d6173, alpha: 0.2 })
      .stroke({ color: 0xe3bf77, width: 2 });
    g.moveTo(-8, -9)
      .lineTo(8, -9)
      .moveTo(0, -15)
      .lineTo(0, 12)
      .stroke({ color: 0xd5e8f0, width: 1, alpha: 0.9 });
    g.position.set(c.x + side * 12 * scale, c.y);
    g.scale.set(scale);
    this.animate(
      this.reduced ? 100 : 200,
      (t) => {
        g.alpha = (1 - t) * 0.9;
        if (!this.reduced) g.scale.set(scale * (breaking ? 1 + t * 0.16 : 1));
      },
      () => this.release(g),
    );
    if (breaking) this.sparksAt(c.x, c.y, 'FORCE', this.reduced ? 1 : 5, 18);
  }

  /** Small physical/recovery/resource cues reuse the bounded graphics/particle pool. */
  martialPulse(
    pos: Pos,
    kind: 'impact' | 'momentum' | 'spend' | 'recovery' | 'counter',
    strong = false,
  ): void {
    const g = this.graphic();
    if (!g) return;
    const c = this.lift(pos, kind === 'momentum' ? 0.72 : 0.4),
      scale = this.surface(pos).sx;
    const color =
      kind === 'recovery' || kind === 'spend'
        ? 0xe3af69
        : kind === 'momentum'
          ? 0xdf864e
          : 0xd8e4ef;
    if (kind === 'impact' || kind === 'counter')
      g.moveTo(-14, -14)
        .lineTo(14, 14)
        .moveTo(-10, 12)
        .lineTo(10, -12)
        .stroke({ color, width: strong ? 4 : 2 });
    else
      g.poly([0, -14, 9, 0, 0, 14, -9, 0]).stroke({ color, width: 2 }).fill({ color, alpha: 0.08 });
    g.position.set(c.x, c.y);
    g.scale.set(scale);
    this.animate(
      this.reduced ? 100 : 200,
      (t) => {
        g.alpha = 1 - t;
        if (!this.reduced) {
          g.scale.set(scale * (0.8 + t * 0.5));
          g.y = c.y - (kind === 'momentum' ? t * 12 : 0);
        }
      },
      () => this.release(g),
    );
    this.sparksAt(
      c.x,
      c.y,
      kind === 'impact' || kind === 'counter' ? 'FORCE' : 'BARRIER',
      this.reduced ? 1 : strong ? 8 : 4,
      20,
    );
  }

  /** Finisher is a presentation-only cue, driven by the confirmed combat event. */
  /** Bounded ritual geometry; no gameplay randomness or delayed logical outcomes. */
  ritual(pos: Pos, tier: 'MINOR' | 'MAJOR' | 'LEGENDARY', stage: 'seal' | 'release' | 'activate' | 'arrival' = 'activate'): void {
    const c = this.center(pos), scale = this.surface(pos), g = this.graphic();
    if (!g) return;
    this.ground.addChild(g);
    const color = tier === 'MINOR' ? 0xb5c38a : tier === 'MAJOR' ? 0xc1a5e9 : 0xd7b269;
    const sockets = tier === 'MINOR' ? 2 : tier === 'MAJOR' ? 3 : 4;
    g.circle(0,0,32).stroke({color,width:2}).circle(0,0,26).stroke({color,width:1,alpha:.5});
    for(let i=0;i<sockets;i++) {
      const a=i*Math.PI*2/sockets-Math.PI/2,x=Math.cos(a)*29,y=Math.sin(a)*29;
      g.poly([x,y-5,x+5,y,x,y+5,x-5,y]).stroke({color,width:2});
    }
    if(tier==='MINOR') g.poly([-17,-8,0,-20,17,-8,17,8,0,20,-17,8]).stroke({color:0xd6af71,width:2});
    g.position.set(c.x,c.y);g.scale.set(scale.sx,scale.sy);
    const duration=this.reduced?180:stage==='activate'?(tier==='MAJOR'?1100:850):stage==='arrival'?550:320;
    this.animate(duration,t=>{
      g.alpha=stage==='release'?1-t:Math.sin(Math.min(1,t*1.5)*Math.PI)*.85+.1;
      const size=this.reduced?1:stage==='activate'?.7+t*.5:1+t*.12;
      g.scale.set(scale.sx*size,scale.sy*size);
      if(!this.reduced&&stage==='activate')g.rotation=t*.25;
    },()=>this.release(g));
  }

  /** Physical breath follows the authoritative source/target, unlike a fireball projectile. */
  dragonBreath(from: Pos, to: Pos): void {
    const a=this.lift(from,.35), b=this.lift(to,.2), g=this.graphic();if(!g)return;
    g.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color:0x5b3c36,width:18,alpha:.6});
    g.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color:0xe8652d,width:11,alpha:.85});
    g.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color:0xffd899,width:4});
    this.animate(this.reduced?120:300,t=>{g.alpha=1-t;},()=>this.release(g));
    this.sparksAt(b.x,b.y,'FIRE',this.reduced?1:6,16);
  }

  /** Signature breath uses only authoritative tiles; pooled geometry and bounded embers. */
  primordialBreath(from: Pos, tiles: readonly Pos[]): void {
    this.charge(from, 'ARCANE', this.reduced ? 30 : 120);
    const beam = this.graphic(), ground = this.graphic(this.ground);
    if (!beam || !ground) {
      if (beam) this.release(beam);
      if (ground) this.release(ground);
      return;
    }
    const mouth = this.lift(from, .62);
    beam.label = 'primordial-breath';
    ground.label = 'primordial-breath-tiles';
    for (const tile of tiles) {
      const target = this.lift(tile, .15);
      const width = this.geometry.footprint(tile).w * .2;
      beam.poly([mouth.x,mouth.y,target.x-width,target.y,target.x+width,target.y])
        .fill({color:0xb33455,alpha:.15});
      ground.poly(flat(this.geometry.quad(tile, .1)))
        .fill({color:0xa62b42,alpha:.17}).stroke({color:0xe5b668,width:1.3,alpha:.8});
      beam.moveTo(mouth.x,mouth.y).lineTo(target.x,target.y).stroke({color:0x662368,width:15,alpha:.3});
      beam.moveTo(mouth.x,mouth.y).lineTo(target.x,target.y).stroke({color:0xda4058,width:7,alpha:.65});
      beam.moveTo(mouth.x,mouth.y).lineTo(target.x,target.y).stroke({color:0xffd699,width:2,alpha:.9});
    }
    let released = false;
    this.animate(this.reduced ? 120 : 480,t=>{
      const surge = this.reduced ? t : Math.max(0,(t-.25)/.75);
      beam.alpha = ground.alpha = t < .25 && !this.reduced ? 0 : 1-surge;
      if (!released && (this.reduced || t >= .25)) {
        released = true;
        for (const tile of tiles) {
          const p = this.center(tile);
          this.sparksAt(p.x,p.y,'FIRE',this.reduced?1:3,18);
          if(!this.reduced)this.sparksAt(p.x,p.y,'ARCANE',1,10);
        }
      }
    },()=>{this.release(beam);this.release(ground);});
  }

  finisher(pos: Pos): void {
    const c = this.center(pos), scale = this.surface(pos);
    const ring = this.graphic();
    if (ring) {
      this.ground.addChild(ring);
      ring.circle(0, 0, 29).stroke({color: 0xb99046, width: 2, alpha: 0.8});
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, x = Math.cos(a) * 25, y = Math.sin(a) * 25;
        ring.moveTo(x-2,y-3).lineTo(x+2,y+3).moveTo(x-3,y+1).lineTo(x+3,y-1).stroke({color:0xe3bd70,width:1.5});
      }
      ring.position.set(c.x,c.y); ring.scale.set(scale.sx,scale.sy);
      this.animate(this.reduced ? 220 : 320, t => { ring.alpha=1-t; },()=>this.release(ring));
    }
    if (!this.reduced) {
      const slash = this.graphic();
      if (slash) {
        slash.moveTo(6,-100).lineTo(-4,-4).stroke({color:0x972c2e,width:13,alpha:0.8});
        slash.moveTo(6,-100).lineTo(-4,-4).stroke({color:0xffbd94,width:3});
        slash.position.set(c.x,c.y); slash.scale.set(scale.sx);
        this.animate(250,t=>{slash.alpha=1-t;slash.scale.y=scale.sx*(0.85+t*0.15);},()=>this.release(slash));
      }
    }
    const text = this.freeText.pop() ?? (this.textCount < 24 ? (this.textCount++,new Text({text:'',style:{fontFamily:'system-ui',fontSize:18,fontWeight:'800',stroke:{color:0x080d18,width:3}}})) : null);
    if (text) {
      text.text='Remate'; text.style.fill=0xf2a186; text.anchor.set(0.5); this.layer.addChild(text);
      this.animate(500,t=>{text.position.set(c.x,c.y-105*scale.sx-(this.reduced?0:t*12));text.alpha=t<0.6?1:(1-t)/0.4;},()=>{text.removeFromParent();this.freeText.push(text);});
    }
  }

  backstab(pos: Pos): void {
    const c = this.center(pos), text = this.freeText.pop() ?? (this.textCount < 24 ? (this.textCount++,new Text({text:'',style:{fontFamily:'system-ui',fontSize:14,fontWeight:'700',stroke:{color:0x080d18,width:3}}})) : null);
    if (!text) return;
    text.text='Ataque por la espalda'; text.style.fill=0xe6c58a; text.anchor.set(0.5); this.layer.addChild(text);
    this.animate(650,t=>{text.position.set(c.x,c.y-85-(this.reduced?0:t*10));text.alpha=t<0.6?1:(1-t)/0.4;},()=>{text.removeFromParent();this.freeText.push(text);});
  }

  shell(pos: Pos, breaking = false): void {
    const g = this.graphic();
    if (!g) return;
    const c = this.lift(pos, 0.48),
      s = this.surface(pos).sx,
      color = ELEMENTS.BARRIER;
    g.ellipse(0, 0, 36, 40)
      .fill({ color: color.light, alpha: 0.035 })
      .stroke({ color: color.light, width: 2 });
    if (breaking)
      g.moveTo(-10, -34)
        .lineTo(6, -13)
        .lineTo(-4, 3)
        .lineTo(13, 27)
        .stroke({ color: color.core, width: 2 });
    else
      g.poly([0, -25, 17, -15, 13, 8, 0, 22, -13, 8, -17, -15]).stroke({
        color: color.core,
        width: 1,
      });
    g.position.set(c.x, c.y);
    this.animate(
      260,
      (t) => {
        const k = this.reduced ? 1 : breaking ? 1 + t * 0.2 : 0.6 + t * 0.4;
        // The shell wraps a full-height figure: wider than a tile, taller than wide.
        g.scale.set(k * 1.15 * s, k * 1.55 * s);
        g.alpha = (1 - t) * 0.85;
      },
      () => this.release(g),
    );
    if (breaking) this.sparksAt(c.x, c.y, 'BARRIER', this.reduced ? 2 : 8, 35);
  }

  streak(from: Pos, to: Pos): void {
    const g = this.graphic();
    if (!g) return;
    const a = this.lift(from, 0.4),
      b = this.lift(to, 0.4);
    for (const offset of [-8, 0, 8])
      g.moveTo(a.x, a.y + offset)
        .lineTo(b.x, b.y + offset)
        .stroke({ color: ELEMENTS.FORCE.light, width: offset ? 1 : 4, alpha: 0.65 });
    this.animate(
      150,
      (t) => {
        g.alpha = 1 - t;
      },
      () => this.release(g),
    );
  }

  drawCards(pos: Pos, count: number): void {
    for (let i = 0; i < Math.min(count, 3); i++) {
      const g = this.graphic();
      if (!g) return;
      const c = this.lift(pos, 0.75);
      g.roundRect(-8, -12, 16, 24, 2)
        .fill(0x2c2050)
        .stroke({ color: ELEMENTS.ARCANE.light, width: 1.5 });
      g.poly([0, -6, 4, 0, 0, 6, -4, 0]).fill(ELEMENTS.ARCANE.core);
      this.animate(
        350,
        (t) => {
          g.position.set(c.x + (i - 1) * 22 * t, c.y + 25 + (this.reduced ? 0 : t * 75));
          g.alpha = 1 - t * t;
          g.rotation = this.reduced ? 0 : (i - 1) * t * 0.25;
        },
        () => this.release(g),
      );
    }
  }

  number(id: string, pos: Pos, amount: number, kind: 'damage' | 'heal' | 'shield' | 'armor'): void {
    const key = `${id}:${kind}:${this.clock}`;
    const existing = this.numbers.get(key);
    const format = (n: number) =>
      kind === 'damage'
        ? `−${n}`
        : kind === 'heal'
          ? `+${n}`
          : kind === 'shield'
            ? `◇ ${n}`
            : `Bloq. ${n}`;
    if (existing) {
      existing.amount += amount;
      existing.text.text = format(existing.amount);
      return;
    }
    const text =
      this.freeText.pop() ??
      (this.textCount < 24
        ? (this.textCount++,
          new Text({
            text: '',
            style: {
              fontFamily: 'system-ui',
              fontSize: 18,
              fontWeight: '800',
              stroke: { color: 0x080d18, width: 3 },
            },
          }))
        : null);
    if (!text) return;
    const entry = { text, amount },
      lane = this.lanes.get(id) ?? 0,
      c = this.lift(pos, 0.92);
    this.numbers.set(key, entry);
    this.lanes.set(id, lane + 1);
    text.text = format(amount);
    text.style.fill =
      kind === 'damage'
        ? 0xffbfa5
        : kind === 'heal'
          ? 0x94f0be
          : kind === 'shield'
            ? 0xffdc8d
            : 0xc0d0dc;
    text.anchor.set(0.5);
    this.layer.addChild(text);
    this.animate(
      600,
      (t) => {
        text.position.set(
          c.x + (lane % 2 ? 18 : -12),
          c.y - 22 - (lane % 3) * 18 - (this.reduced ? 0 : t * 28),
        );
        text.alpha = t < 0.6 ? 1 : (1 - t) / 0.4;
      },
      () => {
        text.removeFromParent();
        this.freeText.push(text);
        this.numbers.delete(key);
        this.lanes.set(id, Math.max(0, (this.lanes.get(id) ?? 1) - 1));
      },
    );
  }

  sparksAt(x: number, y: number, family: Family, count: number, spread: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles.find((p) => !p.alive);
      if (!p) break;
      const a = i * 2.39996 + this.clock * 0.003;
      Object.assign(p, {
        alive: true,
        age: 0,
        life: 220 + (i % 4) * 35,
        x,
        y,
        vx: Math.cos(a) * spread,
        vy: Math.sin(a) * spread - 10,
        size: family === 'ICE' ? 5 : 2.5,
        family,
      });
    }
  }

  /** One attached cosmetic layer per victim; shares the existing Graphics pool and clock. */
  clearUnitReaction(id: string): void {
    this.reactionCancels.get(id)?.();
    this.reactionCancels.delete(id);
    this.fireball.clearReaction(id);
  }
  get reactionSnapshot() { return { attached: this.reactionCancels.size, particles: this.particles.filter(p => p.alive).length }; }
  unitReaction(id: string, position: () => Pos | undefined, kind: HitReaction): void {
    if (kind === 'none') return;
    this.clearUnitReaction(id);
    if (kind === 'fire' && this.fireball.ready) { this.fireball.reduced = this.reduced; this.fireball.reaction(id, position); return; }
    const initial = position(); if (!initial) return;
    const g = this.graphic(this.projectiles); if (!g) return;
    g.eventMode = 'none';
    const reduced = this.reduced;
    const mobile = typeof matchMedia !== 'undefined' && matchMedia('(max-height: 500px), (pointer: coarse)').matches;
    const count = reduced ? 1 : mobile ? 3 : 5;
    const duration = reduced ? 120 : kind === 'heal' ? 380 : 280;
    const color = REACTION_COLOR[kind];
    let cancel = () => {};
    cancel = this.animate(duration, (t) => {
      const pos = position(); g.clear();
      if (!pos) { g.alpha = 0; return; }
      const ground = this.center(pos), at = this.lift(pos, .44), scale = this.surface(pos).sx;
      g.position.set(at.x, at.y); g.scale.set(scale); g.zIndex = this.geometry.depth(ground) + 3;
      g.alpha = (reduced ? .35 : .68) * (1-t);
      if (kind === 'physical' || kind === 'force' || kind === 'block') {
        const r = kind === 'block' ? 12 : 8;
        g.moveTo(-r,-5).lineTo(r,5).moveTo(-r,5).lineTo(r,-5).stroke({color,width:kind==='block'?1.7:2.2});
        if (!reduced) for(let i=0;i<count;i++) {
          const a=i*2.39996, r=10+t*15;
          g.moveTo(Math.cos(a)*r,Math.sin(a)*r).lineTo(Math.cos(a)*(r+4),Math.sin(a)*(r+4)).stroke({color,width:1.2});
        }
      } else if (kind === 'fire') {
        // Fallback only: existing premium illustrated fire is preferred when its atlas is ready.
        for(let i=0;i<count;i++) {
          const x=(i-(count-1)/2)*7;
          g.moveTo(x+4,14).bezierCurveTo(x-10,-2,x+12,-8,x,-20-(reduced?0:8*t)).stroke({color,width:2.6});
        }
      } else if (kind === 'ice') {
        for(let i=0;i<count;i++) {
          const a=i*2.39996, r=22+(reduced?0:5*t), x=Math.cos(a)*r, y=Math.sin(a)*r;
          g.poly([x,y-9,x+3,y,x,y+5,x-3,y]).fill({color,alpha:.6}).stroke({color:0xe8f7ff,width:1.2});
        }
        g.moveTo(-16,13).lineTo(-9,9).lineTo(-4,14).lineTo(4,10).lineTo(12,14).lineTo(17,10).stroke({color,width:1.4});
      } else {
        // Ascending light motes for healing; short violet runic strokes for confirmed arcane damage.
        for(let i=0;i<count;i++) {
          const x=Math.sin(i*2.39996)*19, y=(i%3)*9-(reduced?0:t*(kind==='heal'?25:12));
          g.moveTo(x-3,y).lineTo(x+3,y).moveTo(x,y-4).lineTo(x,y+4).stroke({color,width:1.5});
        }
        if(kind==='arcane')g.moveTo(-14,7).quadraticCurveTo(0,-13,14,7).stroke({color,width:1.2});
      }
    }, () => {
      this.release(g);
      if (this.reactionCancels.get(id) === cancel) this.reactionCancels.delete(id);
    });
    this.reactionCancels.set(id,cancel);
  }

  setFireTiles(tiles: Pos[]): void {
    this.fireTiles = tiles;
  }
  tick(ms: number): void {
    this.catalog.reduced = this.reduced; this.catalog.tick(ms);
    this.mage.reduced = this.reduced; this.mage.tick(ms);
    this.bastion.reduced = this.pactSummon.reduced = this.reduced;
    this.bastion.tick(ms); this.pactSummon.tick(ms);
    this.fireball.reduced = this.reduced;
    this.fireball.tick(ms);
    this.clock += ms;
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i]!;
      a.age += ms;
      a.update(Math.min(1, a.age / a.duration));
      if (a.age >= a.duration) {
        a.cleanup();
        this.animations.splice(i, 1);
      }
    }
    this.ambientArt.clear();
    for (const tile of this.fireTiles) {
      const c = this.center(tile),
        { sx, sy } = this.surface(tile),
        pulse = this.reduced ? 0.08 : 0.06 + Math.sin(this.clock * 0.003 + tile.x) * 0.025;
      this.ambientArt.ellipse(c.x, c.y, 30 * sx, 26 * sy).fill({ color: 0xff963f, alpha: pulse });
    }
    this.ambientClock += ms;
    if (!this.reduced && this.ambientClock > 900 && this.fireTiles.length) {
      const tile = this.fireTiles[Math.floor(this.clock / 900) % this.fireTiles.length]!;
      const c = this.center(tile);
      this.sparksAt(c.x, c.y, 'FIRE', 2, 10);
      this.ambientClock = 0;
    }
    this.particleArt.clear();
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += ms;
      const t = p.age / p.life;
      if (t >= 1) {
        p.alive = false;
        continue;
      }
      const x = p.x + p.vx * t,
        y = p.y + p.vy * t,
        color = ELEMENTS[p.family];
      if (p.family === 'ICE')
        this.particleArt
          .poly([x, y - p.size, x + 2, y, x, y + p.size, x - 2, y])
          .fill({ color: color.core, alpha: 1 - t });
      else
        this.particleArt
          .circle(x, y, p.size * (1 - t * 0.5))
          .fill({ color: color.light, alpha: 1 - t });
    }
  }
  clear(): void {
    for (const cancel of [...this.reactionCancels.values()]) cancel();
    this.reactionCancels.clear();
    this.catalog.clear();
    this.mage.clear(); this.fireball.clear(); this.bastion.clear(); this.pactSummon.clear();
    for (const a of this.animations) a.cleanup();
    this.animations = [];
    this.numbers.clear();
    this.lanes.clear();
    for (const p of this.particles) p.alive = false;
    this.particleArt.clear();
    this.ambientArt.clear();
    this.fireTiles = [];
  }
  destroy(): void {
    this.clear();
    this.catalog.destroy();
    this.mage.destroy(); this.fireball.destroy(); this.bastion.destroy(); this.pactSummon.destroy();
    for (const g of this.freeGraphics) g.destroy({ context: true });
    for (const t of this.freeText) t.destroy();
    this.freeGraphics.length = 0;
    this.freeText.length = 0;
    this.particleArt.destroy();
    this.ambientArt.destroy();
  }
}
