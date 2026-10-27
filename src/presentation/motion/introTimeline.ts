import { DURATION, INTRO, STAGGER, TURN } from './tokens';
import type { MotionCue } from './motionCues';

/**
 * Beats of the battle intro, in the order the player should read them:
 * battlefield → environment → HUD → actors → objective → hand → "Tu turno" → control.
 */
export type IntroBeat =
  | 'battlefield'
  | 'ambience_lights'
  | 'ambience_fog'
  | 'ambience_motes'
  | 'hud'
  | 'player'
  | 'enemies'
  | 'objective'
  | 'deal'
  | 'banner'
  | 'unlock';

/**
 * FULL: a new encounter (battlefield rises, HUD enters).
 * QUICK: restart of the same encounter (scene is already there: re-deal, banner, control).
 */
export type IntroVariant = 'FULL' | 'QUICK';

export interface IntroStep {
  beat: IntroBeat;
  /** Offset from the intro start (canvas ready), ms. */
  at: number;
  /** How long the beat's own motion lasts, ms. */
  duration: number;
  cue?: MotionCue;
}

/** Deal span for a full hand: card stagger capped, plus one card's travel. */
const DEAL = STAGGER.cap + DURATION.normal + 20;

const step = (beat: IntroBeat, at: number, duration: number, cue?: MotionCue): IntroStep =>
  cue ? { beat, at, duration, cue } : { beat, at, duration };

/**
 * Reference timeline (FULL, from canvas ready; the menu commit + veil add ~250 ms before it):
 *    0  battlefield starts rising          580  battlefield settled
 *  360  torch light ignites                440  HUD enters (staggered)
 *  480  fog drifts in                      520  player spawn beat
 *  600  ambient motes                      640  enemy spawn beat
 *  760  objective reveal                   860  cards dealt
 * 1120  "Tu turno"                        1440  input unlocked
 * Input never unlocks before the hand has finished landing.
 */
export function introTimeline(variant: IntroVariant, reduced: boolean): IntroStep[] {
  if (reduced) {
    // Same order, no travel: everything reads as quick fades and control returns sooner.
    const steps =
      variant === 'FULL'
        ? [
            step('battlefield', 0, DURATION.normal, 'battlefield_enter'),
            step('ambience_lights', 0, DURATION.fast),
            step('ambience_fog', 0, DURATION.fast),
            step('ambience_motes', 0, DURATION.fast),
            step('hud', 80, DURATION.fast),
            step('player', 80, DURATION.fast, 'player_spawn'),
            step('enemies', 80, DURATION.fast, 'enemy_spawn'),
            step('objective', 160, DURATION.fast),
          ]
        : [];
    return [
      ...steps,
      step('deal', 160, DURATION.fast, 'card_draw'),
      step('banner', 200, DURATION.cinematic, 'turn_start'),
      step('unlock', 360, 0),
    ];
  }
  if (variant === 'QUICK')
    return [
      step('objective', 0, DURATION.emphasis),
      step('deal', 60, DEAL, 'card_draw'),
      step('banner', 180, TURN.banner, 'turn_start'),
      step('unlock', 60 + DEAL, 0),
    ];
  return [
    step('battlefield', 0, INTRO.battlefield, 'battlefield_enter'),
    step('ambience_lights', 360, 300),
    step('hud', 440, DURATION.emphasis),
    step('ambience_fog', 480, 700),
    step('player', 520, DURATION.emphasis, 'player_spawn'),
    step('ambience_motes', 600, 700),
    step('enemies', 640, DURATION.emphasis, 'enemy_spawn'),
    step('objective', 760, DURATION.emphasis),
    step('deal', 860, DEAL, 'card_draw'),
    step('banner', 1120, TURN.banner, 'turn_start'),
    step('unlock', 860 + DEAL, 0),
  ];
}
