import type { GameContent } from "../domain/content";
import type { CardDefinition, EffectCondition } from "../domain/cards/card";
import { createBattle } from "../engine/setup";
import { nextRandom } from "../domain/core/rng";
import {
  addCard,
  removeCard,
  validateDeck,
  usableCopies,
  isCardForHero,
  type DeckEntry,
  type DeckRules,
  type OwnedCopies,
} from "./deck-rules";

export const DECK_STYLES = {
  AGGRESSIVE: "Agresivo",
  DEFENSIVE: "Defensivo",
  CONTROL: "Control",
  BALANCED: "Equilibrado",
  COMBOS: "Combos",
} as const;
export type DeckStyle = keyof typeof DECK_STYLES;
export type Axis = "attack" | "defense" | "control" | "mobility" | "resources";
const axes: Axis[] = ["attack", "defense", "control", "mobility", "resources"];
const weights: Record<DeckStyle, number[]> = {
  AGGRESSIVE: [2.3, 0.6, 0.7, 1.4, 0.7],
  DEFENSIVE: [0.7, 2.3, 1.1, 0.7, 1],
  CONTROL: [0.8, 1, 2.3, 1, 1.5],
  BALANCED: [1, 1, 1, 1, 1],
  COMBOS: [1, 1, 1, 1, 1.3],
};
/** Effects/tags, never names or rarity. Same curve, role coverage and package principles as botDeck. */
export function cardRoles(c: CardDefinition): Record<Axis, number> {
  const types = new Set(c.effects.map((e) => e.type));
  const has = (...s: string[]) => s.some((x) => types.has(x as never));
  return {
    attack: Number(c.category === "ATTACK" || has("DAMAGE", "DIRECT_ATTACK")),
    defense: Number(
      c.category === "DEFENSE" ||
        has("HEAL", "SHIELD", "ADD_SHIELD", "CLEANSE", "GAIN_ARMOR"),
    ),
    control: Number(
      c.category === "CONTROL" ||
        c.category === "TERRAIN" ||
        has(
          "APPLY_STATUS",
          "PUSH",
          "SWAP",
          "CREATE_TERRAIN",
          "CREATE_OBSTACLE",
        ),
    ),
    mobility: Number(
      c.category === "MOVEMENT" ||
        has("GAIN_MOVE_POINTS", "TELEPORT", "STEP_CASTER", "TRANSFORM"),
    ),
    resources: Number(
      has("DRAW", "GAIN_ENERGY", "SEARCH_DECK") ||
        !!c.deckSearch ||
        !!c.discardSearch,
    ),
  };
}
const summons = (c: CardDefinition) =>
  c.effects.some((e) => e.type === "SUMMON");
const forms = (cards: CardDefinition[]) =>
  new Set(
    cards.flatMap((c) =>
      c.effects.flatMap((e) =>
        e.type === "TRANSFORM" && e.formId ? [e.formId] : [],
      ),
    ),
  );
function supported(c: CardDefinition, cards: CardDefinition[]) {
  if (
    c.requiredForms &&
    !c.requiredForms.some((f) => f === null || forms(cards).has(f))
  )
    return false;
  if (
    (c.targeting.type === "UNIT" && c.targeting.unitFilter === "SUMMON") ||
    c.effects.some(
      (e) =>
        "bonus" in e &&
        JSON.stringify(e.bonus?.when ?? "").includes("OWN_SUMMON"),
    )
  )
    return cards.some(summons);
  return true;
}
/** Real conditional bonuses only: affinity alone is never described as a combo. */
function conditionalLinks(cards: CardDefinition[]): string[] {
  const links = new Set<string>();
  const match = (condition: EffectCondition, c: CardDefinition): void => {
    if (condition.type === "ANY_OF") {
      condition.conditions.forEach((x) => match(x, c));
      return;
    }
    const producer = cards.find(
      (other) =>
        other.id !== c.id &&
        other.effects.some(
          (e) =>
            (condition.type === "TARGET_HAS_STATUS" &&
              e.type === "APPLY_STATUS" &&
              condition.statuses.includes(e.status)) ||
            (condition.type === "TARGET_ON_TERRAIN" &&
              e.type === "CREATE_TERRAIN" &&
              condition.terrains.includes(e.terrain)) ||
            (["OWN_SUMMON_ALIVE", "OWN_SUMMON_ADJACENT_TO_TARGET"].includes(
              condition.type,
            ) &&
              e.type === "SUMMON"),
        ),
    );
    if (producer)
      links.add(`${producer.name} → bonificación condicional de ${c.name}.`);
  };
  for (const c of cards)
    for (const e of c.effects)
      if ("bonus" in e && e.bonus) {
        const when = e.bonus.when;
        for (const condition of Array.isArray(when) ? when : [when])
          match(condition, c);
      }
  return [...links];
}
export interface DeckAnalysis {
  scores: Record<Axis | "synergy" | "consistency", number>;
  curve: Record<string, number>;
  categories: Record<string, number>;
  combinations: string[];
  strengths: string[];
  weaknesses: string[];
  simulation: {
    samples: number;
    usefulOpening: number;
    expensiveHand: number;
    keyByNextDraw: number;
    seed: number;
    keyCards: string[];
  };
  reasons: Record<string, string>;
  tactics: {
    baseMove: number;
    ranged: number;
    melee: number;
    restricted: number;
  };
}
function expand(deck: readonly DeckEntry[], content: GameContent) {
  return deck.flatMap((e) =>
    Array.from({ length: e.count }, () => content.cards[e.cardId]!),
  );
}
function quality(
  deck: DeckEntry[],
  content: GameContent,
  heroId: string,
  style: DeckStyle,
) {
  const cards = expand(deck, content);
  if (!cards.length) return 0;
  const totals = axes.map((a) =>
    cards.reduce((s, c) => s + cardRoles(c)[a], 0),
  );
  let score = totals.reduce(
    (s, n, i) =>
      s +
      Math.min(n, i === 0 ? 11 : 6) * weights[style][i]! -
      Math.max(0, n - 14),
    0,
  );
  score -=
    Math.abs(
      cards.reduce((s, c) => s + c.cost, 0) / cards.length -
        (style === "AGGRESSIVE" ? 1.6 : 2.1),
    ) * 5;
  score -=
    Math.max(
      0,
      Math.ceil(cards.length * 0.55) - cards.filter((c) => c.cost <= 2).length,
    ) * 2;
  for (const c of cards) {
    if (!supported(c, cards)) score -= 9;
  }
  if (heroId === "summoner")
    score += Math.min(7, cards.filter(summons).length) * 1.8;
  if (heroId === "shapeshifter") score += Math.min(4, forms(cards).size) * 2;
  for (const r of Object.values(content.rituals ?? {}))
    if (r.heroId === heroId) {
      const present = r.pieces.filter((id) => cards.some((c) => c.id === id));
      score +=
        present.length === r.pieces.length
          ? style === "COMBOS"
            ? 10
            : 4
          : -present.length * 2;
    }
  if (style === "COMBOS")
    score += Math.min(4, conditionalLinks(cards).length) * 2;
  for (const c of cards)
    for (const e of c.effects)
      if (e.type === "DAMAGE" || e.type === "SHIELD" || e.type === "HEAL")
        score += (Math.min(6, e.amount) * 0.12) / (1 + c.cost * 0.25);
  if (style === "COMBOS")
    for (const tag of [
      "fire",
      "ice",
      "arcane",
      "thunder",
      "summon-synergy",
      "form",
    ])
      score +=
        Math.min(6, cards.filter((c) => c.tags.includes(tag)).length) * 0.6;
  return score;
}
export function analyzeDeck(
  deck: readonly DeckEntry[],
  content: GameContent,
  heroId: string,
  style: DeckStyle,
  seed = 1,
  samples = 256,
): DeckAnalysis {
  const hero = content.heroes[heroId];
  if (!hero) throw Error("Campeón no disponible");
  const cards = expand(deck, content),
    curve: Record<string, number> = {},
    categories: Record<string, number> = {},
    reasons: Record<string, string> = {};
  const totals = Object.fromEntries(
    axes.map((a) => [a, cards.reduce((s, c) => s + cardRoles(c)[a], 0)]),
  ) as Record<Axis, number>;
  for (const c of cards) {
    curve[String(c.cost)] = (curve[String(c.cost)] ?? 0) + 1;
    categories[c.category] = (categories[c.category] ?? 0) + 1;
    const role = axes.reduce((a, b) =>
      cardRoles(c)[b] * weights[style][axes.indexOf(b)]! >
      cardRoles(c)[a] * weights[style][axes.indexOf(a)]!
        ? b
        : a,
    );
    reasons[c.id] =
      `${({ attack: "Presión y daño", defense: "Supervivencia", control: "Control del tablero", mobility: "Movilidad", resources: "Recursos" } as const)[role]} · ${c.cost} energía${!supported(c, cards) ? " · requiere apoyo específico" : ""}`;
  }
  const combinations: string[] = [];
  combinations.push(...conditionalLinks(cards));
  if (
    cards.some(summons) &&
    cards.some(
      (c) => c.targeting.type === "UNIT" && c.targeting.unitFilter === "SUMMON",
    )
  )
    combinations.push("Invocación + apoyo dirigido a una invocación propia.");
  for (const c of cards.filter((c) => !!c.requiredForms))
    if (supported(c, cards) && !combinations.some((x) => x.includes(c.name)))
      combinations.push(`Transformación compatible → ${c.name}.`);
  for (const r of Object.values(content.rituals ?? {}))
    if (
      r.heroId === heroId &&
      r.pieces.every((id) => cards.some((c) => c.id === id))
    )
      combinations.push(`Ritual completo: ${r.name}.`);
  const samplesBound = Math.max(32, Math.min(512, Math.floor(samples) || 256));
  let useful = 0,
    expensive = 0,
    key = 0;
  const rng = { rngState: seed >>> 0 };
  const preferred = axes[weights[style].indexOf(Math.max(...weights[style]))]!;
  const keyIds = new Set(
    cards
      .filter((c) =>
        style === "COMBOS"
          ? c.ritualPiece ||
            !!c.requiredForms ||
            c.effects.some(
              (e) =>
                e.type === "TRANSFORM" ||
                ("bonus" in e && !!e.bonus) ||
                e.type === "SUMMON",
            )
          : cardRoles(c)[preferred] > 0,
      )
      .map((c) => c.id),
  );
  for (let i = 0; i < samplesBound; i++) {
    const simulationContent = {
      ...content,
      heroes: { ...content.heroes, [heroId]: { ...hero, deck: [...deck] } },
    };
    const { state } = createBattle(
      {
        id: "deck-analysis",
        defaultSeed: 1,
        name: "Análisis local",
        description: "Sin partida real",
        layout: ["...", "...", "..."],
        legend: { ".": { terrain: "NORMAL" } },
        hero: { heroId, pos: { x: 1, y: 1 } },
        structures: [],
        enemies: [],
        waves: [],
        objectives: [{ type: "SURVIVE_ROUNDS", rounds: 3 }],
      },
      simulationContent,
      Math.floor(nextRandom(rng) * 4294967296),
    );
    const hand = state.player.hand.map((x) => content.cards[x.cardId]!);
    const pile = [...state.player.hand, ...state.player.deck];
    const affordable = hand.filter(
      (c) => c.cost <= state.player.energy && supported(c, hand),
    );
    if (affordable.length) useful++;
    if (
      hand.filter((c) => c.cost > Math.floor(hero.maxEnergy / 2)).length >
      hand.length / 2
    )
      expensive++;
    if (
      pile
        .slice(
          0,
          Math.min(hero.startingHandSize + hero.drawPerTurn, hero.maxHandSize),
        )
        .some((x) => keyIds.has(x.cardId))
    )
      key++;
  }
  const pct = (n: number) => Math.round((n / samplesBound) * 1000) / 10;
  const score = (n: number, target: number) =>
    Math.min(100, Math.round((n / target) * 100));
  const scores = {
    ...Object.fromEntries(
      axes.map((a) => [a, score(totals[a], a === "attack" ? 12 : 8)]),
    ),
    synergy: Math.min(100, new Set(combinations).size * 20),
    consistency: pct(useful),
  } as DeckAnalysis["scores"];
  const strengths = axes
    .filter((a) => scores[a] >= 65)
    .map(
      (a) =>
        `${{ attack: "Ataque", defense: "Defensa", control: "Control", mobility: "Movilidad", resources: "Recursos" }[a]} bien representado.`,
    );
  const weaknesses = axes
    .filter((a) => scores[a] < 30)
    .map(
      (a) =>
        `Poca presencia de ${{ attack: "ataque", defense: "defensa", control: "control", mobility: "movilidad", resources: "recursos" }[a]}.`,
    );
  if (cards.some((c) => !supported(c, cards)))
    weaknesses.push("Hay cartas con dependencias sin cubrir.");
  if (expensive / samplesBound > 0.25)
    weaknesses.push("Frecuencia elevada de manos de coste alto.");
  return {
    scores,
    tactics: {
      baseMove: hero.movePoints,
      ranged: cards.filter(
        (c) =>
          c.targeting.type === "LINE" ||
          ("range" in c.targeting &&
            c.targeting.range > 1 &&
            cardRoles(c).attack > 0),
      ).length,
      melee: cards.filter(
        (c) =>
          c.targeting.type === "CHARGE" ||
          ("range" in c.targeting &&
            c.targeting.range <= 1 &&
            cardRoles(c).attack > 0),
      ).length,
      restricted: cards.filter(
        (c) =>
          !!c.requiredForms ||
          !!c.minCasterHp ||
          (c.targeting.type === "UNIT" && c.targeting.unitFilter === "SUMMON"),
      ).length,
    },
    curve,
    categories,
    combinations: combinations.slice(0, 8),
    strengths,
    weaknesses,
    simulation: {
      samples: samplesBound,
      usefulOpening: pct(useful),
      expensiveHand: pct(expensive),
      keyByNextDraw: pct(key),
      seed,
      keyCards: [...keyIds].map((id) => content.cards[id]!.name),
    },
    reasons,
  };
}
export type AutoDeckResult =
  | { ok: true; cards: DeckEntry[]; analysis: DeckAnalysis }
  | { ok: false; available: number; required: number; message: string };
export function generateDeck(
  content: GameContent,
  heroId: string,
  owned: OwnedCopies,
  rules: DeckRules,
  style: DeckStyle,
  seed = 1,
): AutoDeckResult {
  if (!content.heroes[heroId])
    return {
      ok: false,
      available: 0,
      required: rules.requiredSize,
      message: "Campeón no disponible.",
    };
  const rng = { rngState: seed >>> 0 };
  const pool = Object.values(content.cards)
    .filter(
      (c) =>
        isCardForHero(c, heroId) &&
        usableCopies(c.id, owned, content, rules) > 0 &&
        !c.tags.some((t) =>
          ["qa", "experimental", "prototype"].includes(t.toLowerCase()),
        ) &&
        (!c.expansion ||
          content.releasedExpansions?.includes(c.expansion) ||
          content.heroes[heroId]!.starterCollection?.some(
            (e) => e.cardId === c.id,
          )),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const noise = new Map(pool.map((c) => [c.id, nextRandom(rng) * 0.5]));
  let deck: DeckEntry[] = [];
  const legal = (d: DeckEntry[]) =>
    validateDeck(d, heroId, owned, content, rules).every(
      (e) => e.code === "DECK_INCOMPLETE",
    );
  // A ritual is a package: never prefer an isolated seal just for rarity.
  if (style === "COMBOS") {
    const ritual = Object.values(content.rituals ?? {})
      .filter(
        (r) =>
          r.heroId === heroId &&
          r.pieces.every((id) => pool.some((c) => c.id === id)),
      )
      .sort(
        (a, b) => a.pieces.length - b.pieces.length || a.id.localeCompare(b.id),
      )[0];
    if (ritual) {
      const trial = ritual.pieces.map((cardId) => ({ cardId, count: 1 }));
      if (legal(trial)) deck = trial;
    }
  }
  for (
    let i = deck.reduce((s, e) => s + e.count, 0);
    i < rules.requiredSize;
    i++
  ) {
    let best = -Infinity,
      next: DeckEntry[] | undefined;
    for (const c of pool) {
      const trial = addCard(deck, c.id);
      if (!legal(trial)) continue;
      const q = quality(trial, content, heroId, style) + noise.get(c.id)!;
      if (q > best) {
        best = q;
        next = trial;
      }
    }
    if (!next) break;
    deck = next;
  }
  const count = deck.reduce((s, e) => s + e.count, 0);
  if (count !== rules.requiredSize)
    return {
      ok: false,
      available: count,
      required: rules.requiredSize,
      message: `Puedes reunir ${count}/${rules.requiredSize} cartas legales. Faltan ${rules.requiredSize - count} copias compatibles dentro de los límites. Conserva tu mazo actual; revisa las cartas disponibles en Colección.`,
    };
  for (let pass = 0; pass < 2; pass++) {
    let best = quality(deck, content, heroId, style),
      next: DeckEntry[] | undefined;
    for (const from of deck)
      for (const c of pool) {
        if (c.id === from.cardId) continue;
        const trial = addCard(removeCard(deck, from.cardId), c.id);
        if (!legal(trial)) continue;
        const q = quality(trial, content, heroId, style);
        if (q > best + 0.001) {
          best = q;
          next = trial;
        }
      }
    if (!next) break;
    deck = next;
  }
  if (validateDeck(deck, heroId, owned, content, rules).length)
    throw Error("Propuesta inválida");
  const analysis = analyzeDeck(deck, content, heroId, style, seed);
  if (
    pool.reduce((n, c) => n + usableCopies(c.id, owned, content, rules), 0) <=
    rules.requiredSize
  )
    analysis.weaknesses.push(
      "Tu colección deja pocas variantes legales: distintos estilos pueden producir el mismo mazo.",
    );
  return { ok: true, cards: deck, analysis };
}
