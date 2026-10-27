import {afterEach,describe,it,expect,vi} from 'vitest';
import {premiumVfxEnabled} from '../src/presentation/vfx/premiumVfxRelease';
import {fireballPilotAllowed} from '../src/presentation/vfx/fireballRecipe';
import {catalogPremiumEnabled} from '../src/presentation/vfx/catalogRecipes';
import {universalReactionsEnabled} from '../src/presentation/vfx/hitReactions';
import {mageRecipeEnabled} from '../src/presentation/vfx/mageRecipes';
import {readFileSync} from 'node:fs';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('explicit cosmetic VFX rollout',()=>{
 it.each(['rpg-go-tactics.com','rpggo-tactics.pages.dev','127.0.0.1'])('production %s is opt-in, not dependent on hostname',hostname=>{
  vi.stubEnv('DEV',false);vi.stubGlobal('location',{hostname});
  vi.stubEnv('VITE_PREMIUM_VFX_ENABLED',undefined);expect(premiumVfxEnabled()).toBe(false);
  vi.stubEnv('VITE_PREMIUM_VFX_ENABLED','1');
  expect(premiumVfxEnabled()).toBe(true);expect(fireballPilotAllowed()).toBe(true);expect(catalogPremiumEnabled()).toBe(true);expect(universalReactionsEnabled()).toBe(true);expect(mageRecipeEnabled('frost_nova')).toBe(true);
  vi.stubEnv('VITE_PREMIUM_VFX_ENABLED','0');expect(premiumVfxEnabled()).toBe(false);expect(catalogPremiumEnabled()).toBe(false);expect(universalReactionsEnabled()).toBe(false);
 });
 it.each(['true','yes','2',''])('rejects invalid flag %s, including DEV',value=>{
  vi.stubEnv('DEV',true);vi.stubGlobal('location',{hostname:'localhost'});vi.stubEnv('VITE_PREMIUM_VFX_ENABLED',value);expect(premiumVfxEnabled()).toBe(false);
 });
 it('keeps local QA default and explicitly disables animated HP with the same gate',()=>{
  vi.stubEnv('DEV',true);vi.stubGlobal('location',{hostname:'localhost'});vi.stubEnv('VITE_PREMIUM_VFX_ENABLED',undefined);expect(premiumVfxEnabled()).toBe(true);
  const view=readFileSync(new URL('../src/presentation/pixi/UnitView.ts',import.meta.url),'utf8');expect(view).toContain('this.animateNextHealth && premiumVfxEnabled()');
  expect(readFileSync(new URL('../.env.production',import.meta.url),'utf8')).toMatch(/^VITE_PREMIUM_VFX_ENABLED=1$/m);
 });
});
