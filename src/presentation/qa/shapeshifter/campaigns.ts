/** Private campaign registrations. Authored encounters and public campaign objects stay untouched. */
import {
  ASCENT_CAMPAIGN as PUBLIC_ASCENT,
  WORLD_CAMPAIGNS as PUBLIC_CAMPAIGNS,
  worldContext as publicContext,
  campaignForRun as publicCampaignForRun,
  type RunState,
} from '../../../game';
import { shapeshifterQaEnabled } from './access';
export const WORLD_CAMPAIGNS = shapeshifterQaEnabled
  ? Object.fromEntries(
      Object.entries(PUBLIC_CAMPAIGNS).map(([id, campaign]) => [
        id,
        // A champion's own act (the Archer's) stays that champion's.
        campaign.kind === 'CHAMPION_STORY' ? campaign : { ...campaign, heroIds: [...new Set([...campaign.heroIds, 'shapeshifter'])] },
      ]),
    )
  : PUBLIC_CAMPAIGNS;
export const ASCENT_CAMPAIGN = WORLD_CAMPAIGNS[PUBLIC_ASCENT.id]!;
export const worldContext = (released: (flag: string) => boolean = () => false) => ({
  ...publicContext(released),
  campaigns: WORLD_CAMPAIGNS,
});
export const campaignForRun = (
  run: Pick<RunState, 'campaignId' | 'currentEncounterId' | 'heroId'>,
) => WORLD_CAMPAIGNS[run.campaignId] ?? publicCampaignForRun(run);
