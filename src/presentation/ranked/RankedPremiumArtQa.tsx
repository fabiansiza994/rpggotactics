/** DEV-only visual board. Uses production renderers, fixture ownership, no API or grants. */
import { RANKED_PREMIUM_CARDS } from '../../game/data/ranked-premium-cards';
import { RANKED_PREMIUM_AVATARS } from '../../shared/profileAvatars';
import { RankedCardFace } from './RankedRewardsTrack';
import { ProfileFrame } from '../shop/ProfileFrame';
import { CardBackFace } from '../cosmetics/CardBack';
import { CosmeticPreviewContext } from '../cosmetics/cardCosmetics';
import { AvatarPicker } from '../profile/AvatarPicker';
import { useAvatarStore } from '../profile/avatarStore';
import type { Cosmetics } from '../shop/api';
import { useState } from 'react';
import '../../styles/profile-avatar.css';

export function RankedPremiumArtQa() {
  const [showcase,setShowcase]=useState(true);
  const owned:Cosmetics={owned:RANKED_PREMIUM_CARDS.map(c=>({cosmeticId:'showcase_'+c.id,kind:'CARD_ART',acquiredAt:1})),equipped:{}};
  return <section aria-label="Galería de arte Premium" style={{padding:16}}>
    <h2>Arte definitivo · 16 recursos</h2><button onClick={()=>setShowcase(v=>!v)} aria-pressed={showcase}>Showcase {showcase?'ON':'OFF'}</button>
    <div className="rrt-qa-gallery">{RANKED_PREMIUM_CARDS.map(c=><CosmeticPreviewContext.Provider key={c.id} value={{...owned,equipped:showcase?{CARD_ART:'showcase_'+c.id}:{}}}><div><RankedCardFace card={c}/><p>{c.name}</p></div></CosmeticPreviewContext.Provider>)}</div>
    <h3>Avatares · máscara circular</h3><div style={{display:'flex',flexWrap:'wrap',gap:16}}>{RANKED_PREMIUM_AVATARS.map(a=><figure key={a.id} style={{margin:0,width:180}}><img src={a.asset} alt={a.name} loading="lazy" style={{width:128,height:128,borderRadius:'50%',objectFit:'cover'}}/><figcaption>{a.name}</figcaption></figure>)}</div>
    <h3>Marcos transparentes y reverso</h3><div style={{display:'flex',gap:16,alignItems:'center'}}>{['frame_premium_circle_bronze','frame_premium_threshold_crown'].map(id=><div key={id} style={{width:164,height:164}}><ProfileFrame frameId={id}><img src={RANKED_PREMIUM_AVATARS[2]!.asset} alt="Avatar con marco Premium" style={{width:'100%',height:'100%',objectFit:'cover'}}/></ProfileFrame></div>)}<div style={{transform:'scale(3)',transformOrigin:'left center',margin:48}}><CardBackFace cosmetics={{owned:[{cosmeticId:'cardback_premium_arcane_circle',kind:'CARD_BACK',acquiredAt:1}],equipped:{CARD_BACK:'cardback_premium_arcane_circle'}}}/></div></div>
    <h3>Selector poseído · fixture local</h3><button onClick={()=>useAvatarStore.setState({scope:'qa-art',avatarId:'premium_celestial_fox',ownedAvatarIds:RANKED_PREMIUM_AVATARS.map(a=>a.id),status:'READY',saving:false})}>Cargar propiedad de prueba</button><div className="play-nav" style={{position:'relative',maxWidth:360,padding:8}}><AvatarPicker onSelect={id=>useAvatarStore.setState({avatarId:id})}/></div>
  </section>;
}
