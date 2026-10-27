import {useEffect,useRef} from 'react';
import {ALL_PROFILE_AVATARS,avatarOwned} from '../../shared/profileAvatars';
import {useAvatarStore} from './avatarStore';
export function AvatarPicker({onSelect}:{onSelect(id:string):void}){
 const ref=useRef<HTMLElement>(null);
 useEffect(()=>{ref.current?.querySelector<HTMLButtonElement>('button[aria-pressed=true]')?.focus();},[]);
 const {avatarId,ownedAvatarIds,saving,status}=useAvatarStore();
 return <section ref={ref} className="profile-avatar-picker" aria-label="Avatares disponibles"><h3>Elige tu avatar</h3><div className="profile-avatar-grid">{ALL_PROFILE_AVATARS.filter(a=>a.unlockType==='FREE'||avatarOwned(a,ownedAvatarIds)).map(a=>{const owned=avatarOwned(a,ownedAvatarIds);return <button type="button" key={a.id} aria-label={a.name} aria-pressed={avatarId===a.id} disabled={!owned||saving||status!=='READY'} onClick={()=>onSelect(a.id)} title={owned?a.name:a.unlockSource??'Avatar bloqueado'}><span className="profile-avatar-circle"><img src={a.asset} alt={a.name} width={256} height={256} loading="lazy" decoding="async" style={{objectPosition:a.objectPosition??'50% 50%'}}/></span><span className="profile-avatar-name">{a.name}</span>{avatarId===a.id&&<b className="profile-avatar-check" aria-hidden="true">✓</b>}{!owned&&<small>Bloqueado</small>}</button>;})}</div></section>;
}
