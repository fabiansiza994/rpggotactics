import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {profileAvatar} from '../../shared/profileAvatars';
import { ProfileFrame } from '../shop/ProfileFrame';
import { SOCIAL_MESSAGE_MAX, type Presence, type ReportReason } from './api';
import { useSocialStore } from './socialStore';

export const PRESENCE_LABEL: Record<Presence, string> = {
  ONLINE: 'En línea',
  IN_PVP: 'En partida PvP',
  OFFLINE: 'Desconectado',
};
export const REPORT_LABEL: Record<ReportReason, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Acoso',
  OFFENSIVE_CONTENT: 'Contenido ofensivo',
  OTHER: 'Otro motivo',
};

/** Champion portrait in the player's public profile frame (public-safe data only). */
export function SocialAvatar({
  avatarId,
  frameId,
  presence,
}: {
  heroId?: string | null;
  avatarId?: string | null;
  frameId: string | null;
  presence?: Presence;
}) {
  const avatar = profileAvatar(avatarId);
  return (
    <span className="social-avatar" data-presence={presence}>
      <ProfileFrame frameId={frameId}>
        <img src={avatar.asset} alt={avatar.name} draggable={false} onError={e=>{if(e.currentTarget.dataset.fallback){e.currentTarget.style.visibility='hidden';return;}e.currentTarget.dataset.fallback='true';e.currentTarget.src=profileAvatar(null).asset;}}/>
      </ProfileFrame>
      {presence && <b className="social-presence-dot" aria-hidden="true" />}
    </span>
  );
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (at: number) => new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });

/**
 * One 1:1 conversation. Used by the Amigos screen and by the in-match panel: both read and write
 * the SAME conversation (there is no separate "match chat"). Text is rendered by React, i.e.
 * escaped: no HTML, markdown or link previews.
 */
export function ChatPanel({
  conversationId,
  friend,
  compact = false,
  autoFocus = false,
}: {
  conversationId: string;
  friend: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const cache = useSocialStore((s) => s.conversations[conversationId]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const [reported, setReported] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);

  useEffect(() => {
    const store = useSocialStore.getState();
    void store.openConversation(conversationId);
    return store.show(conversationId);
  }, [conversationId]);
  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus, conversationId]);
  useLayoutEffect(() => {
    if (list.current && stick.current) list.current.scrollTop = list.current.scrollHeight;
  }, [cache?.messages.length]);

  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    const failed = await useSocialStore.getState().send(conversationId, text);
    setSending(false);
    if (failed) setError(failed);
    else {
      setDraft('');
      stick.current = true;
    }
  }
  async function report(messageId: number, reason: ReportReason) {
    const failed = await useSocialStore.getState().report(friend, reason, messageId);
    setReporting(null);
    if (failed) setError(failed);
    else setReported(true);
  }

  const messages = cache?.messages ?? [];
  const days = messages.map((m) => day(m.createdAt));
  return (
    <section
      className={`social-chat ${compact ? 'is-compact' : ''}`}
      aria-label={`Conversación con ${friend}`}
    >
      <ol
        className="social-chat-log"
        ref={list}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {cache?.hasMore && (
          <li className="social-chat-more">
            <button
              type="button"
              onClick={() => void useSocialStore.getState().loadOlder(conversationId)}
            >
              Mensajes anteriores
            </button>
          </li>
        )}
        {!cache?.loaded && <li className="social-chat-empty">Cargando…</li>}
        {cache?.loaded && !messages.length && (
          <li className="social-chat-empty">Todavía no hay mensajes. ¡Saluda a {friend}!</li>
        )}
        {messages.map((m, i) => {
          const d = days[i]!;
          const divider = i === 0 || d !== days[i - 1];
          return [
            divider && !compact ? (
              <li className="social-chat-day" key={`d-${m.id}`}>
                {d}
              </li>
            ) : null,
            <li key={m.id} className={`social-msg ${m.mine ? 'is-mine' : 'is-theirs'}`}>
              <p>{m.body}</p>
              <span className="social-msg-meta">
                <time dateTime={new Date(m.createdAt).toISOString()}>{time(m.createdAt)}</time>
                {!m.mine && (
                  <button
                    type="button"
                    className="social-msg-report"
                    aria-label="Reportar mensaje"
                    title="Reportar mensaje"
                    onClick={() => setReporting(reporting === m.id ? null : m.id)}
                  >
                    ⚑
                  </button>
                )}
              </span>
              {reporting === m.id && (
                <span className="social-report-menu" role="group" aria-label="Motivo del reporte">
                  {(Object.keys(REPORT_LABEL) as ReportReason[]).map((r) => (
                    <button type="button" key={r} onClick={() => void report(m.id, r)}>
                      {REPORT_LABEL[r]}
                    </button>
                  ))}
                </span>
              )}
            </li>,
          ];
        })}
      </ol>
      {reported && (
        <p className="social-chat-note" role="status">
          Gracias. Revisaremos el reporte.
        </p>
      )}
      {cache?.loaded && !cache.canSend ? (
        <p className="social-chat-note">No puedes enviar mensajes a este jugador ahora.</p>
      ) : (
        <form
          className="social-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            maxLength={SOCIAL_MESSAGE_MAX}
            placeholder={`Mensaje para ${friend}`}
            aria-label={`Mensaje para ${friend}`}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Keys typed in the chat never reach battle shortcuts.
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {draft.length > SOCIAL_MESSAGE_MAX - 100 && (
            <span className="social-count" aria-live="polite">
              {SOCIAL_MESSAGE_MAX - draft.length}
            </span>
          )}
          <button type="submit" disabled={!draft.trim() || sending}>
            Enviar
          </button>
        </form>
      )}
      {error && (
        <p className="social-chat-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
