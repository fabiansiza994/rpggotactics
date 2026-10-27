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
  r.style === 'volley'
    ? { charge: [13], contact: [0, 1, 2, 3], floor: [14], mote: [13] }
    : r.style === 'ancestral'
      ? { charge: [12], contact: [8, 9, 10, 11], floor: [15], mote: [12] }
      : CLIPS[r.family];

/** Shared illustrated families, using five source atlases (not one atlas/card).
 * All sprites are non-interactive, depth-anchored and driven by the existing world clock. */
class RecipeBank extends PaintedEffectPool {
  constructor(actors: Container, ground: Container, geometry: FxGeometry, bank: AtlasBank) {
    super(actors, ground, geometry, bank, 24);
  }
  get requested() {
    return catalogPremiumEnabled();
  }
  charge(
    recipe: CatalogRecipe,
    from: Pos,
    duration: number,
    origin?: { x: number; y: number },
  ): void {
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
    const surface = recipe.family === 'physical' || recipe.shape === 'area',
      a = surface ? this.geometry.center(from) : (origin ?? this.lifted(from, 0.48));
    const b = surface ? this.geometry.center(to) : this.lifted(to, 0.44),
      scale = this.geometry.footprint(to).w / 96;
    const clip =
      recipe.shape === 'area'
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
          s.position.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
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
    const p = recipe.style === 'volley' ? this.geometry.center(at) : this.lifted(at, 0.43),
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
  reduced = false;
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    this.banks = Object.fromEntries(
      (['bastion', 'fireball', 'mage-spells', 'pact-summon', 'wild-spirit'] as const).map((id) => [
        id,
        new RecipeBank(actors, ground, geometry, id),
      ]),
    ) as Record<AtlasBank, RecipeBank>;
  }
  get requested() {
    return catalogPremiumEnabled();
  }
  get snapshot() {
    return Object.fromEntries(Object.entries(this.banks).map(([id, bank]) => [id, bank.snapshot]));
  }
  beginBatch(): void {
    for (const bank of Object.values(this.banks)) bank.beginBatch();
  }
  async prepare(recipes: readonly CatalogRecipe[]): Promise<void> {
    await Promise.all(
      [...new Set(recipes.map((r) => r.bank))].map((id) => this.banks[id].prepare()),
    );
  }
  private bank(recipe: CatalogRecipe): RecipeBank | null {
    const bank = this.banks[recipe.bank];
    bank.reduced = this.reduced;
    return this.requested && bank.ready ? bank : null;
  }
  handles(recipe: CatalogRecipe | undefined): recipe is CatalogRecipe {
    return !!recipe && !!this.bank(recipe);
  }
  charge(
    recipe: CatalogRecipe,
    from: Pos,
    duration: number,
    origin?: { x: number; y: number },
  ): void {
    this.bank(recipe)?.charge(recipe, from, duration, origin);
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
    this.bank(recipe)?.travel(recipe, from, to, duration, origin);
  }
  impact(recipe: CatalogRecipe, from: Pos, at: Pos, affected: readonly Pos[]): void {
    const bank = this.bank(recipe);
    if (
      !bank ||
      recipe.contactOnDamage ||
      recipe.shape === 'arrival' ||
      recipe.shape === 'transition'
    )
      return;
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
  tick(ms: number): void {
    for (const bank of Object.values(this.banks)) bank.tick(ms);
  }
  clear(): void {
    for (const bank of Object.values(this.banks)) bank.clear();
  }
  destroy(): void {
    for (const bank of Object.values(this.banks)) bank.destroy();
  }
}
/** Atlas banks are shared by family; this helper does not imply loading them all at startup. */
export const familyBank = (family: PremiumFamily): AtlasBank => BANK[family];
