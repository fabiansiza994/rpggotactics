import { useEffect, useState } from 'react';
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../../../game';
import { spawnSummon } from '../../../game/domain/summons/summons';
import { useBattleStore } from '../../store/battleStore';
import { BoardView } from '../../react/components/BoardView';
import { HeroPanel, HandBar } from '../../react/components/Hud';
import '../../react/components/BattleStyles';
import '../freeCatalog/final-cleanup-qa.css';
import { presentationBus } from '../../events/presentationBus';
import { useMechanismPlayback } from '../../mechanisms/mechanismPlayback';

/**
 * Local-only lab for Vínculo Prohibido (`/forbidden-bond-qa`, dev server on loopback only): the
 * Summoner with the card in hand, 0 / 1 / 2 summons on the board and a chosen HP. No accounts,
 * grants or saves; «Reconectar» rebuilds the engine from a JSON snapshot.
 */
const SCENARIO: ScenarioDef = {
  id: 'forbidden-bond-qa', name: 'Vínculo Prohibido', description: 'Laboratorio local',
  layout: Array(5).fill('.......'), legend: { '.': {} },
  hero: { heroId: 'summoner', pos: { x: 1, y: 2 } },
  enemies: [{ id: 'qa-orc', enemyId: 'orc_warrior', pos: { x: 6, y: 2 } }],
  structures: [], waves: [], objectives: [{ type: 'ELIMINATE_ALL' }], defaultSeed: 42,
};
const SUMMONS = [['fox', { x: 2, y: 2 }], ['chicken', { x: 1, y: 1 }]] as const;

export default function ForbiddenBondQa() {
  const [summons, setSummons] = useState(2), [hp, setHp] = useState(14), [generation, setGeneration] = useState(0), [saved, setSaved] = useState<GameState | null>(null);
  const e = useBattleStore((s) => s.engine), state = useBattleStore((s) => s.state), notice = useBattleStore((s) => s.notice);
  useEffect(() => {
    const content = DEFAULT_CONTENT;
    const initial = new GameEngine(SCENARIO, content, 42), s = initial.state as GameState;
    s.player.energy = 9;
    s.player.hand = ['forbidden_bond', 'summon_raven', 'summon_wolf', 'summon_turtle'].map((cardId, i) => ({ uid: `qa-bond-${i}`, cardId }));
    const hero = s.units.find((u) => u.id === initial.heroId)!;
    hero.hp = hp;
    for (const [id, pos] of SUMMONS.slice(0, summons)) spawnSummon({ state: s, content, emit: () => {} }, hero, id, pos);
    const engine = GameEngine.fromSnapshot(saved ?? s, content, SCENARIO);
    useBattleStore.setState({ engine, state: engine.state, selectedCardUid: null, pairSelection: null, aim: null, notice: null, introLocked: false, playbackBusy: false, onlineCommand: null, handDiscard: null });
    return engine.subscribe((events, next) => { useBattleStore.setState({ state: next }); presentationBus.publish(events, next); });
  }, [summons, hp, generation, saved]);
  // Same rule as BattleScreen: the HUD follows the visual playback, never jumps to the final state.
  const busy = useBattleStore((s) => s.playbackBusy || s.introLocked), shown = useMechanismPlayback((s) => s.state);
  const displayed = state && busy && shown?.scenarioId === state.scenarioId ? shown : state;
  const hero = state?.units.find((u) => u.id === e?.heroId);
  return <main className="battle final-cleanup-qa forbidden-bond-qa">
    <header className="final-cleanup-controls">
      <label>Invocaciones <select aria-label="Invocaciones iniciales" value={summons} onChange={(ev) => { setSaved(null); setSummons(Number(ev.target.value)); }}>{[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>PV <select aria-label="PV iniciales" value={hp} onChange={(ev) => { setSaved(null); setHp(Number(ev.target.value)); }}>{[18, 14, 8, 5, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <button onClick={() => { setSaved(null); setGeneration((n) => n + 1); }}>Reiniciar</button>
      <button onClick={() => { if (e) setSaved(JSON.parse(JSON.stringify(e.state)) as GameState); }}>Reconectar snapshot</button>
      <button onClick={() => { const c = e?.state.player.hand.find((x) => x.cardId === 'forbidden_bond'); if (c && e) e.dispatch({ type: 'PLAY_CARD', cardUid: c.uid, target: null }); }}>Jugar Vínculo</button>
      <span data-testid="bond-status">PV {hero?.hp}/{hero?.maxHp} · bonus {hero?.summonCapacityBonus ?? 0} · energía {state?.player.energy} · {notice}</span>
    </header>
    {e && displayed && <HeroPanel engine={e} state={displayed} />}
    <BoardView key={`${summons}-${hp}-${generation}-${!!saved}`} focusedEnemyId={null} />
    {e && state && <HandBar engine={e} state={state} />}
  </main>;
}
