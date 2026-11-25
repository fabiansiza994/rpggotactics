import {DARK_LIGHT_CARDS,DARK_LIGHT_EXPANSIONS} from '../data/dark-light';
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
  /** Editorial definitions can remain addressable without appearing in the public shelf. */
  public?: boolean;
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
/** Permanent benefit defaults apply only after an expansion has published boosters. */
export const DEFAULT_EXPANSION_FREE_PACKS = 3;
export const freePackAllowance = (e: MarketExpansion): number =>
  e.status === "AVAILABLE" && e.pack ? (e.freePacksPerPlayer ?? DEFAULT_EXPANSION_FREE_PACKS) : 0;
/** Stable entitlement identity, independent of pool revision or paid purchase history. */
export const freePackOfferId = (expansionId: string) => `booster_${expansionId}_free`;
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
const standardPack=(revision:string)=>({price:ARCANE_PACK_PRICE,policy:{...ARCANE_PACK_POLICY,revision}});
export const MARKET_EXPANSIONS: readonly MarketExpansion[] = [
 {id:'origins_arcanos',name:'Orígenes Arcanos',description:'Magia arcana, movilidad, protección y recursos tácticos.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'AVAILABLE',poolType:'GENERAL',freePacksPerPlayer:5,cardIds:ORIGINS_CARD_IDS,pack:standardPack('origins-arcane-v5')},
 {id:'thunder_god',name:'Dios del Trueno',description:'Conducción, impactos eléctricos y dominio de la tormenta.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'AVAILABLE',poolType:'GENERAL',cardIds:THUNDER_CARD_IDS,pack:standardPack('thunder-god-v2')},
 {id:'antarctic_magic',name:'Magia Antártica',description:'Control del campo mediante frío, hielo y desplazamientos.',art:'/art/antarctic-market/expansion_hero.jpg',packArt:'/art/antarctic-market/booster.jpg',status:'AVAILABLE',poolType:'GENERAL',cardIds:primaryMarketCardIds('antarctic_magic'),pack:standardPack('antarctic-winter-dominion-v1')},
 {id:'pack_pact',name:'Pacto de la Manada',description:'Invocaciones, vínculos y rituales: domina la arena junto a tus criaturas.',art:'/art/summoner/wolf.webp',status:'AVAILABLE',poolType:'GENERAL',cardIds:primaryMarketCardIds('pack_pact'),pack:standardPack('pack-pact-v1')},
 {id:'warrior_promise',name:'Promesa del Guerrero',description:'Defensa, embestidas y golpes decisivos.',art:'/art/store-cards/heavy_strike.webp',status:'AVAILABLE',poolType:'GENERAL',cardIds:primaryMarketCardIds('warrior_promise'),pack:standardPack('warrior-promise-v1')},
 {id:'reserva_cazador',name:'Cazador',description:'Presa, flechas y trampas: prepara el momento de atacar.',art:'/art/archer-cards/archer_shot.webp',status:'AVAILABLE',poolType:'GENERAL',cardIds:primaryMarketCardIds('reserva_cazador'),pack:standardPack('hunter-v1')},
 ...([{id:DARK_LIGHT_EXPANSIONS.dark,name:'Aliados de la Oscuridad',card:'dark_dark_world'},{id:DARK_LIGHT_EXPANSIONS.light,name:'Camino hacia la Luz',card:'light_light_world'}].map(e=>({id:e.id,name:e.name,description:e.name,art:`/art/dark-light/cards/${e.card}.jpg`,status:'AVAILABLE' as const,poolType:'GENERAL' as const,cardIds:DARK_LIGHT_CARDS.filter(c=>c.expansion===e.id).map(c=>c.id),pack:standardPack(`${e.id}-box-v${e.id===DARK_LIGHT_EXPANSIONS.dark?2:1}`)}))),
 {id:'furia_elemental',name:'Furia Elemental',description:'Fuego e interacción elemental. Una futura colección en preparación.',art:'/art/checkpoint05/cards/fireball.webp',status:'COMING_SOON',cardIds:primaryMarketCardIds('furia_elemental')},
 {id:'reserva_cambiaformas_formas',name:'Cambiaformas',description:'Una futura colección de transformaciones.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'COMING_SOON',public:false,cardIds:primaryMarketCardIds('reserva_cambiaformas_formas')},
 {id:'reserva_cambiaformas_legado',name:'Cambiaformas',description:'Una futura colección de transformaciones.',art:'/art/checkpoint05/cards/arcane_burst.webp',status:'COMING_SOON',public:false,cardIds:primaryMarketCardIds('reserva_cambiaformas_legado')},
 {id:'guerra_psicologica',name:'Guerra Psicológica',description:'Colección futura.',art:'/art/checkpoint05/cards/dispel.webp',status:'COMING_SOON',cardIds:[]},
 {id:'pactos_bestias',name:'Pactos y Bestias',description:'Colección futura.',art:'/art/store-cards/entangle.webp',status:'COMING_SOON',cardIds:[]},
];
