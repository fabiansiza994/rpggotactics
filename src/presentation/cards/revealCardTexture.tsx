import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {CardDefinition} from '../../game';
import {MarketCard} from '../shop/MarketCard';

const properties=['display','position','top','right','bottom','left','width','height','min-width','min-height','max-width','max-height','box-sizing','margin','padding','gap','row-gap','column-gap','flex','flex-direction','flex-wrap','align-items','justify-content','grid-template-columns','grid-template-rows','overflow','border','border-top','border-bottom','border-left','border-right','border-radius','background','background-image','background-size','background-position','background-clip','color','font','font-size','font-family','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','text-shadow','white-space','word-break','overflow-wrap','opacity','box-shadow','object-fit','object-position','z-index','clip-path','fill','stroke','stroke-width','vertical-align','aspect-ratio','rotate','filter'];
const image=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Card texture image unavailable'));img.src=src;});
async function embedded(src:string){if(src.startsWith('data:'))return src;const response=await fetch(src);if(!response.ok)throw Error('Card artwork unavailable');const blob=await response.blob();return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});}
/** Flatten the actual printed card once, without replacing its artwork or rebuilding its rules.
 * The result is a reusable GPU face; no DOM capture or texture creation occurs per animation frame. */
export async function rasterRevealCard(card:CardDefinition):Promise<HTMLCanvasElement>{
 const host=document.createElement('div');host.className='ar-texture-source';host.style.cssText='position:fixed;left:-10000px;top:0;width:350px;height:488.889px;pointer-events:none;contain:layout style;';document.body.append(host);const root=createRoot(host);
 try{
  flushSync(()=>root.render(<MarketCard card={card} interactive={false}/>));
  const face=host.firstElementChild as HTMLElement;face.style.cssText='width:350px;height:488.889px;margin:0;transform:none;perspective:none';
  await document.fonts.ready;
  await Promise.all(Array.from(face.querySelectorAll('img')).map(img=>img.decode()));
  const clone=face.cloneNode(true) as HTMLElement,original=[face,...face.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  await Promise.all(original.map(async(el,index)=>{const copy=copies[index] as HTMLElement|SVGElement,computed=getComputedStyle(el);for(const p of properties){const value=computed.getPropertyValue(p);if(value)copy.style.setProperty(p,value);}copy.style.setProperty('animation','none');copy.style.setProperty('transition','none');copy.style.setProperty('transform','none');if(el instanceof HTMLImageElement)(copy as HTMLImageElement).src=await embedded(el.currentSrc||el.src);}));
  clone.style.width='350px';clone.style.height='488.889px';clone.style.position='relative';clone.style.margin='0';clone.style.opacity='1';
  const markup=new XMLSerializer().serializeToString(clone),svg=`<svg xmlns="http://www.w3.org/2000/svg" width="840" height="1174" viewBox="0 0 350 488.889"><foreignObject width="350" height="488.889"><div xmlns="http://www.w3.org/1999/xhtml">${markup}</div></foreignObject></svg>`;
  const bitmap=await image('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));const canvas=document.createElement('canvas');canvas.width=840;canvas.height=1174;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Card texture context unavailable');ctx.drawImage(bitmap,0,0);ctx.getImageData(0,0,1,1);return canvas;
 }finally{flushSync(()=>root.unmount());host.remove();}
}
