import type { GameState } from '../../game';
import { unitVisualId } from '../assets/visualIdentity';
import { formVisual } from '../qa/shapeshifter/visuals';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
/** Actual snapshot only: waves, catalog summons and inactive transformations are not prefetched. */
export function sceneAssetIds(state: Readonly<GameState>): string[] {
  const ids = new Set<string>(['stone', 'root_snare']);
  for (const unit of state.units) ids.add(unit.defId === 'shapeshifter' && shapeshifterPresentationEnabled
    ? `qa_form_${formVisual(unit.activeForm).id}` : unitVisualId(unit.defId));
  for (const obstacle of state.obstacles) ids.add(obstacle.defId === 'ice_wall' ? 'ice_obstacle' : obstacle.defId);
  if (state.scenarioId.startsWith('w2_')) for (const id of ['infernal_basalt','infernal_lava','infernal_pylon','infernal_cage_support']) ids.add(id);
  if (state.scenarioId.startsWith('hunt_')) for (const id of ['veil_tree','veil_brambles','veil_cover','veil_relic','veil_camp']) ids.add(id);
  return [...ids].sort();
}
export const sceneAssetKey = (state: Readonly<GameState>) => JSON.stringify([state.scenarioId,sceneAssetIds(state),state.mechanisms?.objects.map(o=>o.def.kind)]);
