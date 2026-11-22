/** Presentation-only stacking fix. Never resize/reparent the canvas or touch game state. */
let enabled=true;
export const setRevealLayerOrder=(next:boolean)=>{enabled=next;};
export class RevealLayerOrder{
 private saved:{host:HTMLElement;previous:string|undefined}|null=null;
 constructor(private canvas:()=>HTMLCanvasElement){}
 begin(){
  if(!enabled){this.end();return;}
  if(this.saved)return;
  const host=this.canvas().closest<HTMLElement>('.board-host');if(!host)return;
  this.saved={host,previous:host.dataset.ultraLayer};host.dataset.ultraLayer='foreground';
 }
 end(){const s=this.saved;if(!s)return;this.saved=null;if(s.previous===undefined)delete s.host.dataset.ultraLayer;else s.host.dataset.ultraLayer=s.previous;}
}
