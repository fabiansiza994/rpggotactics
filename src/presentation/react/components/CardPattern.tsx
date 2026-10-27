import type { CardDefinition } from '../../../game';
import { cardPattern } from '../card/cardPattern';

export function CardPattern({ targeting }: { targeting: CardDefinition['targeting'] }) {
  const { cells, origin, shape } = cardPattern(targeting);
  return (
    <svg className="card-pattern" viewBox="0 0 30 30" role="img" aria-label={`Patrón: ${targeting.type === 'SELF' ? 'propio' : targeting.type === 'UNIT' ? 'unidad' : targeting.type === 'STEP' ? 'paso' : targeting.type === 'TILE' ? 'casilla' : ({LINE:'línea',CROSS:'cruz',SQUARE:'área',WALL:'muro',SINGLE:'objetivo'}[shape])}${targeting.type === 'SELF' || targeting.type === 'LINE' ? '; punto = origen' : '; contorno = objetivo'}`}>
      {Array.from({ length: 25 }, (_, i) => (
        <rect key={i} x={(i % 5) * 6 + 0.7} y={Math.floor(i / 5) * 6 + 0.7} width="4.6" height="4.6" rx="0.5" className="pattern-cell" />
      ))}
      {cells.map(({ x, y }) => <rect key={`${x},${y}`} x={x * 6 + 0.7} y={y * 6 + 0.7} width="4.6" height="4.6" rx="0.5" className="pattern-hit" />)}
      {(targeting.type === 'SELF' || targeting.type === 'LINE') ? <circle cx={origin.x * 6 + 3} cy={origin.y * 6 + 3} r="1.4" className="pattern-origin" /> : <rect x="12" y="12" width="6" height="6" fill="none" stroke="#ffd384" strokeWidth="1"/>}
      {targeting.type === 'LINE' && <path d="M9 15H27M24 12l3 3-3 3" className="pattern-direction"/>}
    </svg>
  );
}
