import { DEFAULT_CONTENT, type GameContent } from "../../src/game";
import { botStarterDeck } from "../../src/game/ai/ranked-bot-deck";
import type { BotIdentity } from "../../src/game/ai/ranked-bot-policy";
import { rankedBotCatalog } from "./rankedBotCatalog";
import type { D1Database, Env } from "./db";
export type BotChampion = BotIdentity["heroId"];
/** Explicit AI support, not the human release roster. Warrior/Archer have no validated bot policy. */
export const BOT_CHAMPION_SUPPORT: readonly BotChampion[] = [
  "mage",
  "summoner",
  "shapeshifter",
];
export function playableBotChampions(
  env: Env,
  content: GameContent = DEFAULT_CONTENT,
): BotChampion[] {
  const catalog = rankedBotCatalog(content, env);
  return BOT_CHAMPION_SUPPORT.filter((id) => {
    if (!catalog.heroes[id]) return false;
    try {
      botStarterDeck(catalog, id);
      return true;
    } catch {
      return false;
    }
  });
}
/** Independent domain; adjacent seeds do not produce 48 identical champions. Never consumes combat RNG. */
function championRandom(seed: number) {
  let n = ((seed >>> 0) ^ 0x71c3a9e5) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function selectBotChampion(
  seed: number,
  available: readonly BotChampion[],
  recent: readonly unknown[] = [],
): BotChampion {
  const heroes = [...new Set(available)];
  if (!heroes.length) throw Error("NO_PLAYABLE_BOT_CHAMPION");
  // A third same champion stays possible (1/11 with three available), but is less likely.
  const repeated =
    recent.length >= 2 && recent[0] === recent[1] ? recent[0] : null;
  const weights = heroes.map((id) => (id === repeated ? 0.2 : 1)),
    total = weights.reduce((a, b) => a + b, 0);
  let pick = championRandom(seed) * total;
  for (let i = 0; i < heroes.length; i++) {
    pick -= weights[i]!;
    if (pick < 0) return heroes[i]!;
  }
  return heroes[heroes.length - 1]!;
}
/** Existing user/created_at index + LIMIT2. Same cutoff on every heartbeat/reconnect of a ticket. */
export async function recentBotChampions(
  db: D1Database,
  userId: number,
  before: number,
): Promise<BotChampion[]> {
  const rows = await db
    .prepare(
      "SELECT bot_json FROM tactics_ranked_bot_encounters WHERE user_id=? AND created_at<? ORDER BY created_at DESC,match_id DESC LIMIT 2",
    )
    .bind(userId, before)
    .all<{ bot_json: string }>();
  return (rows.results ?? []).flatMap((row) => {
    try {
      const id = (JSON.parse(row.bot_json) as { heroId?: unknown }).heroId;
      return BOT_CHAMPION_SUPPORT.includes(id as BotChampion)
        ? [id as BotChampion]
        : [];
    } catch {
      return [];
    }
  });
}
export const botChampionAvatar = (hero: BotChampion) =>
  (
    ({
      mage: "wizard_blue",
      summoner: "arcane_sigil",
      shapeshifter: "shapeshifter_bear",
    }) as const
  )[hero];
