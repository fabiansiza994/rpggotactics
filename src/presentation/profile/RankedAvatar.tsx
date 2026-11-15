import { profileAvatar } from "../../shared/profileAvatars";
import "../../styles/ranked-avatar.css";
/** Public profile cosmetic only; never a champion portrait or a card illustration. */
export function RankedAvatar({
  avatarId,
  frameId,
}: {
  avatarId?: string | null;
  frameId?: string | null;
}) {
  const avatar = profileAvatar(avatarId);
  return (
    <span className="ranked-player-avatar" data-frame={frameId ?? undefined}>
      <img
        src={avatar.asset}
        alt={`Avatar: ${avatar.name}`}
        draggable={false}
        style={{ objectPosition: avatar.objectPosition ?? "50% 50%" }}
      />
    </span>
  );
}
