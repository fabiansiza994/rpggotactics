import { RitualCinematic } from './RitualCinematic';
import { CardTypeVisual } from './CardTypeVisual';
import '../../../styles/resolution.css';
import type { GameEngine } from '../../../game';
import { usePublicCast, ENEMY_ACTION_LABELS } from '../../cards/publicCast';
import { RARITY_LABEL } from '../format';
import { SpellArt } from './SpellArt';
export function ResolvingCardPreview({ engine }: { engine: GameEngine }) {
  return <><RitualCinematic engine={engine} /><PublicActionPreview engine={engine} /></>;
}
function PublicActionPreview({ engine }: { engine: GameEngine }) {
  const cast = usePublicCast((s) => s.cast);
  const action = usePublicCast((s) => s.action);

  if (!cast && action) {
    const unit = engine.state.units.find((u) => u.id === action.enemyId);
    return (
      <aside
        className="resolving-card-preview resolving-enemy-action"
        data-rival="true"
        role="status"
        aria-label="Acción del rival"
      >
        <div className="public-action-sigil" aria-hidden="true">
          {action.intent.kind === 'AREA_SPELL' ? '✧' : action.intent.kind === 'CHARGE' ? '➜' : '⚔'}
        </div>
        <div>
          <small>RIVAL · EN RESOLUCIÓN</small>
          <strong>{ENEMY_ACTION_LABELS[action.intent.kind]}</strong>
          <span>{unit?.name ?? 'Enemigo'}</span>
        </div>
      </aside>
    );
  }
  if (!cast) return null;
  const card = engine.content.cards[cast.cardId];
  if (!card) return null;
  return (
    <aside
      key={`${cast.casterId}:${cast.cardUid}`}
      className="resolving-card-preview"
      data-rival={cast.casterId !== engine.heroId}
      role="status"
      aria-label={`Carta en resolución: ${card.name}`}
      data-card-id={card.id}
    >
      <div className="resolving-card-art">
        <SpellArt spell={card.presentation.visualKey} cardId={card.id} /><CardTypeVisual card={card} />
      </div>
      <div>
        <small>{cast.casterId === engine.heroId ? 'EN RESOLUCIÓN' : 'RIVAL · EN RESOLUCIÓN'}</small>
        <strong>{card.name}</strong>
        <span>
          {card.cost} EN · {RARITY_LABEL[card.rarity ?? 'COMMON']}
        </span>
      </div>
    </aside>
  );
}
