/** Existing protocol: each client can resume rooms from its own or earlier certified release. */
export const CONTENT_RELEASE = 'scout-siege-release-1';
export const PREVIOUS_CONTENT_RELEASE = 'beasts-release-1';
export const LEGACY_CONTENT_RELEASE = 'thunder-release-2';
const RELEASES = [LEGACY_CONTENT_RELEASE, PREVIOUS_CONTENT_RELEASE, CONTENT_RELEASE] as const;
export const isSupportedContentRelease = (value: unknown): value is string =>
  typeof value === 'string' && RELEASES.some(release => release === value);
export const supportsRoomRelease = (client: string | undefined, room: string): boolean =>
  isSupportedContentRelease(client) && isSupportedContentRelease(room) &&
  RELEASES.indexOf(client as typeof RELEASES[number]) >= RELEASES.indexOf(room as typeof RELEASES[number]);

/** Missing response identifies the oldest supported Worker; never upgrade a persisted room. */
export function roomConnectionRelease(value: unknown): string {
  if(value == null)return LEGACY_CONTENT_RELEASE;
  if(isSupportedContentRelease(value))return value;
  throw new Error('CLIENT_UPDATE_REQUIRED');
}
