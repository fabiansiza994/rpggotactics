import type { CSSProperties } from 'react';
import type { GameEngine } from '../../../game';
import { usePublicCast } from '../../cards/publicCast';
import { SpellArt } from './SpellArt';
import '../../../styles/ritual-cinematic.css';
/** Revealed pieces only. Never reads a hidden hand or an unactivated altar. */
export function RitualCinematic({ engine }: { engine: GameEngine }) {
  const ritual = usePublicCast(s=>s.ritual);
  if (!ritual || ritual.pieces.length !== 4) return null;
  return <div key={ritual.pieces.map(p=>p.cardUid).join(':')} className="ritual-cinematic" role="status" aria-label="Ritual de cuatro piezas: convergencia e invocación">
    <div className="ritual-convergence">
      {ritual.pieces.map((piece,index)=>{
        const card=engine.content.cards[piece.cardId];
        return <figure key={piece.cardUid} className="ritual-flying-card" style={{'--ritual-slot':index-1.5} as CSSProperties}>
          {card && <SpellArt cardId={card.id} spell={card.presentation.visualKey} />}
          <figcaption>{card?.name ?? 'Sello revelado'}</figcaption>
        </figure>;
      })}
      <span className="ritual-fusion" aria-hidden="true">✧</span>
      <span className="ritual-cinematic-label">CONVERGENCIA PRIMORDIAL</span>
    </div>
  </div>;
}
