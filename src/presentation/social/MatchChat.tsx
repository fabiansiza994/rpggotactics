import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadSession } from '../cloud/session';
import { socialApi, type Friend } from './api';
import { ChatPanel, PRESENCE_LABEL, SocialAvatar } from './ChatPanel';
import { useSocialStore } from './socialStore';
import '../../styles/social.css';

/** Wide enough for a docked panel beside the board without shrinking it below its desktop layout. */
const DOCK_QUERY = '(min-width: 1280px) and (min-height: 640px)';
const COLLAPSED_KEY = 'rpg-go-tactics:match-chat-collapsed';

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The rival as a friend (same conversation as the Amigos screen), or null: no friend chat. */
export function useMatchFriend(code: string | null): Friend | null {
  const [friend, setFriend] = useState<Friend | null>(null);
  // Re-check when the friend list changes (unfriend/block mid-match disables chat).
  const signature = useSocialStore(
    (s) => s.overview?.friends.map((f) => f.username).join(',') ?? '',
  );
  const live = useSocialStore(
    (s) => s.overview?.friends.find((f) => f.username === friend?.username) ?? null,
  );
  useEffect(() => {
    const token = loadSession()?.token;
    if (!code || !token) return;
    let alive = true;
    void socialApi.matchFriend(token, code).then((res) => {
      if (alive) setFriend(res.ok ? res.data.friend : null);
    });
    return () => {
      alive = false;
    };
  }, [code, signature]);
  return friend ? { ...friend, ...(live ?? {}) } : null;
}

/**
 * In-match surface for the friend conversation. Desktop: a collapsible column beside the
 * battlefield. Phones: a compact button (with unread badge) that opens a drawer, closed with one
 * tap. It only talks to the social API: chat never touches the battle socket or state.
 */
export function MatchChat({ friend }: { friend: Friend }) {
  const docked = useMedia(DOCK_QUERY);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  const conversationId = friend.conversationId;
  if (!conversationId) return null;
  const unread = friend.unread;
  function collapse(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* per-device convenience only */
    }
  }
  const head = (close: () => void, label: string) => (
    <header className="match-chat-head">
      <SocialAvatar heroId={friend.heroId} frameId={friend.frameId} presence={friend.presence} />
      <span className="social-name">
        <b>{friend.username}</b>
        <small>{PRESENCE_LABEL[friend.presence]}</small>
      </span>
      <button type="button" className="match-chat-close" aria-label={label} onClick={close}>
        {docked ? '›' : '✕'}
      </button>
    </header>
  );

  if (docked)
    return collapsed ? (
      <aside className="match-chat is-docked is-collapsed" aria-label="Chat con tu amigo">
        <button
          type="button"
          className="match-chat-rail"
          onClick={() => collapse(false)}
          aria-label={`Abrir chat con ${friend.username}${unread ? `, ${unread} sin leer` : ''}`}
        >
          <span aria-hidden="true">‹</span>
          <b>Chat</b>
          {unread > 0 && <em className="social-badge">{unread}</em>}
        </button>
      </aside>
    ) : (
      <aside className="match-chat is-docked" aria-label="Chat con tu amigo">
        {head(() => collapse(true), 'Contraer chat')}
        <ChatPanel conversationId={conversationId} friend={friend.username} compact />
      </aside>
    );

  return (
    <>
      <button
        type="button"
        className="match-chat-fab"
        aria-label={`Chat con ${friend.username}${unread ? `, ${unread} sin leer` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✉</span>
        {unread > 0 && <em className="social-badge">{unread > 9 ? '9+' : unread}</em>}
      </button>
      {open && (
        <div className="match-chat-backdrop" onClick={() => setOpen(false)}>
          <aside
            className="match-chat is-drawer"
            role="dialog"
            aria-label={`Chat con ${friend.username}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            {head(() => setOpen(false), 'Cerrar chat y volver a la partida')}
            <ChatPanel conversationId={conversationId} friend={friend.username} compact />
          </aside>
        </div>
      )}
    </>
  );
}
