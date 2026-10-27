import {SocialDockButton} from '../social/SocialDockButton';
import { useCatalogCatchupNotice } from '../catalog/CatalogCatchup';
const CrystalModalQa = import.meta.env.DEV ? lazy(() => import('../shop/CrystalModalQa').then(m => ({default: m.CrystalModalQa}))) : null;
const SocialUxQa = import.meta.env.DEV ? lazy(() => import('../play/SocialUxQa').then(m => ({default: m.SocialUxQa}))) : null;
import {PlayHub} from '../play/PlayHub';
import {navigatePlay,usePlayMode} from '../play/navigation';
const SocialSidebar=lazy(()=>import('../social/SocialSidebar').then(m=>({default:m.SocialSidebar})));
import {socialBadge} from '../social/socialStore';
const CampaignSelectorQa = import.meta.env.DEV ? lazy(() => import('./components/CampaignSelectorQa').then(m => ({default: m.CampaignSelectorQa}))) : null;
const DialogueVisualQa = import.meta.env.DEV ? lazy(() => import('../dialogue/DialogueVisualQa').then(m => ({default: m.DialogueVisualQa}))) : null;
const ArcherReleaseControls = import.meta.env.DEV ? lazy(() => import('../qa/archer/ArcherReleaseControls').then(m => ({default: m.ArcherReleaseControls}))) : null;
const ArcherCampaignVisualLab = import.meta.env.DEV ? lazy(() => import('../qa/archer/ArcherCampaignVisualLab').then(m => ({default: m.ArcherCampaignVisualLab}))) : null;
import '../../styles/archer-hunt.css';
import { shapeshifterQaEnabled } from '../qa/shapeshifter/access';
const RealQaControls = import.meta.env.DEV ? lazy(() => import('../qa/shapeshifter/RealQaControls').then(m => ({default: m.RealQaControls}))) : null;
import { useBattleStore } from '../store/battleStore';
const BattleScreen = lazy(() => import('./screens/BattleScreen').then(m => ({default: m.BattleScreen})));
const ChampionSelect = lazy(() => import('./screens/ChampionSelect').then(m => ({default: m.ChampionSelect})));
const DeckBuilder = lazy(() => import('./screens/DeckBuilder').then(m => ({default: m.DeckBuilder})));
const VisualQaPanel = import.meta.env.DEV ? lazy(() => import('./components/VisualQaPanel').then(m => ({default: m.VisualQaPanel}))) : null;
import { AccountBootstrap, AccountNotice, AccountOverlay, CloudBanner, GuestGateDialog, ImportDialog } from './components/Account';
import { ChampionPrompts } from './components/ChampionOnboarding';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
const StoreScreen = lazy(() => import('../shop/StoreScreen').then(m => ({default: m.StoreScreen})));
const PvpScreen = lazy(() => import('../pvp/PvpScreen').then(m => ({default: m.PvpScreen})));
const SocialScreen = lazy(() => import('../social/SocialScreen').then(m => ({default: m.SocialScreen})));
import { SocialNotifications, SocialRuntime } from '../social/SocialEntry';
import { GiftNotifications, GiftRuntime } from '../gifts/GiftInbox';
import { useSocialStore } from '../social/socialStore';
import { BugReportButton } from '../support/BugReport';
import { PaymentResult } from '../shop/PaymentResult';
import { requestBugReport } from '../support/reportContext';

export function App() {
  useCatalogCatchupNotice();
  const playMode=usePlayMode();
  const pvp=playMode==='pvp';
  const setPvp=(open:boolean)=>navigatePlay(open?'pvp':'hub');
  const [socialDrawer,setSocialDrawer]=useState(false);
  const socialCount=useSocialStore(socialBadge);
  // Remounts the PvP screen on a new invite room so it reconnects to the server's active room.
  const [pvpKey, setPvpKey] = useState('pvp');
  const [shop, setShop] = useState(() => new URLSearchParams(location.search).get('store') === '1');
  useEffect(() => { const open = () => setShop(true); window.addEventListener('rpggo-open-crystals', open); return () => window.removeEventListener('rpggo-open-crystals', open); }, []);
  const social=playMode==='friends';
  const setSocial=(open:boolean)=>navigatePlay(open?'friends':'hub');
  const account = useBattleStore((s) => s.account);
  const screen = useBattleStore((s) => s.screen);
  const inMatch = useBattleStore((s) => s.onlineCommand !== null);
  useEffect(()=>useBattleStore.subscribe(s=>{if(s.screen==='BATTLE'||s.onlineCommand!==null)setSocialDrawer(false);}),[]);
  const playUrl=useRef(location.href);
  useEffect(()=>{
    const remember=()=>{playUrl.current=location.href;};
    const back=()=>{const st=useBattleStore.getState();if(st.screen==='BATTLE'||st.onlineCommand!==null){history.pushState({},'',playUrl.current);window.dispatchEvent(new Event('rpggo-play-route'));return;}st.backToMenu();setShop(new URLSearchParams(location.search).get('store')==='1');setSocialDrawer(false);remember();};
    window.addEventListener('rpggo-play-route',remember);window.addEventListener('popstate',back);
    return()=>{window.removeEventListener('rpggo-play-route',remember);window.removeEventListener('popstate',back);};
  },[]);
  const pvpOpen = useRef(pvp);
  const supportRequested = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('commercial-support') === '1' && !supportRequested.current && account.status !== 'CONNECTING') {
      supportRequested.current = true;
      requestBugReport({ category: 'STORE' });
    }
  }, [account.status]);
  useEffect(() => {
    pvpOpen.current = pvp;
  }, [pvp]);
  // An invite we sent or accepted became a room: go to the PvP lobby.
  useEffect(
    () =>
      useSocialStore.subscribe((s, prev) => {
        if (!s.roomReady || s.roomReady === prev.roomReady) return;
        const { code } = s.roomReady;
        s.consumeRoom();
        // Never yank a player out of a campaign battle: the room waits behind the PvP button.
        if (!pvpOpen.current && useBattleStore.getState().screen === 'BATTLE') {
          s.toast('Tu sala PvP está lista: abre PvP desde el menú.');
          return;
        }
        useBattleStore.getState().backToMenu();
        setShop(false);
        setSocial(false);
        setPvpKey(code);
        setPvp(true);
      }),
    [],
  );
  const [chatFriend,setChatFriend]=useState<string|undefined>();
  const socialOpen = social && account.status === 'READY';
  const homeVisible=screen==='MENU'&&!pvp&&!shop&&!socialOpen&&playMode==='hub'&&account.status!=='CONNECTING';
  if (import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/crystal-ux-qa' && CrystalModalQa) return <CrystalModalQa/>;
  if (import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/social-ux-qa' && SocialUxQa) return <SocialUxQa/>;
  if (import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/campaign-selector-qa' && CampaignSelectorQa) return <CampaignSelectorQa />;
  if (import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/dialogue-qa' && DialogueVisualQa) return <DialogueVisualQa />;
  return (
    <>
      {VisualQaPanel && <Suspense fallback={null}><VisualQaPanel /></Suspense>}
      <CloudBanner />
      <AccountNotice />
      <ImportDialog />
      <GuestGateDialog />
      {!pvp && !shop && !socialOpen && <ChampionPrompts key={screen} />}
      <AccountOverlay />
      {RealQaControls && shapeshifterQaEnabled && screen !== 'BATTLE' && <Suspense fallback={null}><RealQaControls /></Suspense>}
      {ArcherReleaseControls && screen === 'BATTLE' && <Suspense fallback={null}><ArcherReleaseControls /></Suspense>}
      {ArcherCampaignVisualLab && <Suspense fallback={null}><ArcherCampaignVisualLab /></Suspense>}
      {!homeVisible&&<BugReportButton
        route={shop ? 'STORE' : pvp ? 'PVP' : socialOpen ? 'SOCIAL' : screen === 'BATTLE' ? 'BATTLE' : screen === 'DECK' ? 'DECK' : screen === 'CHAMPIONS' ? 'CHAMPIONS' : 'MENU'}
      />}
      <PaymentResult />
      <SocialRuntime />
      {screen!=='BATTLE'&&!inMatch&&(homeVisible||account.status==='READY')&&<SocialDockButton hidden={socialDrawer} count={socialCount} disabled={account.status!=='READY'} onClick={()=>setSocialDrawer(v=>!v)}/>}
      {socialDrawer&&account.status==='READY'&&screen!=='BATTLE'&&!inMatch&&<Suspense fallback={<p role="status">Abriendo amigos…</p>}><SocialSidebar initialFriend={chatFriend} onClose={()=>setSocialDrawer(false)} onProfile={username=>{setSocialDrawer(false);setShop(false);navigatePlay('friends',{friend:username});}}/></Suspense>}
      <GiftRuntime />
      <GiftNotifications quiet={inMatch || (!pvp && screen === 'BATTLE')} />
      <SocialNotifications
        suppressInvites={inMatch || socialOpen || socialDrawer}
        quiet={inMatch || (!pvp && screen === 'BATTLE')}
      />
      <Suspense fallback={<p className="mode-loading" role="status">Cargando modo…</p>}>
      {account.status === 'CONNECTING' && !pvp && !shop ? (
        <AccountBootstrap />
      ) : shop ? (
        <StoreScreen
          key={'username' in account ? account.username : 'guest'}
          onExit={() => setShop(false)}
        />
      ) : pvp ? (
        <PvpScreen key={pvpKey} onExit={() => setPvp(false)} onOpponentHistory={username=>navigatePlay('friends',{friend:username})}/>
      ) : socialOpen ? (
        <SocialScreen onOpenChat={username=>{setChatFriend(username);setSocialDrawer(true);}} key={new URLSearchParams(location.search).get('friend')??'friends'} initialFriend={new URLSearchParams(location.search).get('friend')??undefined} onExit={() => setSocial(false)} />
      ) : screen === 'BATTLE' ? (
        <BattleScreen />
      ) : screen === 'DECK' ? (
        <DeckBuilder />
      ) : screen === 'CHAMPIONS' ? (
        <ChampionSelect />
      ) : (
        <PlayHub mode={playMode} onStore={()=>setShop(true)} utilities={homeVisible?<><BugReportButton route="MENU"/></>:undefined}/>
      )}
      </Suspense>
    </>
  );
}
