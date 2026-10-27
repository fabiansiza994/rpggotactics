import { Text } from 'pixi.js';
import { PALETTE } from '../pixi/palette';
import type { VfxContext, VfxRegistry } from './vfxRegistry';

/**
 * Minimal graybox feedback so the game is readable before the visual pass:
 * floating numbers for damage / heal / shield. Codex can replace or remove these freely.
 */
function floatText(ctx: VfxContext, pos: { x: number; y: number }, label: string, color: number): void {
  const text = new Text({
    text: label,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '800', fill: color, stroke: { color: 0x000000, width: 4 } },
  });
  text.anchor.set(0.5);
  const center = ctx.tileCenter(pos);
  text.position.set(center.x, center.y - ctx.tileSize * 0.2);
  ctx.vfxLayer.addChild(text);
  const duration = ctx.reducedMotion ? 500 : 800;
  ctx.animate((elapsed) => {
    const t = Math.min(1, elapsed / duration);
    text.y = center.y - ctx.tileSize * 0.2 - (ctx.reducedMotion ? 0 : t * ctx.tileSize * 0.4);
    text.alpha = 1 - t * t;
    if (t >= 1) {
      text.destroy();
      return true;
    }
    return false;
  });
}

export function registerGrayboxVfx(registry: VfxRegistry): void {
  registry.on('UNIT_DAMAGED', (e, ctx) => {
    if (e.hpLost > 0) floatText(ctx, e.pos, `-${e.hpLost}`, PALETTE.damageText);
    else if (e.shieldAbsorbed > 0 || e.armorMitigated > 0) floatText(ctx, e.pos, 'bloq.', PALETTE.shieldText);
  });
  registry.on('UNIT_HEALED', (e, ctx) => {
    const unit = ctx.state.units.find((u) => u.id === e.unitId);
    if (unit) floatText(ctx, unit.pos, `+${e.amount}`, PALETTE.healText);
  });
  registry.on('SHIELD_GAINED', (e, ctx) => {
    const unit = ctx.state.units.find((u) => u.id === e.unitId);
    if (unit) floatText(ctx, unit.pos, `+${e.amount} escudo`, PALETTE.shieldText);
  });
}
