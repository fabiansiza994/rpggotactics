import type { Container } from 'pixi.js';
import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import { fireballPilotAllowed } from './fireballRecipe';
import { BASTION_RECIPE as recipe, phaseTwoPilot } from './phaseTwoRecipes';

/** Metal/stone contact recipe. Does not inspect Guardia or invent push/stun outcomes. */
export class BastionEffects extends PaintedEffectPool {
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    super(actors, ground, geometry, recipe.atlas);
  }
  get requested() {
    return fireballPilotAllowed() && phaseTwoPilot.bastion;
  }
  anticipate(from: Pos, to: Pos, duration: number): void {
    const a = this.lifted(from, 0.5),
      b = this.lifted(to, 0.45),
      scale = this.geometry.footprint(from).w / 96;
    const angle = Math.atan2(b.y - a.y, b.x - a.x),
      at = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
    this.sprite(
      this.reduced ? recipe.frames.glint : recipe.frames.arc,
      at,
      100 * scale,
      duration,
      (t, s) => {
        s.rotation = angle;
        s.alpha = this.reduced ? 0.25 : 0.3 + Math.sin(Math.PI * t) * 0.48;
        s.width = s.height = (this.reduced ? 35 : 72 + 24 * t) * scale;
        s.zIndex = this.geometry.depth(this.geometry.center(from)) + 3;
      },
    );
  }
  impact(from: Pos, to: Pos): void {
    const at = this.lifted(to, 0.45),
      origin = this.lifted(from, 0.5),
      ground = this.geometry.center(to),
      f = this.geometry.footprint(to),
      scale = f.w / 96;
    const angle = Math.atan2(at.y - origin.y, at.x - origin.x);
    this.sprite(
      recipe.frames.contact,
      at,
      (this.reduced ? 65 : 105) * scale,
      this.reduced ? 140 : recipe.contactMs,
      (t, s) => {
        s.rotation = angle;
        s.alpha = (this.reduced ? 0.5 : 0.9) * (1 - t * t);
        s.zIndex = this.geometry.depth(ground) + 4;
      },
    );
    this.sprite(
      recipe.frames.wave,
      ground,
      128 * scale,
      this.reduced ? 140 : recipe.waveMs,
      (t, s) => {
        s.width = (74 + 55 * t) * scale;
        s.height = (s.width * f.h) / f.w;
        s.alpha = (this.reduced ? 0.2 : 0.45) * (1 - t);
      },
      true,
      false,
    );
    if (this.reduced) return;
    this.sprite(
      recipe.frames.dust,
      ground,
      70 * scale,
      recipe.debrisMs,
      (t, s) => {
        s.y = ground.y - 9 * t * scale;
        s.alpha = 0.22 * Math.sin(t * Math.PI);
        s.width = (50 + 30 * t) * scale;
        s.height = s.width * 0.6;
      },
      true,
      false,
    );
    const count = this.mobile ? recipe.mobileFragments : recipe.desktopFragments;
    for (let i = 0; i < count; i++) {
      const a = angle + (i / Math.max(1, count - 1) - 0.5) * 2.2,
        d = (18 + (i % 3) * 10) * scale;
      this.sprite(
        i % 2 ? recipe.frames.spark : recipe.frames.shard,
        at,
        (9 + (i % 3) * 3) * scale,
        recipe.debrisMs,
        (t, s) => {
          s.position.set(
            at.x + Math.cos(a) * d * t,
            at.y + Math.sin(a) * d * t + 12 * t * t * scale,
          );
          s.rotation = a + t * 2;
          s.alpha = 0.8 * (1 - t);
          s.zIndex = this.geometry.depth(ground) + 3;
        },
        false,
        i % 2 === 1,
      );
    }
  }
}
