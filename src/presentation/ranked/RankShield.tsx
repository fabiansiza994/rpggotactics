import { formatRp, rankFor, type RankedTierId } from '../../game/ranked/ranked';

/** Six illustrations; divisions are always real UI text, never baked into an asset. */
export const RANK_SHIELD_ART: Record<RankedTierId, string> = {
  IRON: '/art/ranked/rank-iron.webp',
  BRONZE: '/art/ranked/rank-bronze.webp',
  SILVER: '/art/ranked/rank-silver.webp',
  GOLD: '/art/ranked/rank-gold.webp',
  PLATINUM: '/art/ranked/rank-platinum.webp',
  DIAMOND: '/art/ranked/rank-diamond.webp',
};
export function RankShield({ rp, size = 'md' }: { rp: number; size?: 'sm' | 'md' | 'lg' }) {
  const rank = rankFor(rp);
  return (
    <span
      className="rank-shield"
      data-tier={rank.tierId}
      data-division={rank.division}
      data-size={size}
      role="img"
      aria-label={rank.label}
    >
      <img
        src={RANK_SHIELD_ART[rank.tierId]}
        width="384"
        height="432"
        alt=""
        draggable={false}
        decoding="async"
      />
      <b className="rank-shield-division">{rank.division}</b>
    </span>
  );
}
export function RankLine({ rp, compact = false }: { rp: number; compact?: boolean }) {
  const rank = rankFor(rp);
  return (
    <span className="rank-line" data-tier={rank.tierId}>
      <RankShield rp={rp} size="sm" />
      <span>
        <b>{rank.label}</b>
        {!compact && <small>{formatRp(rank.rp)}</small>}
      </span>
    </span>
  );
}
