import { Container, Graphics } from 'pixi.js';
import type { BoardViewModel } from '../pixi/viewModel';
import type { GridProjection } from '../pixi/GridProjection';
import type { VisualElement } from '../../game/domain/cards/card';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';

export const targetingColors: Record<VisualElement, number> = {
  NATURE: 0x43d78c, THUNDER: 0x93cfff, FIRE: 0xff7635, ICE: 0x85dcff, ARCANE: 0xc486ff, FORCE: 0xeeb95c,
  SHIELD: 0x7bd9e5, TELEPORT: 0xa89aff, NEUTRAL: 0xc9c1a5,
};
/** Pure presentation: consumes the resolved footprint, never computes targeting. */
export class ElementalTargetingPreview extends PaintedEffectPool {
  readonly root = new Container();
  private readonly art: Container;
  private readonly maskShape = new Graphics();
  private readonly lines = new Graphics();
  private key = '';
  private clock = 0;
  private opacity = 0;
  private shown = false;
  private painted = false;
  private pending: (() => void) | null = null;
  constructor(geometry: FxGeometry) {
    const layer = new Container();
    super(layer, layer, geometry, 'environment', 64);
    this.art = layer;
    this.root.eventMode = 'none';
    this.root.addChild(this.art, this.maskShape, this.lines);
    this.art.mask = this.maskShape;
  }
  get requested() { return true; }
  sync(vm: BoardViewModel, proj: GridProjection) {
    const p = vm.interactive && vm.preview?.valid ? vm.preview : null;
    const element = p?.element;
    if (!p || !element) { this.shown = false; return; }
    const points = p.tiles.map(tile => ({ tile, center: proj.getTileCenter(tile), footprint: proj.footprint(tile), polygon: proj.getInsetPolygon(tile, .035).flatMap(v => [v.x, v.y]) }));
    const key = JSON.stringify([element, points]);
    this.shown = true;
    if (key === this.key) return;
    this.key = key;
    this.clear(); this.painted = false;
    this.maskShape.clear(); this.lines.clear();
    const color = targetingColors[element];
    for (const p of points) {
      this.maskShape.poly(p.polygon).fill(0xffffff);
      this.lines.poly(p.polygon).fill({ color, alpha: .12 }).stroke({ color, width: 1.8, alpha: .85 });
      // Arcane sigils and physical contact marks intentionally differ from flame silhouettes.
      if (element !== 'FIRE' && element !== 'ICE') {
        const { x, y } = p.center, w = p.footprint.w * .18, h = p.footprint.h * .18;
        this.lines.poly([x,y-h,x+w,y,x,y+h,x-w,y]).stroke({color,width:1.3,alpha:.7});
        this.lines.moveTo(x-w*1.5,y).lineTo(x-w*.6,y).moveTo(x+w*.6,y).lineTo(x+w*1.5,y).stroke({color,width:1.4,alpha:.7});
      }
    }
    this.pending = () => {
      for (const [i, p] of points.slice(0, 32).entries()) {
        this.sprite([element === 'FIRE' ? 0 : element === 'ICE' ? 4 : 14], p.center, p.footprint.w, Infinity, (_, s) => {
          const frame = this.reduced ? i % 4 : Math.floor(this.clock / 160 + i) % 4;
          const surface = element === 'FIRE' || element === 'ICE';
          s.texture = this.frames[surface ? (element === 'ICE' ? 4 : 0) + frame : 14]!;
          s.tint = surface ? 0xffffff : color;
          s.rotation = surface || this.reduced ? 0 : .08 * Math.sin(this.clock / 1100 + i);
          s.width = p.footprint.w * .92; s.height = p.footprint.h * .95;
          s.alpha = element === 'ICE' ? .48 : element === 'FIRE' ? .55 : .32;
        }, true, element === 'FIRE');
      }
    };
    this.beginBatch(); void this.prepare();
  }
  override tick(ms: number) {
    this.clock += ms;
    this.opacity = Math.max(0, Math.min(1, this.opacity + (this.shown ? 1 : -1) * ms / 160));
    this.root.alpha = this.opacity * (this.reduced ? 1 : .94 + .06 * Math.sin(this.clock / 650));
    if (this.shown && this.ready && !this.painted) { this.pending?.(); this.painted = true; }
    if (!this.shown && this.opacity === 0) this.reset();
    super.tick(ms);
  }
  reset() { this.shown = false; this.key = ''; this.pending = null; this.clear(); this.root.alpha = 0; this.opacity = 0; }
  override destroy() { super.destroy(); this.root.destroy({children:true}); }
}
