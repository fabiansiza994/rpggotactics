import {ArcaneRevealSettings} from './ArcaneReveal';
import { useSyncExternalStore } from "react";
import {
  readImmersion,
  writeImmersion,
  subscribeImmersion,
} from "../../immersion/settings";
import "../../../styles/combat-immersion.css";
export function CombatImmersionSettings() {
  const s = useSyncExternalStore(
    subscribeImmersion,
    readImmersion,
    readImmersion,
  );
  return (
    <fieldset className="immersion-settings">
      <legend>Juego · Inmersión de combate</legend>
      <ArcaneRevealSettings/>
      <label>
        <input
          type="checkbox"
          checked={s.vibration}
          onChange={(e) =>
            writeImmersion({ ...s, vibration: e.target.checked })
          }
        />{" "}
        Vibración de combate
      </label>
      <small>
        Desactivada por defecto. Solo en dispositivos compatibles; Safari de
        iPhone puede no admitirla.
      </small>
      <label>
        Intensidad de vibración
        <select
          value={s.intensity}
          onChange={(e) =>
            writeImmersion({
              ...s,
              intensity: e.target.value as typeof s.intensity,
            })
          }
        >
          <option value="soft">Suave</option>
          <option value="normal">Normal</option>
          <option value="strong">Fuerte</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.visuals}
          onChange={(e) => writeImmersion({ ...s, visuals: e.target.checked })}
        />{" "}
        Efectos de vida crítica y ambiente
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.subtle}
          onChange={(e) => writeImmersion({ ...s, subtle: e.target.checked })}
        />{" "}
        Reducir intensidad visual
      </label>
      <small>
        Preferencias de este dispositivo. El movimiento reducido elimina el
        pulso.
      </small>
    </fieldset>
  );
}
