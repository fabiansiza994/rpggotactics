/** Existing protocol: each client can resume rooms from its own or earlier certified release. */
export const CONTENT_RELEASE = 'darkness-expanded-1';
export const PREVIOUS_CONTENT_RELEASE = 'dark-light-1';
export const LEGACY_CONTENT_RELEASE = 'thunder-release-2';
const RELEASES = [LEGACY_CONTENT_RELEASE, 'beasts-release-1', 'scout-siege-release-1', 'market-boxes-release-1', 'frozen-battlefield-3','winter-heart-2','competitive-zones-1', PREVIOUS_CONTENT_RELEASE, CONTENT_RELEASE] as const;
export const isSupportedContentRelease = (value: unknown): value is string =>
  typeof value === 'string' && RELEASES.some(release => release === value);
export const supportsRoomRelease = (client: string | undefined, room: string): boolean =>
  isSupportedContentRelease(client) && isSupportedContentRelease(room) &&
  ((client === CONTENT_RELEASE) === (room === CONTENT_RELEASE)) &&
  RELEASES.indexOf(client as typeof RELEASES[number]) >= RELEASES.indexOf(room as typeof RELEASES[number]);

/** Missing response identifies the oldest supported Worker; never upgrade a persisted room. */
export function roomConnectionRelease(value: unknown): string {
  if(value == null)return LEGACY_CONTENT_RELEASE;
  if(isSupportedContentRelease(value))return value;
  throw new Error('CLIENT_UPDATE_REQUIRED');
}

/** This Worker has no embedded legacy engine: active rooms must be drained before upgrade.
 * Missing markers belong to pre-expansion games, never upgrade them on rehydration. */
export const canRunRoomRules = (room: { game: unknown; result: unknown; rulesRelease?: string }): boolean =>
  !room.game || !!room.result || room.rulesRelease === CONTENT_RELEASE;
