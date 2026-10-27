import {create} from 'zustand';
import {DEFAULT_AVATAR_ID,PROFILE_AVATARS,avatarOwned,profileAvatar} from '../../shared/profileAvatars';
import {request} from '../cloud/http';
import {CLOUD_CONFIG} from '../cloud/config';
export const GUEST_AVATAR_KEY='rpg-go-tactics:guest-avatar:v1';
interface AvatarView {avatarId:string;ownedAvatarIds:string[]}
const freeIds=PROFILE_AVATARS.filter(a=>avatarOwned(a)).map(a=>a.id);
function guestAvatar(){try{const avatar=profileAvatar(localStorage.getItem(GUEST_AVATAR_KEY));return avatarOwned(avatar)?avatar.id:DEFAULT_AVATAR_ID;}catch{return DEFAULT_AVATAR_ID;}}
interface AvatarState {
 scope:string;avatarId:string;ownedAvatarIds:string[];status:'LOADING'|'READY'|'ERROR';saving:boolean;message:string;
 load(scope:string,token:string|null):Promise<void>;
 select(id:string,token:string|null):Promise<void>;
}
let revision=0;
export const useAvatarStore=create<AvatarState>((set,get)=>({
 scope:'',avatarId:DEFAULT_AVATAR_ID,ownedAvatarIds:[],status:'LOADING',saving:false,message:'',
 async load(scope,token){
  const ticket=++revision;
  set({scope,avatarId:DEFAULT_AVATAR_ID,ownedAvatarIds:[],status:'LOADING',saving:false,message:''});
  if(scope==='guest'){set({avatarId:guestAvatar(),ownedAvatarIds:freeIds,status:'READY'});return;}
  if(!token){set({status:'ERROR',message:'Conecta tu cuenta para cambiar el avatar.'});return;}
  const result=await request<AvatarView>(CLOUD_CONFIG.apiUrl,'/api/tactics/profile/avatar',{token,timeoutMs:CLOUD_CONFIG.timeoutMs});
  if(ticket!==revision)return;
  if(result.ok)set({avatarId:profileAvatar(result.data.avatarId).id,ownedAvatarIds:result.data.ownedAvatarIds,status:'READY'});
  else set({status:'ERROR',message:'No pudimos cargar tu avatar. Intenta nuevamente.'});
 },
 async select(id,token){
  const state=get();if(state.status!=='READY'||state.saving||!state.ownedAvatarIds.includes(id))return;
  const ticket=revision;
  set({avatarId:id,saving:true,message:''});
  if(state.scope==='guest'){
   try{localStorage.setItem(GUEST_AVATAR_KEY,id);set({saving:false,message:'Avatar actualizado.'});}
   catch{set({avatarId:state.avatarId,saving:false,message:'No pudimos guardar el avatar en este dispositivo.'});}
   return;
  }
  if(!token){set({avatarId:state.avatarId,saving:false,message:'Vuelve a conectar tu cuenta.'});return;}
  const result=await request<AvatarView>(CLOUD_CONFIG.apiUrl,'/api/tactics/profile/avatar',{method:'PUT',token,body:{avatarId:id},timeoutMs:CLOUD_CONFIG.timeoutMs});
  if(ticket!==revision)return;
  if(result.ok)set({avatarId:profileAvatar(result.data.avatarId).id,saving:false,message:'Avatar actualizado.'});
  else set({avatarId:state.avatarId,saving:false,message:'No pudimos guardar el avatar. Intenta nuevamente.'});
 },
}));
