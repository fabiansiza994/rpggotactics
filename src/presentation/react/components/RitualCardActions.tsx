import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GameEngine, GameState } from "../../../game";
import { useBattleStore } from "../../store/battleStore";
import { FINAL_CARD_ART } from "../../assets/paintedAssets";
import { ERROR_LABEL } from "../format";
import "../../../styles/ritual-card-actions.css";
export function ritualActionAvailability(engine: GameEngine, uid: string) {
  const card = engine.state.player.hand.find((c) => c.uid === uid),
    def = card && engine.content.cards[card.cardId];
  if (!def?.ritualPiece) return null;
  const play = engine.getCardPlayability(uid),
    seal = engine.getCommitPlayability(uid);
  const self = engine.selectionTargeting(uid)?.type === "SELF";
  return {
    play,
    seal,
    self,
    hasTarget: self || engine.getValidTargets(uid).length > 0,
  };
}
/** Presentation only. Both actions use the existing dispatcher and authoritative legality. */
export function RitualCardActions({
  uid,
  state,
  engine,
  busy,
}: {
  uid: string;
  state: Readonly<GameState>;
  engine: GameEngine;
  busy: boolean;
}) {
  const [aiming, setAiming] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const notice = useBattleStore((s) => s.notice);
  const root = useRef<HTMLDivElement>(null),
    sent = useRef(false);
  const card = state.player.hand.find((c) => c.uid === uid),
    def = card && engine.content.cards[card.cardId];
  const availability = ritualActionAvailability(engine, uid);
  const seal = availability?.seal,
    play = availability?.play,
    self = availability?.self,
    hasTarget = availability?.hasTarget;
  const allowed = state.phase === "PLAYER" && !busy;
  useEffect(() => {
    if (aiming) return;
    const update = () => {
      const anchor = document.querySelector(
        `[data-card-uid="${CSS.escape(uid)}"]`,
      );
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const width = Math.min(280, innerWidth - 24),
        height = root.current?.offsetHeight ?? 166;
      setPosition({
        left: Math.max(
          12,
          Math.min(innerWidth - width - 12, a.left + a.width / 2 - width / 2),
        ),
        top: Math.max(
          12,
          Math.min(innerHeight - height - 12, a.top - height - 12),
        ),
        ready: true,
      });
    };
    update();
    let frame = 0;
    const started = performance.now();
    const settle = (now: number) => {
      update();
      if (now - started < 320) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = new ResizeObserver(update);
    if (root.current) observer.observe(root.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [uid, aiming]);
  useEffect(() => {
    if (!busy) sent.current = false;
  }, [busy, notice]);
  useEffect(() => {
    if (position.ready && !aiming)
      root.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [position.ready, aiming]);
  const cancel = () => useBattleStore.getState().selectCard(null);
  if (!def?.ritualPiece || !seal || aiming) return null;
  const reason = (check: typeof play) =>
    check && !check.playable ? ERROR_LABEL[check.reason] : undefined;
  return createPortal(
    <div
      className="ritual-choice-layer"
      data-ritual-choice="true"
      role="dialog"
      aria-modal="true"
      aria-label={`Decide cómo usar ${def.name}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Tab") {
          const list = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const i = list.indexOf(document.activeElement as HTMLButtonElement);
          e.preventDefault();
          list[
            (i + (e.shiftKey ? -1 : 1) + list.length) % list.length
          ]?.focus();
        }
      }}
    >
      <button
        className="ritual-choice-backdrop"
        aria-label="Cancelar decisión de ritual"
        onClick={cancel}
        tabIndex={-1}
      />
      <div
        ref={root}
        className="ritual-choice"
        style={{
          left: position.left,
          top: position.top,
          visibility: position.ready ? "visible" : "hidden",
        }}
      >
        <div className="ritual-choice-heading">{def.name}</div>
        <div className="ritual-choice-options">
          <button
            className="ritual-choice-card is-seal"
            disabled={!allowed || !seal.playable}
            title={reason(seal)}
            onClick={() => {
              if (sent.current) return;
              sent.current = true;
              useBattleStore.getState().commitRitualPiece(uid);
            }}
          >
            <span className="ritual-choice-art">
              <img src={FINAL_CARD_ART[def.id]} alt="" />
              <span aria-hidden="true">✦</span>
            </span>
            <span className="ritual-choice-flames" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <i
                  key={i}
                  style={{
                    animationDelay: `${i * -0.23}s`,
                    left: `${14 + i * 22}%`,
                  }}
                />
              ))}
            </span>
            <strong>Enviar al altar</strong>
            <small>{engine.getAltarStatus()?.nextSealCost ?? 0} energía</small>
            {!seal.playable && <small>{reason(seal)}</small>}
          </button>
          <button
            className="ritual-choice-card is-effect"
            disabled={!allowed || !play?.playable || !hasTarget}
            title={!hasTarget ? "Sin objetivo válido" : reason(play)}
            onClick={() => {
              if (sent.current) return;
              sent.current = true;
              const panel = document.querySelector<HTMLDetailsElement>(
                '[data-testid="altar-panel"]',
              );
              if (panel) panel.open = false;
              setAiming(true);
              if (self) useBattleStore.getState().selectCard(uid);
            }}
          >
            <span className="ritual-choice-art">
              <img src={FINAL_CARD_ART[def.id]} alt="" />
              <span aria-hidden="true">✧</span>
            </span>
            <strong>Activar efecto</strong>
            <small>{engine.getCardCost(uid)?.cost ?? def.cost} energía</small>
            {(!play?.playable || !hasTarget) && (
              <small>{!hasTarget ? "Sin objetivo válido" : reason(play)}</small>
            )}
          </button>
        </div>
        <button className="ritual-choice-cancel" onClick={cancel}>
          Cancelar
        </button>
      </div>
    </div>,
    document.body,
  );
}
