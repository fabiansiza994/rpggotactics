import { createPortal } from "react-dom";
import {
  useSyncExternalStore,
  type CSSProperties,
  type ComponentPropsWithoutRef,
} from "react";
import {
  subscribeScreenViewport,
  screenViewportSnapshot,
  SERVER_VIEWPORT,
} from "../../immersion/screenViewport";
import "../../../styles/screen-status-layer.css";
/** One shared positioning/lifecycle contract for existing screen effects; not a second VFX engine. */
export function ScreenStatusLayer({
  className = "",
  style,
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  const viewport = useSyncExternalStore(
    subscribeScreenViewport,
    screenViewportSnapshot,
    () => SERVER_VIEWPORT,
  );
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      {...props}
      className={`screen-status-vfx ${className}`}
      aria-hidden="true"
      data-page-hidden={viewport.hidden}
      style={
        {
          ...style,
          left: viewport.left,
          top: viewport.top,
          width: viewport.width,
          height: viewport.height,
          "--screen-fall-distance": `${viewport.height}px`,
        } as CSSProperties
      }
    >
      {children}
    </div>,
    document.body,
  );
}
