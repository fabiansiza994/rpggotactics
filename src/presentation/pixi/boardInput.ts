import type { Pos } from '../../game';
/** A legal floor target wins over a tall summon silhouette covering that floor. */
export function boardActionWins(ground:Pos|null,move:readonly Pos[],targets:readonly Pos[]){
  return !!ground && [...move,...targets].some(p=>p.x===ground.x&&p.y===ground.y);
}
