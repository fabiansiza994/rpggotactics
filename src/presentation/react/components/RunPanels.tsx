import type { ReactNode } from 'react';
import { campaignForRun } from '../../qa/shapeshifter/campaigns';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import { WorldRewardReveal } from './WorldRewardReveal';
import { MissionRewardChoice } from './MissionRewardChoice';
import {
  encounterById,
  encounterOrder,
  type EncounterDef,
  type RunState,
} from '../../../game';
import { useBattleStore } from '../../store/battleStore';

export const TIER_LABEL: Record<EncounterDef['tier'], string> = {
  NORMAL: 'Combate',
  ELITE: 'Élite',
  BOSS: 'Jefe',
};

export function boardLabel(e: EncounterDef): string {
  return `${e.board.rows}×${e.board.columns}`;
}

/** "Encuentro 4/10 · 6×9 · Élite" + the encounter's tactical focus. */
export function RunProgress({ run }: { run: RunState }) {
  const order = encounterOrder(
    campaignForRun(run),
  );
  const encounter = encounterById(
    campaignForRun(run),
    run.currentEncounterId,
  );
  const index = order.findIndex((e) => e.id === encounter.id);
  return (
    <div className={`run-progress tier-${encounter.tier.toLowerCase()}`}>
      <span className="run-step">
        {run.campaignId === 'skirmish' ? 'Escaramuza' : `Encuentro ${index + 1}/${order.length}`} ·{' '}
        {boardLabel(encounter)} · {TIER_LABEL[encounter.tier]}
      </span>
      <span className="run-focus">{encounter.focus}</span>
    </div>
  );
}

/** Presentation is local; the existing authoritative save action remains unchanged. */
export function RewardChoice({ run, masteryFeedback }: { run: RunState; masteryFeedback?:ReactNode }) {
  const chooseReward = useBattleStore((s) => s.chooseReward);
  const saving = useBattleStore((s) => s.cloud.busy !== null);
  const encounter = encounterById(campaignForRun(run), run.currentEncounterId);
  const next = encounter.next ? encounterById(campaignForRun(run), encounter.next) : null;
  return <MissionRewardChoice key={`${run.campaignId}:${run.heroId}:${run.currentEncounterId}:${run.rewardOptions.map(o=>o.id).join(',')}`}
    options={run.rewardOptions} heroId={run.heroId} saving={saving} onConfirm={chooseReward}
    masteryFeedback={masteryFeedback}
    footer={next ? `Siguiente: ${next.name} · ${boardLabel(next)} · ${TIER_LABEL[next.tier]}` : run.campaignId === 'skirmish' ? 'Recompensa de escaramuza para tu colección' : 'Último encuentro de la campaña'}
    confirmLabel={next ? 'Guardar recompensa' : run.campaignId === 'skirmish' ? 'Guardar en colección' : 'Terminar campaña'} />;
}

/** A verified win whose roll offered nothing (normal fight without a card drop). */
export function NoDropResult({ run, masteryFeedback }: { run: RunState; masteryFeedback?:ReactNode }) {
  const backToMenu = useBattleStore((s) => s.backToMenu);
  const continueRun = useBattleStore((s) => s.continueRun);
  const encounterId = useBattleStore((s) => s.state?.scenarioId);
  const rewarded = run.chosenRewards.some((r) => r.encounterId === encounterId);
  const next = encounterById(
    campaignForRun(run),
    run.currentEncounterId,
  );
  return (
    <div className="result-card won">
      <h2>Victoria</h2>
      {masteryFeedback}
      <p>{rewarded ? 'Recompensa guardada.' : 'Esta vez no apareció ninguna carta.'}</p>
      <p className="muted">
        {run.campaignId === 'skirmish'
          ? 'La victoria suma pity para próximos desbloqueos del Invocador.'
          : `Siguiente: ${next.name} · ${boardLabel(next)} · ${TIER_LABEL[next.tier]}`}
      </p>
      <div className="result-actions">
        <button type="button" className="reward-confirm" onClick={run.campaignId === 'skirmish' ? backToMenu : continueRun}>
          {run.campaignId === 'skirmish' ? 'Volver al menú' : 'Continuar al siguiente encuentro'}
        </button>
        {run.campaignId !== 'skirmish' && <button type="button" onClick={backToMenu}>Volver a la ruta</button>}
      </div>
    </div>
  );
}

export function RunComplete({ run, masteryFeedback }: { run: RunState; masteryFeedback?:ReactNode }) {
  const backToMenu = useBattleStore((s) => s.backToMenu);
  const cards = run.chosenRewards.flatMap(({ reward }) =>
    reward.kind === 'ADD_CARD' ? [DEFAULT_CONTENT.cards[reward.cardId]?.name ?? reward.cardId] : [],
  );
  return (
    <div className={`result-card won${run.campaignId === 'infernal' ? ' infernal-completion' : run.campaignId === 'archer_hunt' ? ' veil-completion' : ''}`}>
      <h2>{run.campaignId === 'infernal' ? 'REINO INFERNAL COMPLETADO' : run.campaignId === 'archer_hunt' ? 'SENDERO DEL CAZADOR COMPLETADO' : 'Campaña completada'}</h2>
      {masteryFeedback}
      <WorldRewardReveal run={run} />
      <p>
        {campaignForRun(run).name}: {run.completedEncounterIds.length} encuentros superados.
      </p>
      <p className="muted">
        Cartas obtenidas: {cards.join(', ') || '—'}
        {run.maxHpBonus ? ` · +${run.maxHpBonus} vida máxima` : ''}
      </p>
      <div className="result-actions">
        <button type="button" onClick={backToMenu}>
          Ver la ruta
        </button>
      </div>
    </div>
  );
}
