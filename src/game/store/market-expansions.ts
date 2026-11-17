import {primaryMarketCardIds} from './market-primary';
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
  packArt?:string;
  status: "AVAILABLE" | "CATALOG_ONLY" | "COMING_SOON";
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
export const LEGACY_ORIGINS_CARD_IDS: readonly string[] = [
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

export const ORIGINS_CARD_IDS=primaryMarketCardIds('origins_arcanos');
export const THUNDER_CARD_IDS=primaryMarketCardIds('thunder_god');
export const MARKET_EXPANSIONS: readonly MarketExpansion[] = [
 {id:'origins_arcanos',name:'Orígenes Arcanos',description:'Magia arcana fundamental: movilidad, teletransporte, barreras, disipación y control.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'AVAILABLE',poolType:'GENERAL',freePacksPerPlayer:5,cardIds:ORIGINS_CARD_IDS,pack:{price:ARCANE_PACK_PRICE,policy:{...ARCANE_PACK_POLICY,revision:'origins-arcane-v4'}}},
 {id:'thunder_god',name:'Dios del Trueno',description:'Conducción, impactos eléctricos y dominio de la tormenta. Avatar de la Tormenta conserva su fuente exclusiva.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'AVAILABLE',poolType:'GENERAL',cardIds:THUNDER_CARD_IDS,pack:{price:ARCANE_PACK_PRICE,policy:{...ARCANE_PACK_POLICY,revision:'thunder-god-v1'}}},
 {id:"antarctic_magic",name:"Magia Antártica",description:'Control del campo mediante frío, hielo y desplazamientos. Flecha de Hielo conserva su fuente exclusiva.',art:'/art/antarctic-market/expansion_hero.jpg',packArt:'/art/antarctic-market/booster.jpg',status:'AVAILABLE',poolType:'GENERAL',cardIds:primaryMarketCardIds("antarctic_magic"),pack:{price:ARCANE_PACK_PRICE,policy:{...ARCANE_PACK_POLICY,revision:'antarctic-magic-v2-world'}}},
 {id:"pack_pact",name:"Pacto de la Manada",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("pack_pact")},
 {id:"pendiente_hibridos_elementales",name:"Pendiente: Híbridos elementales",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("pendiente_hibridos_elementales")},
 {id:"pendiente_sabueso_de_ceniza",name:"Pendiente: Sabueso de Ceniza",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("pendiente_sabueso_de_ceniza")},
 {id:"reserva_cambiaformas_formas",name:"Reserva: Cambiaformas — Formas",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_cambiaformas_formas")},
 {id:"reserva_cambiaformas_legado",name:"Reserva: Cambiaformas — Legado",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_cambiaformas_legado")},
 {id:"reserva_cazador",name:"Reserva: Cazador",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_cazador")},
 {id:"reserva_dragones",name:"Reserva: Dragones",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_dragones")},
 {id:"reserva_fuego",name:"Reserva: Fuego",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_fuego")},
 {id:"reserva_naturaleza",name:"Reserva: Naturaleza",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_naturaleza")},
 {id:"reserva_recursos_tacticos",name:"Reserva: Recursos tácticos",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_recursos_tacticos")},
 {id:"reserva_rituales_y_constructos",name:"Reserva: Rituales y constructos",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_rituales_y_constructos")},
 {id:"reserva_umbral",name:"Reserva: Umbral",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("reserva_umbral")},
 {id:"warrior_promise",name:"Promesa del Guerrero",description:'Catálogo temático. Sin sobre disponible; las fuentes exclusivas se conservan.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'CATALOG_ONLY',cardIds:primaryMarketCardIds("warrior_promise")},
 {id:'furia_elemental',name:'Furia Elemental',description:'Colección futura; sin sobre disponible.',art:'/art/checkpoint05/cards/fireball.webp',status:'COMING_SOON',cardIds:[]},
 {id:'guerra_psicologica',name:'Guerra Psicológica',description:'Colección futura; sin sobre disponible.',art:'/art/checkpoint05/cards/dispel.webp',status:'COMING_SOON',cardIds:[]},
 {id:'pactos_bestias',name:'Pactos y Bestias',description:'Colección futura; sin sobre disponible.',art:'/art/store-cards/entangle.webp',status:'COMING_SOON',cardIds:[]},
];
