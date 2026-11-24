import type {Unit} from '../../game';
import {unitVisualId} from './visualIdentity';
import {formUnitVisualId} from '../qa/shapeshifter/visuals';
/** The same identity drives preload, live events and snapshot reconstruction. */
export function unitPresentationId(unit: Pick<Unit,'defId'|'activeForm'>, formsEnabled: boolean): string {
  if (unit.defId === 'shapeshifter' && (formsEnabled || unit.activeForm === 'dark_abyssal_minotaur'))
    return formUnitVisualId(unit.activeForm);
  return unitVisualId(unit.defId);
}
