import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MobileShell,InterfaceSettings,activeMobileTab} from '../src/presentation/mobile/MobileShell';
import {MOBILE_MODES,chooseMobileMode} from '../src/presentation/mobile/MobilePlay';
import {navigatePlay,readPlayMode,registerPlayNavigationGuard} from '../src/presentation/play/navigation';
const noop=()=>{};
describe('mobile primary navigation and mode destinations',()=>{
 beforeEach(()=>{const update=(href:string|URL)=>{const url=new URL(href);vi.stubGlobal('location',{href:url.href,search:url.search});};update('https://qa.invalid/play?payment=return');vi.stubGlobal('history',{pushState:vi.fn((_a,_b,url)=>update(url))});vi.stubGlobal('window',{dispatchEvent:vi.fn()});});
 afterEach(()=>vi.unstubAllGlobals());
 it.each(['campaign','ranked','casual','skirmish','stories'] as const)('opens %s using existing commands without losing payment return context',id=>{chooseMobileMode(id);expect(readPlayMode()).toBe(id==='ranked'||id==='casual'?'pvp':id);expect(location.search).toContain('payment=return');expect(new URLSearchParams(location.search).get('queue')).toBe(id==='ranked'?'ranked':null);});
 it('makes Jugar a refreshable presentation route, leaving campaign progress on its existing URL',()=>{navigatePlay('play');expect(readPlayMode()).toBe('play');expect(activeMobileTab('play','MENU')).toBe('campaign');chooseMobileMode('campaign');expect(readPlayMode()).toBe('campaign');});
 it('does not bypass unsaved deck protection when opening a mode',()=>{const off=registerPlayNavigationGuard(()=>false);try{expect(chooseMobileMode('ranked')).toBe(false);expect(history.pushState).not.toHaveBeenCalled();}finally{off();}});
 it('has five distinct visual choices, no invented mode or duplicate',()=>{expect(MOBILE_MODES.map(m=>m.id)).toEqual(['campaign','ranked','casual','skirmish','stories']);expect(new Set(MOBILE_MODES.map(m=>m.art)).size).toBeGreaterThan(2);});
});
describe('one shell and contextual reporting',()=>{
 it.each(['hub','campaign','cards','store','profile'] as const)('keeps the primary navigation mounted for %s',active=>{const html=renderToStaticMarkup(createElement(MobileShell,{enabled:true,active,balance:0,onSettings:noop,onNavigate:noop},createElement('main',null,active)));expect(html.match(/aria-label="Navegación móvil"/g)).toHaveLength(1);expect(html.match(/aria-current="page"/g)).toHaveLength(1);expect(html).not.toContain('bug-report-fab');});
 it('offers reporting from settings without adding another floating control',()=>{const html=renderToStaticMarkup(createElement(InterfaceSettings,{preference:'mobile',pending:false,onClose:noop,showHelp:true}));expect(html).toContain('Reportar un problema');expect(html).not.toContain('bug-report-fab');});
 it('does not add a header or navigation to the battle/desktop slot',()=>{const html=renderToStaticMarkup(createElement(MobileShell,{enabled:false,active:'campaign',balance:null,onSettings:noop,onNavigate:noop},createElement('canvas',{'data-existing-battle':true})));expect(html).not.toContain('<nav');expect(html).not.toContain('<header');expect(html).toContain('data-existing-battle');});
});
