import {useEffect,useState} from 'react';
/** Two decoded layers crossfade in the same slot; an expression never changes portrait geometry. */
export function DialoguePortrait({src,fallback}:{src:string;fallback?:string}){
 const [frame,setFrame]=useState({shown:fallback??src,previous:undefined as string|undefined});
 useEffect(()=>{
  let alive=true;
  const reveal=(url:string)=>{if(alive)setFrame(current=>current.shown===url?current:{shown:url,previous:current.shown});};
  const image=new Image();image.decoding='async';
  image.onload=()=>{void image.decode().catch(()=>{}).then(()=>reveal(src));};
  image.onerror=()=>{if(fallback)reveal(fallback);};
  image.src=src;
  return()=>{alive=false;image.onload=null;image.onerror=null;};
 },[src,fallback]);
 return <span className="dialogue-portrait-stack">
  {frame.previous&&<img className="dialogue-portrait-previous" src={frame.previous} alt="" aria-hidden="true" decoding="async"/>}
  <img key={frame.shown} className="dialogue-portrait-current" src={frame.shown} data-requested-portrait={src} alt="" decoding="async"/>
 </span>;
}
