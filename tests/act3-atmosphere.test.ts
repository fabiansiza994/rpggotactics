import { describe, it, expect } from 'vitest';
import { GameEngine, DEFAULT_CONTENT, encounterFor } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { templeComposition } from '../src/presentation/pixi/TempleComposition';
import { puzzlePresentation } from '../src/presentation/mechanisms/puzzlePresentation';
describe('Lost Relic composition',()=>{
  it('keeps a single architectural focal point and fewer decorative props without mutating the map',()=>{
    const s=new GameEngine(encounterFor(TEMPLE_CAMPAIGN,'w3_e06','mage'),DEFAULT_CONTENT).state;
    const before=JSON.stringify(s),c=templeComposition(s)!;
    // Direction reset: the floating board carries the focal point (relic inlay), no props around it.
    expect(c.dressing).toHaveLength(2);
    expect(c.dressing.every(p=>p.asset==='brazier' && p.at.y<0)).toBe(true);
    expect(c.walls).toEqual([]);
    expect(puzzlePresentation(s)?.introHint).toContain('cámara iluminada');
    expect(s.mechanisms!.objects.filter(o=>o.def.kind==='GATE')).toHaveLength(3);
    expect(JSON.stringify(s)).toBe(before);
  });
});
