import {ScreenEdgeMaterial} from "./ScreenEdgeMaterial";
import {ScreenStatusLayer} from "./ScreenStatusLayer";
import {screenViewportSnapshot,subscribeScreenViewport,SERVER_VIEWPORT} from "../../immersion/screenViewport";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  composeAtmosphere,
  type AtmosphereView,
} from "../../immersion/atmosphere";
import { readImmersion, subscribeImmersion } from "../../immersion/settings";
import "../../../styles/combat-immersion.css";
/** Fixed reusable layers; no append-only particles, pointer handlers or screen-wide filter. */
export function CombatAtmosphere({ view }: { view: AtmosphereView }) {
  const settings = useSyncExternalStore(
    subscribeImmersion,
    readImmersion,
    readImmersion,
  );
  const c = composeAtmosphere(view, settings);
  const {hidden}=useSyncExternalStore(subscribeScreenViewport,screenViewportSnapshot,()=>SERVER_VIEWPORT);
  const blood = useRef<HTMLDivElement>(null);
  const previousHp = useRef(view.hp);
  useEffect(() => {
    const damaged = view.hp < previousHp.current;
    previousHp.current = view.hp;
    if (
      hidden ||
      !damaged ||
      view.finished ||
      c.mood === "normal" ||
      !blood.current ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // HP is the committed presentation projection. Mount/reconnect never replays this cue.
    const pulse = blood.current.animate?.(
      [{ opacity: 0.72 }, { opacity: 1, offset: 0.25 }, { opacity: 0.86 }],
      { duration: 320, easing: "ease-out" },
    );
    return () => pulse?.cancel();
  }, [view.hp, view.finished, c.mood, hidden]);
  const style = {
    "--health-opacity": c.healthOpacity,
    "--root-opacity": c.rootOpacity,
    "--terrain-opacity": c.terrainOpacity,
  } as CSSProperties;
  return (
    <ScreenStatusLayer
      className="combat-atmosphere"
      aria-hidden="true"
      data-mood={c.mood}
      data-rooted={c.rooted}
      data-subtle={settings.subtle}
      data-terrain={c.terrain}
      data-cold={c.cold}
      data-heat={c.heat}
      style={style}
    >
      <div className="combat-health-edge">
        <div ref={blood} className="combat-blood-texture"><ScreenEdgeMaterial/></div>
      </div>
      <div className="combat-terrain-edge">
        <div className="combat-ice-texture"><ScreenEdgeMaterial/></div>
        <div className="combat-fire-texture"><ScreenEdgeMaterial/></div>
        <div className="combat-edge-motes">
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
      <div className="combat-root-edge">
        <div className="combat-root-texture"><ScreenEdgeMaterial/></div>
      </div>
    </ScreenStatusLayer>
  );
}
