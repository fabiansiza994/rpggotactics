import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleResultPresentation } from '../src/presentation/results/BattleResultPresentation';
afterEach(()=>vi.unstubAllGlobals());
it.each(['victory','defeat'] as const)('%s keeps the cinematic and reward content but has no skip button',tone=>{
 vi.stubGlobal('window',{matchMedia:()=>({matches:false})});
 const html=renderToStaticMarkup(createElement(BattleResultPresentation,{identity:{},tone,children:createElement('button',null,'Continuar recompensas confirmadas')}));
 expect(html).toContain('result-cinema');expect(html).toContain('Continuar recompensas confirmadas');expect(html).toContain('inert');expect(html).not.toContain('Omitir animación');expect(html).toContain('tabindex="-1"');
});
it.each(['victory','defeat'] as const)('%s preserves immediate reduced-motion access to results',tone=>{
 vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
 const html=renderToStaticMarkup(createElement(BattleResultPresentation,{identity:{},tone,children:createElement('button',null,'Continuar')}));
 expect(html).not.toContain('class="result-cinema"');expect(html).not.toContain('inert');expect(html).toContain('Continuar');
});
it('leaves the draw control intact',()=>{
 vi.stubGlobal('window',{matchMedia:()=>({matches:false})});
 const html=renderToStaticMarkup(createElement(BattleResultPresentation,{identity:{},tone:'draw',children:'Empate'}));expect(html).toContain('Omitir animación');
});
