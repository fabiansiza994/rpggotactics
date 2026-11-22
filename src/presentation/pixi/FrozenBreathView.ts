import {Container,Graphics} from 'pixi.js';
/** Presentation only; constructions and elementals are deliberately absent. */
export const breathesInCold=(id:string)=>['mage','warrior','archer','summoner','shapeshifter','wolf','raven','turtle','fox','war_drake','orc_warrior','goblin','bear','minotaur'].includes(id);
export class FrozenBreathView extends Container {
 private compact=typeof matchMedia!=='undefined'&&matchMedia('(max-width:600px)').matches;private time=0;private frozen=false;private frost=false;private wisps:Graphics[]=[];private shell=new Graphics();
 constructor(private visualHeight:number,private seed:number){super();this.eventMode='none';for(let i=0;i<3;i++){const g=new Graphics().ellipse(0,0,5,2.4).fill({color:0xe4f9ff,alpha:.28});this.wisps.push(g);this.addChild(g);}for(let i=0;i<5;i++){const x=(i-2)*6;this.shell.poly([x-4,0,x,-visualHeight*(.14+i%2*.08),x+5,0]).fill({color:0x88d9f3,alpha:.46});}this.addChild(this.shell);this.visible=false;}
 sync(frozen:boolean,permafrost:boolean){this.frozen=frozen||permafrost;this.frost=permafrost;this.visible=frozen||permafrost;this.shell.visible=permafrost;}
 advance(ms:number,reduced:boolean,facing:string){if(!this.visible)return;this.time+=ms;const side=facing.includes('W')?-1:facing.includes('E')?1:0,period=2800+(this.seed%600);for(let i=0;i<3;i++){const g=this.wisps[i]!,t=((this.time+this.seed+i*170)%period)/700;g.visible=this.frozen&&!reduced&&t<1&&(!this.compact||i<1);if(!g.visible)continue;g.position.set(side*(this.visualHeight*.1+t*13),-this.visualHeight*(facing.includes('N')?.87:.8)-t*9);g.scale.set(.5+t*1.7,.6+t);g.alpha=Math.sin(t*Math.PI)*.6;}this.shell.alpha=reduced?.6:.65+Math.sin(this.time/450)*.12;this.shell.visible=this.frost;}
}
