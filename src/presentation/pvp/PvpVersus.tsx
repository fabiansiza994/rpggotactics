import { useEffect, useRef } from "react";
import { RankedAvatar } from "../profile/RankedAvatar";
import { PRESENTATION_CONTENT } from "../qa/shapeshifter/runtime";
import type { LobbyRoom } from "./PvpLobby";
import "../../styles/pvp-versus.css";
export const PVP_VERSUS_MS = 3000;
/** Pre-ready presentation: the server turn clock has not started. No game state is owned here. */
export function PvpVersus({
  room,
  onFinish,
  onCancel,
}: {
  room: LobbyRoom;
  onFinish(): void;
  onCancel(): void;
}) {
  const finish = useRef(onFinish),
    cancel = useRef(onCancel);
  useEffect(() => {
    finish.current = onFinish;
    cancel.current = onCancel;
  });
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const end = () => finish.current();
    const timer = setTimeout(end, media.matches ? 0 : PVP_VERSUS_MS);
    const visibility = () => {
      if (document.hidden) cancel.current();
    };
    const reduced = () => {
      if (media.matches) end();
    };
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", reduced);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", reduced);
    };
  }, []);
  useEffect(() => {
    if (room.members.length !== 2 || room.members.some((m) => !m.connected))
      cancel.current();
  }, [room.members]);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let audio: AudioContext | undefined;
    try {
      audio = new AudioContext();
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(140, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        50,
        audio.currentTime + 0.22,
      );
      gain.gain.setValueAtTime(0.035, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.24);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.25);
      void audio.resume().catch(() => {});
    } catch {
      /* Browser audio policy must never block entry. */
    }
    const close = setTimeout(() => {
      void audio?.close().catch(() => {});
    }, 500);
    return () => {
      clearTimeout(close);
      if (audio?.state !== "closed") void audio?.close().catch(() => {});
    };
  }, []);
  const seats = [room.members[room.seat], room.members[1 - room.seat]];
  return (
    <section
      className="pvp-versus"
      role="dialog"
      aria-modal="true"
      aria-label="Enfrentamiento confirmado"
      onKeyDown={(e) => {
        if (e.key === "Escape") onFinish();
        if (e.key === "Tab") {
          const buttons = Array.from(
            e.currentTarget.querySelectorAll("button"),
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          e.preventDefault();
          buttons[
            (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
          ]?.focus();
        }
      }}
    >
      <div className="pvp-versus-energy" aria-hidden="true" />
      <div className="pvp-versus-fighters">
        {seats.map((member, index) => (
          <article className={`pvp-versus-fighter side-${index}`} key={index}>
            <RankedAvatar
              avatarId={member?.avatarId}
              frameId={member?.frameId}
            />
            <h2>{member?.name ?? "Rival"}</h2>
            <p>
              {PRESENTATION_CONTENT.heroes[member?.heroId ?? ""]?.name ??
                "Campeón"}
            </p>
            {member?.kind === "BOT" && (
              <small>Rival automatizado · recompensas IA</small>
            )}
          </article>
        ))}
      </div>
      <strong className="pvp-versus-mark" aria-hidden="true">
        VS
      </strong>
      <p className="pvp-versus-caption" role="status">
        El enfrentamiento está listo
      </p>
      <div className="pvp-versus-controls">
        <button autoFocus onClick={onFinish}>
          Omitir presentación
        </button>
        <button onClick={onCancel}>Volver al lobby</button>
      </div>
    </section>
  );
}
