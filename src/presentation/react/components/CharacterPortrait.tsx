import { characterDefinition } from '../../assets/characterDefinitions';
import { CHARACTER_PAINTINGS } from '../../assets/paintedAssets';

export function CharacterPortrait({ unit = 'mage' }: { unit?: string }) {
  const art = characterDefinition(unit);
  if (CHARACTER_PAINTINGS[unit])
    return (
      <div className={`painted-portrait portrait-${unit}`} aria-hidden="true">
        <img src={CHARACTER_PAINTINGS[unit]} alt="" />
      </div>
    );
  return (
    <svg
      viewBox={art.portrait}
      aria-hidden="true"
      focusable="false"
      className="character-portrait-art"
    >
      <rect x="-60" y="-80" width="140" height="150" fill="#0b1726" />
      <circle cx="4" cy="-28" r="32" fill="none" stroke={art.accent} opacity=".25" />
      {art.shapes.map((shape, i) => (
        <path
          key={i}
          d={shape.d}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.width}
        />
      ))}
    </svg>
  );
}
