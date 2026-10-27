import { useId, type ReactNode } from 'react';
import { COSMETICS, DEFAULT_CONTENT } from '../../game';
import { PROFILE_FRAME_ART } from '../assets/profileFrames';
import '../../styles/cosmetics.css';
import { isRankedFrame, RankedProfileFrame } from '../ranked/RankedCosmetics';

/**
 * Profile frame cosmetic: decorates a champion portrait (store, PvP lobby). Pure presentation;
 * an unknown/absent id renders the portrait unframed. A shared SVG viewport preserves the
 * painted overlay's proportions and portrait window in square avatars and taller store/lobby slots.
 */
export function ProfileFrame({
  frameId,
  children,
}: {
  frameId: string | null | undefined;
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  if (frameId && isRankedFrame(frameId)) return <RankedProfileFrame frameId={frameId}>{children}</RankedProfileFrame>;
  const known = frameId && COSMETICS[frameId]?.kind === 'PROFILE_FRAME' ? frameId : null;
  const art = known ? PROFILE_FRAME_ART[known] : undefined;
  const window = known === 'frame_executioner_oath'
    ? {x:120,y:212,width:360,height:436,rx:70}
    : {x:102,y:148,width:396,height:554,rx:100};
  if (!known || !art) return <>{children}</>;
  return (
    <div className="profile-frame" data-frame={known}>
      <svg
        className="profile-frame-canvas"
        viewBox="0 0 600 800"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={`portrait-${id}`}>
            <rect {...window} />
          </clipPath>
          <radialGradient id={`gem-${id}`}>
            <stop stopColor="currentColor" stopOpacity=".6" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <foreignObject x={window.x} y={window.y} width={window.width} height={window.height} clipPath={`url(#portrait-${id})`}>
          <div className="profile-frame-window">{children}</div>
        </foreignObject>
        <image
          className="profile-frame-ornament"
          href={art}
          width="600"
          height="800"
          aria-hidden="true"
        />
        <ellipse
          className="profile-frame-glint"
          cx="300"
          cy="103"
          rx="28"
          ry="42"
          fill={`url(#gem-${id})`}
          aria-hidden="true"
        />
      </svg>
    </div>
  );
}

/** A framed champion portrait for store previews. */
export function FramedPortrait({ frameId, heroId }: { frameId: string; heroId: string }) {
  return (
    <div className="shop-cosmetic-art">
      <ProfileFrame frameId={frameId}>
        <svg
          className="profile-frame-portrait"
          viewBox="0 0 90 120"
          role="img"
          aria-label={`Vista del marco para ${DEFAULT_CONTENT.heroes[heroId]?.name ?? 'Mago'}`}
        >
          <rect width="90" height="120" fill="#152333" />
          <ellipse cx="45" cy="56" rx="31" ry="42" fill="#24364a" />
          <path
            d="M25 61Q24 32 45 23Q66 32 65 61L57 70Q78 78 81 120H9Q12 78 33 70Z"
            fill="#080f1b"
            stroke="#526174"
          />
        </svg>
      </ProfileFrame>
    </div>
  );
}
