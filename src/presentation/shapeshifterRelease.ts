import { shapeshifterQaEnabled } from './qa/shapeshifter/access';
/** The release build and the authenticated server must both authorize gameplay. */
export const shapeshifterBuildEnabled = (): boolean => import.meta.env.VITE_SHAPESHIFTER_ENABLED === '1';
export const shapeshifterPresentationEnabled = shapeshifterQaEnabled || shapeshifterBuildEnabled();
