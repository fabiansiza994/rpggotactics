import {fitBattlefield,type ArenaBounds} from '../responsive/battleFit';

/** Local presentation state: never serialized or sent to the combat server. */
export class ManualCamera {
  zoom=1;
  private renderedZoom=1;
  turn:0|1|2|3=0;
  pan={x:0,y:0};
  reset(){this.renderedZoom=1;this.zoom=1;this.turn=0;this.pan={x:0,y:0};}
  rotate(direction:number){this.turn=((this.turn+direction+4)%4) as 0|1|2|3;this.pan={x:0,y:0};}
  magnify(factor:number){this.zoom=Math.max(1,Math.min(2.8,this.zoom*factor));if(this.zoom===1)this.pan={x:0,y:0};}
  tick(ms:number,reduced:boolean):boolean {
    if(Math.abs(this.zoom-this.renderedZoom)<.001){this.renderedZoom=this.zoom;return false;}
    this.renderedZoom=reduced?this.zoom:this.renderedZoom+(this.zoom-this.renderedZoom)*(1-Math.exp(-ms/65));return true;
  }
  frame(width:number,height:number,bounds:ArenaBounds,padding:number){
    const fit=fitBattlefield(width,height,bounds,padding),scale=fit.scale*this.renderedZoom;
    // Retain a substantial part of the arena on screen, even at maximum zoom.
    const margin=Math.min(width,height)*.25;
    this.pan.x=Math.max(margin-fit.x-bounds.right*scale,Math.min(width-margin-fit.x-bounds.left*scale,this.pan.x));
    this.pan.y=Math.max(margin-fit.y-bounds.bottom*scale,Math.min(height-margin-fit.y-bounds.top*scale,this.pan.y));
    return {scale,x:fit.x+this.pan.x,y:fit.y+this.pan.y};
  }
}
