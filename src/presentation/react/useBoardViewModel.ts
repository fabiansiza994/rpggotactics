import { pairTargets, pairSecondary } from '../input/pairSelection';
import { useMemo } from 'react';
import { samePos, type GameEvent } from '../../game';
import type { BoardViewModel } from '../pixi/viewModel';
import { useBattleStore } from '../store/battleStore';
import { archerBoardHints } from '../qa/archer/archerBoard';

/** Summarise a dry-run's events per unit, e.g. "-3", "+4🛡", "↦". */
function predictionLabels(events: GameEvent[]): { unitId: string; label: string }[] {
  const byUnit = new Map<string, string[]>();
  const add = (id: string, text: string) => byUnit.set(id, [...(byUnit.get(id) ?? []), text]);
  for (const e of events) {
    if (e.type === 'FINISHER_TRIGGERED') add(e.unitId, 'Remate');
    if (e.type === 'UNIT_DAMAGED') add(e.unitId, e.hpLost > 0 ? `-${e.hpLost}` : '0');
    if (e.type === 'SHIELD_GAINED') add(e.unitId, `+${e.amount}🛡`);
    if (e.type === 'UNIT_DEFEATED') add(e.unitId, '☠');
    if (e.type === 'STATUS_APPLIED')
      add(e.unitId, ({ROOTED:'Enraizado',BURNING:'Ardiendo',SLOWED:'Ralentizado',POISONED:'Envenenado',SMOKE_SCREEN:'Humo'} as Record<string,string>)[e.status] ?? e.status);
  }
  return [...byUnit].map(([unitId, parts]) => ({ unitId, label: parts.join(' ') }));
}

/**
 * Derives the board view model from engine queries. All legality comes from the engine;
 * this hook only decides WHAT to highlight given the UI selection.
 */
export function useBoardViewModel(focusedEnemyId: string | null): BoardViewModel | null {
  const engine = useBattleStore((s) => s.engine);
  const state = useBattleStore((s) => s.state);
  const selectedCardUid = useBattleStore((s) => s.selectedCardUid);
  const pairSelection = useBattleStore(s => s.pairSelection);
  const selectedMechanismId = useBattleStore(s=>s.selectedMechanismId);
  const aim = useBattleStore((s) => s.aim);
  const hoverTile = aim?.pos ?? null;
  const aimArmed = aim?.source === 'tap';
  const playbackBusy = useBattleStore((s) => s.playbackBusy);
  const introLocked = useBattleStore((s) => s.introLocked);

  const base = useMemo(() => {
    if (!engine || !state) return null;
    const interactive = state.phase === 'PLAYER' && !introLocked;
    const moveTiles = interactive && !selectedCardUid ? engine.getLegalMoves() : [];
    const targetTiles =
      interactive && selectedCardUid ? pairTargets(engine, selectedCardUid, pairSelection) : [];
    return { interactive, moveTiles, targetTiles, intents: engine.getIntentPreviews() };
    // `state` identity changes on every accepted command, which is what invalidates queries.
  }, [engine, state, selectedCardUid, pairSelection, introLocked]);

  return useMemo(() => {
    if (!engine || !state || !base) return null;
    let hoverPath: BoardViewModel['hoverPath'] = [];
    let preview: BoardViewModel['preview'] = null;
    let unitTargeting = false;

    if (selectedCardUid && base.interactive && !playbackBusy) {
      const targeting = engine.selectionTargeting(selectedCardUid);
      unitTargeting = targeting?.type === 'UNIT' || targeting?.type === 'CHARGE';
      const target = targeting?.type === 'SELF' ? null : hoverTile;
      if (targeting && (target || targeting.type === 'SELF')) {
        const result = pairSelection?.cardUid === selectedCardUid
          ? engine.previewCard(selectedCardUid, pairSelection.first, target ? pairSecondary(engine,target) : undefined)
          : engine.previewCard(selectedCardUid, target);
        if (targeting.type === 'UNIT' && targeting.pairSwap && !pairSelection && target) {
          preview = { tiles: [target], valid: engine.getSecondaryTargets(selectedCardUid,target).length > 0, impact: null, predicted: [] };
        } else preview = result.valid
          ? {
              element: engine.content.cards[state.player.hand.find(c => c.uid === selectedCardUid)?.cardId ?? '']?.presentation?.element,
              tiles: [...(result.resolved?.affectedTiles ?? []), ...result.predictedEvents.filter(e => e.type === 'ARROW_REBOUNDED').map(e => e.pos)],
              valid: true,
              impact: result.resolved?.impact ?? null,
              predicted: predictionLabels(result.predictedEvents),
            }
          : { tiles: target ? [target] : [], valid: false, impact: null, predicted: [] };
      }
    } else if (hoverTile) {
      hoverPath = base.moveTiles.find((n) => samePos(n.pos, hoverTile))?.path ?? [];
    }

    return {
      state,
      mechanisms: engine.getMechanismView(),
      selectedMechanismId: selectedCardUid ? null : selectedMechanismId,
      mechanismPushTo: !selectedCardUid ? engine.getInteractions().find(o=>o.adjacent && (selectedMechanismId ? o.mechanismId===selectedMechanismId : !!o.pushTo))?.pushTo : undefined,
      content: engine.content,
      heroId: engine.heroId,
      cameraOrigin: engine.scenario.hero.pos,
      interactive: base.interactive,
      hoverTile,
      aimArmed,
      moveTiles: base.moveTiles,
      hoverPath,
      targetTiles: base.targetTiles,
      unitTargeting,
      preview,
      intents: base.intents,
      focusedEnemyId,
      archer: base.interactive ? archerBoardHints(engine, state, selectedCardUid, base.targetTiles, hoverTile) : undefined,
    };
  }, [engine, state, selectedMechanismId, pairSelection, playbackBusy, base, selectedCardUid, hoverTile, aimArmed, focusedEnemyId]);
}
