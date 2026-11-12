import { StartupBoundary } from './presentation/startup/StartupBoundary';
import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { Capacitor } from '@capacitor/core';
const App = lazy(() => import('./presentation/react/App').then(m => ({ default: m.App })));
const OfficialSite = lazy(() => import('./presentation/site/OfficialSite'));
// Private lab: never reachable in a production build or from a non-loopback host.
const ShapeshifterLab = import.meta.env.DEV && import.meta.env.MODE === 'shapeshifterqa' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && location.pathname === '/lab'
  ? lazy(() => import('./presentation/qa/shapeshifter/ShapeshifterLab')) : null;
const LocomotionLab = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && ((import.meta.env.MODE === 'shapeshifterqa' && location.pathname === '/locomotion') || location.pathname === '/golem-cycles-qa')
  ? lazy(() => import('./presentation/qa/locomotion/SummonerLocomotionLab')) : null;
const PremiumIntegrationQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/premium-integration-qa' ? lazy(()=>import('./presentation/qa/freeCatalog/PremiumIntegrationQa')) : null;
const ArtFoilQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/art-foil-qa' ? lazy(()=>import('./presentation/qa/artFoil/ArtFoilQa')) : null;
const MissionRewardQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/mission-reward-qa' ? lazy(()=>import('./presentation/qa/missionReward/MissionRewardQa')) : null;
const ForbiddenBondQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/forbidden-bond-qa' ? lazy(()=>import('./presentation/qa/forbiddenBond/ForbiddenBondQa')) : null;
const FinalCleanupQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/free-catalog-final-qa' ? lazy(()=>import('./presentation/qa/freeCatalog/FinalCleanupQa')) : null;
const FreeCatalogQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/free-catalog-qa' ? lazy(()=>import('./presentation/qa/freeCatalog/FreeCatalogQa')) : null;
const ResolutionQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/card-resolution-qa' ? lazy(()=>import('./presentation/qa/act3/ResolutionQa')) : null;
const Act3Qa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/act3-qa'
  ? lazy(() => import('./presentation/qa/act3/Act3Qa')) : null;
const Act3RotationLab = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/act3-rotation-qa'
  ? lazy(() => import('./presentation/qa/act3/RotationLab')) : null;
const RankedVisualQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/ranked-visual-qa'
  ? lazy(() => import('./presentation/ranked/RankedVisualQa').then(m=>({default:m.RankedVisualQa}))) : null;
const RankedRewardVisualQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/ranked-rewards-visual-qa'
  ? lazy(() => import('./presentation/ranked/RankedRewardVisualQa')) : null;
const MasteryVisualQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/mastery-visual-qa'
  ? lazy(() => import('./presentation/mastery/MasteryVisualQa').then(m=>({default:m.MasteryVisualQa}))) : null;
const SummonInspectionQa = import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/summon-inspection-qa'
  ? lazy(() => import('./presentation/qa/locomotion/SummonInspectionQa')) : null;
const UnleashedHuntQa = import.meta.env.DEV && import.meta.env.MODE==='unleashedqa' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/unleashed-hunt-qa'
  ? lazy(() => import('./presentation/qa/locomotion/UnleashedHuntQa')) : null;
const publicPaths = new Set(['/', '/store', '/terms', '/privacy', '/refunds', '/delivery', '/contact']);
const publicSite = !import.meta.env.MODE.endsWith('qa') && !Capacitor.isNativePlatform() && publicPaths.has(location.pathname.replace(/\/+$/, '') || '/') && !Array.from(new URLSearchParams(location.search).keys()).some(key => /qa|test|payment|store|commercial-support/i.test(key));
import { applyMotionTokens } from './presentation/motion/tokens';
import './styles/tokens.css';
import './styles/globals.css';
import './styles/scrollbars.css';
import './styles/identity.css';
import './styles/painted.css';
import './styles/motion.css';
import './styles/dialog-primitives.css';
import './styles/account.css';
import './styles/onboarding.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
applyMotionTokens(document.documentElement);
// No StrictMode double-mount: the Pixi canvas lifecycle is managed explicitly in BoardView.
createRoot(root).render(<StartupBoundary><Suspense fallback={<p role="status">Cargando RPG GO Tactics…</p>}>{ArtFoilQa ? <ArtFoilQa/> : MissionRewardQa ? <MissionRewardQa/> : ForbiddenBondQa ? <ForbiddenBondQa/> : PremiumIntegrationQa ? <PremiumIntegrationQa/> : FinalCleanupQa ? <FinalCleanupQa/> : FreeCatalogQa ? <FreeCatalogQa/> : ResolutionQa ? <ResolutionQa/> : Act3Qa ? <Act3Qa/> : Act3RotationLab ? <Act3RotationLab/> : RankedRewardVisualQa ? <RankedRewardVisualQa/> : UnleashedHuntQa ? <UnleashedHuntQa /> : SummonInspectionQa ? <SummonInspectionQa /> : MasteryVisualQa ? <MasteryVisualQa /> : RankedVisualQa ? <RankedVisualQa /> : LocomotionLab ? <LocomotionLab /> : ShapeshifterLab ? <ShapeshifterLab /> : publicSite ? <OfficialSite /> : <App />}</Suspense></StartupBoundary>);
