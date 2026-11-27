import { describe, expect, it, vi } from 'vitest';
import { Graphics } from 'pixi.js';
import { drawRanges } from '../src/presentation/pixi/BoardOverlays';
import { GridProjection } from '../src/presentation/pixi/GridProjection';
import { targetingColors } from '../src/presentation/vfx/ElementalTargetingPreview';
import type { BoardViewModel } from '../src/presentation/pixi/viewModel';
import { makeEngine, setHand } from './helpers';

const projection = (quarterTurn: 0 | 1 | 2 | 3) => new GridProjection({cols:7, rows:5, tile:96, perspective:1.18, depth:.66, quarterTurn});
function fixture() {
  const e = makeEngine({enemies:[{id:'near',enemyId:'orc_warrior',pos:{x:2,y:2}}]});
  const [uid] = setHand(e, ['magic_missile']);
  const vm: BoardViewModel = {state:e.state, content:e.content, heroId:e.heroId, interactive:true, hoverTile:null, aimArmed:false, moveTiles:[], hoverPath:[], targetTiles:e.getValidTargets(uid!), targetElement:'ARCANE', unitTargeting:true, preview:null, intents:[], focusedEnemyId:null};
  return {e, vm};
}
describe('clean tactical targeting', () => {
  it.each([0,1,2,3] as const)('anchors every legal target to its projected tile at rotation %s', turn => {
    const {e,vm} = fixture(), before=JSON.stringify(e.state), g=new Graphics(), p=projection(turn);
    const poly=vi.spyOn(g,'poly'), lines=vi.spyOn(g,'lineTo');
    drawRanges(g,p,vm);
    for(const tile of vm.targetTiles) expect(poly.mock.calls).toContainEqual([p.getInsetPolygon(tile,.04).flatMap(v=>[v.x,v.y])]);
    expect(lines.mock.calls.length).toBeGreaterThan(0); // Brackets remain visible without colour discrimination.
    expect(JSON.stringify(e.state)).toBe(before);
    g.destroy();
  });
  it('uses selected elemental identity before hover and retains translucent terrain visibility', () => {
    const {vm}=fixture(), g=new Graphics(), stroke=vi.spyOn(g,'stroke'),fill=vi.spyOn(g,'fill');
    drawRanges(g,projection(0),{...vm,targetElement:'FIRE',preview:null});
    expect(stroke.mock.calls.some(([s])=>typeof s==='object'&&s!==null&&'color' in s&&s.color===targetingColors.FIRE)).toBe(true);
    expect(fill.mock.calls.some(([s])=>typeof s==='object'&&s!==null&&'alpha' in s&&s.alpha===.10)).toBe(true);
    g.destroy();
  });
  it('clears all legal-target marks on cancellation using the same graphics context', () => {
    const {vm}=fixture(), g=new Graphics();drawRanges(g,projection(0),vm);expect(g.context.instructions.length).toBeGreaterThan(0);
    g.clear();drawRanges(g,projection(0),{...vm,targetTiles:[],targetElement:undefined});
    expect(g.context.instructions).toHaveLength(0);g.destroy();
  });
});
