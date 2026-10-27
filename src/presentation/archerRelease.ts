import { archerGameplayQaEnabled } from './qa/archer/battlePreview';
/** Presentation availability only. Authenticated accounts must also be authorized by the Worker. */
export const archerBuildEnabled = (): boolean => import.meta.env.VITE_ARCHER_ENABLED === '1';
export const archerPresentationEnabled = archerGameplayQaEnabled || archerBuildEnabled();
