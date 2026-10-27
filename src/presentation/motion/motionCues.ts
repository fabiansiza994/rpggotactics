/**
 * Named moments of the motion system. Audio (and anything else that must stay in sync with
 * motion) subscribes here; no sound catalogue is wired yet. Cues are presentation facts only.
 */
export type MotionCue =
  | 'ritual_seal'
  | 'ritual_release'
  | 'ritual_ready'
  | 'ritual_activate'
  | 'summon_arrival'
  | 'battlefield_enter'
  | 'player_spawn'
  | 'enemy_spawn'
  | 'card_draw'
  | 'card_hover'
  | 'card_select'
  | 'card_play'
  | 'energy_spend'
  | 'move_start'
  | 'move_end'
  | 'hit'
  | 'critical'
  | 'death'
  | 'turn_start'
  | 'turn_end'
  | 'victory'
  | 'defeat';

export type MotionCueListener = (cue: MotionCue) => void;

class MotionCueBus {
  private readonly listeners = new Set<MotionCueListener>();

  subscribe(listener: MotionCueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(cue: MotionCue): void {
    for (const listener of this.listeners) listener(cue);
  }
}

export const motionCues = new MotionCueBus();
