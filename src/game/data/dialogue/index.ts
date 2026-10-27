import type { DialogueLibrary } from '../../dialogue/dialogue';
import { CAMPAIGN_DIALOGUES } from './campaign';
import { PVP_MATCHUPS, PVP_VICTORY } from './pvp';
import { VOICES } from './voices';

/** The shipped dialogue content (Spanish source text; translations replace it by line key). */
export const DIALOGUE_LIBRARY: DialogueLibrary = {
  voices: VOICES,
  pvp: PVP_MATCHUPS,
  pvpVictory: PVP_VICTORY,
  campaign: CAMPAIGN_DIALOGUES,
};

export { CAMPAIGN_DIALOGUES, PVP_MATCHUPS, PVP_VICTORY, VOICES };
