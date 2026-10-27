import { archerPresentationEnabled } from '../archerRelease';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import type { GameContent, HeroDef } from '../../game';
import { CHARACTER_PAINTINGS } from './paintedAssets';
import { unitVisualId } from './visualIdentity';

/**
 * Champion Select presentation. Narrative and playstyle ratings only: every number shown
 * (HP, energy, hand, summon capacity, summon stats) is read from the hero / summon
 * definitions at render time, never copied here. Ratings are descriptive UX guidance (1–5),
 * not combat stats.
 */
export type RatingKey = 'DAMAGE' | 'CONTROL' | 'MOBILITY' | 'DEFENSE' | 'COMPLEXITY';
export type ChampionAvailability = 'AVAILABLE' | 'LOCKED';

export const RATING_LABEL: Record<RatingKey, string> = {
  DAMAGE: 'Daño',
  CONTROL: 'Control',
  MOBILITY: 'Movilidad',
  DEFENSE: 'Defensa',
  COMPLEXITY: 'Complejidad',
};
export const RATING_ORDER: readonly RatingKey[] = ['DAMAGE', 'CONTROL', 'MOBILITY', 'DEFENSE', 'COMPLEXITY'];

export interface ChampionMechanic {
  title: string;
  summary: string;
  /** Rule facts derived from the authoritative definitions. */
  facts(hero: HeroDef, content: GameContent): string[];
}

export type ChampionArtMode = 'cutout' | 'framedArtwork';
export interface ChampionPresentation {
  heroArtMode: ChampionArtMode;
  /** Focal position for framed portraits; never inferred from file names or alpha at runtime. */
  heroArtPosition?: string;
  accessLabel?: 'GRATIS';
  /** Same id as the HeroDef: the champion IS the hero; this only adds presentation. */
  heroId: string;
  role: string;
  /** Four-word identity shown where the player picks or unlocks a champion (none is "the best"). */
  identity: readonly string[];
  tagline: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  ratings: Record<RatingKey, number>;
  mechanic: ChampionMechanic;
  /**
   * Content-level availability (LOCKED = not playable by anyone yet). Per-player ownership is
   * separate: see champion-unlocks.ts and `championUsableIn`.
   */
  availability: ChampionAvailability;
  /** The current art is borrowed from another unit and will be replaced. */
  temporaryArt?: boolean;
}

/** Display order of the champion list. */
export const CHAMPIONS: readonly ChampionPresentation[] = [
  {
    heroId: 'mage', heroArtMode: 'cutout',
    identity: ['hechizos', 'control', 'movilidad', 'terreno'],
    role: 'Daño arcano · control',
    tagline: 'Lanzador directo con presión a distancia.',
    description:
      'Domina el campo con hechizos: proyectiles, áreas, muros de hielo y teletransporte. Cada turno elige entre golpear, controlar o reposicionarse.',
    strengths: ['Daño directo fuerte a distancia', 'Hechizos versátiles y de área', 'Se reposiciona con cartas (Blink, Phase Step)'],
    weaknesses: ['Frágil si los enemigos llegan a melé', 'Depende de la energía del turno', 'Menos presencia en el tablero que el Invocador'],
    ratings: { DAMAGE: 4, CONTROL: 4, MOBILITY: 4, DEFENSE: 2, COMPLEXITY: 3 },
    availability: 'AVAILABLE',
    mechanic: {
      title: 'Arsenal arcano',
      summary: 'Todo su poder está en las cartas: cada hechizo actúa al instante sobre el tablero.',
      facts: (hero) => [
        `${hero.maxEnergy} de energía por turno para lanzar hechizos`,
        `Mano inicial de ${hero.startingHandSize}, máximo ${hero.maxHandSize}`,
        'Terreno y obstáculos propios: fuego, hielo y muros',
      ],
    },
  },
  {
    heroId: 'summoner', heroArtMode: 'cutout',
    identity: ['criaturas', 'posicionamiento', 'apoyo', 'control de espacio'],
    role: 'Invocaciones · control del tablero',
    tagline: 'Reparte su poder entre criaturas en el campo.',
    description:
      'Invoca criaturas que actúan solas, ocupan casillas y presionan al enemigo mientras el Invocador se mantiene a salvo y las cuida.',
    strengths: ['Presencia en el tablero con varias unidades', 'Bloquea pasillos y protege objetivos', 'Las criaturas recogen objetos por él'],
    weaknesses: ['Poco daño directo propio', 'Mano y energía más cortas', 'La capacidad limita cuántas criaturas puedes mantener'],
    ratings: { DAMAGE: 2, CONTROL: 5, MOBILITY: 3, DEFENSE: 3, COMPLEXITY: 4 },
    availability: 'AVAILABLE',
    temporaryArt: false,
    mechanic: {
      title: 'Capacidad de invocación',
      summary: 'Cada criatura ocupa capacidad. Cuando una cae o es retirada, libera su espacio para invocar otra.',
      facts: (hero, content) => {
        const facts = [`Capacidad de invocación: ${hero.summonCapacity ?? 0}`];
        for (const s of Object.values(content.summons ?? {})) {
          facts.push(
            `${s.name}: ${s.maxHp} de vida, ${s.damage} de daño, mueve ${s.moveRange}, ocupa ${s.capacityCost}, sin caducidad por rondas`,
          );
        }
        facts.push('Las criaturas actúan desde la ronda siguiente; las salidas requieren al héroe');
        return facts;
      },
    },
  },
  {
    heroId: 'warrior', heroArtMode: 'cutout',
    identity: ['melee', 'guardia', 'impulso', 'presión física'],
    role: 'Melé · aguante · control del espacio',
    tagline: 'Se planta, aguanta la presión y castiga a quien se acerca mal.',
    description:
      'Gana terreno a pie o con cargas, absorbe golpes con su Guardia y convierte cada choque en Impulso para golpes más duros, empujones y contraataques.',
    strengths: ['Mucho daño a melé (la cobertura no le protege al rival)', 'Aguanta: más vida y Guardia', 'Empuja enemigos fuera de nodos, hacia peligros y contra muros'],
    weaknesses: ['Sin alcance: hay que llegar primero', 'Los campeones a distancia pueden alejarse y enraizarlo', 'Sus defensas exigen buen momento: pierde movimiento al plantarse'],
    ratings: { DAMAGE: 4, CONTROL: 3, MOBILITY: 3, DEFENSE: 5, COMPLEXITY: 2 },
    availability: 'AVAILABLE',
    temporaryArt: false,
    mechanic: {
      title: 'Impulso',
      summary:
        'Gana Impulso al trabarse en melé (una vez por turno) y al recibir golpes enemigos. Algunas cartas lo consumen solas para un efecto mayor.',
      facts: (hero) => [
        `Impulso máximo ${hero.momentum?.max ?? 0}: +1 al acabar un movimiento junto a un enemigo (1 vez por turno), +1 por golpe enemigo recibido`,
        'Guardia = escudo hasta tu próximo turno; Contraataque responde al primer golpe adyacente',
        `${hero.maxEnergy} de energía; ${hero.maxHp} de vida; sin alcance a distancia`,
      ],
    },
  },
];

const QA_CHAMPION: ChampionPresentation = {
 heroId:'shapeshifter', heroArtMode:'framedArtwork', heroArtPosition:'50% 18%', role:'Transformaciones · Oso y Minotauro', identity:['ancestral','Oso','Minotauro','adaptación'],
 tagline:'Un campeón, formas decididas por tu mazo.', description:'Empieza humanoide. Adopta Oso o Minotauro mediante cartas y construye tu propio estilo. Transformarse no cura. PvP pendiente de validación.',
 strengths:['Oso defensivo','Minotauro con carga y área'], weaknesses:['Cartas condicionadas por forma','Balance provisional'],
 ratings:{DAMAGE:3,CONTROL:3,MOBILITY:3,DEFENSE:4,COMPLEXITY:4}, availability:'AVAILABLE',
 mechanic:{title:'Formas ancestrales', summary:'Una forma activa hasta cambiar o terminar el combate.',
 facts:(hero)=>[`${hero.maxHp} HP · ${hero.maxEnergy} energía`, 'Oso +2 armadura · Minotauro +1', 'Sin Furia; apertura con transformación si el mazo incluye alguna']},
};
const ARCHER: ChampionPresentation = {
  heroId: 'archer', heroArtMode:'framedArtwork', heroArtPosition:'50% 18%', accessLabel:'GRATIS', role: 'Presa · Concentración · Distancia Óptima',
  identity: ['Presa', 'Concentración', 'Distancia Óptima', 'precisión'],
  tagline: 'Marca una Presa y domina la distancia.',
  description: 'Marca una Presa, domina la distancia y acumula Concentración para ejecutar disparos devastadores.',
  strengths: ['Presión a distancia', 'Trampas y reposicionamiento', 'Disparos potenciados con preparación'],
  weaknesses: ['Vulnerable en melé', 'Necesita línea de visión', 'Poca defensa propia'],
  ratings: { DAMAGE: 4, CONTROL: 3, MOBILITY: 4, DEFENSE: 2, COMPLEXITY: 4 }, availability: 'AVAILABLE',
  mechanic: { title: 'Cacería precisa', summary: 'Presa · Concentración · Distancia Óptima',
    facts: (hero) => [`${hero.maxHp} de vida · ${hero.maxEnergy} energía · ${hero.movePoints} movimiento`,
      `Concentración máxima: ${hero.focus?.max ?? 0}`,
      `Distancia Óptima: ${hero.focus?.optimalRange.min ?? 0}–${hero.focus?.optimalRange.max ?? 0} casillas`] },
};
const roster = () => [...CHAMPIONS, ...(shapeshifterPresentationEnabled ? [QA_CHAMPION] : []), ...(archerPresentationEnabled ? [ARCHER] : [])];

/**
 * Champions whose hero exists in the content, in display order. `released` hides champions
 * behind a release switch (the QA-only Warrior, see campaignRelease.ts).
 */
export const championsIn = (content: GameContent, released: (heroId: string) => boolean = () => true): ChampionPresentation[] =>
  roster().filter((c) => content.heroes[c.heroId] && released(c.heroId));

export const championOf = (heroId: string): ChampionPresentation | undefined => roster().find((c) => c.heroId === heroId);

/** The champion's painting (or the art it currently borrows). */
export const championPortrait = (heroId: string): string | undefined => heroId === 'archer' ? CHARACTER_PAINTINGS.archer : CHARACTER_PAINTINGS[unitVisualId(heroId)];

/** Unknown artwork defaults to the safe framed treatment, without exposing unreleased champions. */
export const championArtMode = (heroId: string): ChampionArtMode => championOf(heroId)?.heroArtMode ?? 'framedArtwork';
/** A single mutually exclusive badge; an active free champion must never render two badges. */
export function championCardStatus({active,locked,free=false}:{active:boolean;locked:boolean;free?:boolean}): 'ACTIVO'|'GRATIS'|'DESBLOQUEADO'|'BLOQUEADO' {
  return locked?'BLOQUEADO':active?'ACTIVO':free?'GRATIS':'DESBLOQUEADO';
}
