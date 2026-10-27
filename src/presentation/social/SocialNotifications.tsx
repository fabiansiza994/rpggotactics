import { useEffect, useRef, useState } from 'react';
import { useBattleStore } from '../store/battleStore';
import { InviteCard } from './Invites';
import { useSocialStore } from './socialStore';
import type { Invite } from './api';
import '../../styles/social.css';

const NO_INVITES: Invite[] = [];

/** Starts/stops the social connection with the signed-in account (cloud READY only). */
export function SocialRuntime() {
  const ready = useBattleStore((s) => s.account.status === 'READY');
  const user = useBattleStore((s) => (s.account.status === 'READY' ? s.account.userId : null));
  useEffect(() => {
    if (!ready) return;
    useSocialStore.getState().start();
    return () => useSocialStore.getState().stop();
  }, [ready, user]);
  return null;
}

/**
 * Lightweight in-game notifications: toasts (requests, accepted, messages, invite results) and an
 * incoming challenge card. Challenges are not shown over an active PvP match (`suppressInvites`)
 * and toasts not over any battle (`quiet`); the Amigos badge keeps the count. No flashing: a single slide-in, then it stays still.
 */
export function SocialNotifications({
  suppressInvites = false,
  quiet = false,
}: {
  suppressInvites?: boolean;
  quiet?: boolean;
}) {
  const toasts = useSocialStore((s) => s.toasts);
  const invites = useSocialStore((s) => s.overview?.invites.incoming ?? NO_INVITES);
  const [hidden, setHidden] = useState<string[]>([]);
  const invite = suppressInvites
    ? null
    : (invites.find((i) => !hidden.includes(i.inviteId)) ?? null);
  const card = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (invite)
      card.current?.querySelector<HTMLButtonElement>('.is-primary')?.focus({ preventScroll: true });
  }, [invite?.inviteId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {invite && (
        <div
          className="social-challenge-pop"
          ref={card}
          role="alertdialog"
          aria-label={`${invite.from} te desafía`}
        >
          <InviteCard invite={invite} incoming />
          <button
            type="button"
            className="social-pop-later"
            onClick={() => setHidden((h) => [...h, invite.inviteId])}
          >
            Más tarde
          </button>
        </div>
      )}
      <div className="social-toasts" aria-live="polite">
        {/* In a battle the chat button/panel carries the unread badge instead of toasts. */}
        {!quiet &&
          !invite &&
          toasts.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`social-toast is-${t.tone}`}
              onClick={() => useSocialStore.getState().dismiss(t.id)}
            >
              {t.text}
            </button>
          ))}
      </div>
    </>
  );
}
