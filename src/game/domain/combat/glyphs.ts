import { areHostile, unitById } from '../board/occupancy';
import type { RuleContext } from '../context';
import { comparePos, posKey, type Pos } from '../core/position';
import type { Faction, Unit } from '../entities/unit';
import type { DamageType } from './damage-types';
import { dealDamage } from './damage';

/**
 * Glyphs (Mage: Runa de Ignición): a telegraphed area that resolves at the START of its owner's
 * next turn. Public state, like traps: both seats see every tile before choosing where to stand.
 * Damage is a normal hit (armour and shields apply; not ranged, so cover does not reduce it).
 * A glyph whose owner left the board fizzles.
 */

export function placeGlyph(ctx: RuleContext, owner: Unit, tiles: readonly Pos[], glyphId: string, damage: number, damageType: DamageType, activations?: number, maxTargets?: number, origin?: Pos): void {
  if (!tiles.length) return;
  // One persistent instance per owner/kind; recasting replaces, never accumulates.
  if (activations !== undefined) ctx.state.glyphs = (ctx.state.glyphs ?? []).filter(g => g.ownerId !== owner.id || g.glyphId !== glyphId);
  (ctx.state.glyphs ??= []).push({
    id: `glyph-${ctx.state.nextId++}`,
    glyphId,
    ownerId: owner.id,
    tiles: tiles.map((p) => ({ ...p })).sort(comparePos),
    damage,
    damageType,
    ...(origin ? {origin: {...origin}} : {}),
    ...(activations !== undefined ? { activationsLeft: Math.max(1, Math.min(2, activations)) } : {}),
    ...(maxTargets !== undefined ? { maxTargets: Math.max(1, Math.min(8, maxTargets)) } : {}),
  });
}

/** Start of `faction`'s turn: its glyphs strike the hostile units inside, then disappear. */
export function resolveGlyphs(ctx: RuleContext, faction: Faction): void {
  const glyphs = ctx.state.glyphs;
  if (!glyphs?.length) return;
  for (const glyph of [...glyphs]) {
    const owner = unitById(ctx.state, glyph.ownerId);
    if (owner && owner.faction !== faction) continue;
    if (glyph.activationsLeft !== undefined) glyph.activationsLeft -= 1;
    if (!owner || glyph.activationsLeft === undefined || glyph.activationsLeft <= 0) ctx.state.glyphs = ctx.state.glyphs!.filter((g) => g !== glyph);
    if (!owner) continue;
    const area = new Set(glyph.tiles.map(posKey));
    const hit = ctx.state.units
      .filter((u) => area.has(posKey(u.pos)) && areHostile(owner, u))
      .sort((a, b) => comparePos(a.pos, b.pos));
    const targets = hit.slice(0, glyph.maxTargets ?? hit.length);
    if (glyph.activationsLeft !== undefined) ctx.emit({type:'GLYPH_ACTIVATED', glyphId:glyph.id, kind:glyph.glyphId, ownerId:owner.id, origin:glyph.origin ?? glyph.tiles[0]!, targets:targets.map(u=>({unitId:u.id,pos:{...u.pos}})), remaining:glyph.activationsLeft});
    for (const u of targets) dealDamage(ctx, u, glyph.damage, owner.id, glyph.damageType);
  }
  if (!ctx.state.glyphs!.length) delete ctx.state.glyphs;
}
