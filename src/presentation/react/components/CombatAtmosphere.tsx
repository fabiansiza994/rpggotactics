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
  const blood = useRef<HTMLDivElement>(null);
  const previousHp = useRef(view.hp);
  useEffect(() => {
    const damaged = view.hp < previousHp.current;
    previousHp.current = view.hp;
    if (
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
  }, [view.hp, view.finished, c.mood]);
  const style = {
    "--health-opacity": c.healthOpacity,
    "--root-opacity": c.rootOpacity,
    "--terrain-opacity": c.terrainOpacity,
  } as CSSProperties;
  return (
    <div
      className="combat-atmosphere"
      aria-hidden="true"
      data-mood={c.mood}
      data-rooted={c.rooted}
      data-subtle={settings.subtle}
      data-terrain={c.terrain}
      style={style}
    >
      <div className="combat-health-edge">
        <div ref={blood} className="combat-blood-texture" />
      </div>
      <div className="combat-terrain-edge">
        <div className="combat-ice-texture" />
        <div className="combat-fire-texture" />
        <div className="combat-edge-motes">
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
      <div className="combat-root-edge">
        <div className="combat-root-texture" />
      </div>
    </div>
  );
}
