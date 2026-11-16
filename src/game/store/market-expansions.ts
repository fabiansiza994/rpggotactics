import {
  ARCANE_PACK_POLICY,
  ARCANE_PACK_PRICE,
  type BoosterPolicy,
} from "./boosters";
/** Stable collection identities; future sets have no saleable contents or mechanics yet. */
export interface MarketExpansion {
  id: string;
  name: string;
  description: string;
  art: string;
  status: "AVAILABLE" | "COMING_SOON";
  poolType?: "GENERAL" | "CHAMPION" | "THEMATIC";
  championId?: string;
  freePacksPerPlayer?: number;
  highlights?: readonly { cardId: string; caption: string }[];
  synergies?: readonly {
    id: string;
    title: string;
    cardIds: readonly string[];
    reason: string;
  }[];
  cardIds: readonly string[];
  pack?: { policy: BoosterPolicy; price: number };
}
export interface MarketExpansionView extends Omit<MarketExpansion, "pack"> {
  /** Only legal, published, saleable cards for this account/Worker release. */
  packs: {
    offerId: string;
    heroId?: string;
    price: number;
    policy: BoosterPolicy;
  }[];
}
// Frozen first-edition membership. New releases do not silently change an existing pack pool.
export const ORIGINAL_ORIGINS_CARD_IDS: readonly string[] = [
  "alpha_instinct",
  "ancestral_pack",
  "arcane_burst",
  "arcane_burst_ii",
  "arcane_chain",
  "arcane_overload",
  "arcane_pull",
  "arcane_surge",
  "barrier",
  "bastion",
  "bastion_blow",
  "binder_command",
  "binder_strike",
  "binding_ward",
  "blink",
  "blink_ii",
  "bond_sacrifice",
  "brutal_shove",
  "chain_lightning",
  "challenge",
  "conductive_mark",
  "dispel",
  "electric_frenzy",
  "elemental_detonation",
  "entangle",
  "execution",
  "familiar_aegis",
  "fireball",
  "flame_tile",
  "force_push",
  "frost_comet",
  "frost_nova",
  "fulminating_spear",
  "glacial_field",
  "glacial_shell",
  "grapple",
  "guard",
  "guard_breaker",
  "heavy_strike",
  "ice_wall",
  "judgement_hammer",
  "lightning_step",
  "lightning_wall",
  "magic_missile",
  "mark_blood",
  "mark_fang",
  "mark_moon",
  "mark_prey",
  "mirror_step",
  "nurture",
  "pack_call",
  "pack_hymn",
  "pack_oath",
  "pack_tracking",
  "paralyzing_pulse",
  "phase_step",
  "ram",
  "recall_familiar",
  "repulse",
  "riposte",
  "rune_shell",
  "rune_stone",
  "seal_claw",
  "seal_fang",
  "seal_heart",
  "seal_wing",
  "second_wind",
  "shield_bash",
  "silence_seal",
  "spur_familiar",
  "static_field",
  "steady_advance",
  "steel_wall",
  "storm_orb",
  "summon_chicken",
  "summon_fox",
  "summon_raven",
  "summon_turtle",
  "summon_war_drake",
  "summon_wolf",
  "summoner_blink",
  "summoner_dispel",
  "summoner_push",
  "summoner_step",
  "summoner_ward",
  "sweep",
  "tempest_judgment",
  "thunder_discharge",
  "thunder_hammer",
  "titan_step",
  "unleashed_hunt",
  "unstoppable",
  "vanguard_fury",
  "vital_offering",
  "voltaic_armor",
  "warrior_charge",
];
/** Curated historical collection: Mage14, Summoner14, Warrior12. */
export const ORIGINS_CARD_IDS: readonly string[] = [
  "magic_missile",
  "fireball",
  "blink",
  "flame_tile",
  "glacial_field",
  "frost_nova",
  "dispel",
  "arcane_surge",
  "arcane_burst_ii",
  "voltaic_armor",
  "glacial_shell",
  "frost_comet",
  "chain_lightning",
  "elemental_detonation",
  "summon_chicken",
  "summon_fox",
  "entangle",
  "summoner_blink",
  "summoner_dispel",
  "summon_turtle",
  "summon_raven",
  "familiar_aegis",
  "recall_familiar",
  "summon_wolf",
  "ancestral_pack",
  "mark_prey",
  "alpha_instinct",
  "binder_command",
  "heavy_strike",
  "guard",
  "steady_advance",
  "shield_bash",
  "steel_wall",
  "ram",
  "unstoppable",
  "bastion",
  "execution",
  "guard_breaker",
  "judgement_hammer",
  "bastion_blow",
];

export const MARKET_EXPANSIONS: readonly MarketExpansion[] = [
  {
    id: "origins_arcanos",
    poolType: "GENERAL",
    freePacksPerPlayer: 5,
    name: "Orígenes Arcanos",
    description:
      "Los primeros pactos, hechizos y armas de la arena. Cuatro cartas de los campeones incluidos en cada sobre.",
    art: "/art/checkpoint05/cards/arcane_burst.webp",
    status: "AVAILABLE",
    cardIds: ORIGINS_CARD_IDS,
    highlights: [
      { cardId: "frost_nova", caption: "Control cercano" },
      { cardId: "summon_wolf", caption: "Presencia en el tablero" },
      { cardId: "glacial_field", caption: "Control del terreno" },
      { cardId: "entangle", caption: "Enraizamiento" },
      { cardId: "execution", caption: "Remate condicionado" },
    ],
    synergies: [
      {
        id: "ice-control",
        title: "Hielo y control cercano",
        cardIds: ["glacial_field", "frost_nova"],
        reason:
          "Dos herramientas de control del Mago: terreno que encarece la salida y enraizamiento cercano. Sus costes y objetivos se mantienen.",
      },
      {
        id: "pact-control",
        title: "Presencia y enraizamiento",
        cardIds: ["summon_wolf", "entangle"],
        reason:
          "El Invocador puede combinar presencia en el tablero con control del movimiento. Consulta el coste, alcance y condiciones de cada carta.",
      },
    ],
    pack: {
      policy: { ...ARCANE_PACK_POLICY, revision: "origins-40-free-batch-v3" },
      price: ARCANE_PACK_PRICE,
    },
  },
  {
    id: "furia_elemental",
    name: "Furia Elemental",
    description:
      "Fuego, hielo, trueno y naturaleza. Su catálogo estará disponible cuando sus cartas se publiquen.",
    art: "/art/checkpoint05/cards/fireball.webp",
    status: "COMING_SOON",
    cardIds: [],
  },
  {
    id: "guerra_psicologica",
    name: "Guerra Psicológica",
    description:
      "Una futura colección de desgaste, descarte y recuperación. Cartas y mecánicas pendientes de validación.",
    art: "/art/checkpoint05/cards/dispel.webp",
    status: "COMING_SOON",
    cardIds: [],
  },
  {
    id: "pactos_bestias",
    name: "Pactos y Bestias",
    description:
      "Próximos caminos para Invocador y Cambiaformas. Sin contenido definitivo anunciado.",
    art: "/art/store-cards/entangle.webp",
    status: "COMING_SOON",
    cardIds: [],
  },
];
