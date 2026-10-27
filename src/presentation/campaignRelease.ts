import { archerPresentationEnabled } from './archerRelease';
import { shapeshifterBuildEnabled } from './shapeshifterRelease';
import { ASCENT_CAMPAIGN } from './qa/shapeshifter/campaigns';
import { shapeshifterQaEnabled } from './qa/shapeshifter/access';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from './qa/shapeshifter/runtime';
import { FREE_CATALOG_EXPANSION } from '../game/data/free-catalog';
import { SHOWCASE_STORE_EXPANSION, ARSENAL_EXPANSION, defaultCampaignHero, grantCard, PRIMORDIAL_CARDS, PRIMORDIAL_EXPANSION, RITUAL_EXPANSION, TACTICAL_EXPANSION, type CardDefinition, type GameContent, type PlayerProfile } from '../game';

/**
 * Which champions the player may pick for the campaign. The core supports every champion in
 * `ASCENT_CAMPAIGN.heroIds`; the Summoner stays hidden until its balance pass is signed off.
 * Enable it for QA builds with VITE_SUMMONER_CAMPAIGN=1 (the server has its own switch).
 */
export function summonerCampaignEnabled(qaAuthorized = false): boolean {
  return import.meta.env.VITE_SUMMONER_CAMPAIGN === '1' && (import.meta.env.VITE_SUMMONER_CAMPAIGN_QA !== '1' || qaAuthorized);
}

/**
 * The Warrior is QA-only until its gameplay and final art pass review. Guest/offline builds
 * show it with VITE_WARRIOR_ENABLED=1; signed-in players only when the server allows it
 * (WARRIOR_ENABLED, or WARRIOR_QA for the QA accounts), since the server enforces it anyway.
 */
export const warriorBuildEnabled = (): boolean => import.meta.env.VITE_WARRIOR_ENABLED === '1';

export const championReleased = (heroId: string, warriorReleased: boolean): boolean =>
  heroId === 'archer' ? archerPresentationEnabled : heroId === 'shapeshifter' ? (shapeshifterQaEnabled || shapeshifterBuildEnabled()) : heroId !== 'warrior' || warriorReleased;

/**
 * The Archer campaign «Sendero del Cazador» is hidden until its visual pass. Guest builds list it
 * with VITE_ARCHER_CAMPAIGN=1 (its battles still need an account, see guest-gate); signed-in
 * players follow the server (ARCHER_CAMPAIGN_ENABLED, or ARCHER_CAMPAIGN_QA for the QA accounts).
 */
export const archerCampaignBuildEnabled = (): boolean => import.meta.env.VITE_ARCHER_CAMPAIGN === '1';

export function campaignHeroes(qaAuthorized = false, warriorReleased = warriorBuildEnabled(), archerCampaign = archerCampaignBuildEnabled()): string[] {
  // Story availability is checked per world; it never blocks a champion's main acts.
  void archerCampaign; // retained argument for older callers
  return ASCENT_CAMPAIGN.heroIds.filter(
    (heroId) => (heroId !== 'summoner' || summonerCampaignEnabled(qaAuthorized)) && championReleased(heroId, warriorReleased),
  );
}

/** The champion to show for the campaign: the requested one when released, else the default. */
export function releasedCampaignHero(heroId: string | null | undefined): string {
  return heroId && campaignHeroes().includes(heroId) ? heroId : defaultCampaignHero(ASCENT_CAMPAIGN);
}

/**
 * Dev/QA bypass (dev server only, never a production build): a brand-new guest gets the open
 * roster of a legacy profile and no guest encounter cap. Accounts are unaffected (the server
 * decides for them). Used by e2e suites that test other features: `vite --mode e2e`.
 */
export const openProgressionBuild = (): boolean => import.meta.env.DEV && import.meta.env.VITE_OPEN_PROGRESSION === '1';

/**
 * Summoner rituals + advanced summons are QA-only: guest builds add the set to reward drops with
 * VITE_SUMMONER_RITUALS=1 (`vite --mode ritualsqa`). Accounts follow the server switch
 * (SUMMONER_RITUALS_ENABLED). Battles never depend on it.
 */
export const ritualsBuildEnabled = (): boolean => import.meta.env.VITE_SUMMONER_RITUALS === '1';

/**
 * «Recursos tácticos» (neutral cards + Summoner bond cards) is QA-only too: guest builds add it to
 * reward drops with VITE_TACTICAL_CARDS=1 (`vite --mode tacticalqa`). Accounts follow TACTICAL_CARDS_ENABLED on the server. Battles never depend on it.
 */
export const tacticalBuildEnabled = (): boolean => import.meta.env.VITE_TACTICAL_CARDS === '1';

/**
 * «Arsenal I» (12 cards, qa/card-expansion-01) is QA-only the same way: guest builds add it to
 * reward drops with VITE_ARSENAL_CARDS=1 (`vite --mode arsenalqa`). Accounts follow ARSENAL_CARDS_ENABLED on the server.
 */
export const arsenalBuildEnabled = (): boolean => import.meta.env.VITE_ARSENAL_CARDS === '1';

/**
 * Dragón Primordial seals (set summoner_primordial) are unreleased: guest builds add them to reward
 * drops with VITE_PRIMORDIAL_DRAGON=1. Accounts follow PRIMORDIAL_DRAGON_ENABLED on the server.
 */
export const primordialBuildEnabled = (): boolean => import.meta.env.VITE_PRIMORDIAL_DRAGON === '1';

/**
 * Dev/QA only (`vite --mode primordialqa`, never a production build): the guest owns 2 copies of
 * every seal so the ritual can be tested without farming drops.
 */
export const primordialQaBuild = (): boolean => import.meta.env.DEV && import.meta.env.VITE_PRIMORDIAL_DRAGON_QA === '1';

export function withPrimordialQaSeals(profile: PlayerProfile): PlayerProfile {
  if (!primordialQaBuild()) return profile;
  let out = profile;
  for (const card of PRIMORDIAL_CARDS)
    for (let n = out.heroes.summoner?.collection[card.id]?.copies ?? 0; n < (card.maxCopies ?? 1); n++) {
      const granted = grantCard(out, 'summoner', card.id, DEFAULT_CONTENT);
      if (granted.ok) out = granted.profile;
    }
  return out;
}

/**
 * Collection visibility (Deck Builder): an unreleased Dragón Primordial seal is hidden unless the
 * player already owns it or the build releases the set. Same idea as World 2's reward cards.
 */
export const primordialCardVisible = (card: CardDefinition, owned: number): boolean =>
  card.expansion !== PRIMORDIAL_EXPANSION || owned > 0 || primordialBuildEnabled() || primordialQaBuild();

/**
 * Free card catalog for guests/offline (VITE_FREE_CATALOG_ENABLED=1): milestone grants on the
 * local save. Signed-in players follow the server (FREE_CATALOG_ENABLED), which grants them itself.
 */
export const freeCatalogBuildEnabled = (): boolean => import.meta.env.VITE_FREE_CATALOG_ENABLED === '1';

/** Content for guest reward rolls (same tables, plus the released QA sets). */
export const guestRewardContent = (): GameContent => {
  const released = [
    ...(DEFAULT_CONTENT.releasedExpansions ?? []),
    ...(ritualsBuildEnabled() ? [RITUAL_EXPANSION] : []),
    ...(primordialBuildEnabled() ? [PRIMORDIAL_EXPANSION] : []),
    ...(tacticalBuildEnabled() ? [TACTICAL_EXPANSION] : []),
    ...(arsenalBuildEnabled() ? [ARSENAL_EXPANSION] : []),
    ...(import.meta.env.VITE_STORE_SHOWCASE === '1' ? [SHOWCASE_STORE_EXPANSION] : []),
    ...(freeCatalogBuildEnabled() ? [FREE_CATALOG_EXPANSION] : []),
  ];
  return released.length ? { ...DEFAULT_CONTENT, releasedExpansions: released } : DEFAULT_CONTENT;
};

/**
 * World 2 «Reino Infernal» is hidden until its visual pass. Guest/offline builds show it with
 * VITE_WORLD_2_ENABLED=1 (`vite --mode world2qa`); signed-in players follow the server
 * (WORLD_2_ENABLED, or WORLD_2_QA for the QA accounts), which enforces it anyway.
 */
export const world2BuildEnabled = (): boolean => import.meta.env.VITE_WORLD_2_ENABLED === '1';

/** World 3 «El Templo del Umbral» (Act III), guest/offline builds only: VITE_WORLD_3_ENABLED=1. */
export const world3BuildEnabled = (): boolean => import.meta.env.VITE_WORLD_3_ENABLED === '1';
