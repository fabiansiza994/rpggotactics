import {afterEach,describe,expect,it,vi} from 'vitest';
import {championCardStatus} from '../src/presentation/assets/champions';

afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
describe('champion art and selection presentation',()=>{
 it('registers safe art modes without coupling them to image filenames or gameplay',async()=>{
  vi.stubEnv('VITE_ARCHER_ENABLED','1');vi.stubEnv('VITE_SHAPESHIFTER_ENABLED','1');vi.resetModules();
  const {championOf,championArtMode}=await import('../src/presentation/assets/champions');
  for(const id of ['mage','summoner','warrior'])expect(championArtMode(id)).toBe('cutout');
  for(const id of ['shapeshifter','archer']){expect(championArtMode(id)).toBe('framedArtwork');expect(championOf(id)?.heroArtPosition).toBeDefined();}
  expect(championArtMode('future-illustration')).toBe('framedArtwork');
 });
 it.each([
  [{active:true,locked:false,free:true},'ACTIVO'],
  [{active:false,locked:false,free:true},'GRATIS'],
  [{active:false,locked:false},'DESBLOQUEADO'],
  [{active:false,locked:true,free:true},'BLOQUEADO'],
  [{active:true,locked:true,free:true},'BLOQUEADO'],
 ] as const)('returns one badge with permission/active precedence (%j)',(state,label)=>{
  expect(championCardStatus(state)).toBe(label);
 });
});
