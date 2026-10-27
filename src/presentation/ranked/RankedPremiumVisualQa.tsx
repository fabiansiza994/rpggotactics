/** Loopback DEV fixture only. No sessions, network, wallet writes, flags or grants. */
import { useRef, useState } from 'react';
import { RANKED_TRACK, rankedTrackView } from '../../game/ranked/rewardTrack';
import { RANKED_PREMIUM_TRACK, rankedPremiumView } from '../../game/ranked/premiumTrack';
import { RankedRewardsDialog } from './RankedRewardsTrack';
import type { PremiumActions } from './RankedPremiumTrack';

export function RankedPremiumVisualQa({ scene, onClose }: { scene: string; onClose(): void }) {
  const high = scene === 'premium-showcase' || scene === 'premium-chosen';
  const rp = high ? 1700 : scene === 'premium-zero' ? 0 : 893;
  const alreadyOwned = high || scene === 'premium-owned';
  const grants = Object.fromEntries(
    RANKED_PREMIUM_TRACK.filter((n) => n.requiredRp <= rp).flatMap((n) =>
      n.items
        .filter((i) => i.type !== 'SHOWCASE_CHOICE')
        .map((i) => [i.rewardId, { grantedAt: 1, copies: i.quantity }]),
    ),
  );
  const free = rankedTrackView({
    rp,
    peakRp: rp,
    firstValidRanked: rp > 0,
    granted: {},
    milestones: [],
  });
  const [premium, setPremium] = useState(() =>
    rankedPremiumView({
      rp,
      peakRp: rp,
      pass: alreadyOwned ? { purchasedAt: 1 } : null,
      granted: alreadyOwned ? grants : {},
      showcase: scene === 'premium-chosen' ? { cardId: 'ash_eclipse', chosenAt: 1 } : null,
    }),
  );
  const [balance, setBalance] = useState(scene === 'premium-low' ? 120 : 1040);
  const receipt = useRef<Awaited<ReturnType<PremiumActions['purchase']>>>(null);
  const operation = useRef('');
  const attempts = useRef(0);
  const [purchases, setPurchases] = useState(0);
  const actions: PremiumActions = {
    equipTitle: async () => null,
    purchase: async (_season, key) => {
      attempts.current++;
      if (receipt.current && operation.current === key) return receipt.current;
      if (balance < premium.price)
        return {
          ok: false,
          error: {
            kind: 'REJECTED',
            status: 409,
            code: 'INSUFFICIENT_FUNDS',
            message: 'Saldo insuficiente',
          },
        };
      const result = rankedPremiumView({
        rp,
        peakRp: rp,
        pass: { purchasedAt: 1 },
        granted: grants,
        showcase: null,
      });
      operation.current = key;
      receipt.current = {
        ok: true,
        data: {
          status: 'PURCHASED',
          balance: balance - premium.price + premium.onPurchase.crystals,
          granted: Object.keys(grants).map((rewardId) => ({ rewardId })),
          premium: result,
        },
      };
      setPurchases((p) => p + 1);
      if (scene === 'premium-retry' && attempts.current === 1)
        return {
          ok: false,
          error: {
            kind: 'NETWORK',
            status: 0,
            code: 'NETWORK',
            message: 'QA: respuesta perdida. Reintenta la misma operación.',
          },
        };
      return receipt.current;
    },
    showcase: async (cardId) => ({
      ok: true,
      data: {
        chosenCardId: cardId,
        premium: rankedPremiumView({
          rp,
          peakRp: rp,
          pass: { purchasedAt: 1 },
          granted: grants,
          showcase: { cardId, chosenAt: 1 },
        }),
      },
    }),
  };
  return (
    <>
      <output className="rpt-qa-receipts" aria-label="Débitos QA">
        Débitos QA: {purchases}
      </output>
      <RankedRewardsDialog
        view={free}
        premium={premium}
        premiumBalance={balance}
        onPremiumChange={(v, b) => {
          setPremium(v);
          if (b !== undefined) setBalance(b);
        }}
        premiumActions={actions}
        onClose={onClose}
        onRefresh={() => {}}
      />
    </>
  );
}
export const PREMIUM_QA_SCENES = [
  ['premium', 'Premium · compra retroactiva'],
  ['premium-zero', 'Premium · 0 RP'],
  ['premium-low', 'Premium · saldo insuficiente'],
  ['premium-owned', 'Premium · en propiedad'],
  ['premium-showcase', 'Premium · elegir Showcase'],
  ['premium-chosen', 'Premium · Showcase concedido'],
  ['premium-retry', 'Premium · respuesta perdida / reintento'],
] as const;
// Retains the canonical free thresholds; this lab never changes them.
export const PREMIUM_QA_FREE_NODES = RANKED_TRACK.length;
