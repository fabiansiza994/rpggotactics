import { afterEach, describe, expect, it, vi } from 'vitest';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('pixi.js', () => ({
  Assets: { load },
  Rectangle: class { constructor(public x:number,public y:number,public width:number,public height:number) {} },
  Texture: class { source:unknown; constructor(config:{source:unknown}) { this.source=config.source; } },
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); load.mockReset(); });
describe('Warrior battlefield art readiness', () => {
  it('loads the real Warrior art even if client selection flag is off, retries a transient atlas failure', async () => {
    vi.stubEnv('VITE_WARRIOR_ENABLED', '0'); let failed=false;
    load.mockImplementation(async (url:string) => { if(url.endsWith('warrior_front.webp')&&!failed){failed=true;throw Error('Transient request failure');}return {source:{url}}; });
    const p=await import('../src/presentation/pixi/paintedTextures');await p.loadPaintedCharacters(['warrior']);
    expect(p.paintedCharacter('warrior')).toBeDefined();
    for(const view of ['front','back','left','right']) expect(p.paintedAnimationFrame('warrior','idle',0,view)).toBeDefined();
    expect(load.mock.calls.filter(([url])=>url.endsWith('warrior_front.webp'))).toHaveLength(2);
    const calls=load.mock.calls.length;await p.loadPaintedCharacters(['warrior']);expect(load.mock.calls).toHaveLength(calls);
  });
  it('allows a later battle mount to recover a missing master without reloading cached atlases', async () => {
    let failures=2;
    load.mockImplementation(async(url:string)=>{if(url.endsWith('warrior_idle.webp')&&failures-->0)throw Error('Request unavailable');return {source:{url}};});
    const p=await import('../src/presentation/pixi/paintedTextures');await p.loadPaintedCharacters(['warrior']);expect(p.paintedCharacter('warrior')).toBeUndefined();
    await p.loadPaintedCharacters(['warrior']);expect(p.paintedCharacter('warrior')).toBeDefined();
    expect(load.mock.calls.filter(([url])=>url.endsWith('warrior_front.webp'))).toHaveLength(1);
  });
});
