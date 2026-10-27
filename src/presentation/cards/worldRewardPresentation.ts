import { WORLDS, type CardDefinition } from '../../game';

/** Read existing origin metadata; artwork never changes acquisition or ownership. */
export function worldRewardIdentity(card: Pick<CardDefinition, 'acquisition'>) {
  if (card.acquisition?.source !== 'WORLD_COMPLETION') return null;
  const world = WORLDS.find((w) => w.id === card.acquisition!.worldId);
  return world ? { worldId: world.id, name: world.name, label: 'RECOMPENSA DE MUNDO' } : null;
}
