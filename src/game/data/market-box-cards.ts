import type {
  CardDefinition,
  EffectDef,
  TargetingDef,
  DeckSearchCondition,
} from "../domain/cards/card";
const self: TargetingDef = { type: "SELF" };
const card = (
  id: string,
  name: string,
  heroId: string,
  cost: number,
  targeting: TargetingDef,
  effects: EffectDef[],
  rulesText: string,
  element: "ARCANE" | "ICE" | "THUNDER" | "FORCE" = "ARCANE",
): CardDefinition => ({
  id,
  name,
  heroId,
  cost,
  rarity: "ULTRA",
  maxCopies: 2,
  commercialUltra: true,
  category: (id === "eternal_winter_heart" || effects.some((fx) => fx.type === "DAMAGE")) ? "ATTACK" : "UTILITY",
  tags: ["commercial-box", element.toLowerCase()],
  targeting,
  effects,
  rulesText,
  presentation: { visualKey: id, element, castAnimation: "cast" },
});
/** New commercial Ultras reuse bounded, authoritative effects. No existing reward card is reclassified. */
export const MARKET_BOX_ULTRAS: CardDefinition[] = [
  card(
    "arcane_confluence",
    "Confluencia Arcana",
    "mage",
    3,
    self,
    [
      { type: "DRAW", count: 1 },
      { type: "SHIELD", amount: 3, to: "CASTER" },
    ],
    "Roba 1 carta y gana 3 de escudo hasta tu próximo turno. No concede energía ni busca otras cartas.",
  ),
  card(
    "arcane_balance",
    "Equilibrio del Nexo",
    "mage",
    3,
    self,
    [
      { type: "CLEANSE", to: "CASTER" },
      { type: "HEAL", amount: 2, to: "CASTER" },
      { type: "SHIELD", amount: 2, to: "CASTER" },
    ],
    "Limpia tus estados negativos, cura 2 HP y gana 2 de escudo hasta tu próximo turno. No supera tu vida máxima.",
  ),
  card(
    "storm_crown",
    "Corona de la Tempestad",
    "mage",
    3,
    { type: "UNIT", range: 4, unitFilter: "ENEMY", requiresLineOfSight: true },
    [
      { type: "DAMAGE", amount: 3, damageType: "ARCANE", to: "ENEMIES" },
      { type: "APPLY_STATUS", status: "SLOWED", duration: 1, to: "ENEMIES" },
    ],
    "Inflige 3 de daño mágico eléctrico a un enemigo con visión a distancia 4 y lo ralentiza durante su próximo turno. No impide atacar.",
    "THUNDER",
  ),
  card(
    "storm_conduit",
    "Conducto de los Cielos",
    "mage",
    3,
    self,
    [
      { type: "SHIELD", amount: 4, to: "CASTER" },
      { type: "DRAW", count: 1 },
    ],
    "Gana 4 de escudo hasta tu próximo turno y roba 1 carta. Es una carta eléctrica; no concede activaciones adicionales.",
    "THUNDER",
  ),
  card(
    "eternal_winter_heart",
    "Corazón del Invierno Eterno",
    "mage",
    3,
    { type: "TILE", range: 3, tileFilter: "NOT_BLOCKED", requiresLineOfSight: true, area: {shape: "CROSS", radius: 1} },
    [{ type: "PLACE_WINTER_HEART" }],
    "Ritual de 3 turnos propios: reúne un fragmento por turno. En el tercero cae: 5 de daño al centro y 1 a enemigos ortogonales. Sin Mundo Gélido fija una casilla; con Mundo Gélido al lanzar sigue a un enemigo. Si muere, conserva su última casilla.",
    "ICE",
  ),
  card(
    "pack_concord",
    "Concordia de la Manada",
    "summoner",
    3,
    { type: "SELF", area: { shape: "CROSS", radius: 2 } },
    [
      { type: "HEAL", amount: 2, to: "SUMMONS" },
      { type: "SHIELD", amount: 3, to: "SUMMONS" },
    ],
    "Tus invocaciones en la cruz de radio 2 se curan 2 HP y ganan 3 de escudo hasta tu próximo turno. No invoca, aumenta capacidad ni adelanta su activación.",
  ),
  card(
    "oath_of_steel",
    "Juramento de Acero",
    "warrior",
    3,
    self,
    [
      { type: "SHIELD", amount: 4, to: "CASTER" },
      { type: "GAIN_MOMENTUM", amount: 1 },
    ],
    "Gana 4 de Guardia hasta tu próximo turno y 1 Impulso, respetando su límite. No concede invulnerabilidad ni ataques adicionales.",
    "FORCE",
  ),
  card(
    "hunters_patience",
    "Paciencia del Depredador",
    "archer",
    2,
    self,
    [
      { type: "GAIN_FOCUS", amount: 1 },
      { type: "SHIELD", amount: 2, to: "CASTER" },
    ],
    "Gana 1 Concentración, respetando su límite, y 2 de escudo hasta tu próximo turno. No marca ni dispara automáticamente.",
    "FORCE",
  ),
];
const searchConditions: Record<
  string,
  { condition: DeckSearchCondition; text: string }
> = {
  arcane_resonance: {
    condition: "CASTER_DAMAGED",
    text: "Requiere haber perdido HP. ",
  },
  tempest_call: {
    condition: "THUNDER_IN_HAND",
    text: "Requiere otra carta eléctrica distinta en tu mano. ",
  },
  pact_link: {
    condition: "OWN_SUMMON",
    text: "Requiere una invocación tuya viva en el campo. ",
  },
  warriors_oath: {
    condition: "GUARD",
    text: "Requiere al menos 1 de Guardia. ",
  },
  hunter_trail: {
    condition: "NO_ADJACENT_ENEMY",
    text: "Requiere no tener enemigos adyacentes. ",
  },
};
export const MARKET_SEARCHERS: CardDefinition[] = [
  [
    "arcane_resonance",
    "Resonancia Arcana",
    "mage",
    "arcane_inversion",
    "Inversión Arcana",
    2,
  ],
  [
    "tempest_call",
    "Llamado de la Tempestad",
    "mage",
    "thunder_incarnation",
    "Encarnación del Dios del Trueno",
    2,
  ],
  [
    "winter_call",
    "Llamado del Invierno",
    "mage",
    "absolute_zero",
    "Mundo Gélido",
    1,
  ],
  [
    "pact_link",
    "Vínculo del Pacto",
    "summoner",
    "mark_prey",
    "Marcar Presa",
    1,
  ],
  [
    "warriors_oath",
    "Juramento del Guerrero",
    "warrior",
    "bastion",
    "Bastión",
    1,
  ],
  [
    "hunter_trail",
    "Rastro del Cazador",
    "archer",
    "hunters_eye",
    "Ojo del Cazador",
    1,
  ],
].map(([id, name, heroId, targetId, targetName, cost]) => ({
  id: id as string,
  name: name as string,
  heroId: heroId as string,
  cost: cost as number,
  rarity: "RARE",
  category: "UTILITY",
  tags: [
    "commercial-box",
    "search",
    ...(id === "tempest_call" ? ["thunder"] : []),
  ],
  deckSearch: {
    targetCardId: targetId as string,
    maxUsesPerTurn: 1,
    lockTargetThisTurn: true,
    conditions: searchConditions[id as string]
      ? [searchConditions[id as string]!.condition]
      : [],
  },
  targeting: self,
  effects: [],
  rulesText: `${searchConditions[id as string]?.text ?? ""}Busca 1 «${targetName}» en tu mazo y agrégala a tu mano. No puedes activar ninguna copia de «${targetName}» durante este turno. Máximo una activación de ${name} por turno.`,
  presentation: {
    visualKey: id as string,
    element:
      id === "winter_call"
        ? "ICE"
        : id === "tempest_call"
          ? "THUNDER"
          : "ARCANE",
    castAnimation: "cast",
  },
}));
export const MARKET_BOX_MEMBERSHIP: Record<string, string[]> = {
  origins_arcanos: ["arcane_confluence", "arcane_balance", "arcane_resonance"],
  thunder_god: ["storm_crown", "storm_conduit", "tempest_call"],
  antarctic_magic: ["eternal_winter_heart", "winter_call"],
  pack_pact: ["pack_concord", "pact_link"],
  warrior_promise: ["oath_of_steel", "warriors_oath"],
  reserva_cazador: ["hunters_patience", "hunter_trail"],
};
