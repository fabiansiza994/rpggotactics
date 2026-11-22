/** Presentation implementation only. QA can compare both against the same timeline. */
export type RevealRenderer = 'css' | 'pixi';
let renderer:RevealRenderer='pixi';
export const readRevealRenderer=()=>renderer;
export function selectRevealRenderer(next:RevealRenderer){renderer=next;}
