import type { AudioCue } from './catalog';
export type ProvisionalCue = 'ui_cancel' | 'card_hover' | 'card_activate';
export type ProvisionalVariant = 'A' | 'B' | 'C' | 'D';
const key = 'rpggo:arcane-audio:v2-provisional';
export const approvedAudio = ['ui_confirm', 'ui_cancel', 'card_hover', 'card_activate', 'ranked_search_loop', 'ranked_match_found'] as const;
const provisional: ProvisionalCue[] = ['ui_cancel', 'card_hover', 'card_activate'];
export function provisionalSelections(): Record<ProvisionalCue, ProvisionalVariant> {
  const result: Record<ProvisionalCue, ProvisionalVariant> = { ui_cancel: 'A', card_hover: 'A', card_activate: 'A' };
  if (!import.meta.env.DEV) return result;
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    for (const cue of provisional) if (['A', 'B', 'C', 'D'].includes(stored[cue])) result[cue] = stored[cue];
  } catch { /* Local audition preferences never affect commands. */ }
  return result;
}
export function selectProvisional(cue: ProvisionalCue, variant: ProvisionalVariant) {
  if (!import.meta.env.DEV || !provisional.includes(cue) || !['A', 'B', 'C', 'D'].includes(variant)) return;
  try { localStorage.setItem(key, JSON.stringify({ ...provisionalSelections(), [cue]: variant })); } catch { /* Storage optional. */ }
}
export function runtimeAudioFiles(cue: AudioCue): string[] {
  const variant = provisional.includes(cue as ProvisionalCue) ? provisionalSelections()[cue as ProvisionalCue] : 'A';
  const extension = cue === 'card_hover' ? '.wav' : '.mp3';
  // Alternative files exist only in DEV. Public delivery contains six selected files.
  return [(import.meta.env.DEV && variant !== 'A' ? '/audio/arcane-v2/' : '/audio/arcane-runtime/v2/') + cue + '_' + variant + extension];
}

/** Original composition stays intact. First play begins at zero; repeat body begins at 10s.
 * The owner approved this musical join in the final release authorization. */
export const gatheringLoop = { start: 10, end: 75.0498 };
