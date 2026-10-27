import { RankedPremiumArtQa } from './RankedPremiumArtQa';
import { RankedPremiumVisualQa, PREMIUM_QA_SCENES } from './RankedPremiumVisualQa';
import '../../styles/ranked.css';
import { useState } from 'react';
import { RANKED_TRACK, rankedTrackView } from '../../game/ranked/rewardTrack';
import { RANKED_TRACK_CARDS } from '../../game/data/ranked-cards';
import { RankedRewardsDialog, RankedCardFace } from './RankedRewardsTrack';
import { RankedRewardUnlock } from './RankedRewardUnlock';
import type { RankedSnapshot } from './rankedApi';
/** Loopback DEV only. Pure fixture views, no network, session, grants or storage writes. */
export default function RankedRewardVisualQa() {
  const [scene, setScene] = useState(
      new URLSearchParams(location.search).has('premium') ? 'premium' : 'demotion',
    ),
    [open, setOpen] = useState(true);
  const peak = scene === 'all' ? 2100 : 905,
    rp = scene === 'all' ? 2100 : 893;
  const granted = Object.fromEntries(
    RANKED_TRACK.filter((n) => n.requiredRp <= peak)
      .flatMap((n) => n.items)
      .filter((i) => i.type !== 'CRYSTALS')
      .map((i) => [i.rewardId, { grantedAt: 1, copies: i.quantity }]),
  );
  const view = rankedTrackView({
    rp,
    peakRp: peak,
    firstValidRanked: true,
    granted: scene === 'unlocked' ? {} : granted,
    milestones:
      scene === 'unlocked'
        ? []
        : RANKED_TRACK.filter((n) => n.requiredRp <= peak).map((n) => n.tierId),
  });
  const rewards: NonNullable<RankedSnapshot['outcome']>['rewards'] = RANKED_TRACK.flatMap(
    (n) => n.items,
  )
    .filter((i) => i.type !== 'CRYSTALS')
    .filter((i) => scene !== 'single' || i.cardId === 'siege_leap')
    .slice(0, scene === 'single' ? 1 : 5)
    .map((i) => ({
      rewardId: i.rewardId,
      type: i.type as 'CARD' | 'TITLE' | 'COSMETIC',
      itemId: i.cardId ?? i.titleId ?? i.cosmeticId!,
      heroId: i.heroId ?? null,
      granted: i.quantity,
    }));
  return (
    <main
      className="rrt-qa"
      style={{
        background: '#07111e',
        color: '#eee2ca',
        minHeight: '100dvh',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <header style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>QA LOCAL · REWARD TRACK</b>
        <label>
          Escena{' '}
          <select
            aria-label="Escena visual"
            value={scene}
            onChange={(e) => {
              setScene(e.target.value);
              setOpen(!['premium-art', 'gallery', 'single', 'multiple'].includes(e.target.value));
            }}
          >
            {PREMIUM_QA_SCENES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
            <option value="demotion">Actual / máximo</option>
            <option value="unlocked">Desbloqueado sin reclamar</option>
            <option value="all">Diamante / todo reclamado</option>
            <option value="single">Una recompensa</option>
            <option value="multiple">Varias recompensas</option>
            <option value="gallery">Nueve cartas</option>
            <option value="premium-art">Arte Premium · 16 recursos</option>
          </select>
        </label>
        <button onClick={() => setOpen(true)}>Abrir timeline</button>
      </header>
      {scene === 'premium-art' ? <RankedPremiumArtQa /> : scene === 'gallery' ? (
        <div className="rrt-qa-gallery">
          {RANKED_TRACK_CARDS.map((card) => (
            <RankedCardFace card={card} key={card.id} />
          ))}
        </div>
      ) : (
        <RankedRewardUnlock key={`unlock-${scene}`} rewards={rewards} />
      )}
      {open && scene.startsWith('premium') ? (
        <RankedPremiumVisualQa key={scene} scene={scene} onClose={() => setOpen(false)} />
      ) : (
        open && (
          <RankedRewardsDialog
            key={`track-${scene}`}
            view={view}
            onClose={() => setOpen(false)}
            onRefresh={() => {}}
          />
        )
      )}
    </main>
  );
}
