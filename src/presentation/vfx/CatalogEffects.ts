import { isThunderAddition, thunderAdditionStyle } from './thunderExpansionRecipe';
import { ParalyzingPulseEffects } from './ParalyzingPulseEffects';
import { thunderConnection, thunderEnvelope } from './thunderRecipe';
import type { Container } from 'pixi.js';
import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import {
  BANK,
  catalogPremiumEnabled,
  familyRecipe,
  type AtlasBank,
  type CatalogRecipe,
  type PremiumFamily,
} from './catalogRecipes';

const CLIPS = {
  physical: { charge: [0, 1, 2, 3], contact: [4, 5, 6, 7], floor: [8, 9, 10, 11], mote: [13] },
  force: { charge: [12], contact: [8, 9, 10, 11], floor: [12], mote: [15] },
  fire: { charge: [15], contact: [4, 5, 6, 7], floor: [14], mote: [13] },
  ice: { charge: [4], contact: [5], floor: [0, 1, 2, 3], mote: [7] },
  arcane: { charge: [12], contact: [8, 9, 10, 11], floor: [12], mote: [15] },
  defense: { charge: [12], contact: [12], floor: [8, 9, 10, 11], mote: [13] },
  heal: { charge: [12], contact: [4, 5, 6, 7], floor: [0, 1, 2, 3], mote: [13] },
  movement: { charge: [12], contact: [12], floor: [8, 9, 10, 11], mote: [15] },
  summon: { charge: [12], contact: [4, 5, 6, 7], floor: [0, 1, 2, 3], mote: [13] },
  transform: { charge: [15], contact: [4, 5, 6, 7], floor: [0, 1, 2, 3], mote: [12] },
  tactic: { charge: [12], contact: [12], floor: [0, 1, 2, 3], mote: [13] },
} as const;
const clips = (r: CatalogRecipe) =>
  r.mageElement === 'nature'
    ? {
        charge: [12],
        contact:
          r.variant === 'grasping_roots' || r.variant === 'entangled_forest'
            ? [0, 1, 2, 3]
            : ['rebirth_bloom', 'vital_sap'].includes(r.variant ?? '')
              ? [12]
              : [4, 5, 6, 7],
        floor: [0, 1, 2, 3],
        mote: [13],
      }
    : r.mageElement === 'thunder'
      ? { charge: [14], contact: [8, 9, 10, 11], floor: [15], mote: [14] }
      : r.style === 'volley'
        ? { charge: [13], contact: [0, 1, 2, 3], floor: [14], mote: [13] }
        : r.style === 'ancestral'
          ? { charge: [12], contact: [8, 9, 10, 11], floor: [15], mote: [12] }
          : CLIPS[r.family];

/** Shared illustrated families, using five source atlases (not one atlas/card).
 * All sprites are non-interactive, depth-anchored and driven by the existing world clock. */
class RecipeBank extends PaintedEffectPool {
  private round = 0;
  private thunderOrigin: {from: Pos; to: Pos; origin: {x:number;y:number}} | null = null;
  private readonly residueExpiry = new Map<string, number>();
  advanceRound(round: number) {
    this.round = round;
    for (const [key, expiry] of this.residueExpiry)
      if (round >= expiry) {
        this.clearGroup(key);
        this.residueExpiry.delete(key);
      }
  }
  override clear() {
    super.clear();
    this.residueExpiry.clear();
    this.thunderOrigin = null;
  }
  residue(recipe: CatalogRecipe, at: Pos) {
    if (
      !recipe.mageElement ||
      ['vital_sap', 'arcane_overload', 'entangled_forest'].includes(recipe.variant ?? '')
    )
      return;
    const key = `residue:${at.x}:${at.y}`;
    this.clearGroup(key);
    if (!this.residueExpiry.has(key) && this.residueExpiry.size >= 8) return;
    this.residueExpiry.set(key, this.round + 2);
    const f = this.geometry.footprint(at);
    this.sprite(
      [recipe.bank === 'thunder-premium' ? 12 : recipe.mageElement === 'thunder' ? 15 : recipe.variant === 'rebirth_bloom' ? 12 : 3],
      this.geometry.center(at),
      f.w * 0.65,
      Infinity,
      (_, s) => {
        const p = this.geometry.center(at);
        s.position.set(p.x, p.y);
        s.width = f.w * 0.65;
        s.height = f.h * 0.65;
        s.alpha = recipe.bank === 'thunder-premium' ? 0.4 : 0.22;
      },
      true,
      false,
      key,
    );
  }
  constructor(actors: Container, ground: Container, geometry: FxGeometry, bank: AtlasBank) {
    super(actors, ground, geometry, bank, bank === 'thunder-premium' ? 48 : 24);
  }
  get requested() {
    return catalogPremiumEnabled();
  }
  charge(
    recipe: CatalogRecipe,
    from: Pos,
    duration: number,
    origin?: { x: number; y: number },
    target: Pos = from,
    affected: readonly Pos[] = [target],
  ): void {
    if (isThunderAddition(recipe.variant)) { this.thunderAddition(recipe, 'charge', from, target, affected, duration); return; }
    if (recipe.bank === 'thunder-premium') { this.thunderCharge(recipe, from, target, affected, duration, origin); return; }
    const ground = this.geometry.center(from),
      at = recipe.shape === 'area' ? ground : (origin ?? this.lifted(from, 0.48));
    const scale = this.geometry.footprint(from).w / 96;
    this.sprite(
      clips(recipe).charge,
      at,
      58 * scale,
      Math.max(1, duration),
      (t, s) => {
        s.width = s.height = (this.reduced ? 32 : 30 + 25 * t) * scale;
        s.alpha = (this.reduced ? 0.22 : 0.45) * Math.sin(Math.PI * (0.1 + 0.8 * t));
        s.tint = recipe.tint;
        s.zIndex = this.geometry.depth(ground) + 3;
      },
      recipe.shape === 'area',
    );
  }
  travel(
    recipe: CatalogRecipe,
    from: Pos,
    to: Pos,
    duration: number,
    origin?: { x: number; y: number },
  ): void {
    if (isThunderAddition(recipe.variant)) { this.thunderAddition(recipe, 'travel', from, to, [to], duration); return; }
    if (recipe.bank === 'thunder-premium') { this.thunderTravel(recipe, from, to, duration, origin); return; }
    if (recipe.variant === 'tempest_judgment') {
      const ground = this.geometry.center(to),
        scale = this.geometry.footprint(to).w / 96;
      this.sprite([14], ground, 85 * scale, Math.max(1, duration), (t, s) => {
        s.anchor.set(0.5, 1);
        s.position.set(ground.x, ground.y - (this.reduced ? 0 : 150 * (1 - t) * scale));
        s.height = 130 * scale;
        s.alpha = this.reduced ? 0.3 : 0.65;
        s.tint = recipe.tint;
        s.zIndex = this.geometry.depth(ground) + 3;
      });
      return;
    }
    const surface = recipe.family === 'physical' || recipe.shape === 'area',
      a = surface ? this.geometry.center(from) : (origin ?? this.lifted(from, 0.48));
    const b = surface ? this.geometry.center(to) : this.lifted(to, 0.44),
      scale = this.geometry.footprint(to).w / 96;
    const clip =
      recipe.mageElement === 'thunder'
        ? [14]
        : recipe.mageElement === 'nature'
          ? [13]
          : recipe.shape === 'area'
            ? clips(recipe).floor
            : recipe.family === 'fire'
              ? [0, 1, 2, 3]
              : recipe.family === 'ice'
                ? [5]
                : surface
                  ? [0, 1, 2, 3]
                  : [13];
    const angle = Math.atan2(b.y - a.y, b.x - a.x),
      count = this.reduced ? 1 : this.mobile ? 2 : 3;
    for (let i = 0; i < count; i++)
      this.sprite(
        clip,
        a,
        (this.reduced ? 30 : 48 - i * 7) * scale,
        Math.max(1, duration),
        (t, s) => {
          const u = Math.max(0, t - i * 0.045);
          const zig =
            recipe.mageElement === 'thunder' && !this.reduced
              ? Math.sin(u * Math.PI * 12 + i) * Math.sin(Math.PI * u) * 9 * scale
              : 0;
          s.position.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + zig);
          s.rotation = angle;
          s.alpha = (i ? 0.2 : 0.72) * (1 - i / count);
          s.tint = recipe.tint;
          s.zIndex =
            this.geometry.depth({
              x:
                this.geometry.center(from).x +
                (this.geometry.center(to).x - this.geometry.center(from).x) * u,
              y:
                this.geometry.center(from).y +
                (this.geometry.center(to).y - this.geometry.center(from).y) * u,
            }) + 3;
        },
        surface,
      );
  }
  /** Ten compositions share the existing illustrated atlas/pool/clock and exact resolved tiles. */
  private thunderAddition(recipe: CatalogRecipe, phase: 'charge' | 'travel' | 'impact', from: Pos, at: Pos, affected: readonly Pos[], duration: number) {
    const style = thunderAdditionStyle(recipe.variant), f = this.geometry.footprint(at),
      scale = f.w / 96, center = this.geometry.center(at), source = this.lifted(from, 0.46),
      life = Math.max(1, duration), soft = this.reduced ? 0.25 : 0.62;
    if (phase === 'charge') {
      this.sprite([15], source, 38 * scale, life, (t,s) => {
        s.width=s.height=(22+25*t)*scale; s.alpha=soft*Math.sin(Math.PI*t); s.tint=style==='frenzy'?0xd59bff:0xbcecff;
        s.zIndex=this.geometry.depth(this.geometry.center(from))+4;
      });
      return;
    }
    if (phase === 'travel') {
      if (style === 'orb' || style === 'field') {
        this.thunderBeam(this.lifted(from, style==='orb'?0.25:0.03), this.lifted(at,0.38), at, life, true);
      } else if (style === 'spear') {
        const end = this.lifted(at,0.4), dx=end.x-source.x, dy=end.y-source.y, length=Math.hypot(dx,dy);
        this.sprite([0,1,2,3],source,length,life,(t,s)=>{
          s.anchor.set(1,0.5);s.position.set(source.x+dx*t,source.y+dy*t);s.rotation=Math.atan2(dy,dx);
          s.width=Math.min(length,f.w*1.8);s.height=16*scale;s.alpha=soft;s.zIndex=this.geometry.depth(center)+4;
        });
      } else if (style === 'hammer') {
        this.sprite([4,5,6,7], center, 85*scale, life, (t,s)=>{
          s.anchor.set(0.5,1);s.position.set(center.x,center.y-(1-t)*105*scale);s.height=120*scale;s.alpha=soft*t;
          s.rotation=this.reduced?0:(1-t)*-0.4;s.zIndex=this.geometry.depth(center)+4;
        });
      } else if (style === 'step') {
        for (const tile of [from,at]) this.sprite([9],this.lifted(tile,0.35),65*scale,life,(t,s)=>{
          s.alpha=soft*Math.sin(Math.PI*t);s.height=95*scale;s.zIndex=this.geometry.depth(this.geometry.center(tile))+4;
        });
      }
      return;
    }
    const body = ['shield','mark','frenzy','avatar'].includes(style);
    const tiles = body || style === 'orb' ? [at] : affected.slice(0, this.mobile ? 6 : 8);
    for (const tile of tiles) {
      const p=body?this.lifted(tile,0.35):this.geometry.center(tile), footprint=this.geometry.footprint(tile);
      const frames=style==='hammer'?[8,9,10,11]:style==='orb'?[15]:style==='wall'?[4,5,6,7]:[13];
      this.sprite(frames,p,footprint.w*(body?0.85:0.78),life,(t,s)=>{
        s.alpha=soft*Math.sin(Math.PI*(0.15+0.85*t));
        s.width=footprint.w*(style==='hammer'?0.35+0.55*t:body?0.85:0.78);
        s.height=body?footprint.w*(style==='avatar'?1.5:1.0):style==='wall'?footprint.w*0.9:footprint.h*0.8;
        if(style==='orb')s.y=p.y-(this.reduced?20:20+Math.sin(t*Math.PI)*8)*scale;
        if(style==='frenzy')s.tint=0xd3a1ff;
        if(style==='mark')s.rotation=this.reduced?0:t*0.4;
        s.zIndex=this.geometry.depth(this.geometry.center(tile))+(body||style==='wall'||style==='orb'?4:1);
      },!body&&style!=='wall'&&style!=='orb');
      if (!this.reduced && ['avatar','shield','frenzy'].includes(style)) for(let i=0;i<(this.mobile?2:4);i++)
        this.sprite([11],p,16*scale,life,(t,s)=>{
          const angle=i*Math.PI*0.5+t*2;
          s.position.set(p.x+Math.cos(angle)*24*scale,p.y+Math.sin(angle)*15*scale-t*18*scale);
          s.alpha=0.4*(1-t);s.zIndex=this.geometry.depth(this.geometry.center(tile))+5;
        });
    }
  }
  /** Two authored thunder compositions, sharing this atlas pool and the existing presentation clock. */
  private thunderCharge(recipe: CatalogRecipe, from: Pos, at: Pos, tiles: readonly Pos[], duration: number, origin?: {x:number;y:number}) {
    const c = this.geometry.center(at), scale = this.geometry.footprint(at).w / 96;
    const tempest = recipe.variant === 'tempest_judgment';
    const life = duration + (tempest ? (this.reduced ? 60 : 120) : 0);
    if (tempest) {
      this.sprite([8], c, 240 * scale, life, (t, s) => {
        s.width = 240 * scale; s.height = this.geometry.footprint(at).h * 2.4;
        s.tint = 0x0c1729; s.alpha = (this.reduced ? 0.16 : 0.36) * Math.sin(Math.PI * (0.1 + 0.8 * t));
      }, true, false);
      // A small cluster of painted storm clouds darkens just the affected chamber, never the screen.
      for (let i = 0; i < (this.reduced ? 1 : 3); i++) {
        const offset = (i - (this.reduced ? 0 : 1)) * 58 * scale;
        this.sprite([8], c, 170 * scale, life, (t, s) => {
          s.position.set(c.x + offset + (this.reduced ? 0 : Math.sin(t * 2 + i) * 4 * scale), c.y - (140 + i % 2 * 20) * scale);
          s.width = (170 + 14 * t) * scale; s.height = 94 * scale;
          s.alpha = (this.reduced ? 0.28 : 0.67) * Math.sin(Math.PI * (0.12 + t * 0.76));
          s.tint = 0x8094bb; s.zIndex = this.geometry.depth(c) + 6;
        }, false, false);
      }
      for (const tile of tiles.slice(0, 5)) {
        const p = this.geometry.center(tile), f = this.geometry.footprint(tile);
        this.sprite([13], p, f.w * 0.86, life, (t, s) => {
          s.height = f.h * 0.8; s.alpha = (this.reduced ? 0.15 : 0.12 + 0.3 * t) * Math.sin(Math.PI * (0.1 + 0.8 * t));
        }, true);
      }
    }
    const a = origin ?? this.lifted(from, 0.48);
    this.sprite([15], a, 42 * scale, duration, (t, s) => {
      s.width = s.height = (20 + 28 * t) * scale;
      s.alpha = (this.reduced ? 0.24 : 0.65) * Math.sin(Math.PI * (0.15 + 0.7 * t));
    });
  }
  private thunderBeam(from: {x:number;y:number}, to: {x:number;y:number}, tile: Pos, duration: number, reveal: boolean) {
    const f = this.geometry.footprint(tile), plan = thunderConnection(from, to, f.w, this.reduced, this.mobile);
    const depth = this.geometry.depth(this.geometry.center(tile)) + 5;
    const width = (this.reduced ? 10 : plan.tier === 'long' ? 26 : plan.tier === 'medium' ? 22 : 18) * f.w / 96;
    const points = plan.points;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!, b = points[i + 1]!, length = Math.hypot(b.x - a.x, b.y - a.y);
      this.sprite([0, 1, 2, 3], a, length, duration, (t, s) => {
        const u = reveal ? Math.max(0, Math.min(1, t * (points.length - 1) - i)) : 1;
        s.anchor.set(0, 0.5); s.position.set(a.x, a.y);
        s.rotation = Math.atan2(b.y - a.y, b.x - a.x);
        s.width = Math.max(0.01, length * 1.11 * u); s.height = width;
        s.alpha = u > 0 ? thunderEnvelope(t, this.reduced) : 0;
        s.zIndex = depth;
      });
    }
    for (let i = 0; i < plan.branches; i++) {
      const a = points[Math.min(points.length - 2, i + 1)]!;
      const angle = Math.atan2(to.y - from.y, to.x - from.x) + (i % 2 ? -0.7 : 0.75);
      this.sprite([0, 2, 1, 3], a, f.w * 0.38, duration, (t, s) => {
        s.anchor.set(0, 0.5); s.rotation = angle;
        s.height = width * 0.55; s.alpha = reveal && t < (i + 1) / points.length ? 0 : 0.4 * thunderEnvelope(t, false);
        s.zIndex = depth;
      });
    }
  }
  private thunderTravel(recipe: CatalogRecipe, from: Pos, to: Pos, duration: number, origin?: {x:number;y:number}) {
    if (recipe.variant !== 'tempest_judgment') {
      this.thunderOrigin = {from, to, origin: origin ?? this.lifted(from, 0.48)};
      this.thunderBeam(this.thunderOrigin.origin, this.lifted(to, 0.44), to, duration, true);
      return;
    }
    const c = this.geometry.center(to), scale = this.geometry.footprint(to).w / 96;
    // Thin leader only. The bright full strike starts on the authoritative spellImpact cue.
    this.sprite([4, 5, 6, 7], c, 48 * scale, duration, (t, s) => {
      s.anchor.set(0.5, 1); s.position.set(c.x, c.y - (1 - t) * 210 * scale);
      s.width = 44 * scale; s.height = 75 * scale;
      s.alpha = this.reduced ? 0.12 : 0.28 * t; s.zIndex = this.geometry.depth(c) + 5;
    });
  }
  thunderTarget(at: Pos): void {
    const p = this.lifted(at, 0.43), c = this.geometry.center(at), scale = this.geometry.footprint(at).w / 96;
    this.sprite([9], p, (this.reduced ? 46 : 68) * scale, this.reduced ? 110 : 230, (t, s) => {
      s.alpha = (this.reduced ? 0.2 : 0.48) * (1 - t * t); s.zIndex = this.geometry.depth(c) + 5;
    });
    if (!this.reduced) this.sprite([11], p, 55 * scale, 320, (t, s) => {
      s.y = p.y - t * 12 * scale; s.alpha = 0.45 * (1 - t); s.zIndex = this.geometry.depth(c) + 4;
    });
  }
  premiumThunderImpact(recipe: CatalogRecipe, from: Pos, at: Pos, affected: readonly Pos[]) {
    if (isThunderAddition(recipe.variant)) { this.thunderAddition(recipe, 'impact', from, at, affected, this.reduced ? 180 : 460); return; }
    const c = this.geometry.center(at), f = this.geometry.footprint(at), scale = f.w / 96;
    const tempest = recipe.variant === 'tempest_judgment';
    if (tempest) {
      this.sprite(this.reduced ? [5] : [4, 5, 6, 7, 6, 5], c, (this.reduced ? 85 : 165) * scale, this.reduced ? 150 : 310, (t, s) => {
        s.anchor.set(0.5, 1); s.position.set(c.x, c.y + 5 * scale);
        s.height = (this.reduced ? 180 : 330) * scale;
        s.width = (this.reduced ? 85 : 150 + 16 * Math.sin(t * 7)) * scale;
        s.alpha = thunderEnvelope(t, this.reduced); s.zIndex = this.geometry.depth(c) + 6;
      });
    } else {
      const previous = this.thunderOrigin;
      const origin = previous && previous.from.x === from.x && previous.from.y === from.y && previous.to.x === at.x && previous.to.y === at.y ? previous.origin : this.lifted(from, 0.48);
      this.thunderBeam(origin, this.lifted(at, 0.44), at, this.reduced ? 90 : 150, false);
      this.thunderOrigin = null;
    }
    // Exactly the motor's footprint, not a new area inferred by the renderer.
    const tiles = [...new Map(affected.map(p => [`${p.x}:${p.y}`, p])).values()];
    for (const tile of tiles) {
      const p = this.geometry.center(tile), size = this.geometry.footprint(tile);
      this.sprite([13], p, size.w * 0.93, this.reduced ? 140 : 410, (t, s) => {
        s.height = size.h * 0.9; s.alpha = (this.reduced ? 0.2 : 0.62) * (1 - t * t);
      }, true);
      if (tempest) this.residue(recipe, tile);
    }
    this.sprite([10], c, f.w, this.reduced ? 150 : 460, (t, s) => {
      s.width = f.w * (0.6 + t * (tempest ? 1.8 : 0.45));
      s.height = f.h * (0.6 + t * (tempest ? 1.8 : 0.45));
      s.alpha = (this.reduced ? 0.15 : 0.48) * (1 - t * t);
    }, true);
    this.sprite([9], this.lifted(at, 0.4), (tempest ? 116 : 88) * scale, this.reduced ? 120 : 270, (t, s) => {
      s.alpha = (this.reduced ? 0.28 : 0.72) * (1 - t * t); s.zIndex = this.geometry.depth(c) + 4;
    });
    if (!this.reduced) for (let i = 0; i < (this.mobile ? 3 : 6); i++) {
      const a = i * 2.39996;
      this.sprite([15], c, (i % 2 ? 8 : 12) * scale, 440, (t, s) => {
        s.position.set(c.x + Math.cos(a) * (18 + i * 6) * scale * t, c.y - (22 + i * 5) * scale * t + Math.sin(a) * 10 * scale);
        s.alpha = 0.7 * (1 - t); s.zIndex = this.geometry.depth(c) + 4;
      });
    }
  }

  volley(_recipe: CatalogRecipe, tiles: readonly Pos[], duration: number): void {
    const n = Math.min(this.reduced ? 1 : 3, tiles.length);
    for (let i = 0; i < n; i++) {
      const tile = tiles[Math.floor((i * tiles.length) / n)]!,
        ground = this.geometry.center(tile),
        scale = this.geometry.footprint(tile).w / 96;
      this.sprite(
        this.reduced ? [1] : [0, 1, 2],
        ground,
        92 * scale,
        Math.max(1, duration),
        (t, s) => {
          s.y = ground.y - (this.reduced ? 0 : 44 * (1 - t) * scale);
          s.alpha = this.reduced ? 0.32 : 0.3 + 0.4 * t;
          s.zIndex = this.geometry.depth(ground) + 4;
        },
        false,
        false,
      );
    }
  }
  floor(recipe: CatalogRecipe, at: Pos, large = false): void {
    const c = this.geometry.center(at),
      f = this.geometry.footprint(at),
      scale = f.w / 96;
    const duration = this.reduced ? 130 : 320;
    this.sprite(
      clips(recipe).floor,
      c,
      (large ? 142 : 92) * scale,
      duration,
      (t, s) => {
        s.width = (large ? 90 + 68 * t : 58 + 38 * t) * scale;
        s.height = (s.width * f.h) / f.w;
        s.alpha = (this.reduced ? 0.2 : 0.38) * (1 - t * t);
        s.tint = recipe.tint;
      },
      true,
      false,
    );
  }
  contact(recipe: CatalogRecipe, from: Pos, at: Pos): void {
    const p =
        recipe.style === 'volley' ||
        recipe.variant === 'grasping_roots' ||
        recipe.variant === 'entangled_forest'
          ? this.geometry.center(at)
          : this.lifted(at, 0.43),
      ground = this.geometry.center(at),
      a = this.lifted(from, 0.48),
      scale = this.geometry.footprint(at).w / 96;
    this.sprite(
      recipe.style === 'volley' ? [3] : clips(recipe).contact,
      p,
      (this.reduced ? 58 : 90) * scale,
      this.reduced ? 130 : 240,
      (t, s) => {
        s.alpha = (this.reduced ? 0.38 : 0.72) * (1 - t * t);
        s.tint = recipe.tint;
        s.zIndex = this.geometry.depth(ground) + 4;
        if (recipe.family === 'physical' && recipe.style !== 'volley')
          s.rotation = Math.atan2(p.y - a.y, p.x - a.x);
      },
      false,
      recipe.style !== 'volley',
    );
    if (this.reduced) return;
    const count = this.mobile ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996,
        d = (14 + (i % 2) * 12) * scale;
      this.sprite(clips(recipe).mote, p, 9 * scale, 260, (t, s) => {
        s.position.set(
          p.x + Math.cos(angle) * d * t,
          p.y + Math.sin(angle) * d * t - 10 * t * scale,
        );
        s.alpha = 0.55 * (1 - t);
        s.tint = recipe.tint;
        s.zIndex = this.geometry.depth(ground) + 3;
      });
    }
  }
  pulse(recipe: CatalogRecipe, at: Pos, large = false): void {
    this.floor(recipe, at, large);
    const ground = this.geometry.center(at),
      p = this.lifted(at, 0.4),
      scale = this.geometry.footprint(at).w / 96;
    this.sprite(
      clips(recipe).contact,
      p,
      (large ? 105 : 72) * scale,
      this.reduced ? 140 : 360,
      (t, s) => {
        s.y = p.y - (this.reduced ? 0 : 12 * t * scale);
        s.alpha = (this.reduced ? 0.22 : large ? 0.48 : 0.32) * Math.sin(Math.PI * t);
        s.tint = recipe.tint;
        s.zIndex = this.geometry.depth(ground) + 3;
      },
    );
    if (this.reduced) return;
    for (let i = 0; i < (this.mobile ? 2 : 4); i++)
      this.sprite(clips(recipe).mote, ground, 11 * scale, 340, (t, s) => {
        const angle = i * 2.39996;
        s.position.set(
          ground.x + Math.cos(angle) * 20 * scale * (1 - t),
          ground.y - 42 * t * scale + Math.sin(angle) * 7,
        );
        s.alpha = 0.45 * Math.sin(Math.PI * t);
        s.tint = recipe.tint;
        s.zIndex = this.geometry.depth(ground) + 2;
      });
  }
}

export class CatalogEffects {
  private readonly banks: Record<AtlasBank, RecipeBank>;
  private readonly paralyzing: ParalyzingPulseEffects;
  reduced = false;
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    this.paralyzing = new ParalyzingPulseEffects(actors, ground, geometry);
    this.banks = Object.fromEntries(
      (
        [
          'thunder-premium',
          'mage-elements',
          'bastion',
          'fireball',
          'mage-spells',
          'pact-summon',
          'wild-spirit',
        ] as const
      ).map((id) => [id, new RecipeBank(actors, ground, geometry, id)]),
    ) as Record<AtlasBank, RecipeBank>;
  }
  get requested() {
    return catalogPremiumEnabled();
  }
  get snapshot() {
    const banks=Object.fromEntries(Object.entries(this.banks).map(([id,bank])=>[id,bank.snapshot])) as Record<AtlasBank,RecipeBank['snapshot']>;
    return {...banks,'paralyzing-pulse':this.paralyzing.snapshot};
  }
  beginBatch(): void {
    this.paralyzing.beginBatch();
    for (const bank of Object.values(this.banks)) bank.beginBatch();
  }
  async prepare(recipes: readonly CatalogRecipe[]): Promise<void> {
    await Promise.all(
      [recipes.some(r=>r.variant==='paralyzing_pulse') ? this.paralyzing.prepare() : Promise.resolve(),
      ...[...new Set(recipes.filter(r=>r.variant!=='paralyzing_pulse').map((r) => r.bank))].map((id) => this.banks[id].prepare())],
    );
  }
  private bank(recipe: CatalogRecipe): RecipeBank | null {
    const bank = this.banks[recipe.bank];
    bank.reduced = this.reduced;
    return this.requested && bank.ready ? bank : null;
  }
  handles(recipe: CatalogRecipe | undefined): recipe is CatalogRecipe {
    if(recipe?.variant==='paralyzing_pulse'){this.paralyzing.reduced=this.reduced;return this.requested&&this.paralyzing.ready;}
    return !!recipe && !!this.bank(recipe);
  }
  charge(
    recipe: CatalogRecipe,
    from: Pos,
    duration: number,
    origin?: { x: number; y: number },
    target: Pos = from,
    affected: readonly Pos[] = [target],
  ): void {
    if(recipe.variant==='paralyzing_pulse'){if(this.handles(recipe))this.paralyzing.charge(from,affected,duration);return;}
    this.bank(recipe)?.charge(recipe, from, duration, origin, target, affected);
  }
  volley(recipe: CatalogRecipe, tiles: readonly Pos[], duration: number): void {
    this.bank(recipe)?.volley(recipe, tiles, duration);
  }
  projectile(
    recipe: CatalogRecipe,
    from: Pos,
    to: Pos,
    duration: number,
    origin?: { x: number; y: number },
  ): void {
    if(recipe.variant==='paralyzing_pulse'){if(this.handles(recipe))this.paralyzing.release(from,duration);return;}
    this.bank(recipe)?.travel(recipe, from, to, duration, origin);
  }
  impact(recipe: CatalogRecipe, from: Pos, at: Pos, affected: readonly Pos[]): void {
    if(recipe.variant==='paralyzing_pulse'){if(this.handles(recipe))this.paralyzing.impact(from,affected);return;}
    const bank = this.bank(recipe);
    if (
      !bank ||
      recipe.contactOnDamage ||
      recipe.shape === 'arrival' ||
      recipe.shape === 'transition'
    )
      return;
    if (recipe.bank === 'thunder-premium') { bank.premiumThunderImpact(recipe, from, at, affected); return; }
    if (recipe.mageElement) for (const tile of affected.slice(0, 8)) bank.residue(recipe, tile);
    if (recipe.variant === 'vital_sap') bank.travel(recipe, at, from, this.reduced ? 100 : 380);
    if (['defense', 'heal', 'movement', 'tactic'].includes(recipe.family)) {
      bank.pulse(recipe, at);
      return;
    }
    if (recipe.shape === 'area') {
      bank.floor(recipe, at, true);
      const n = Math.min(this.reduced ? 1 : 3, affected.length);
      for (let i = 0; i < n; i++)
        bank.contact(recipe, from, affected[Math.floor((i * affected.length) / n)]!);
    } else bank.contact(recipe, from, at);
  }
  thunderTarget(recipe: CatalogRecipe, at: Pos): void {
    if(recipe.variant==='paralyzing_pulse'){if(this.handles(recipe))this.paralyzing.target(at);return;}
    if (recipe.bank === 'thunder-premium') this.bank(recipe)?.thunderTarget(at);
  }
  pulseStatus(recipe: CatalogRecipe, at: Pos, turns: number): void {
    if(recipe.variant==='paralyzing_pulse'&&this.handles(recipe))this.paralyzing.status(at,turns);
  }
  contact(family: PremiumFamily, from: Pos, at: Pos): boolean {
    const recipe = familyRecipe(family),
      bank = this.bank(recipe);
    if (!bank) return false;
    bank.contact(recipe, from, at);
    return true;
  }
  area(family: PremiumFamily, from: Pos, tiles: readonly Pos[]): boolean {
    const recipe = familyRecipe(family, 'area');
    if (!this.bank(recipe)) return false;
    const at = tiles[Math.floor(tiles.length / 2)];
    if (at) this.impact(recipe, from, at, tiles);
    return true;
  }
  pulse(family: PremiumFamily, at: Pos, large = false): boolean {
    const recipe = familyRecipe(family, 'pulse'),
      bank = this.bank(recipe);
    if (!bank) return false;
    bank.pulse(recipe, at, large);
    return true;
  }
  /** Only invoked from confirmed spawn / form events, never anticipatory CARD_PLAYED. */
  arrival(at: Pos, transform = false): boolean {
    return this.pulse(transform ? 'transform' : 'summon', at, true);
  }
  advanceRound(round: number): void {
    for (const bank of Object.values(this.banks)) bank.advanceRound(round);
  }
  tick(ms: number): void {
    this.paralyzing.tick(ms);
    for (const bank of Object.values(this.banks)) bank.tick(ms);
  }
  clear(): void {
    this.paralyzing.clear();
    for (const bank of Object.values(this.banks)) bank.clear();
  }
  destroy(): void {
    this.paralyzing.destroy();
    for (const bank of Object.values(this.banks)) bank.destroy();
  }
}
/** Atlas banks are shared by family; this helper does not imply loading them all at startup. */
export const familyBank = (family: PremiumFamily): AtlasBank => BANK[family];
