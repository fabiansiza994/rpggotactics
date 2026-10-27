/** Ephemeral presentation only; never serialized with a run or used to grant rewards. */
export type RevealState = { faces: Record<string, 'hidden' | 'revealing' | 'revealed'>; picked: string | null; confirming: boolean };
export type RevealAction = { type: 'reveal' | 'finish' | 'select'; id: string } | { type: 'confirm' | 'retry' };
export const initialReveal = (ids: string[]): RevealState => ({ faces: Object.fromEntries(ids.map(id => [id, 'hidden'])), picked: null, confirming: false });
export const revealBusy = (s: RevealState) => Object.values(s.faces).includes('revealing');
export function rewardRevealReducer(s: RevealState, a: RevealAction): RevealState {
  if (a.type === 'retry') return { ...s, confirming: false };
  if (s.confirming) return s;
  if (a.type === 'confirm') return s.picked && !revealBusy(s) ? { ...s, confirming: true } : s;
  if (!('id' in a) || !(a.id in s.faces)) return s;
  if (a.type === 'reveal') return s.faces[a.id] === 'hidden' ? { ...s, faces: { ...s.faces, [a.id]: 'revealing' } } : s;
  if (a.type === 'finish') return s.faces[a.id] === 'revealing' ? { ...s, faces: { ...s.faces, [a.id]: 'revealed' } } : s;
  return s.faces[a.id] === 'revealed' && !revealBusy(s) ? { ...s, picked: s.picked === a.id ? null : a.id } : s;
}
