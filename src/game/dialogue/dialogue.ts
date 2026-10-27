/**
 * Character dialogue (Phase 1): short, skippable, data-driven lines for PvP banter and campaign
 * moments. Pure lookups over authored data (`data/dialogue/*`); it never touches battle state,
 * so it cannot affect gameplay, replays or server authority. Variant choice is a stable hash of
 * a key the caller provides (PvP match id, encounter + champion), never randomness.
 *
 * Every resolved line carries a stable `key`: a translation catalog can replace the text by key
 * (`translate`), so the Spanish authored text doubles as the fallback.
 */

export type DialogueExpression = 'neutral' | 'confident' | 'angry' | 'amused' | 'serious' | 'wounded';
/** Cosmetic image selection only; optional for older authored/localized dialogue data. */
export type DialoguePortraitVariant = DialogueExpression | 'threatening' | 'defeated';
export const DIALOGUE_EXPRESSIONS: readonly DialogueExpression[] = ['neutral', 'confident', 'angry', 'amused', 'serious', 'wounded'];

export type DialogueSide = 'left' | 'right';

/** Minimal presentation hint: no cinematic scripting, just how long/how loud. */
export interface DialogueHint {
  /** Suggested on-screen time for auto-advancing contexts (PvP). Default: by text length. */
  holdMs?: number;
  emphasis?: 'shout' | 'aside';
}

/** Optional per-line presentation fields shared by every authored line. */
export interface DialogueLineStyle {
  portraitVariant?: DialoguePortraitVariant;
  expression?: DialogueExpression;
  side?: DialogueSide;
  /** Portrait id to use instead of the speaker's own (a hero or unit id). */
  portrait?: string;
  hint?: DialogueHint;
}

/** What the UI renders. `speaker` is a hero or enemy definition id ('narrator' = no portrait). */
export interface DialogueLine extends DialogueLineStyle {
  key: string;
  speaker: string;
  text: string;
  /** PvP only: the seat whose champion speaks (the viewer's own seat goes on the left). */
  seat?: 0 | 1;
}

export type DialogueMoment =
  | 'PVP_INTRO'
  | 'PVP_OUTRO'
  | 'ENCOUNTER_INTRO'
  | 'ENCOUNTER_OUTRO'
  | 'ELITE_INTRO'
  | 'ELITE_DEFEAT'
  | 'BOSS_INTRO'
  | 'BOSS_DEFEAT';

export interface DialogueSequence {
  /** Stable id of this sequence (used to remember it was shown). */
  id: string;
  moment: DialogueMoment;
  lines: DialogueLine[];
}

export type Translate = (key: string) => string | undefined;

// ---------------------------------------------------------------- authored shapes

/** One champion's voice: the bible entry plus the reusable response pools. */
export interface VoiceDef {
  heroId: string;
  traits: readonly string[];
  style: string;
  avoid: readonly string[];
  defaultExpression: DialogueExpression;
  /** Used when a PvP matchup has no authored exchange (future champions). */
  greeting: readonly string[];
  /** Generic post-match lines (winner when no line vs that rival exists; loser). */
  victory: readonly string[];
  defeat: readonly string[];
  /** Main-act responses when an encounter authors no line for this champion. */
  responses: Readonly<Record<ResponsePool, readonly string[]>>;
}

export type ResponsePool = 'encounter' | 'elite' | 'boss' | 'won' | 'eliteWon';

export interface AuthoredPvpLine extends DialogueLineStyle {
  /** Index into the matchup's `pair`. In a mirror, 0 = seat 0's champion. */
  by: 0 | 1;
  text: string;
}

export interface PvpMatchupDef {
  pair: readonly [string, string];
  variants: readonly (readonly AuthoredPvpLine[])[];
}

export interface AuthoredSceneLine extends DialogueLineStyle {
  /** 'HERO' = the run's champion; anything else is an enemy/unit id (or 'narrator'). */
  speaker: string;
  /** Text for any speaker (for HERO: the fallback when `byHero` has no entry). */
  text?: string;
  /** HERO lines: per-champion text. */
  byHero?: Readonly<Partial<Record<string, string>>>;
  /** HERO lines: draw from the champion's response pool when nothing above matches. */
  pool?: ResponsePool;
}

export interface EncounterDialogueDef {
  intro?: readonly AuthoredSceneLine[];
  /** Shown on victory (ENCOUNTER_OUTRO, ELITE_DEFEAT or BOSS_DEFEAT by tier). */
  outro?: readonly AuthoredSceneLine[];
}

export interface DialogueLibrary {
  voices: Readonly<Record<string, VoiceDef>>;
  pvp: readonly PvpMatchupDef[];
  /** Specific winner lines: `${winner}>${loser}` → line. */
  pvpVictory: Readonly<Record<string, string>>;
  /** encounterId → scenes. */
  campaign: Readonly<Record<string, EncounterDialogueDef>>;
}

// ---------------------------------------------------------------- determinism

/** FNV-1a 32-bit: same key → same variant on every client, server and replay. */
export function stableHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const pickStable = <T>(items: readonly T[], key: string): T | undefined =>
  items.length ? items[stableHash(key) % items.length] : undefined;

const localize = (line: DialogueLine, translate?: Translate): DialogueLine => {
  const text = translate?.(line.key);
  // Existing authored acting maps to the image layer; an explicit portrait choice wins.
  return { ...line, portraitVariant: line.portraitVariant ?? line.expression ?? 'neutral', ...(text ? { text } : {}) };
};

// ---------------------------------------------------------------- PvP

export const matchupId = (a: string, b: string): string => [a, b].sort().join('__');

/** The authored matchup for two champions in either order (mirror = same id twice). */
export function findMatchup(lib: DialogueLibrary, a: string, b: string): PvpMatchupDef | undefined {
  const id = matchupId(a, b);
  return lib.pvp.find((m) => matchupId(m.pair[0], m.pair[1]) === id);
}

export interface PvpContext {
  /** Champion of seat 0 and seat 1. */
  heroes: readonly [string, string];
  /** Stable per match (server match id). */
  matchKey: string;
  translate?: Translate;
}

/**
 * Intro banter. Both seats see the same variant and the same speaking order; each line says
 * which seat speaks. Unknown matchup → each known champion's greeting; nothing known → null.
 */
export function pvpIntro(lib: DialogueLibrary, ctx: PvpContext): DialogueSequence | null {
  const [h0, h1] = ctx.heroes;
  const id = matchupId(h0, h1);
  const matchup = findMatchup(lib, h0, h1);
  const variants = matchup?.variants ?? [];
  const index = variants.length ? stableHash(`${ctx.matchKey}|intro|${id}`) % variants.length : -1;
  let lines: DialogueLine[];
  if (matchup && index >= 0) {
    const mirror = h0 === h1;
    lines = variants[index]!.map((l, j) => {
      const speaker = matchup.pair[l.by];
      const seat: 0 | 1 = mirror ? l.by : speaker === h0 ? 0 : 1;
      const { expression, side, portrait, hint } = l;
      return { text: l.text, expression, side, portrait, hint, key: `pvp.intro.${id}.v${index + 1}.${j + 1}`, speaker, seat };
    });
  } else {
    lines = ([h0, h1] as const).flatMap((hero, seat) => {
      const text = pickStable(lib.voices[hero]?.greeting ?? [], `${ctx.matchKey}|greet|${seat}`);
      if (!text) return [];
      const i = lib.voices[hero]!.greeting.indexOf(text);
      return [{ key: `voice.${hero}.greeting.${i + 1}`, speaker: hero, text, seat: seat as 0 | 1 }];
    });
  }
  if (!lines.length) return null;
  return { id: `pvp:${ctx.matchKey}:intro`, moment: 'PVP_INTRO', lines: lines.map((l) => localize(l, ctx.translate)) };
}

/**
 * One winner line (specific vs that rival, else the winner's generic pool), plus one short
 * loser line when the loser has a voice. Draws (winnerSeat < 0) have no outro.
 */
export function pvpOutro(lib: DialogueLibrary, ctx: PvpContext & { winnerSeat: number }): DialogueSequence | null {
  if (ctx.winnerSeat !== 0 && ctx.winnerSeat !== 1) return null;
  const ws = ctx.winnerSeat as 0 | 1;
  const ls = (1 - ws) as 0 | 1;
  const winner = ctx.heroes[ws];
  const loser = ctx.heroes[ls];
  const lines: DialogueLine[] = [];
  const specific = lib.pvpVictory[`${winner}>${loser}`];
  if (specific) lines.push({ key: `pvp.victory.${winner}.vs.${loser}`, speaker: winner, text: specific, seat: ws, expression: 'confident' });
  else {
    const pool = lib.voices[winner]?.victory ?? [];
    const text = pickStable(pool, `${ctx.matchKey}|victory`);
    if (text) lines.push({ key: `voice.${winner}.victory.${pool.indexOf(text) + 1}`, speaker: winner, text, seat: ws, expression: 'confident' });
  }
  const defeat = lib.voices[loser]?.defeat ?? [];
  const lost = pickStable(defeat, `${ctx.matchKey}|defeat`);
  if (lost) lines.push({ key: `voice.${loser}.defeat.${defeat.indexOf(lost) + 1}`, speaker: loser, text: lost, seat: ls, expression: 'wounded' });
  if (!lines.length) return null;
  return { id: `pvp:${ctx.matchKey}:outro`, moment: 'PVP_OUTRO', lines: lines.map((l) => localize(l, ctx.translate)) };
}

// ---------------------------------------------------------------- campaign

export type EncounterTierLike = 'NORMAL' | 'ELITE' | 'BOSS';

export const campaignMoment = (tier: EncounterTierLike, phase: 'intro' | 'outro'): DialogueMoment =>
  tier === 'BOSS'
    ? phase === 'intro' ? 'BOSS_INTRO' : 'BOSS_DEFEAT'
    : tier === 'ELITE'
      ? phase === 'intro' ? 'ELITE_INTRO' : 'ELITE_DEFEAT'
      : phase === 'intro' ? 'ENCOUNTER_INTRO' : 'ENCOUNTER_OUTRO';

export interface CampaignContext {
  encounterId: string;
  tier: EncounterTierLike;
  heroId: string;
  phase: 'intro' | 'outro';
  translate?: Translate;
}

/**
 * The champion-adapted scene for one encounter moment. HERO lines resolve to the champion's own
 * text, else the authored fallback, else its response pool; a HERO line with none of those is
 * dropped. No authored scene → null (the battle simply starts).
 */
export function campaignDialogue(lib: DialogueLibrary, ctx: CampaignContext): DialogueSequence | null {
  const scene = lib.campaign[ctx.encounterId]?.[ctx.phase];
  if (!scene?.length) return null;
  const base = `campaign.${ctx.encounterId}.${ctx.phase}`;
  const lines = scene.flatMap((l, j): DialogueLine[] => {
    const { speaker, text, byHero, pool, ...style } = l;
    const n = j + 1;
    if (speaker !== 'HERO') return text ? [{ ...style, key: `${base}.${n}`, speaker, text }] : [];
    const own = byHero?.[ctx.heroId];
    if (own) return [{ ...style, key: `${base}.${n}.${ctx.heroId}`, speaker: ctx.heroId, text: own }];
    if (text) return [{ ...style, key: `${base}.${n}`, speaker: ctx.heroId, text }];
    const responses = pool ? lib.voices[ctx.heroId]?.responses[pool] ?? [] : [];
    const picked = pickStable(responses, `${ctx.encounterId}|${ctx.phase}|${ctx.heroId}|${n}`);
    return picked
      ? [{ ...style, key: `voice.${ctx.heroId}.${pool}.${responses.indexOf(picked) + 1}`, speaker: ctx.heroId, text: picked }]
      : [];
  });
  if (!lines.length) return null;
  return {
    id: `campaign:${ctx.heroId}:${ctx.encounterId}:${ctx.phase}`,
    moment: campaignMoment(ctx.tier, ctx.phase),
    lines: lines.map((l) => localize(l, ctx.translate)),
  };
}

/** Every line key the library can produce (translation catalogs, duplicate checks). */
export function dialogueKeys(lib: DialogueLibrary): string[] {
  const keys: string[] = [];
  for (const m of lib.pvp) {
    const id = matchupId(m.pair[0], m.pair[1]);
    m.variants.forEach((v, i) => v.forEach((_, j) => keys.push(`pvp.intro.${id}.v${i + 1}.${j + 1}`)));
  }
  for (const k of Object.keys(lib.pvpVictory)) {
    const [w, l] = k.split('>');
    keys.push(`pvp.victory.${w}.vs.${l}`);
  }
  for (const v of Object.values(lib.voices)) {
    v.greeting.forEach((_, i) => keys.push(`voice.${v.heroId}.greeting.${i + 1}`));
    v.victory.forEach((_, i) => keys.push(`voice.${v.heroId}.victory.${i + 1}`));
    v.defeat.forEach((_, i) => keys.push(`voice.${v.heroId}.defeat.${i + 1}`));
    for (const [pool, lines] of Object.entries(v.responses)) lines.forEach((_, i) => keys.push(`voice.${v.heroId}.${pool}.${i + 1}`));
  }
  for (const [enc, def] of Object.entries(lib.campaign))
    for (const phase of ['intro', 'outro'] as const)
      def[phase]?.forEach((l, j) => {
        const base = `campaign.${enc}.${phase}.${j + 1}`;
        if (l.text) keys.push(base);
        for (const hero of Object.keys(l.byHero ?? {})) keys.push(`${base}.${hero}`);
      });
  return keys;
}
