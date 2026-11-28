/** Additive room capability; never upgrade a running room on reconnect. */
export const INFORMED_RESPONSE_PROTOCOL = 'informed-response-2';
export const INFORMED_RESPONSE_MS = 15_000;
export const LEGACY_RESPONSE_MS = 5_000;
export function negotiateResponseProtocol(members: readonly {kind?: string; responseProtocol?: string}[]) {
  return members.every(m => m.kind === 'BOT' || m.responseProtocol === INFORMED_RESPONSE_PROTOCOL)
    ? INFORMED_RESPONSE_PROTOCOL : undefined;
}
export function responseDuration(protocol?: string) {
  return protocol === INFORMED_RESPONSE_PROTOCOL ? INFORMED_RESPONSE_MS : LEGACY_RESPONSE_MS;
}
