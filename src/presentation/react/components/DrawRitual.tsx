import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { GameEngine, GameState } from "../../../game";
import { drawRitual, drawPointerCommits } from "../../cards/drawRitual";
import { readDrawMode } from "../../cards/drawRitualSettings";
import { EquippedCardBack } from "../../cosmetics/CardBack";
import { CardView } from "./CardView";
import "../../../styles/draw-ritual.css";
export const useDrawVisual = () =>
  useSyncExternalStore(
    drawRitual.subscribe,
    drawRitual.getSnapshot,
    drawRitual.getSnapshot,
  );
export function DrawRitual({
  state,
  engine,
  busy,
  footer,
}: {
  state: Readonly<GameState>;
  engine: GameEngine;
  busy: boolean;
  footer: RefObject<HTMLElement | null>;
}) {
  const visual = useDrawVisual(),
    ticket = visual.current;
  const geometry = useRef({ x: 0, y: 0, dx: 0, dy: 0, scale: 1 }),
    overlay = useRef<HTMLDivElement>(null),
    idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active =
    !!ticket && visual.phase !== "waiting" && visual.phase !== "idle";
  const setOffset = (n: number) =>
    overlay.current?.style.setProperty("--draw-drag", `${n}px`);
  const armIdle = () => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => drawRitual.phase("committing"), 2500);
  };
  const drag = useRef<{
      x: number;
      y: number;
      at: number;
      dy: number;
      dx: number;
      moved: number;
    } | null>(null),
    button = useRef<HTMLDivElement>(null);
  const reduced =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const automatic =
    reduced || readDrawMode() === "automatic" || !ticket?.interactive;
  const commit = () => {
    drag.current = null;
    drawRitual.phase("committing");
  };
  useLayoutEffect(() => {
    if (!ticket || !overlay.current) return;
    const measure = () => {
      const card = Array.from(
        footer.current?.querySelectorAll<HTMLElement>(
          ".hand [data-card-uid]",
        ) ?? [],
      ).find((el) => el.dataset.cardUid === ticket.uid);
      const target = card?.getBoundingClientRect(),
        hand = footer.current?.querySelector(".hand")?.getBoundingClientRect();
      const x = Math.max(12, Math.min(innerWidth - 128, innerWidth / 2 - 58)),
        y = Math.max(72, (hand?.top ?? innerHeight - 150) - 224);
      geometry.current = {
        x,
        y,
        dx: (target ? target.left + target.width / 2 : innerWidth / 2) - x - 58,
        dy:
          (target ? target.top + target.height / 2 : innerHeight - 90) - y - 82,
        scale: target ? target.width / 116 : 1,
      };
      const el = overlay.current;
      if (el) {
        for (const [name, value] of Object.entries(geometry.current))
          el.style.setProperty(
            "--draw-" + name,
            name === "scale" ? String(value) : `${value}px`,
          );
      }
    };
    setOffset(0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ticket, active, footer]);
  useEffect(() => {
    if (!ticket) return;
    if (document.visibilityState === "hidden" || state.outcome) {
      drawRitual.complete();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (ms: number, fn: () => void) => {
      timer = setTimeout(fn, ms);
    };
    switch (visual.phase) {
      case "waiting":
        if (!busy) drawRitual.phase("presenting");
        break;
      case "presenting":
        later(reduced ? 40 : 180, () =>
          drawRitual.phase(automatic ? "committing" : "ready"),
        );
        break;
      case "ready":
      case "dragging":
        armIdle();
        break;
      case "springBack":
        later(reduced ? 0 : 180, () => drawRitual.phase("ready"));
        break;
      case "committing":
        drawRitual.phase("reveal");
        break;
      case "reveal":
        later(reduced ? 60 : 220, () => drawRitual.phase("flight"));
        break;
      case "flight":
        later(reduced ? 80 : 280, () => drawRitual.phase("settled"));
        break;
      case "settled":
        drawRitual.settle(ticket.key);
        break;
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(idleTimer.current);
    };
  }, [
    ticket,
    visual.phase,
    busy,
    automatic,
    reduced,
    state.outcome,
    state.player.hand,
  ]);
  useEffect(() => {
    const finish = () => drawRitual.complete();
    const action = (e: Event) => {
      if (!(e.target as HTMLElement)?.closest?.(".draw-ritual")) finish();
    };
    const visible = () => {
      if (document.visibilityState === "hidden") finish();
    };
    document.addEventListener("pointerdown", action, true);
    document.addEventListener("keydown", action, true);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("blur", finish);
    return () => {
      document.removeEventListener("pointerdown", action, true);
      document.removeEventListener("keydown", action, true);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("blur", finish);
      finish();
    };
  }, []);
  if (!active) return null;
  const def = engine.content.cards[ticket.cardId];
  if (!def) return null;
  const interactive = visual.phase === "ready" || visual.phase === "dragging";

  return createPortal(
    <div
      ref={overlay}
      className="draw-ritual"
      data-phase={visual.phase}
      data-reduced={reduced || undefined}
    >
      <div className="draw-ritual-pile" aria-hidden="true">
        <EquippedCardBack />
        <EquippedCardBack />
      </div>
      <div
        ref={button}
        className="draw-ritual-card"
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : -1}
        aria-label={
          interactive
            ? "Robar carta: toca, desliza hacia abajo o pulsa Enter"
            : undefined
        }
        onDragStart={(e) => e.preventDefault()}
        onClick={() => {
          if (interactive) commit();
        }}
        onKeyDown={(e) => {
          if (interactive && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            commit();
          }
        }}
        onPointerDown={(e) => {
          if (!interactive || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            at: performance.now(),
            dy: 0,
            dx: 0,
            moved: 0,
          };
          drawRitual.phase("dragging");
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dy = Math.max(0, e.clientY - drag.current.y);
          drag.current.dy = dy;
          drag.current.dx = e.clientX - drag.current.x;
          drag.current.moved = Math.max(
            drag.current.moved,
            Math.hypot(drag.current.dx, e.clientY - drag.current.y),
          );
          setOffset(Math.min(180, dy));
          armIdle();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          const dy = Math.max(0, e.clientY - d.y),
            dx = e.clientX - d.x,
            moved = Math.max(d.moved, Math.hypot(dx, e.clientY - d.y));
          if (
            drawPointerCommits(
              dx,
              dy,
              moved,
              performance.now() - d.at,
              geometry.current.dy,
            )
          )
            commit();
          else {
            setOffset(0);
            drawRitual.phase("springBack");
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setOffset(0);
          drawRitual.phase("springBack");
        }}
      >
        <div className="draw-ritual-back">
          <EquippedCardBack />
        </div>
        <div className="draw-ritual-front" aria-hidden="true">
          <CardView
            def={def}
            hotkey={0}
            selected={false}
            playable
            disabled
            onClick={() => {}}
          />
        </div>
      </div>
      {interactive && (
        <span className="draw-ritual-hint">Toca o desliza para robar</span>
      )}
      <span className="draw-ritual-sr" role="status">
        Carta recibida en tu mano
      </span>
    </div>,
    document.body,
  );
}
