import { useState } from 'react';
import { RANKED_TRACK_CARDS } from '../../game/data/ranked-cards';
import { RANKED_COSMETICS, rankedTitleName } from '../../game/ranked/rewardTrack';
import { FINAL_CARD_ART } from '../assets/paintedAssets';
import { RARITY_LABEL } from '../react/format';
import type { RankedSnapshot } from './rankedApi';
import '../../styles/ranked-rewards.css';
type Rewards = NonNullable<RankedSnapshot['outcome']>['rewards'];
/** One compact result panel for all authoritative unlocks, no queue of blocking modals. */
export function RankedRewardUnlock({ rewards }: { rewards: Rewards }) {
  const [expanded, setExpanded] = useState(true);
  if (!rewards?.length) return null;
  if (!expanded)
    return (
      <button className="rrt-unlock-closed" onClick={() => setExpanded(true)}>
        Ver {rewards.length} recompensas desbloqueadas
      </button>
    );
  return (
    <section className="rrt-unlock" aria-label="Recompensas Ranked desbloqueadas" role="status">
      <header>
        <h3>{rewards.length === 1 ? 'RECOMPENSA RANKED DESBLOQUEADA' : 'NUEVAS RECOMPENSAS'}</h3>
        <button aria-label="Ocultar recompensas" onClick={() => setExpanded(false)}>
          ×
        </button>
      </header>
      <div className="rrt-unlock-list">
        {rewards.map((r) => {
          const card = RANKED_TRACK_CARDS.find((c) => c.id === r.itemId),
            cosmetic = RANKED_COSMETICS[r.itemId];
          const name = card?.name ?? rankedTitleName(r.itemId) ?? cosmetic?.name ?? r.itemId;
          const art = card
            ? FINAL_CARD_ART[card.id]
            : cosmetic
              ? `/art/ranked-rewards/${cosmetic.id}.svg`
              : null;
          return (
            <div
              key={r.rewardId}
              className="rrt-unlock-card"
              data-type={r.type}
              data-rarity={card?.rarity}
            >
              {art ? (
                <img src={art} alt="" />
              ) : (
                <span className="rrt-unlock-icon" aria-hidden="true">
                  ✦
                </span>
              )}
              <span>
                <strong>{name}</strong>
                <small>
                  {card
                    ? `${RARITY_LABEL[card.rarity ?? 'COMMON']} · ${r.granted > 0 ? `×${r.granted}` : 'Ya en colección'}`
                    : r.type === 'TITLE'
                      ? 'Título desbloqueado'
                      : 'Cosmético en propiedad'}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
