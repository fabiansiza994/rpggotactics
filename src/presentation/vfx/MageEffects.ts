import { elementalReactionDuration, elementalReactionEnvelope } from './elementalReactionTiming';
import type { Container } from 'pixi.js';
import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import { MAGE_FRAMES as frames, mageRecipeEnabled, type MageRecipeKey } from './mageRecipes';

/** Two illustrated recipes on the existing clock/pool. Never synthesizes damage or status. */
export class MageEffects extends PaintedEffectPool {
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    super(actors, ground, geometry, 'mage-spells');
  }
  get requested() {
    return mageRecipeEnabled('frost_nova') || mageRecipeEnabled('magic_missile');
  }
  handles(key: string): key is MageRecipeKey {
    return this.ready && mageRecipeEnabled(key);
  }

  clearReaction(id: string): void { this.clearGroup('hit:'+id); }
  /** Target-bound atlas layers, on the same bounded pool and presentation clock. */
  reaction(id: string, position: () => Pos | undefined, kind: 'ice' | 'arcane', adjusted = true): void {
    this.clearReaction(id);
    const p=position();if(!p)return;
    const scale=this.geometry.footprint(p).w/96,at=this.lifted(p,.4),group='hit:'+id;
    const reduced=this.reduced,duration=reduced?140:elementalReactionDuration(kind,adjusted);
    this.sprite(kind==='ice'?frames.mist:frames.arcaneCharge,at,64*scale,duration,(t,s)=>{
      const pos=position();if(!pos){s.alpha=0;return;}
      const body=this.lifted(pos,.4);s.position.set(body.x,body.y);
      const envelope=adjusted&&!reduced?elementalReactionEnvelope(t):Math.min(1,t*7)*(1-t);
      s.width=(reduced?46:kind==='ice'?61+7*t:42+25*t)*scale;
      s.height=s.width*(kind==='ice'?1.05:.72);
      s.alpha=(reduced?.16:kind==='ice'?.24:.34)*envelope;
      s.tint=kind==='ice'?0xb9eeff:0xc8a4ff;
      s.zIndex=this.geometry.depth(this.geometry.center(pos))+3;
    },false,kind==='arcane',group);
    if(reduced)return;
    const count=this.mobile?2:3;
    for(let i=0;i<count;i++)this.sprite(kind==='ice'?frames.iceShard:frames.mote,at,(kind==='ice'?19:10)*scale,(adjusted?duration:300+i*25),(t,s)=>{
      const pos=position();if(!pos){s.alpha=0;return;}
      const body=this.lifted(pos,.4),a=i*2.39996;
      const r=15+12*t;
      s.position.set(body.x+Math.cos(a)*r*scale,body.y+Math.sin(a)*r*.65*scale-(kind==='ice'?0:9*t*scale));
      s.alpha=.6*(adjusted?elementalReactionEnvelope(t):Math.min(1,t*9)*(1-t));s.rotation=a+(kind==='ice'?t*.5:t);
      s.tint=kind==='ice'?0xd9f7ff:i%2?0x88eff3:0xc8a4ff;
      s.zIndex=this.geometry.depth(this.geometry.center(pos))+3;
    },false,kind==='arcane',group);
  }

  charge(key: MageRecipeKey, from: Pos, duration: number, origin?: { x: number; y: number }): void {
    const at =
      key === 'magic_missile' ? (origin ?? this.lifted(from, 0.5)) : this.geometry.center(from);
    const scale = this.geometry.footprint(from).w / 96;
    this.sprite(
      key === 'frost_nova' ? frames.iceCharge : frames.arcaneCharge,
      at,
      65 * scale,
      duration,
      (t, s) => {
        s.width = s.height = (this.reduced ? 32 : 32 + 30 * t) * scale;
        s.alpha = (this.reduced ? 0.25 : 0.65) * Math.sin(Math.PI * (0.1 + 0.8 * t));
        s.rotation = this.reduced ? 0 : t * 0.35;
        s.zIndex = this.geometry.depth(this.geometry.center(from)) + 3;
      },
      key === 'frost_nova',
    );
  }

  projectile(from: Pos, to: Pos, duration: number, origin?: { x: number; y: number }): void {
    const a = origin ?? this.lifted(from, 0.5),
      b = this.lifted(to, 0.44);
    const scale = this.geometry.footprint(from).w / 96;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // The illustrated leading tip points right in the atlas. No logical facing is changed.
    this.sprite(frames.missile, a, (this.reduced ? 38 : 67) * scale, duration, (t, s) => {
      s.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      s.rotation = angle;
      s.alpha = this.reduced ? 0.6 : 0.88;
      s.zIndex =
        this.geometry.depth(
          this.geometry.center({
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
          }),
        ) + 3;
    });
    if (this.reduced) return;
    const count = this.mobile ? 2 : 4;
    for (let i = 0; i < count; i++)
      this.sprite(frames.trail, a, 55 * scale, duration, (t, s) => {
        const follow = Math.max(0, t - (i + 1) * 0.045);
        s.position.set(a.x + (b.x - a.x) * follow, a.y + (b.y - a.y) * follow);
        s.rotation = angle;
        s.width = (45 - i * 6) * scale;
        s.height = (21 - i * 2) * scale;
        s.alpha = 0.22 * (1 - i / count) * Math.sin(Math.PI * t);
        s.zIndex =
          this.geometry.depth(
            this.geometry.center({
              x: from.x + (to.x - from.x) * follow,
              y: from.y + (to.y - from.y) * follow,
            }),
          ) + 2;
      });
  }

  impact(key: MageRecipeKey, at: Pos, affected: readonly Pos[]): void {
    const ground = this.geometry.center(at),
      f = this.geometry.footprint(at),
      scale = f.w / 96;
    if (key === 'magic_missile') {
      const contact = this.lifted(at, 0.44);
      this.sprite(
        frames.arcaneImpact,
        contact,
        (this.reduced ? 62 : 100) * scale,
        this.reduced ? 140 : 240,
        (t, s) => {
          s.alpha = (this.reduced ? 0.45 : 0.8) * (1 - t * t);
          s.zIndex = this.geometry.depth(ground) + 4;
        },
      );
      this.motes(contact, scale, frames.mote, 0xbfa4ff, this.geometry.depth(ground) + 3);
      return;
    }
    // A self-centred nova is a ground propagation, never an invented projectile.
    this.sprite(
      frames.frostWave,
      ground,
      180 * scale,
      this.reduced ? 140 : 360,
      (t, s) => {
        s.width = (this.reduced ? 130 : 100 + 115 * t) * scale;
        s.height = (s.width * f.h) / f.w;
        s.alpha = (this.reduced ? 0.3 : 0.65) * (1 - t * t);
      },
      true,
      false,
    );
    if (this.reduced) return;
    const limit = this.mobile ? 4 : 8;
    // Sample the entire confirmed footprint; slicing the first four drops its lower half.
    const count = Math.min(limit, affected.length);
    const tiles = Array.from(
      { length: count },
      (_, i) => affected[Math.floor((i * affected.length) / count)]!,
    );
    for (const tile of tiles) {
      const p = this.geometry.center(tile);
      this.sprite(
        frames.iceShard,
        p,
        45 * scale,
        320,
        (t, s) => {
          s.y = p.y - Math.sin(Math.PI * t) * 14 * scale;
          s.alpha = 0.6 * Math.sin(Math.PI * t);
          s.height = (28 + 12 * Math.sin(Math.PI * t)) * scale;
        },
        true,
        false,
      );
    }
    this.sprite(
      frames.mist,
      ground,
      150 * scale,
      400,
      (t, s) => {
        s.width = (120 + 55 * t) * scale;
        s.height = (s.width * f.h) / f.w;
        s.alpha = 0.22 * Math.sin(Math.PI * t);
        s.y = ground.y - 7 * t * scale;
      },
      true,
      false,
    );
    this.motes(ground, scale, frames.iceSpark, 0xb5f3ff);
  }
  private motes(
    at: { x: number; y: number },
    scale: number,
    clip: readonly number[],
    tint: number,
    depth = this.geometry.depth(at) + 3,
  ): void {
    if (this.reduced) return;
    const count = this.mobile ? 3 : 6;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996,
        d = (15 + (i % 3) * 9) * scale;
      this.sprite(clip, at, 12 * scale, 300, (t, s) => {
        s.position.set(
          at.x + Math.cos(angle) * d * t,
          at.y + Math.sin(angle) * d * t - 12 * t * scale,
        );
        s.alpha = 0.65 * (1 - t);
        s.tint = tint;
        s.rotation = t * 0.5;
        s.zIndex = depth;
      });
    }
  }
}
