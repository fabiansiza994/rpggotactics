import { CONTENT_RELEASE } from '../cloud/contentRelease';
import { create } from 'zustand';
import { CLOUD_CONFIG } from '../cloud/config';
import type { CloudResult } from '../cloud/http';
import { loadSession } from '../cloud/session';
import { useBattleStore } from '../store/battleStore';
import {
  socialApi,
  type ChatMessage,
  type Invite,
  type Overview,
  type ReportReason,
  type SearchResult,
  type SocialEvent,
} from './api';

/**
 * Social client state: friends overview, cached conversations, toasts and the user's social
 * socket. Completely separate from the PvP socket and battle store: if anything here fails, a
 * battle never notices. The socket only delivers hints; every list is re-read over REST.
 */
export interface ConversationCache {
  messages: ChatMessage[];
  with: string | null;
  canSend: boolean;
  loaded: boolean;
  hasMore: boolean;
}
export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}
type Live = 'OFF' | 'CONNECTING' | 'LIVE' | 'POLLING';
type Relation = Parameters<typeof socialApi.relation>[1];

interface SocialState {
  live: Live;
  overview: Overview | null;
  conversations: Record<string, ConversationCache>;
  /** Conversations currently on screen (count per surface): new messages there are marked read. */
  visible: Record<string, number>;
  toasts: Toast[];
  /** Set when an invite we sent or accepted became a room: the app opens the PvP lobby. */
  roomReady: { code: string; at: number } | null;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  search(
    q: string,
  ): Promise<{ ok: true; results: SearchResult[] } | { ok: false; message: string }>;
  relation(action: Relation, username: string): Promise<string | null>;
  openConversation(conversationId: string): Promise<void>;
  loadOlder(conversationId: string): Promise<void>;
  show(conversationId: string): () => void;
  send(conversationId: string, body: string): Promise<string | null>;
  invite(username: string, mode: 'DUEL' | 'DOMINION', mapId: string): Promise<string | null>;
  respond(invite: Invite, action: 'accept' | 'reject' | 'cancel'): Promise<string | null>;
  report(username: string, reason: ReportReason, messageId?: number): Promise<string | null>;
  toast(text: string, tone?: Toast['tone']): void;
  dismiss(id: number): void;
  consumeRoom(): void;
}

let socket: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let poller: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let generation = 0;
let toastSeq = 0;
let refreshing: Promise<void> | null = null;

const token = () => loadSession()?.token ?? null;

/** Common failure handling: an expired session goes through the normal account flow. */
function failure<T>(res: CloudResult<T>, used: string | null): string | null {
  if (res.ok) return null;
  if (res.error.kind === 'AUTH' && used && loadSession()?.token === used)
    useBattleStore.getState().sessionExpired();
  return res.error.message;
}

export const useSocialStore = create<SocialState>((set, get) => {
  /**
   * Adds a live message even when the conversation's first load is still in flight (the load
   * merges it back in), so a message sent or received in that window is never lost from view.
   */
  function append(conversationId: string, message: ChatMessage) {
    set((s) => {
      const cached = s.conversations[conversationId] ?? {
        messages: [],
        with: null,
        canSend: true,
        loaded: false,
        hasMore: false,
      };
      if (cached.messages.some((m) => m.id === message.id)) return {};
      const messages = [...cached.messages, message].sort((x, y) => x.id - y.id);
      return { conversations: { ...s.conversations, [conversationId]: { ...cached, messages } } };
    });
  }
  function onEvent(data: SocialEvent) {
    const s = get();
    if (data.event === 'MESSAGE') {
      append(data.conversationId, data.message);
      if (data.message.mine) return;
      if (s.visible[data.conversationId]) {
        const t = token();
        if (t) void socialApi.markRead(t, data.conversationId);
        return;
      }
      if (s.overview)
        set({
          overview: {
            ...s.overview,
            counts: { ...s.overview.counts, unread: s.overview.counts.unread + 1 },
            friends: s.overview.friends.map((f) =>
              f.conversationId === data.conversationId
                ? { ...f, unread: f.unread + 1, lastMessageAt: data.message.createdAt }
                : f,
            ),
          },
        });
      get().toast(`Nuevo mensaje de ${data.from}`);
      return;
    }
    if (data.event === 'FRIEND_REQUEST') get().toast(`${data.username} quiere ser tu amigo`);
    if (data.event === 'FRIEND_ACCEPTED') get().toast(`${data.username} aceptó tu solicitud`);
    // INVITE: no toast — the challenge card and the Amigos badge show it.
    if (data.event === 'INVITE_UPDATE') {
      const me = s.overview?.me.username;
      if (data.invite.status === 'REJECTED') get().toast('INVITACIÓN RECHAZADA', 'warn');
      if (data.invite.status === 'CANCELLED' && data.invite.to === me)
        get().toast(`${data.invite.from} canceló el desafío`, 'warn');
      if (data.invite.status === 'ACCEPTED' && data.invite.code && data.invite.from === me) {
        get().toast(`${data.invite.to} aceptó tu desafío`);
        set({ roomReady: { code: data.invite.code, at: Date.now() } });
      }
    }
    void get().refresh();
  }

  async function connect() {
    const mine = ++generation;
    const t = token();
    if (!t || !CLOUD_CONFIG.apiUrl) return;
    set({ live: 'CONNECTING' });
    const res = await socialApi.connect(t);
    if (mine !== generation) return;
    if (!res.ok) {
      failure(res, t);
      return schedule();
    }
    const url = new URL(CLOUD_CONFIG.apiUrl + '/api/tactics/social/socket');
      url.searchParams.set('clientRelease', CONTENT_RELEASE);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('hub', res.data.hub);
    url.searchParams.set('ticket', res.data.ticket);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return schedule();
    }
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      attempts = 0;
      set({ live: 'LIVE' });
      void get().refresh();
    };
    ws.onmessage = (e) => {
      if (socket !== ws) return;
      try {
        const data = JSON.parse(String(e.data)) as SocialEvent | { type: 'pong' };
        if (data.type === 'social') onEvent(data);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      schedule();
    };
    ws.onerror = () => ws.close();
  }

  /** Reconnect with backoff; meanwhile the poller keeps the overview fresh. */
  function schedule() {
    if (generation < 0) return;
    set({ live: 'POLLING' });
    if (retry) clearTimeout(retry);
    const delay = [2000, 5000, 10000, 30000][Math.min(attempts++, 3)]!;
    retry = setTimeout(() => void connect(), delay);
  }

  return {
    live: 'OFF',
    overview: null,
    conversations: {},
    visible: {},
    toasts: [],
    roomReady: null,

    start() {
      if (get().live !== 'OFF' || !token()) return;
      generation = Math.max(generation, 0);
      attempts = 0;
      void get().refresh();
      void connect();
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
      }, 30_000);
      // Presence and fallback: a light refresh even when live; faster when the socket is down.
      let tick = 0;
      poller = setInterval(() => {
        if (get().live !== 'LIVE' || ++tick % 3 === 0) void get().refresh();
      }, 20_000);
    },

    stop() {
      generation = -1;
      for (const timer of [heartbeat, poller]) if (timer) clearInterval(timer);
      if (retry) clearTimeout(retry);
      heartbeat = poller = retry = null;
      const ws = socket;
      socket = null;
      ws?.close();
      set({
        live: 'OFF',
        overview: null,
        conversations: {},
        visible: {},
        toasts: [],
        roomReady: null,
      });
    },

    refresh() {
      if (refreshing) return refreshing;
      const t = token();
      if (!t) return Promise.resolve();
      refreshing = socialApi
        .overview(t)
        .then((res) => {
          if (res.ok) set({ overview: res.data });
          else failure(res, t);
        })
        .finally(() => {
          refreshing = null;
        });
      return refreshing;
    },

    async search(q) {
      const t = token();
      if (!t) return { ok: false, message: 'Inicia sesión.' };
      const res = await socialApi.search(t, q);
      return res.ok
        ? { ok: true, results: res.data.results }
        : { ok: false, message: failure(res, t)! };
    },

    async relation(action, username) {
      const t = token();
      if (!t) return 'Inicia sesión.';
      const res = await socialApi.relation(t, action, username);
      if (res.ok) set({ overview: res.data });
      return failure(res, t);
    },

    async openConversation(conversationId) {
      const t = token();
      if (!t) return;
      const res = await socialApi.messages(t, conversationId);
      if (!res.ok) return void failure(res, t);
      set((s) => ({
        conversations: {
          ...s.conversations,
          [conversationId]: {
            // Keep live messages that arrived while loading.
            messages: [
              ...res.data.messages,
              ...(s.conversations[conversationId]?.messages ?? []).filter(
                (m) =>
                  !res.data.messages.some((x) => x.id === m.id) &&
                  m.id > (res.data.messages.at(-1)?.id ?? 0),
              ),
            ],
            with: res.data.with,
            canSend: res.data.canSend,
            loaded: true,
            hasMore: res.data.messages.length >= 50,
          },
        },
      }));
      if (res.data.messages.some((m) => !m.mine && m.readAt === null)) {
        await socialApi.markRead(t, conversationId);
        void get().refresh();
      }
    },

    async loadOlder(conversationId) {
      const t = token();
      const cached = get().conversations[conversationId];
      if (!t || !cached?.messages.length) return;
      const res = await socialApi.messages(t, conversationId, cached.messages[0]!.id);
      if (!res.ok) return void failure(res, t);
      set((s) => ({
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...(s.conversations[conversationId] ?? cached),
            // Current list (it may have grown while loading) after the older page.
            messages: [
              ...res.data.messages,
              ...(s.conversations[conversationId] ?? cached).messages.filter(
                (m) => !res.data.messages.some((x) => x.id === m.id),
              ),
            ],
            hasMore: res.data.messages.length >= 50,
          },
        },
      }));
    },

    show(conversationId) {
      set((s) => ({
        visible: { ...s.visible, [conversationId]: (s.visible[conversationId] ?? 0) + 1 },
      }));
      return () =>
        set((s) => {
          const next = { ...s.visible };
          if ((next[conversationId] ?? 0) <= 1) delete next[conversationId];
          else next[conversationId]! -= 1;
          return { visible: next };
        });
    },

    async send(conversationId, body) {
      const t = token();
      if (!t) return 'Inicia sesión.';
      const res = await socialApi.send(t, conversationId, body);
      if (res.ok) {
        append(conversationId, res.data.message);
        return null;
      }
      if (res.error.code === 'CHAT_DISABLED') {
        const cached = get().conversations[conversationId];
        if (cached)
          set((s) => ({
            conversations: { ...s.conversations, [conversationId]: { ...cached, canSend: false } },
          }));
      }
      return failure(res, t);
    },

    async invite(username, mode, mapId) {
      const t = token();
      if (!t) return 'Inicia sesión.';
      const res = await socialApi.invite(t, username, mode, mapId);
      void get().refresh();
      return failure(res, t);
    },

    async respond(invite, action) {
      const t = token();
      if (!t) return 'Inicia sesión.';
      const res = await socialApi.respond(t, invite.inviteId, action);
      void get().refresh();
      if (res.ok && action === 'accept' && res.data.code)
        set({ roomReady: { code: res.data.code, at: Date.now() } });
      return failure(res, t);
    },

    async report(username, reason, messageId) {
      const t = token();
      if (!t) return 'Inicia sesión.';
      return failure(await socialApi.report(t, username, reason, messageId), t);
    },

    toast(text, tone = 'info') {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
      setTimeout(() => get().dismiss(id), 5000);
    },
    dismiss(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    consumeRoom() {
      set({ roomReady: null });
    },
  };
});

/** Badge total for the main menu: unread messages + pending requests + incoming challenges. */
export const socialBadge = (s: Pick<SocialState, 'overview'>) =>
  s.overview
    ? s.overview.counts.unread + s.overview.counts.requests + s.overview.counts.invites + (s.overview.counts.gifts ?? 0)
    : 0;
