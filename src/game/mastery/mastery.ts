/**
 * Champion Mastery v0.1 — the ONE place for the XP curve, XP sources, titles and level rewards.
 * Pure and integer-only. The Worker grants XP (server/src/mastery.ts) from server-verified events
 * and binds these numbers into its SQL; the client only derives labels from XP the server sent.
 * Level is never stored: always `masteryFor(totalXp)`. Independent from Ranked RP.
 */

import { rankedTitleName } from '../ranked/rewardTrack';

export const MASTERY_CHAMPIONS = ['mage', 'summoner', 'warrior', 'archer', 'shapeshifter'] as const;

/**
 * XP needed to go from level i+1 to i+2 (index 0 = 1→2). 10 levels today; extending to 20/30
 * means appending steps here (no migration: XP is stored as a total).
 * Cumulative: M2 100 · M3 250 · M4 450 · M5 725 · M6 1075 · M7 1525 · M8 2075 · M9 2775 · M10 3625.
 */
export const MASTERY_STEPS: readonly number[] = [100, 150, 200, 275, 350, 450, 550, 700, 850];
export const MASTERY_MAX_LEVEL = MASTERY_STEPS.length + 1;

/** XP per server-verified event. Only match/progress/result — never micro-actions. */
export const MASTERY_XP = {
  /** Any verified PvE victory (campaign, story, replay, skirmish). Repeatable, daily-capped. */
  PVE_VICTORY: 30,
  /** First clear of an encounter with this champion, by encounter tier. Once per champion. */
  FIRST_CLEAR: { NORMAL: 40, ELITE: 80, BOSS: 150 },
  /** Extra on a first clear inside a Champion Story. */
  STORY_FIRST_CLEAR: 25,
  /** Reuses the existing daily first win (PvE, UTC day): the champion that earned it. */
  DAILY_FIRST_WIN: 50,
  PVP: {
    CASUAL: { WIN: 40, LOSS: 25 },
    RANKED: { WIN: 45, LOSS: 30 },
  },
} as const;

export const MASTERY_LIMITS = {
  /** Repeatable PvE victory XP rows per champion per UTC day (first clears are not capped). */
  pveRepeatPerDay: 12,
  /** A PvP match gives no mastery before this round (instant abandons / pre-turn surrenders). */
  pvpMinRounds: 2,
  /** Same rival: after this many XP-granting matches in the window, more matches give 0 XP. */
  pvpPairLimit: 3,
  pvpPairWindowMs: 24 * 3600_000,
} as const;

export interface MasteryView {
  xp: number;
  level: number;
  /** XP where the current level started. */
  levelXp: number;
  /** XP that reaches the next level; null at max level. */
  nextXp: number | null;
  /** XP earned inside this level / needed for it (both 0 at max). */
  intoLevel: number;
  levelSize: number;
  /** 0–100. */
  progress: number;
}

const toXp = (xp: number) => (Number.isSafeInteger(xp) && xp > 0 ? xp : 0);

/** Total XP at which `level` starts (level 1 = 0). */
export function masteryLevelXp(level: number): number {
  let total = 0;
  for (let i = 0; i < Math.min(level, MASTERY_MAX_LEVEL) - 1; i++) total += MASTERY_STEPS[i]!;
  return total;
}

export function masteryFor(rawXp: number): MasteryView {
  const xp = toXp(rawXp);
  let level = 1;
  while (level < MASTERY_MAX_LEVEL && xp >= masteryLevelXp(level + 1)) level++;
  const levelXp = masteryLevelXp(level);
  const nextXp = level === MASTERY_MAX_LEVEL ? null : masteryLevelXp(level + 1);
  const levelSize = nextXp === null ? 0 : nextXp - levelXp;
  const intoLevel = nextXp === null ? 0 : xp - levelXp;
  return { xp, level, levelXp, nextXp, intoLevel, levelSize, progress: nextXp === null ? 100 : Math.floor((intoLevel * 100) / levelSize) };
}

// ── Titles ──────────────────────────────────────────────────────────────────────────────

/** Levels that unlock a title. Title id = `mastery.<championId>.<level>` (stable, never renamed). */
export const TITLE_LEVELS = [1, 3, 5, 7, 9, 10] as const;

/**
 * Display names, Spanish (the only locale today). Components read names ONLY through
 * `titleName(id)`, so a future locale is one more table keyed by the same stable ids.
 */
const TITLE_NAMES_ES: Readonly<Record<string, readonly string[]>> = {
  mage: ['Aprendiz Arcano', 'Adepto de los Sellos', 'Conjurador Experto', 'Perfeccionista en Magia', 'Mago Maestro', 'Archimago'],
  archer: ['Rastreador', 'Cazador Preciso', 'Ojo del Bosque', 'Maestro de la Presa', 'Tirador Perfecto', 'Señor de la Cacería'],
  warrior: ['Espada Jurada', 'Veterano de Mil Choques', 'Muro de Acero', 'Maestro de la Guardia', 'Campeón del Juramento', 'Señor del Campo de Batalla'],
  // "Primordial" stays reserved for the Dragón Primordial ritual: M9 is a pact title instead.
  summoner: ['Vinculador', 'Pastor de Bestias', 'Maestro de Pactos', 'Señor del Altar', 'Voz de los Pactos Antiguos', 'Señor de las Bestias'],
  shapeshifter: ['Sangre Salvaje', 'Caminante de Formas', 'Dominador de la Bestia', 'Maestro de las Formas', 'Avatar Salvaje', 'Señor de las Mil Formas'],
};

export interface MasteryTitle {
  id: string;
  championId: string;
  requiredMastery: number;
}

export const MASTERY_TITLES: readonly MasteryTitle[] = MASTERY_CHAMPIONS.flatMap((championId) =>
  TITLE_LEVELS.map((requiredMastery) => ({ id: `mastery.${championId}.${requiredMastery}`, championId, requiredMastery })),
);

export const titleById = (id: unknown): MasteryTitle | undefined =>
  typeof id === 'string' ? MASTERY_TITLES.find((t) => t.id === id) : undefined;

/**
 * Display name of ANY equippable title: Champion Mastery or Ranked (src/game/ranked/rewardTrack.ts).
 * Both share the one equipped-title slot (tactics_profile_titles).
 */
export function titleName(id: string | null | undefined): string | null {
  const t = titleById(id);
  if (!t) return rankedTitleName(id);
  return TITLE_NAMES_ES[t.championId]?.[TITLE_LEVELS.indexOf(t.requiredMastery as (typeof TITLE_LEVELS)[number])] ?? null;
}

export const titlesFor = (championId: string) => MASTERY_TITLES.filter((t) => t.championId === championId);

// ── Level rewards (one-time per champion and level) ──────────────────────────────────────

export type MasteryCosmeticHook = 'PORTRAIT_BORDER' | 'MASTERY_BADGE' | 'PREMIUM_HOOK' | 'MASTERY_EMBLEM';

export interface MasteryReward {
  level: number;
  /** One-time Cristales (0 = none). Moderate on purpose (see qa/champion-mastery/REPORT.md). */
  crystals: number;
  /** Visual reward contract for Codex; v0.1 grants no cosmetic item, it only reserves the hook. */
  cosmetic: MasteryCosmeticHook | null;
}

export const MASTERY_REWARDS: readonly MasteryReward[] = [
  { level: 1, crystals: 0, cosmetic: null },
  { level: 3, crystals: 25, cosmetic: null },
  { level: 5, crystals: 50, cosmetic: 'PORTRAIT_BORDER' },
  { level: 7, crystals: 75, cosmetic: 'MASTERY_BADGE' },
  { level: 9, crystals: 100, cosmetic: 'PREMIUM_HOOK' },
  { level: 10, crystals: 150, cosmetic: 'MASTERY_EMBLEM' },
];

/** Roman numeral for the level badge (I–XXX). */
export function masteryNumeral(level: number): string {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let n = Math.max(1, Math.min(level, 39)),
    out = '';
  for (const [v, s] of map)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

export const masteryPublicConfig = () => ({
  maxLevel: MASTERY_MAX_LEVEL,
  levelXp: Array.from({ length: MASTERY_MAX_LEVEL }, (_, i) => masteryLevelXp(i + 1)),
  rewards: MASTERY_REWARDS,
});
