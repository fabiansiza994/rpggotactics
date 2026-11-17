import { useEffect, useState } from "react";
import { PRESENTATION_CONTENT } from "../qa/shapeshifter/runtime";
import {
  describeCardAcquisition,
  type CardAcquisitionView,
} from "../../game/store/card-acquisition";
import { storeApi } from "./api";
import { loadSession } from "../cloud/session";
import { navigatePlay } from "../play/navigation";
import "../../styles/card-acquisition.css";
export function openMarketExpansion(id: string) {
  if (!navigatePlay("store")) return;
  const u = new URL(location.href);
  u.searchParams.set("market", "packs");
  u.searchParams.set("expansion", id);
  history.replaceState(history.state, "", u);
  window.dispatchEvent(new Event("rpggo-play-route"));
  window.dispatchEvent(new Event("rpggo-market-route"));
}
const requests = new Map<string, ReturnType<typeof storeApi.acquisition>>();
export function CardAcquisition({
  cardId,
  onExpansion,
}: {
  cardId: string;
  onExpansion?: (id: string) => void;
}) {
  const [remote, setRemote] = useState<Record<
    string,
    CardAcquisitionView
  > | null>(null);
  const session = loadSession();
  const token = session?.token;
  useEffect(() => {
    let alive = true;
    if (token) {
      let pending = requests.get(token);
      if (!pending) {
        pending = storeApi.acquisition(token);
        requests.set(token, pending);
      }
      void pending.then((r) => {
        if (alive && loadSession()?.token === token && r.ok)
          setRemote(r.data.cards);
        if (!r.ok) requests.delete(token);
      });
    }
    return () => {
      alive = false;
    };
  }, [token]);
  const info =
    remote?.[cardId] ?? describeCardAcquisition(cardId, PRESENTATION_CONTENT);
  if (!info) return null;
  const verified = !token || !!remote;
  return (
    <section className="card-acquisition" aria-label="Cómo conseguir">
      <h4>Cómo conseguir</h4>
      {info.sources.map((s) => (
        <p key={s}>{s}</p>
      ))}
      <p>{verified ? info.notice : "Consultando disponibilidad…"}</p>
      {info.expansionName && <strong>{info.expansionName}</strong>}
      {verified && info.inBooster && info.expansionId && (
        <button
          type="button"
          onClick={() => {
            const id = info.expansionId!;
            (onExpansion ?? openMarketExpansion)(id);
          }}
        >
          Ir a la expansión →
        </button>
      )}
    </section>
  );
}
