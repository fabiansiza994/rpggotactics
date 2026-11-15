import '../../styles/ranked-avatar.css';
import { type ReactNode } from 'react';
import { DEFAULT_CONTENT } from '../../game';
import { PROFILE_FRAME_ART } from '../assets/profileFrames';
import '../../styles/cosmetics.css';

/**
 * Profile frame cosmetic: decorates a champion portrait (store, PvP lobby). Pure presentation;
 * an unknown/absent id renders the portrait unframed. The shared circular PNG overlay keeps
 * the transparent portrait opening centered without changing cosmetic IDs or ownership.
 */
export function ProfileFrame({
  frameId,
  children,
}: {
  frameId: string | null | undefined;
  children: ReactNode;
}) {
  const art = frameId ? PROFILE_FRAME_ART[frameId] : undefined;
  if ( !art) return <>{children}</>;
  return (
    <span className="circular-profile-frame" data-frame={frameId}>
      <span className="circular-frame-portrait">{children}</span>
      <img
        className="circular-frame-art"
        src={art}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </span>
  );
}

/** A framed champion portrait for store previews. */
export function FramedPortrait({
  frameId,
  heroId,
}: {
  frameId: string;
  heroId: string;
}) {
  return (
    <div className="shop-cosmetic-art shop-avatar-preview">
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
