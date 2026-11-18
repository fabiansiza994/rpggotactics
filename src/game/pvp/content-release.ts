/** Existing contentRelease protocol; newer clients can resume legacy rooms. */
export const CONTENT_RELEASE = 'beasts-release-1';
export const LEGACY_CONTENT_RELEASE = 'thunder-release-2';
export const supportsRoomRelease = (client: string | undefined, room: string): boolean =>
  client === room || (client === CONTENT_RELEASE && room === LEGACY_CONTENT_RELEASE);

/** Missing response field identifies the previous Worker during a rolling deployment. */
export function roomConnectionRelease(value: unknown): string {
  if(value == null)return LEGACY_CONTENT_RELEASE;
  if(value === CONTENT_RELEASE || value === LEGACY_CONTENT_RELEASE)return value;
  throw new Error('CLIENT_UPDATE_REQUIRED');
}
