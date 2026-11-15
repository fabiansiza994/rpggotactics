import {createRoot} from 'react-dom/client';
import {MobileShell} from '../../src/presentation/mobile/MobileShell';
import {DeckBuilder} from '../../src/presentation/react/screens/DeckBuilder';
import {useBattleStore} from '../../src/presentation/store/battleStore';
import {PRESENTATION_CONTENT as CONTENT} from '../../src/presentation/qa/shapeshifter/runtime';
import {createProfile,parseProfileSave,serializeProfile} from '../../src/game';
import '../../src/styles/tokens.css';import '../../src/styles/globals.css';import '../../src/styles/identity.css';import '../../src/styles/painted.css';
const loaded=parseProfileSave(localStorage.getItem('auto-deck-qa-profile'),CONTENT);
const incomplete=new URLSearchParams(location.search).has('incomplete');
const profile=!incomplete&&loaded.status==='OK'?loaded.profile:createProfile(CONTENT);
if(incomplete)for(const entry of Object.values(profile.heroes.mage!.collection))entry.copies=0;
const requested=new URLSearchParams(location.search).get('hero')??'mage';
const heroId=['mage','summoner','shapeshifter'].includes(requested)&&CONTENT.heroes[requested]?requested:'mage';
useBattleStore.setState({profile,deckHeroId:heroId,screen:'DECK'});
useBattleStore.subscribe((s,prev)=>{if(s.profile!==prev.profile)localStorage.setItem('auto-deck-qa-profile',serializeProfile(s.profile));});
function Lab(){const mobile=new URLSearchParams(location.search).has('mobile');return <><p style={{padding:12}}>QA LOCAL · editor real y autoarmador opcional · sin cuentas ni servicios productivos</p><MobileShell enabled={mobile} active='cards' balance={0} onSettings={()=>{}} onNavigate={()=>{}}><DeckBuilder mobile={mobile}/></MobileShell></>;}
createRoot(document.getElementById('root')!).render(<Lab/>);
