import { unitVisualId } from '../assets/visualIdentity';
import { formVisual } from '../qa/shapeshifter/visuals';
let warming = false;
/** Menu intent only, one champion at a time. No speculative catalog/atlas sweep. */
export function prewarmChampion(heroId: string): void {
  if (warming) return;
  warming = true;
  const id=heroId==='shapeshifter'?`qa_form_${formVisual(undefined).id}`:unitVisualId(heroId);
  void import('../pixi/paintedTextures').then(m=>m.loadPaintedCharacters([id]))
    .catch(()=>{/* The scene loader retries; menu navigation always remains usable. */})
    .finally(()=>{warming=false;});
}
