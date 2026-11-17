import {useEffect,useState,type CSSProperties,type ReactNode} from 'react';
import {packExpansion} from './PackArt';
import {expansionVisual} from './expansionVisuals';
import '../../styles/pack-experience.css';

/** One persistent environment across confirmation, persisted opening and batch results.
 * The native dialog keeps focus trapping/inert surroundings; its surface is full viewport. */
export function PackExperience({packId,children}:{packId?:string;children:ReactNode}) {
  const [paused,setPaused]=useState(()=>typeof document!=='undefined'&&document.hidden);
  useEffect(()=>{const update=()=>setPaused(document.hidden);document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  useEffect(()=>{
    if(!packId)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[packId]);
  if(!packId)return <>{children}</>;
  const e=packExpansion(packId),v=expansionVisual(e?.id,e?.art);
  const style={'--pack-accent':v.accent,'--pack-glow':v.glow,'--pack-landscape':'url("'+v.environment+'")'} as CSSProperties;
  return <div className="pack-experience" style={style} data-theme={e?.id??'unknown'} data-atmosphere={v.atmosphere} data-paused={paused}>
    <div className="pack-environment" aria-hidden="true">
      <div className="pack-landscape"/>
      <div className="pack-horizon"/>
      <div className="pack-floor"><span>✧</span></div>
      <div className="pack-crest">{v.atmosphere==='spirits'?<img src={v.cover} alt=""/>:v.sigil}</div>
      <div className="pack-dust">{Array.from({length:12},(_,i)=><i key={i} style={{'--i':i} as CSSProperties}/>)}</div>
    </div>
    <div className="pack-experience-content">{children}</div>
  </div>;
}
