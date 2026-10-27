import { ICON_PATHS, type IconName } from '../../assets/iconPaths';
export function GameIcon({ name }: { name: IconName }) {
  return (
    <svg className="game-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={ICON_PATHS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
