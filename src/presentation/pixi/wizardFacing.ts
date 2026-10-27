/** Compatibility names for existing Mage tools/tests; champions share the intent resolver. */
export {
  FACING_SECTORS as WIZARD_SECTORS,
  FACING_TOLERANCE,
  directionalFacing as wizardFacing,
  resolvedFacingTarget,
  mageView as wizardView,
} from './directionalFacing';
export type { DirectionalFacing as WizardFacing, FacingTargets } from './directionalFacing';
