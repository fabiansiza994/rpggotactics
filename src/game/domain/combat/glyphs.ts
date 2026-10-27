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

export function placeGlyph(ctx: RuleContext, owner: Unit, tiles: readonly Pos[], glyphId: string, damage: number, damageType: DamageType): void {
  if (!tiles.length) return;
  (ctx.state.glyphs ??= []).push({
    id: `glyph-${ctx.state.nextId++}`,
    glyphId,
    ownerId: owner.id,
    tiles: tiles.map((p) => ({ ...p })).sort(comparePos),
    damage,
    damageType,
  });
}

/** Start of `faction`'s turn: its glyphs strike the hostile units inside, then disappear. */
export function resolveGlyphs(ctx: RuleContext, faction: Faction): void {
  const glyphs = ctx.state.glyphs;
  if (!glyphs?.length) return;
  for (const glyph of [...glyphs]) {
    const owner = unitById(ctx.state, glyph.ownerId);
    if (owner && owner.faction !== faction) continue;
    ctx.state.glyphs = ctx.state.glyphs!.filter((g) => g !== glyph);
    if (!owner) continue;
    const area = new Set(glyph.tiles.map(posKey));
    const hit = ctx.state.units
      .filter((u) => area.has(posKey(u.pos)) && areHostile(owner, u))
      .sort((a, b) => comparePos(a.pos, b.pos));
    for (const u of hit) dealDamage(ctx, u, glyph.damage, owner.id, glyph.damageType);
  }
  if (!ctx.state.glyphs!.length) delete ctx.state.glyphs;
}
