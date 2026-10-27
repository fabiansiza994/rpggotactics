import { RANKED_COSMETICS } from '../../game/ranked/rewardTrack';
/** Track preview only: no ownership writes, fake equip or backend catalog substitution. */
export function RankedCosmeticPreview({
  cosmeticId,
  owned = false,
  status = 'LOCKED',
}: {
  cosmeticId: string;
  owned?: boolean;
  status?: 'LOCKED' | 'UNLOCKED' | 'CLAIMED';
}) {
  const cosmetic = RANKED_COSMETICS[cosmeticId];
  if (!cosmetic) return null;
  return (
    <figure className="rrt-cosmetic" data-kind={cosmetic.kind} data-owned={owned}>
      <img
        src={`/art/ranked-rewards/${cosmeticId}.svg`}
        alt={cosmetic.name}
        width="240"
        height="240"
      />
      <figcaption>
        {owned
          ? '✓ EN PROPIEDAD'
          : status === 'UNLOCKED'
            ? '◇ PENDIENTE DE ENTREGA'
            : '⌑ BLOQUEADO'}
        <small>{cosmetic.name}</small>
      </figcaption>
    </figure>
  );
}
