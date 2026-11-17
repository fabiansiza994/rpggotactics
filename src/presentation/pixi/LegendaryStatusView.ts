import {Container,Graphics} from 'pixi.js';
import type {Unit} from '../../game';
import type {StatusId} from '../../game/domain/statuses/status';
/** Small reusable visual vocabulary. No filters, textures or per-frame geometry allocation. */
export const LEGENDARY_VISUALS:Partial<Record<StatusId,{color:number;electric:boolean}>>={
 SNOW_WAR:{color:0xd6f6ff,electric:false},
 ABSOLUTE_ZERO:{color:0xc4f3ff,electric:false},
 FROZEN:{color:0x9cecff,electric:false},
 FROST_MANTLE:{color:0xb0dfff,electric:false},
 GLACIAL_REFLECTION:{color:0xe4faff,electric:false},
 ARCANE_SKATING:{color:0x73dcff,electric:false},
 ARCANE_INVERSION:{color:0xb27bff,electric:false},
 THUNDER_INCARNATION:{color:0x73dcff,electric:true},
};
export class LegendaryStatusView extends Container {
 private createLayer(id:StatusId){
  const def=LEGENDARY_VISUALS[id]!;
  const group=new Container(),rune=new Graphics(),aura=new Graphics();
  rune.ellipse(0,0,31,11).ellipse(0,0,24,8).stroke({color:def!.color,width:1.4,alpha:.9});
  for(let i=0;i<6;i++){const a=i*Math.PI/3; rune.moveTo(Math.cos(a)*25,Math.sin(a)*9).lineTo(Math.cos(a)*35,Math.sin(a)*13).stroke({color:def!.color,width:1.4});}
  aura.ellipse(0,-39,29,40).stroke({color:def!.color,width:8,alpha:.09}).ellipse(0,-39,29,40).stroke({color:def!.color,width:2,alpha:.75});
  if(def!.electric)for(const x of [-16,13])aura.poly([x,-4,x+4,-18,x-3,-26,x+4,-39,x,-53]).stroke({color:def!.color,width:1.4,alpha:.8});
  if(id==='SNOW_WAR'){aura.clear();for(const x of [-19,17]){for(let i=0;i<3;i++){const a=i*Math.PI/3;aura.moveTo(x-Math.cos(a)*6,-31-Math.sin(a)*6).lineTo(x+Math.cos(a)*6,-31+Math.sin(a)*6).stroke({color:0xe7fcff,width:1.2,alpha:.75});}}}
  const particles=Array.from({length:6},()=>new Graphics().circle(0,0,1.5).fill(def!.color));
  group.eventMode='none';group.addChild(rune,aura,...particles);group.alpha=0;this.addChild(group);
  return {id:id as StatusId,group,rune,aura,particles,turns:0,fade:0,used:false,signature:'',pulse:0,seen:false};
 }
 private readonly layers:ReturnType<LegendaryStatusView['createLayer']>[]=[];
 constructor(){super();this.eventMode='none';for(const id of ['ARCANE_INVERSION','THUNDER_INCARNATION'] as StatusId[])this.layers.push(this.createLayer(id));}
 update(unit:Unit):void {
  for(const status of unit.statuses)if(LEGENDARY_VISUALS[status.id]&&!this.layers.some(l=>l.id===status.id))this.layers.push(this.createLayer(status.id));
  for(const l of this.layers){
   const s=unit.hp>0?unit.statuses.find(s=>s.id===l.id):undefined;
   const signature=s?JSON.stringify([s.lastTriggerTurn,s.triggerCount,s.stepUsed]):'';
   if(l.seen && s && signature!==l.signature)l.pulse=350;
   if(l.turns && !s)l.fade=350;
   l.turns=s?.turnsLeft??0;l.used=l.id==='ARCANE_INVERSION'?!!s?.absorptionUsed:!!s?.discountUsed;
   l.signature=signature;l.seen=true;
  }
 }
 advance(ms:number,clock:number,reduced:boolean):void {
  for(const l of this.layers){
   l.pulse=Math.max(0,l.pulse-ms);l.fade=Math.max(0,l.fade-ms);
   const intensity=l.turns?(.4+Math.min(l.id==='ABSOLUTE_ZERO'?10:3,l.turns)*(l.id==='ABSOLUTE_ZERO'?.048:.16)):l.fade/350*.4;
   l.group.visible=intensity>0;if(!l.group.visible)continue;
   const wave=reduced?1:.92+Math.sin(clock/(l.turns===1?135:300))*.08;
   l.group.alpha=Math.min(.95,intensity*wave+(l.pulse? .18:0));
   l.aura.alpha=l.used?.55:.85;
   l.rune.scale.set(1+(reduced?0:Math.sin(clock/500)*.025));
   l.particles.forEach((p,i)=>{const a=i*Math.PI/3+(reduced?0:clock/1700);p.position.set(Math.cos(a)*(l.pulse?16:27),-39+Math.sin(a)*37);p.alpha=reduced?.55:.5+Math.sin(a+clock/180)*.3;});
  }
 }
}
