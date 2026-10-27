import {PROFILE_AVATARS,ALL_PROFILE_AVATARS,DEFAULT_AVATAR_ID,avatarOwned} from '../../src/shared/profileAvatars';
import type {D1Database} from './db';
import {json,error} from './http';

/** Earned avatars the account owns (tactics_player_cosmetics kind PROFILE_AVATAR, e.g. the Ranked Premium Track). */
async function ownedAvatarIds(db:D1Database,userId:number):Promise<string[]>{
 const {results}=await db.prepare("SELECT cosmetic_id FROM tactics_player_cosmetics WHERE user_id = ? AND kind = 'PROFILE_AVATAR'").bind(userId).all<{cosmetic_id:string}>();
 return results.map(r=>r.cosmetic_id);
}

/** Stable one-time assignment. INSERT conflict never overwrites a player's choice. */
export async function ensureProfileAvatar(db:D1Database,userId:number,now:number){
 const defaults=PROFILE_AVATARS.filter(a=>a.unlockType==='FREE');
 const id=defaults[(userId-1)%defaults.length]!.id;
 await db.prepare('INSERT INTO tactics_profile_avatars (user_id, avatar_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId,id,now).run();
 const saved=await db.prepare('SELECT avatar_id FROM tactics_profile_avatars WHERE user_id = ?').bind(userId).first<{avatar_id:string}>();
 return ALL_PROFILE_AVATARS.find(a=>a.id===saved?.avatar_id)?.id ?? DEFAULT_AVATAR_ID;
}

/** Called only after the existing session resolver authenticates the caller. */
export async function profileAvatarRoute(request:Request,db:D1Database,userId:number,now:number):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/tactics/profile/avatar')return null;
 if(request.method!=='GET'&&request.method!=='PUT')return error(405,'BAD_METHOD','Método no permitido.');
 const owned=await ownedAvatarIds(db,userId);
 if(request.method==='PUT'){
  let body:unknown;try{body=await request.json();}catch{return error(400,'BAD_JSON','Solicitud inválida.');}
  const id=body&&typeof body==='object'?'avatarId' in body?body.avatarId:null:null;
  const avatar=ALL_PROFILE_AVATARS.find(a=>a.id===id);
  // Earned avatars resolve ownership on the server (D1 rows), never from the client.
  if(!avatar||!avatarOwned(avatar,owned))return error(422,'AVATAR_UNAVAILABLE','Avatar no disponible.');
  await db.prepare('INSERT INTO tactics_profile_avatars (user_id, avatar_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET avatar_id = excluded.avatar_id, updated_at = excluded.updated_at').bind(userId,avatar.id,now).run();
 }
 const id=await ensureProfileAvatar(db,userId,now);
 const current=ALL_PROFILE_AVATARS.find(a=>a.id===id);
 return json({avatarId:current&&avatarOwned(current,owned)?current.id:DEFAULT_AVATAR_ID,ownedAvatarIds:ALL_PROFILE_AVATARS.filter(a=>avatarOwned(a,owned)).map(a=>a.id)});
}
