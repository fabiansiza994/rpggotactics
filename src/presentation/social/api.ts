import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';

/** Shapes returned by /api/tactics/social/* (server/src/social.ts). */
export type Presence = 'ONLINE' | 'IN_PVP' | 'OFFLINE';
export interface Friend {
  avatarId?: string | null;
  username: string;
  heroId: string | null;
  frameId: string | null;
  /** Equipped mastery title id (absent on servers before Champion Mastery). */
  titleId?: string | null;
  /** Equipped Ranked crest (absent on servers before the Ranked cosmetics equip). */
  crestId?: string | null;
  presence: Presence;
  unread: number;
  conversationId: string | null;
  lastMessageAt: number | null;
  since: number;
}
export interface PlayerCard {
  avatarId?: string | null;
  username: string;
  heroId: string | null;
  frameId: string | null;
  titleId?: string | null;
}
export interface PendingRequest extends PlayerCard {
  sentAt: number;
}
export type Relation = 'NONE' | 'FRIEND' | 'INCOMING' | 'OUTGOING' | 'BLOCKED';
export interface SearchResult extends PlayerCard {
  relation: Relation;
}
export interface Invite {
  inviteId: string;
  from: string;
  to: string;
  mode: 'DUEL' | 'DOMINION';
  mapId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  code: string | null;
  expiresAt: number;
}
export interface Overview {
  serverTime: number;
  me: { username: string };
  friends: Friend[];
  incoming: PendingRequest[];
  outgoing: PendingRequest[];
  blocked: string[];
  invites: { incoming: Invite[]; outgoing: Invite[] };
  /** gifts = unclaimed store gifts (absent on servers without gifting). */
  counts: { unread: number; requests: number; invites: number; gifts?: number };
}
export interface ChatMessage {
  id: number;
  mine: boolean;
  body: string;
  createdAt: number;
  readAt: number | null;
}
export interface ConversationPage {
  conversationId: string;
  with: string | null;
  friend: Friend | null;
  canSend: boolean;
  messages: ChatMessage[];
}
export type ReportReason = 'SPAM' | 'HARASSMENT' | 'OFFENSIVE_CONTENT' | 'OTHER';
/** Pushed over the user's social socket. Best effort: REST is the source of truth. */
export type SocialEvent =
  | { type: 'social'; event: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED'; username: string }
  | { type: 'social'; event: 'FRIENDS_CHANGED' }
  | { type: 'social'; event: 'UNREAD_CHANGED'; conversationId: string }
  | { type: 'social'; event: 'MESSAGE'; conversationId: string; from: string; message: ChatMessage }
  | { type: 'social'; event: 'INVITE' | 'INVITE_UPDATE'; invite: Invite };

const base = '/api/tactics/social';
const opts = (token: string, method = 'GET', body?: unknown) => ({
  method,
  token,
  body,
  timeoutMs: CLOUD_CONFIG.timeoutMs,
});

export interface FriendProfileData {
 lastSeen:number|null;inMatch:boolean;
 ranked:{rp:number;seasonId:string}|null;
 mostUsed:{champion:string;matches:number}|null;
 mastery:{champion:string;xp:number}|null;
 lastMatch:{champion:string;mode:string;result:string;playedAt:number}|null;
}
export const socialApi = {
  profile:(token:string,username:string)=>request<FriendProfileData>(CLOUD_CONFIG.apiUrl,`${base}/profile/${encodeURIComponent(username)}`,opts(token)),
  overview: (token: string) =>
    request<Overview>(CLOUD_CONFIG.apiUrl, `${base}/overview`, opts(token)),
  search: (token: string, q: string) =>
    request<{ results: SearchResult[] }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/search?q=${encodeURIComponent(q)}`,
      opts(token),
    ),
  relation: (
    token: string,
    action:
      | 'requests'
      | 'requests/accept'
      | 'requests/reject'
      | 'requests/cancel'
      | 'friends/remove'
      | 'block'
      | 'unblock',
    username: string,
  ) =>
    request<Overview>(CLOUD_CONFIG.apiUrl, `${base}/${action}`, opts(token, 'POST', { username })),
  messages: (token: string, conversationId: string, before?: number) =>
    request<ConversationPage>(
      CLOUD_CONFIG.apiUrl,
      `${base}/conversations/${conversationId}/messages${before ? `?before=${before}` : ''}`,
      opts(token),
    ),
  send: (token: string, conversationId: string, body: string) =>
    request<{ message: ChatMessage }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/conversations/${conversationId}/messages`,
      opts(token, 'POST', { body }),
    ),
  markRead: (token: string, conversationId: string) =>
    request<{ ok: true }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/conversations/${conversationId}/read`,
      opts(token, 'POST', {}),
    ),
  matchFriend: (token: string, code: string) =>
    request<{ friend: Friend | null }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/match?code=${encodeURIComponent(code)}`,
      opts(token),
    ),
  invite: (token: string, username: string, mode: 'DUEL' | 'DOMINION', mapId: string) =>
    request<{ invite: Invite }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/invites`,
      opts(token, 'POST', { username, mode, mapId }),
    ),
  respond: (token: string, inviteId: string, action: 'accept' | 'reject' | 'cancel') =>
    request<{ invite: Invite; code?: string }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/invites/${inviteId}/${action}`,
      opts(token, 'POST', {}),
    ),
  report: (token: string, username: string, reason: ReportReason, messageId?: number) =>
    request<{ ok: true }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/report`,
      opts(token, 'POST', { username, reason, messageId }),
    ),
  connect: (token: string) =>
    request<{ ticket: string; hub: string }>(
      CLOUD_CONFIG.apiUrl,
      `${base}/connect`,
      opts(token, 'POST', {}),
    ),
};

export const SOCIAL_MESSAGE_MAX = 500;
