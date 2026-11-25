import {BattleRail} from '../../battle/BattleRails';
import {BattleFrame} from '../../battle/BattleFrame';
import {PvpTerrainInfo} from '../../pvp/PvpTerrainInfo';
import '../../../styles/desktop-battlefield.css';
import {BattlePileBank} from "../../battle/BattlePileZones";

import { TurnAnnouncement } from '../components/TurnAnnouncement';
import '../components/BattleStyles';
import { useMechanismPlayback } from '../../mechanisms/mechanismPlayback';
import { combatPhase } from '../../combat/clarity';
import { useCatalogBattleFeedback } from '../../catalog/CatalogRewards';
import {InteractionPanel} from '../../mechanisms/InteractionPanel';
import { useMasteryBattleFeedback } from '../../mastery/MasteryFeedback';
import {PauseMenu} from '../components/PauseMenu';
import { useEffect, useMemo, useState } from 'react';
import '../../../styles/campaign-battle.css';
import { campaignForRun, encounterById, SCENARIOS_BY_ID } from '../../../game';
import { RunProgress } from '../components/RunPanels';
import { activeRun, useBattleStore } from '../../store/battleStore';
import { BoardView } from '../components/BoardView';
import { BattleScenery } from '../components/BattleScenery';
import { TacticalOverview } from '../components/TacticalOverview';
import { encounterIdentity } from '../../assets/visualIdentity';

import { CampaignDialogue } from '../../dialogue/DialogueGates';
import { PRESENTATION_CONTENT } from '../../qa/shapeshifter/runtime';
import {
  CombatLog,
  EnemyPanel,
  HandBar,
  HeroPanel,
  ResultOverlay,
  TurnPanel,
} from '../components/Hud';

export function BattleScreen() {
  const engine = useBattleStore((s) => s.engine);
  const state = useBattleStore((s) => s.state);
  const selectedCardUid = useBattleStore((s) => s.selectedCardUid);
  const busy = useBattleStore((s) => s.playbackBusy || s.introLocked);
  const discard = useBattleStore(s => !!s.handDiscard);
  const shown = useMechanismPlayback(s => s.state);
  const notice = useBattleStore((s) => s.notice);
  const restart = useBattleStore((s) => s.restart);
  const backToMenu = useBattleStore((s) => s.backToMenu);
  const run = useBattleStore(activeRun);
  const cloud = useBattleStore(s=>s.cloud);
  const introLocked = useBattleStore((s) => s.introLocked);
  const introVariant = useBattleStore((s) => s.introVariant);
  const introReached = useBattleStore((s) => s.introReached);
  const turnBanner = useBattleStore((s) => s.turnBanner);
  const [menuPaused, setMenuPaused] = useState(false);
  const [focusedEnemyId, setFocusedEnemyId] = useState<string | null>(null);
  const plans = useMemo(() => (engine && state ? engine.getIntentPreviews() : []), [engine, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useBattleStore.getState();
      if ((e.target as HTMLElement).closest?.('dialog, input, textarea, select')) return;
      if (e.repeat || !store.state || store.state.outcome) return; // held keys / result overlay
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') store.cancelAim();
      else if (e.key === 'e' || e.key === 'E') store.endTurn();
      else if (/^[1-9]$/.test(e.key)) {
        const card = store.state?.player.hand[Number(e.key) - 1];
        if (card) store.selectCard(card.uid);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const catalogFeedback = useCatalogBattleFeedback();
  const masteryOnlyFeedback = useMasteryBattleFeedback({heroId:engine?.scenario.hero.heroId??'',heroName:engine?.content.heroes[engine.scenario.hero.heroId]?.name??'Campeón',battleKey:engine,finished:!!state?.outcome,verified:!cloud.busy&&!cloud.error});
  const masteryFeedback = <>{masteryOnlyFeedback}{catalogFeedback}</>;
  if (!engine || !state) return null;
  const displayed = busy && shown?.scenarioId === state.scenarioId ? shown : state;
  const phase = combatPhase(state, busy || discard);
  const scenario = run
    ? encounterById(
        campaignForRun(run),
        state.scenarioId,
      )
    : SCENARIOS_BY_ID[state.scenarioId];
  const identity = encounterIdentity(state.scenarioId);
  // Character dialogue: intro on an untouched battle once the board intro unlocks; scene on victory.
  const dialoguePhase =
    state.outcome?.result === 'WON' ? 'outro' : !introLocked && !state.outcome && state.round <= 1 && engine.history.length === 0 ? 'intro' : null;

  return (
    <BattleFrame
      className="campaign-battle"
      data-theme={identity.theme}
      data-board-theme={identity.theme === 'veil_forest' ? 'veil_forest' : identity.theme === 'infernal_forge' ? 'infernal_forge' : 'dark_fortress'}
      data-encounter={state.scenarioId}
      data-action={busy ? 'resolving' : selectedCardUid ? 'targeting' : 'normal'}
      data-intro={introLocked ? 'running' : 'done'}
      data-intro-variant={introVariant.toLowerCase()}
      data-reveal={introReached.join(' ')}
    >
      <div className="rotation-prompt" role="status">
        <span aria-hidden="true">↻</span>
        <h1>Gira tu dispositivo para jugar</h1>
        <p>La batalla está diseñada para pantalla horizontal.</p>
        <button type="button" onClick={backToMenu}>
          Menú
        </button>
      </div>
      <div className="battle-veil" aria-hidden="true" />
      <BattleScenery key={identity.theme} theme={identity.theme} />
      <header className="top-bar">
        <BattleRail slot="hero"><HeroPanel state={displayed} engine={engine} /></BattleRail>
        <BattleRail slot="header"><TurnPanel state={displayed} displayPhase={phase} scenarioName={state.pileCounts?'Duelo':scenario?.name??'Combate'}>
          {run && <RunProgress run={run} />}
        </TurnPanel></BattleRail>
        <BattleRail slot="enemy"><EnemyPanel state={displayed} plans={plans} onFocus={setFocusedEnemyId} /></BattleRail>
      </header>
      {identity.theme === 'infernal_forge' && <aside className="infernal-legend" aria-label="Terreno infernal"><span>≋ Lava · permanente</span><span>♨ Fuego · temporal</span></aside>}
      {identity.theme === 'infernal_forge' && state.units.some(u => u.defId === 'forge_king') && [3, 5, 6].includes(state.round) && <div key={`forge-phase-${state.round}`} className="forge-surge" role="status">La forja despierta · Ronda {state.round}</div>}
      <BattleRail slot="terrain"><PvpTerrainInfo name={scenario?.name??'Campo de batalla'} state={displayed} content={engine.content}/></BattleRail>
      <BattleRail slot="map"><TacticalOverview state={displayed} /></BattleRail>
      <main className="battle-main">
        <div className="board-column">
              <BattleRail slot="piles"><BattlePileBank state={displayed} content={engine.content} opponent/></BattleRail>
          <InteractionPanel/><BoardView focusedEnemyId={focusedEnemyId} menuPaused={menuPaused} />
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
        <BattleRail slot="piles"><BattlePileBank state={displayed} content={engine.content}/></BattleRail>
            </div>
      </main>
      <BattleRail slot="pause"><PauseMenu busy={busy} onRestart={restart} onExit={backToMenu} onOpenChange={setMenuPaused} /></BattleRail>
      <div className="battle-utilities">
        <BattleRail slot="log"><CombatLog /></BattleRail>
      </div>
      {turnBanner && <TurnAnnouncement key={turnBanner.id} banner={turnBanner} encounterName={scenario?.name ?? state.scenarioId} />}
      <HandBar state={busy ? displayed : state} engine={engine} />
      <ResultOverlay state={state} masteryFeedback={masteryFeedback}/>
      {run && (
        <CampaignDialogue
          content={PRESENTATION_CONTENT}
          heroId={run.heroId}
          encounterId={state.scenarioId}
          tier={encounterById(campaignForRun(run), state.scenarioId).tier}
          phase={dialoguePhase}
          progress={{ round: state.round, commands: engine.history.length, finished: !!state.outcome }}
        />
      )}
    </BattleFrame>
  );
}
