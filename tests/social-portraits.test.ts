import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {CHAMPION_DIALOGUE_IDS,portraitVariantFor} from '../src/presentation/dialogue/portraitVariants';
it('reuses the existing neutral bust for every champion and handles unknown ids',()=>{
 expect(CHAMPION_DIALOGUE_IDS).toHaveLength(5);
 for(const id of CHAMPION_DIALOGUE_IDS){const p=portraitVariantFor(id)!;expect(p.src).toContain('/dialogue-portraits/');expect(existsSync(new URL('../public'+p.src,import.meta.url))).toBe(true);}
 expect(portraitVariantFor('unknown')).toBe(null);
});
