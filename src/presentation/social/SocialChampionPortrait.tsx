import {portraitVariantFor} from '../dialogue/portraitVariants';
/** Existing dialogue busts, cropped for social UI; never the player's profile avatar. */
export function SocialChampionPortrait({id}:{id:string}){
 const portrait=portraitVariantFor(id);
 return <span className="social-champion-headshot" aria-hidden="true">{portrait?<img src={portrait.src} alt="" loading="lazy" decoding="async" width={48} height={48} onError={e=>{e.currentTarget.style.visibility='hidden';}}/>:<span>✧</span>}</span>;
}
