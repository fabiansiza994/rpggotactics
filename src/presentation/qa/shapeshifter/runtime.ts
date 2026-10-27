import { withUnleashedHuntQa } from '../../../game/data/unleashed-hunt';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { shapeshifterBuildEnabled } from '../../shapeshifterRelease';
import { claimFreeChampion } from '../../../game/collection/champion-unlocks';
import { DEFAULT_CONTENT, grantCard, type PlayerProfile, type GameContent } from '../../../game';
import { withShapeshifter2dQa } from '../../../game/data/shapeshifter-2d-qa';
import { shapeshifterQaEnabled } from './access';
/** Dedicated QA content; never mutates the public registry. Step stays at its original cost. */
export function realFlow2eContent(base: GameContent): GameContent {
  const content = withShapeshifter2dQa(base);
  return {
    ...content,
    cards: {
      ...content.cards,
      qa_hunter_step: {
        ...content.cards.qa_hunter_step!,
        cost: 1,
        rulesText: 'QA provisional: camina hasta 2 casillas. Coste 1; sigue en evaluación.',
      },
    },
  };
}
export { shapeshifterCatalog as realFlowQaContent } from '../../../game/data/shapeshifter-catalog';
import { shapeshifterCatalog } from '../../../game/data/shapeshifter-catalog';
import { withArcher } from '../../../game/data/archer';
import { archerPresentationEnabled } from '../../archerRelease';
const QA_CONTENT = shapeshifterQaEnabled ? shapeshifterCatalog(DEFAULT_CONTENT) : null;
const BASE_CONTENT = QA_CONTENT ?? (shapeshifterBuildEnabled() ? withShapeshifterRelease(DEFAULT_CONTENT) : DEFAULT_CONTENT);
const RELEASE_CONTENT = archerPresentationEnabled ? withArcher(BASE_CONTENT) : BASE_CONTENT;
export const PRESENTATION_CONTENT = import.meta.env.DEV && import.meta.env.MODE==='unleashedqa' && typeof location!=='undefined' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) ? withUnleashedHuntQa(RELEASE_CONTENT) : RELEASE_CONTENT;

/** Add QA catalog copies without deleting earned cards, saved decks or older profile fields. */
export function withQaCatalogCopies(profile: PlayerProfile): PlayerProfile {
  if (!shapeshifterQaEnabled) return profile;
  let next = profile;
  for (const card of Object.values(PRESENTATION_CONTENT.cards).filter(
    (c) => c.heroId === 'shapeshifter',
  )) {
    for (let n = next.heroes.shapeshifter?.collection[card.id]?.copies ?? 0; n < 3; n++) {
      const result = grantCard(next, 'shapeshifter', card.id, PRESENTATION_CONTENT);
      if (result.ok) next = result.profile;
    }
  }
  const claimed = claimFreeChampion(next, 'shapeshifter', ['shapeshifter']);
  return claimed.ok ? claimed.profile : next;
}
