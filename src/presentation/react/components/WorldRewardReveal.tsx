import { CardTypeVisual } from './CardTypeVisual';
import { EquippedCardBack } from '../../cosmetics/CardBack';
import { useCardPremiumEffect } from '../../cards/useCardPremiumEffect';
import { CardPremiumFx } from './CardPremiumFx';
import { WORLDS, ownedFor, type RunState } from '../../../game';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import { useBattleStore } from '../../store/battleStore';
import { SpellArt } from './SpellArt';
import { WorldRewardBadge } from './WorldRewardBadge';
import { RARITY_LABEL } from '../format';
import '../../../styles/world-reward.css';

/** Guaranteed reward presentation. No draws, claims, timers, network or profile writes. */
export function WorldRewardReveal({ run }: { run: RunState }) {
  const profile = useBattleStore((s) => s.profile);
  const connected = useBattleStore((s) => s.account.status === 'READY');
  const world = WORLDS.find((w) => w.campaignId === run.campaignId);
  const cardId = world?.completionReward?.championCards?.[run.heroId];
  const def = cardId ? DEFAULT_CONTENT.cards[cardId] : undefined;
  const premiumRef = useCardPremiumEffect<HTMLElement>(def, 'large');
  if (!world?.completionReward) return null;
  const owned = !!def && ownedFor(profile, run.heroId, DEFAULT_CONTENT)(def.id) > 0;
  return (
    <div
      className="world-reward-reveal"
      key={`${world.id}:${run.heroId}`}
      data-reward-card={def?.id}
    >
      <section className="world-reward-copy">
        <span className="world-reward-kicker">JEFE DERROTADO</span>
        <strong className="world-reward-crystals">
          ◇ {world.completionReward.crystals} <small>CRISTALES ARCANOS</small>
        </strong>
        <p>
          {connected
            ? 'Recompensa única de este mundo por campeón, verificada por el servidor.'
            : 'Los Cristales se obtienen con una cuenta conectada; el invitado conserva su carta.'}
        </p>
        <p className="world-reward-guarantee">
          Recompensa garantizada ·{' '}
          {def ? owned ? 'Carta en tu colección' : 'La carta se entrega al verificar la victoria' : 'Logro registrado sin carta exclusiva de este campeón.'}
        </p>
      </section>
      {def && <figure ref={premiumRef}
        className="world-reward-card"
        data-rarity={def.rarity}
        aria-label={`${def.name}, ${RARITY_LABEL[def.rarity ?? 'COMMON']}, recompensa de ${world.name}`}
      >
        <div className="world-reward-flip">
          <div className="world-reward-back" aria-hidden="true">
            <EquippedCardBack />
          </div>
          <div className="world-reward-front">
            <div className="world-reward-art"><CardPremiumFx def={def} />
              <SpellArt cardId={def.id} spell={def.presentation.visualKey} /><CardTypeVisual card={def} />
            </div>
            <span className="world-reward-rarity">◆ {RARITY_LABEL[def.rarity ?? 'COMMON']}</span>
            <figcaption>{def.name}</figcaption>
            <WorldRewardBadge def={def} />
          </div>
        </div>
      </figure>}
    </div>
  );
}
