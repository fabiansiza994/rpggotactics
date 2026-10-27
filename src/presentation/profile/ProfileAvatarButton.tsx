import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {profileAvatar} from '../../shared/profileAvatars';
import {useBattleStore} from '../store/battleStore';
import {loadSession} from '../cloud/session';
import {useAvatarStore} from './avatarStore';
import '../../styles/profile-avatar.css';
const AvatarPicker=lazy(()=>import('./AvatarPicker').then(m=>({default:m.AvatarPicker})));
export function ProfileAvatarButton(){
 const account=useBattleStore(s=>s.account);
 const username='username' in account?account.username:null;
 const scope=username?`account:${username}`:'guest';
 const session=account.status==='READY'?loadSession():null;
 const token=session?.username===username?session.token:null;
 const avatarState=useAvatarStore();
 const avatar=profileAvatar(avatarState.scope===scope?avatarState.avatarId:null);
 const [open,setOpen]=useState(false),[picker,setPicker]=useState(false);
 const ref=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{void useAvatarStore.getState().load(scope,token);},[scope,token]);
 useEffect(()=>{
  if(!open)return;
  const close=()=>{setOpen(false);setPicker(false);trigger.current?.focus();};
  const pointer=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)){setOpen(false);setPicker(false);}};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
  document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key,true);
  ref.current?.querySelector<HTMLButtonElement>('.profile-popover button')?.focus();
  return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key,true);};
 },[open]);
 const visible=open&&avatarState.scope===scope;
 return <div className="profile-avatar-anchor" ref={ref}><button type="button" className="profile-avatar-trigger" ref={trigger} aria-label="Abrir perfil" aria-expanded={visible} aria-controls={visible?'hub-profile-popover':undefined} onClick={()=>{setOpen(v=>!v);setPicker(false);}}><span className="profile-avatar-circle"><img src={avatar.asset} alt={`Avatar: ${avatar.name}`} width={256} height={256} decoding="async"/></span></button>{visible&&<section id="hub-profile-popover" className="profile-popover" aria-label="Perfil del jugador"><header><span className="profile-avatar-circle profile-avatar-large"><img src={avatar.asset} alt={avatar.name} width={256} height={256}/></span><div><strong>{username??'Invitado'}</strong><small>{account.status==='READY'?'En línea':username?'Sin conexión':'Progreso local'}</small></div><button className="profile-popover-close" type="button" aria-label="Cerrar perfil" onClick={()=>{setOpen(false);setPicker(false);trigger.current?.focus();}}>×</button></header>{!picker?<button className="profile-avatar-change" type="button" disabled={avatarState.status!=='READY'} onClick={()=>setPicker(true)}>Cambiar avatar</button>:<Suspense fallback={<p role="status">Cargando avatares…</p>}><AvatarPicker onSelect={id=>void avatarState.select(id,token)}/></Suspense>}{avatarState.status==='LOADING'&&<p role="status">Cargando perfil…</p>}{avatarState.status==='ERROR'&&<button type="button" onClick={()=>void avatarState.load(scope,token)}>Reintentar</button>}<p className="profile-avatar-feedback" role="status">{avatarState.saving?'Actualizando…':avatarState.message}</p>{scope==='guest'&&<small className="profile-avatar-note">Se guarda en este dispositivo.</small>}</section>}</div>;
}
