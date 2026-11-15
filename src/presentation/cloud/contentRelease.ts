import { BOT_POLICY_VERSION } from "../../game/ai/ranked-bot-policy";
/** Compatibility marker, never an auth credential or ownership assertion. */
export const CONTENT_RELEASE = "thunder-release-2";
export function contentReleaseUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname.startsWith("/api/tactics"))
    url.searchParams.set("clientRelease", CONTENT_RELEASE);
  if (url.pathname.startsWith("/api/tactics/pvp/"))
    url.searchParams.set("botProtocol", BOT_POLICY_VERSION);
  return url.toString();
}
