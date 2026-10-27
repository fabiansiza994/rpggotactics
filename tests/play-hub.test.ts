import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {readPlayMode,navigatePlay} from '../src/presentation/play/navigation';
import {syncCampaignContext} from '../src/presentation/play/context';
import {activeDeck,createProfile,heroProfile,DEFAULT_CONTENT} from '../src/game';
import {withArcher} from '../src/game/data/archer';
describe('play hub routing and shared champion context',()=>{
 beforeEach(()=>{const update=(href:string|URL)=>{const u=new URL(href);vi.stubGlobal('location',{href:u.href,search:u.search});};update('http://localhost/play?archer-campaign-visual=1');vi.stubGlobal('history',{pushState:vi.fn((_data,_title,url)=>update(url))});vi.stubGlobal('window',{dispatchEvent:vi.fn()});});
 afterEach(()=>vi.unstubAllGlobals());
 it('navigates modes and retains existing deep-link parameters without reloading',()=>{
  expect(readPlayMode()).toBe('hub');navigatePlay('campaign');expect(readPlayMode()).toBe('campaign');expect(location.search).toContain('archer-campaign-visual=1');navigatePlay('stories',{story:'archer_act_1'});expect(location.search).toContain('story=archer_act_1');navigatePlay('friends',{friend:'QA player'});expect(new URLSearchParams(location.search).get('friend')).toBe('QA player');expect(location.search).not.toContain('story=');navigatePlay('hub');expect(readPlayMode()).toBe('hub');expect(location.search).not.toContain('mode=');
 });
 it('opens the existing PvP route on Ranked and clears that choice on other modes',()=>{navigatePlay('pvp',{queue:'ranked'});expect(readPlayMode()).toBe('pvp');expect(new URLSearchParams(location.search).get('queue')).toBe('ranked');navigatePlay('campaign');expect(location.search).not.toContain('queue=');});
 it('does not accept an unknown mode',()=>{vi.stubGlobal('location',{search:'?mode=admin'});expect(readPlayMode()).toBe('hub');});
 it('adapts campaign to the canonical champion, temporarily locks a story and restores the normal choice',()=>{
  const state={screen:'MENU',campaignHeroId:'mage',profile:{selectedChampionId:'archer'},selectCampaignHero:vi.fn((id:string)=>{state.campaignHeroId=id;}),selectWorld:vi.fn()};
  syncCampaignContext(state);expect(state.campaignHeroId).toBe('archer');state.profile.selectedChampionId='mage';syncCampaignContext(state,{hero:'archer',id:'archer_act_1'});expect(state.campaignHeroId).toBe('archer');expect(state.profile.selectedChampionId).toBe('mage');expect(state.selectWorld).toHaveBeenCalledWith('archer_act_1');syncCampaignContext(state);expect(state.campaignHeroId).toBe('mage');state.screen='BATTLE';syncCampaignContext(state,{hero:'archer',id:'archer_act_1'});expect(state.campaignHeroId).toBe('mage');
 });
 it('reads the existing per-champion active decks without copying cards between champions',()=>{const content=withArcher(DEFAULT_CONTENT);const profile=createProfile(content);const before=JSON.stringify(profile);const mage=activeDeck(heroProfile(profile,'mage',content));const archer=activeDeck(heroProfile(profile,'archer',content));expect(mage.cards).not.toEqual(archer.cards);expect(JSON.stringify(profile)).toBe(before);});
});
