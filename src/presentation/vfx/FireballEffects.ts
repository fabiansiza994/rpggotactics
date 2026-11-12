import { elementalReactionDuration, elementalReactionEnvelope } from './elementalReactionTiming';
import type { Container, Sprite } from 'pixi.js';
import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import { FIREBALL_RECIPE as recipe, fireballFrame, fireballPilot, fireballPilotAllowed } from './fireballRecipe';

type Point = { x: number; y: number };

/** Approved fireball recipe, sharing its unchanged pool/loader with the phase-two recipes. */
export class FireballEffects extends PaintedEffectPool {
  private angle = 0;
  constructor(actors: Container, ground: Container, geometry: FxGeometry) { super(actors, ground, geometry, 'fireball', recipe.poolLimit); }
  get requested() { return fireballPilotAllowed() && fireballPilot.premium; }
  charge(pos: Pos, duration: number, origin?: Point): void {
    const at = origin ?? this.lifted(pos, 0.7), scale = this.geometry.footprint(pos).w / 96;
    this.sprite(recipe.frames.ignition, at, 62 * scale, duration, (t, s) => {
      const size = (26 + 36 * t) * scale; s.width = s.height = size; s.alpha = 0.22 + t * 0.55;
      s.zIndex = this.geometry.depth(this.geometry.center(pos)) + 2;
    });
  }
  projectile(from: Pos, to: Pos, duration: number, origin?: Point): void {
    const a = origin ?? this.lifted(from, 0.55), b = this.lifted(to, 0.45);
    const ga = this.geometry.center(from), gb = this.geometry.center(to);
    const scale = this.geometry.footprint(to).w / 96;
    const angle = Math.atan2(b.y - a.y, b.x - a.x); this.angle = angle;
    const track = (t: number, s: Sprite) => {
      s.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); s.rotation = angle;
      s.zIndex = this.geometry.depth({ x: ga.x + (gb.x - ga.x) * t, y: ga.y + (gb.y - ga.y) * t }) + 2;
    };
    if (!this.reduced) this.sprite(recipe.frames.trail, a, 100 * scale, duration, (t, s) => {
      track(t, s); s.anchor.set(0.86, 0.5); s.width = (80 + 25 * Math.sin(t * Math.PI)) * scale; s.height = 36 * scale; s.alpha = 0.48;
    });
    this.sprite(recipe.frames.core, a, 66 * scale, duration, (t, s) => {
      track(t, s); s.texture = this.frames[fireballFrame(recipe.frames.core, t * 2, true)]!;
      s.alpha = this.reduced ? 0.65 : 0.95;
    });
  }
  impact(pos: Pos): void {
    const at = this.lifted(pos, 0.32), ground = this.geometry.center(pos), f = this.geometry.footprint(pos);
    const scale = f.w / 96, angle = this.angle;
    this.sprite(recipe.frames.wave, ground, 125 * scale, this.reduced ? 160 : 360, (t, s) => {
      s.width = (65 + 70 * t) * scale; s.height = s.width * f.h / f.w;
      s.alpha = (this.reduced ? 0.28 : 0.52) * (1 - t);
    }, true, false);
    this.sprite(recipe.frames.explosion, at, (this.reduced ? 78 : 114) * scale, this.reduced ? 160 : 300, (t, s) => {
      s.rotation = this.reduced ? 0 : angle + Math.PI / 4; s.alpha = (this.reduced ? 0.55 : 0.88) * (1 - t * t);
      s.zIndex = this.geometry.depth(ground) + 3;
    });
    if (this.reduced) return;
    const quality = this.mobile ? recipe.mobile : recipe.desktop;
    this.sprite(recipe.frames.smoke, at, 106 * scale, quality.smokeMs, (t, s) => {
      s.y = at.y - t * 13 * scale; s.alpha = 0.28 * Math.sin(Math.PI * t);
      s.width = s.height = (80 + 30 * t) * scale; s.zIndex = this.geometry.depth(ground) + 2;
    }, false, false);
    for (let i = 0; i < quality.embers; i++) {
      // Analytic cosmetic distribution: independent of engine RNG and frame cadence.
      const a = angle + (i / Math.max(1, quality.embers - 1) - 0.5) * 1.6, distance = (22 + i % 3 * 11) * scale;
      this.sprite(recipe.frames.ember, at, (10 + i % 3 * 3) * scale, 270 + i % 3 * 65, (t, s) => {
        s.position.set(at.x + Math.cos(a) * distance * t, at.y + Math.sin(a) * distance * t + 12 * t * t);
        s.alpha = 0.75 * (1 - t); s.rotation = a + t; s.zIndex = this.geometry.depth(ground) + 4;
      });
    }
  }
  clearReaction(id: string): void { this.clearGroup('hit:' + id); }
  /** Brief cosmetic flames, never the BURNING status; refreshed instead of stacked per victim. */
  reaction(id: string, position: () => Pos | undefined, layered = false, adjusted = true): void {
    this.clearReaction(id);
    const p = position(); if (!p) return;
    const at = this.lifted(p, .38), scale = this.geometry.footprint(p).w / 96;
    this.sprite(recipe.frames.core, at, (this.reduced ? 42 : 70) * scale, this.reduced ? 140 : elementalReactionDuration('fire',layered&&adjusted), (t, s) => {
      const current = position(); if (!current) { s.alpha = 0; return; }
      const ground = this.geometry.center(current), body = this.lifted(current, .38);
      s.position.set(body.x, body.y - (this.reduced ? 0 : t * 9 * scale));
      s.width = (this.reduced ? 42 : 62 - t * 12) * scale; s.height = s.width * 1.25;
      s.alpha = (this.reduced ? .22 : .52) * (layered&&adjusted&&!this.reduced?elementalReactionEnvelope(t):1-t); s.zIndex = this.geometry.depth(ground) + 3;
    }, false, true, 'hit:' + id);
    if (!layered || this.reduced) return;
    // Existing illustrated core/embers, attached to the victim rather than the projectile.
    const group='hit:'+id;
    if(!this.mobile)this.sprite(recipe.frames.core,at,43*scale,adjusted?550:340,(t,s)=>{
      const current=position();if(!current){s.alpha=0;return;}
      const body=this.lifted(current,.27);
      s.position.set(body.x+Math.sin(t*5)*6*scale,body.y-t*16*scale);
      s.width=(39-12*t)*scale;s.height=s.width*1.4;s.alpha=.33*(adjusted?elementalReactionEnvelope(t):1-t);
      s.zIndex=this.geometry.depth(this.geometry.center(current))+3;
    },false,true,group);
    for(let i=0;i<2;i++)this.sprite(recipe.frames.ember,at,9*scale,adjusted?650:320+i*40,(t,s)=>{
      const current=position();if(!current){s.alpha=0;return;}
      const body=this.lifted(current,.4);
      s.position.set(body.x+(i?1:-1)*(12+8*t)*scale,body.y-(8+24*t)*scale);
      s.alpha=.65*(adjusted?elementalReactionEnvelope(t):(1-t)*(1-t));s.rotation=i+t;
      s.zIndex=this.geometry.depth(this.geometry.center(current))+3;
    },false,true,group);
  }
  override clear(): void { super.clear(); this.angle = 0; }
}
