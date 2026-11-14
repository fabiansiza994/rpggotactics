import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createInterfaceController,preferenceOf,resolveInterface} from '../src/presentation/mobile/interfaceMode';
import {activeMobileTab,MobileShell} from '../src/presentation/mobile/MobileShell';
import {navigatePlay,readPlayMode,registerPlayNavigationGuard,protectPlayBack} from '../src/presentation/play/navigation';
const noop=()=>{};
describe('interface preference and battle lifecycle',()=>{
 it.each(['auto','mobile','desktop'] as const)('reads %s preference',v=>expect(preferenceOf(v)).toBe(v));
 it.each([null,'invalid',42])('falls back for invalid stored value %s',v=>expect(preferenceOf(v)).toBe('auto'));
 it('detects phone or coarse portrait tablet without user-agent',()=>{expect(resolveInterface('auto',true,false)).toBe('mobile');expect(resolveInterface('auto',false,true)).toBe('mobile');expect(resolveInterface('auto',false,false)).toBe('desktop');});
 it('manual preference wins over viewport',()=>{expect(resolveInterface('desktop',true,true)).toBe('desktop');expect(resolveInterface('mobile',false,false)).toBe('mobile');});
 it('defers manual/viewport changes for an entire battle then applies the latest request',()=>{const save=vi.fn(),c=createInterfaceController('auto','mobile',save);c.setLocked(true);c.setAutomatic('desktop');expect(c.getSnapshot().applied).toBe('mobile');c.setPreference('desktop');expect(c.getSnapshot()).toEqual({preference:'desktop',applied:'mobile',pending:true});c.setPreference('mobile');expect(c.getSnapshot().pending).toBe(false);c.setPreference('auto');c.setLocked(false);expect(c.getSnapshot().applied).toBe('desktop');expect(save).toHaveBeenLastCalledWith('auto');});
 it('restores preference without overwriting storage or notifying after unsubscribe',()=>{const save=vi.fn(),fn=vi.fn(),c=createInterfaceController('desktop','mobile',save);const off=c.subscribe(fn);c.restore('auto');expect(c.getSnapshot().applied).toBe('mobile');expect(save).not.toHaveBeenCalled();off();c.setPreference('desktop');expect(fn).toHaveBeenCalledTimes(1);});
 it('retains the exact snapshot object for no-op updates',()=>{const c=createInterfaceController('auto','mobile',noop);const first=c.getSnapshot();c.setAutomatic('mobile');c.setLocked(false);expect(c.getSnapshot()).toBe(first);});
});
describe('shared navigation preserves existing URLs and guards unsaved state',()=>{
 let off:undefined|(()=>void);
 beforeEach(()=>{const update=(href:string|URL)=>{const u=new URL(href);vi.stubGlobal('location',{href:u.href,search:u.search});};update('https://qa.local/play?payment=return');vi.stubGlobal('history',{pushState:vi.fn((_d,_t,url)=>update(url))});vi.stubGlobal('window',{dispatchEvent:vi.fn()});});
 afterEach(()=>{off?.();off=undefined;vi.unstubAllGlobals();});
 it.each(['cards','profile','store'] as const)('supports %s deep link on refresh',mode=>{navigatePlay(mode);expect(readPlayMode()).toBe(mode);expect(location.search).toContain('payment=return');});
 it('accepts legacy store URL and can leave it',()=>{vi.stubGlobal('location',{href:'https://qa.local/play?store=1',search:'?store=1'});expect(readPlayMode()).toBe('store');navigatePlay('hub');expect(readPlayMode()).toBe('hub');expect(location.search).not.toContain('store=');});
 it('retains ranked, friend invitations and clears stale choices when changing destination',()=>{navigatePlay('pvp',{queue:'ranked'});expect(location.search).toContain('queue=ranked');navigatePlay('friends',{friend:'qa player'});expect(new URL(location.href).searchParams.get('friend')).toBe('qa player');expect(location.search).not.toContain('queue=');});
 it('restores the active battle URL before notifying route subscribers on Back',()=>{
  vi.stubGlobal('location',{href:'https://qa.local/play',search:''});
  const seen:string[]=[];vi.stubGlobal('window',{dispatchEvent:vi.fn(()=>{seen.push(location.href);return true;})});
  expect(protectPlayBack('https://qa.local/play?mode=pvp',true)).toBe(true);
  expect(seen).toEqual(['https://qa.local/play?mode=pvp']);
 });
 it('allows ordinary Back without restoring an obsolete route',()=>{expect(protectPlayBack('https://qa.local/play?mode=pvp',false)).toBe(false);expect(history.pushState).not.toHaveBeenCalled();});
 it('does not leave or push history if an editor blocks navigation',()=>{off=registerPlayNavigationGuard(()=>false);const before=location.href;expect(navigatePlay('store')).toBe(false);expect(location.href).toBe(before);expect(history.pushState).not.toHaveBeenCalled();});
});
describe('chrome is presentation only',()=>{
 const html=(enabled:boolean)=>renderToStaticMarkup(createElement(MobileShell,{enabled,active:'hub',balance:null,onSettings:noop,onNavigate:noop},createElement('div',{'data-testid':'existing-screen'},'Existing controller')));
 it('renders five real action buttons with no demo balances',()=>{const s=html(true);for(const name of ['Inicio','Jugar','Cartas','Tienda','Perfil'])expect(s).toContain(name);expect(s).not.toContain('1.250');expect(s).toContain('Existing controller');});
 it('removes all chrome in desktop/battle mode while retaining the same child slot',()=>{const s=html(false);expect(s).not.toContain('<nav');expect(s).not.toContain('<header');expect(s).toContain('data-testid="existing-screen"');});
 it.each([['hub','MENU','hub'],['pvp','MENU','campaign'],['friends','MENU','campaign'],['hub','DECK','cards'],['store','MENU','store'],['profile','MENU','profile']] as const)('resolves active tab for %s/%s', (mode,screen,tab)=>expect(activeMobileTab(mode,screen)).toBe(tab));
});
