import { rankFor } from "../ranked/ranked";
export const BOT_POLICY_VERSION = "ranked-bots-1";
export interface BotPolicy {
  version: string;
  offerAfterMs: number;
  winRp: number;
  lossRp: number;
  abandonRp: number;
  maxDailyWins: number;
  maxDailyPositiveRp: number;
  winXp: number;
  lossXp: number;
  maxDailyXpMatches: number;
}
export const BOT_POLICY: BotPolicy = {
  version: BOT_POLICY_VERSION,
  offerAfterMs: 15_000,
  winRp: 10,
  lossRp: -6,
  abandonRp: -10,
  maxDailyWins: 3,
  maxDailyPositiveRp: 30,
  winXp: 22,
  lossXp: 15,
  maxDailyXpMatches: 6,
};
export type BotPersonality =
  "AGGRESSIVE" | "DEFENSIVE" | "CONTROL" | "BALANCED" | "SUMMONS" | "COMBOS";
export const BOT_PERSONALITIES: readonly BotPersonality[] = [
  "AGGRESSIVE",
  "DEFENSIVE",
  "CONTROL",
  "BALANCED",
  "SUMMONS",
  "COMBOS",
];
export const BOT_LEVELS = [
  { name: "Aprendiz", nodes: 40, depth: 1, width: 2, cpuMs: 8 },
  { name: "Combatiente", nodes: 100, depth: 2, width: 3, cpuMs: 12 },
  { name: "Estratega", nodes: 180, depth: 3, width: 4, cpuMs: 20 },
  { name: "Maestro táctico", nodes: 280, depth: 3, width: 5, cpuMs: 30 },
  { name: "Élite", nodes: 400, depth: 4, width: 6, cpuMs: 40 },
  { name: "Élite avanzada", nodes: 550, depth: 5, width: 6, cpuMs: 50 },
  { name: "Élite+", nodes: 550, depth: 6, width: 5, cpuMs: 50 },
] as const;

/** Finite work even when deployed Workers freeze synchronous clocks. Same existing time/action targets. */
export function botTurnBudget(level: number) {
  const profile =
    BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, level))]!;
  return {
    nodes: Math.ceil((profile.nodes * 250) / profile.cpuMs),
    wallMs: 250,
    maxActions: 64,
  };
}

export const BOT_DIFFICULTY_MIX_VERSION = "ranked-mix-2+1-v1";
export const BOT_HIGHER_LEVEL_BPS = 3333;
/** A separate seed domain: no combat RNG, rank mutation or rigid encounter cycle. */
export function botDifficulty(
  rp: number,
  seed: number,
  higherBps = BOT_HIGHER_LEVEL_BPS,
) {
  const chance = Number.isFinite(higherBps)
    ? Math.max(0, Math.min(10000, Math.round(higherBps)))
    : BOT_HIGHER_LEVEL_BPS;
  let n = (seed ^ 0x8d12e457) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d) >>> 0;
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b) >>> 0;
  const roll = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  const baseLevel = rankFor(rp).tierIndex;
  const promoted = roll < chance / 10000;
  return {
    version: BOT_DIFFICULTY_MIX_VERSION,
    baseLevel,
    higherBps: chance,
    promoted,
    level: baseLevel + Number(promoted),
  };
}
export interface BotIdentity {
  kind: "BOT";
  id: string;
  name: string;
  heroId: "mage" | "summoner" | "shapeshifter";
  personality: BotPersonality;
  level: number;
  difficultyMix?: ReturnType<typeof botDifficulty>;
  seed: number;
  policyVersion: string;
  deckVersion: string;
}
export function botIdentity(
  id: string,
  rp: number,
  seed: number,
  higherBps = BOT_HIGHER_LEVEL_BPS,
): BotIdentity {
  const n = seed >>> 0 || 1;
  const difficultyMix = botDifficulty(rp, n, higherBps);
  const names = [
    "Kael",
    "Lyra",
    "Varek",
    "Selene",
    "Thorne",
    "Iria",
    "Darian",
    "Neris",
  ];
  const titles = [
    "de las Cenizas",
    "Sombraluna",
    "del Eclipse",
    "Filoescarcha",
    "del Alba",
    "Vigíatormenta",
  ];
  return {
    kind: "BOT",
    id,
    name: `${names[n % names.length]} ${titles[Math.floor(n / names.length) % titles.length]} · IA`,
    heroId: (["mage", "summoner", "shapeshifter"] as const)[
      Math.floor(n / 48) % 3
    ]!,
    personality: BOT_PERSONALITIES[Math.floor(n / 144) % 6]!,
    level: difficultyMix.level,
    difficultyMix,
    seed: n || 1,
    policyVersion: BOT_POLICY_VERSION,
    deckVersion: "published-competitive-1",
  };
}
/**
 * What a client may see of a bot (SEC-004). The seed, personality and difficulty mix are the
 * private inputs of its deck and play (botDeck / botDifficulty): publishing them lets a player
 * rebuild the hidden 40-card loadout. Name and champion are already shown by the match itself.
 */
export type PublicBotIdentity = Pick<BotIdentity, "kind" | "id" | "name" | "heroId" | "policyVersion" | "deckVersion">;
export const publicBotIdentity = (identity: BotIdentity): PublicBotIdentity => ({
  kind: identity.kind,
  id: identity.id,
  name: identity.name,
  heroId: identity.heroId,
  policyVersion: identity.policyVersion,
  deckVersion: identity.deckVersion,
});
export type BotOutcome = "WIN" | "LOSS" | "ABANDON" | "DRAW" | "SERVER_ERROR";
export function botReward(
  input: {
    rp: number;
    outcome: BotOutcome;
    dailyWins: number;
    dailyPositive: number;
    dailyXpMatches: number;
    valid: boolean;
  },
  policy: typeof BOT_POLICY = BOT_POLICY,
) {
  const restrictions: string[] = [];
  let delta = 0,
    xp = 0;
  if (input.outcome === "SERVER_ERROR")
    restrictions.push("Incidencia del servidor: sin penalización");
  else if (input.outcome === "WIN") {
    if (!input.valid)
      restrictions.push("Partida demasiado breve para obtener recompensas");
    else if (
      input.dailyWins >= policy.maxDailyWins ||
      input.dailyPositive >= policy.maxDailyPositiveRp
    )
      restrictions.push("Límite diario de RP positivo contra IA");
    else {
      const tier = rankFor(input.rp).tierIndex;
      const ceiling = tier < 5 ? (tier + 1) * 300 - 1 : Number.MAX_SAFE_INTEGER;
      delta = Math.min(
        policy.winRp,
        policy.maxDailyPositiveRp - input.dailyPositive,
        Math.max(0, ceiling - input.rp),
      );
      if (delta < policy.winRp)
        restrictions.push("El ascenso de rango requiere una victoria humana");
    }
  } else if (input.outcome === "LOSS") delta = policy.lossRp;
  else if (input.outcome === "ABANDON") delta = policy.abandonRp;
  delta = Math.max(-input.rp, delta);
  if (input.valid && input.dailyXpMatches < policy.maxDailyXpMatches)
    xp =
      input.outcome === "WIN"
        ? policy.winXp
        : input.outcome === "LOSS"
          ? policy.lossXp
          : 0;
  else if (input.valid && input.dailyXpMatches >= policy.maxDailyXpMatches)
    restrictions.push("Límite diario de maestría contra IA");
  return {
    rpBefore: input.rp,
    rpDelta: delta,
    rpAfter: input.rp + delta,
    xp,
    restrictions,
  };
}
