import {afterEach,expect,it} from 'vitest';
import {RevealLayerOrder,setRevealLayerOrder} from '../src/presentation/pixi/RevealLayerOrder';
afterEach(()=>setRevealLayerOrder(true));
function fixture(previous?:string){const host={dataset:{} as Record<string,string>};if(previous)host.dataset.ultraLayer=previous;const canvas={closest:()=>host};return{host,layers:new RevealLayerOrder(()=>canvas as unknown as HTMLCanvasElement)};}
it('raises only the existing host marker and restores it idempotently',()=>{const{host,layers}=fixture();layers.begin();layers.begin();expect(host.dataset.ultraLayer).toBe('foreground');layers.end();layers.end();expect(host.dataset).toEqual({});});
it('restores a previous marker instead of erasing unrelated state',()=>{const{host,layers}=fixture('existing');layers.begin();layers.end();expect(host.dataset.ultraLayer).toBe('existing');});
it('retains the fast original behavior for the comparison only',()=>{const{host,layers}=fixture();setRevealLayerOrder(false);layers.begin();expect(host.dataset).toEqual({});});
it('removes elevation when presentation is disabled while active',()=>{const{host,layers}=fixture();layers.begin();setRevealLayerOrder(false);layers.begin();expect(host.dataset).toEqual({});});
it('is safe when a battle host has already unmounted',()=>{const layers=new RevealLayerOrder(()=>({closest:()=>null}) as unknown as HTMLCanvasElement);expect(()=>{layers.begin();layers.end();}).not.toThrow();});
