import {it,expect} from 'vitest';
import {memoryD1,addAccount} from './support/d1';
import {ensureProfileAvatar} from '../server/src/profileAvatar';
import {PROFILE_AVATARS} from '../src/shared/profileAvatars';
import {readFileSync} from 'node:fs';
it('persists retroactive defaults once and never overwrites a later explicit choice',async()=>{
 const db=memoryD1();const accounts=Array.from({length:5},(_,i)=>addAccount(db,`old_${i}`));
 for(const a of accounts){const id=await ensureProfileAvatar(db,a.id,1);expect(PROFILE_AVATARS.some(x=>x.id===id)).toBe(true);expect(await ensureProfileAvatar(db,a.id,999)).toBe(id);}
 expect(db.sql.prepare('SELECT COUNT(DISTINCT avatar_id) AS n FROM tactics_profile_avatars').get()).toEqual({n:5});
 const id=accounts[0]!.id;db.sql.prepare('UPDATE tactics_profile_avatars SET avatar_id = ?, updated_at = 2 WHERE user_id = ?').run('mystic_fox',id);
 expect(await Promise.all([ensureProfileAvatar(db,id,3),ensureProfileAvatar(db,id,4)])).toEqual(['mystic_fox','mystic_fox']);
 expect(db.sql.prepare('SELECT updated_at AS at FROM tactics_profile_avatars WHERE user_id = ?').get(id)).toEqual({at:2});
});
it('removes embedded conversation and delegates to the existing floating chat',()=>{
 const screen=readFileSync('src/presentation/social/SocialScreen.tsx','utf8');expect(screen).not.toContain('<ChatPanel');expect(screen).toContain('onOpenChat(friend.username)');
 const sidebar=readFileSync('src/presentation/social/SocialSidebar.tsx','utf8');expect(sidebar).toContain('<ChatPanel');expect(sidebar).toContain('initialFriend');
});
it('removes the redundant summary and leaves one full-history CTA after recent matches',()=>{
 const screen=readFileSync('src/presentation/social/SocialScreen.tsx','utf8');
 expect(screen).not.toContain('<FriendHistory');expect(screen).toContain('key={`matches-${friend.username}`}');expect(screen.match(/className="friend-full-history"/g)).toHaveLength(1);expect(screen.indexOf('className="friend-full-history"')).toBeGreaterThan(screen.indexOf('<PvpHistory key='));
});
