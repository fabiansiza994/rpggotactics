import type { Container } from 'pixi.js';
import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import { fireballPilotAllowed } from './fireballRecipe';
import { GOLEM_RECIPE as recipe, phaseTwoPilot } from './phaseTwoRecipes';

/** Runes may anticipate; creature materialization is owned by UNIT_SPAWNED in VfxDirector. */
export class PactSummonEffects extends PaintedEffectPool {
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    super(actors, ground, geometry, recipe.atlas);
  }
  get requested() {
    return fireballPilotAllowed() && phaseTwoPilot.golem;
  }
  prepareCircle(pos: Pos, duration: number): void {
    const at = this.geometry.center(pos),
      f = this.geometry.footprint(pos),
      scale = f.w / 96;
    this.sprite(
      recipe.frames.circle,
      at,
      105 * scale,
      duration,
      (t, s) => {
        s.height = (s.width * f.h) / f.w;
        s.alpha = this.reduced ? 0.3 : 0.25 + 0.45 * Math.sin(Math.PI * t);
      },
      true,
    );
    if (this.reduced) return;
    const count = this.mobile ? recipe.mobileMotes : recipe.desktopMotes;
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996,
        dx = Math.cos(a) * 48 * scale,
        dy = Math.sin(a) * 20 * scale;
      this.sprite(
        i % 2 ? recipe.frames.rune : recipe.frames.mote,
        at,
        12 * scale,
        duration,
        (t, s) => {
          s.position.set(at.x + dx * (1 - t), at.y + dy * (1 - t) - t * 10 * scale);
          s.alpha = 0.7 * Math.sin(Math.PI * t);
          s.rotation = a + t;
          s.zIndex = this.geometry.depth(at) + 2;
        },
      );
    }
  }
  /** Called only for a confirmed pact_golem spawn, at that event's visual commit. */
  arrive(pos: Pos): void {
    const at = this.geometry.center(pos),
      body = this.lifted(pos, 0.48),
      f = this.geometry.footprint(pos),
      scale = f.w / 96;
    this.sprite(
      recipe.frames.aura,
      at,
      126 * scale,
      this.reduced ? 180 : recipe.auraMs,
      (t, s) => {
        s.height = (s.width * f.h) / f.w;
        s.alpha = (this.reduced ? 0.25 : 0.48) * (1 - t);
      },
      true,
    );
    this.sprite(
      this.reduced ? recipe.frames.convergence : recipe.frames.rise,
      body,
      115 * scale,
      this.reduced ? 160 : recipe.arrivalMs,
      (t, s) => {
        s.height = s.width * 1.18;
        s.alpha = (this.reduced ? 0.3 : 0.52) * Math.sin(Math.PI * t);
        s.zIndex = this.geometry.depth(at) + 2;
      },
    );
    if (this.reduced) return;
    for (let i = 0; i < 2; i++)
      this.sprite(
        recipe.frames.dust,
        at,
        74 * scale,
        420,
        (t, s) => {
          s.position.set(at.x + (i ? 1 : -1) * 23 * t * scale, at.y - 8 * t * scale);
          s.width = (45 + 40 * t) * scale;
          s.height = s.width * 0.55;
          s.alpha = 0.25 * Math.sin(Math.PI * t);
        },
        true,
        false,
      );
    const count = this.mobile ? recipe.mobileMotes : recipe.desktopMotes;
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996,
        dx = Math.cos(a) * 30 * scale;
      this.sprite(recipe.frames.mote, at, (8 + (i % 3) * 3) * scale, 500 + (i % 3) * 55, (t, s) => {
        s.position.set(at.x + dx * (1 - 0.4 * t), at.y - (20 + 30 * (i % 3)) * t * scale);
        s.alpha = 0.65 * Math.sin(Math.PI * t);
        s.zIndex = this.geometry.depth(at) + 3;
      });
    }
  }
}
