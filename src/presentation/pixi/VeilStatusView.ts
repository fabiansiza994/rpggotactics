import { Graphics } from 'pixi.js';
import type { Unit } from '../../game';

/** One reused ground effect per unit, with no particles or new animation clock. */
export class VeilStatusView extends Graphics {
  private active = false;
  private signature = '';
  update(unit: Unit, phase?: string): void {
    const slow=unit.hp>0&&unit.statuses.some(s=>s.id==='SLOWED');
    const burn=unit.hp>0&&unit.statuses.some(s=>s.id==='BURNING');
    const poison=unit.hp>0&&unit.statuses.some(s=>s.id==='POISONED');
    const key=JSON.stringify([slow,burn,poison,phase,unit.hp>0]);
    if(key===this.signature)return;
    this.signature=key;this.clear();this.active=slow||burn||poison||!!phase;
    if(slow){
      this.ellipse(0,0,29,10).stroke({color:0x98dce8,alpha:.75,width:1.8});
      for(const x of [-22,16,25])this.poly([x,1,x+3,-10,x+6,1]).fill({color:0x9bddeb,alpha:.65});
    }
    if(burn)for(const x of [-20,18])this.poly([x,1,x-4,-8,x,-17,x+2,-10,x+5,-12,x+5,1]).fill({color:0xe5a06d,alpha:.7});
    if(poison){this.ellipse(0,2,24,8).stroke({color:0x99bb78,alpha:.65,width:1.5});
      for(const x of [-25,20])this.circle(x,-13,2.5).fill({color:0xa2c57f,alpha:.7});}
    if(phase&&unit.hp>0){this.ellipse(0,0,36,13).stroke({color:0xc09ae5,alpha:.8,width:2});
      for(const x of [-31,31])this.moveTo(x,-4).lineTo(x+3,-14).lineTo(x+6,-4).stroke({color:0xb7a0da,width:2});}
  }
  advance(clock: number, reduced: boolean): void {
    this.alpha=!this.active?0:reduced?.75:.8+Math.sin(clock/260)*.12;
  }
}
