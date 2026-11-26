import{RankedAudioSession}from'../audio/audio';
import { useCallback, useEffect, useRef, useState } from "react";
import { RANKED_RULES } from "../../game/ranked/ranked";
import {
  rankedApi,
  type RankedProfile,
  type RankedQueueState,
} from "./rankedApi";

/**
 * Ranked profile + queue lifecycle for the PvP screen. Polling is the queue heartbeat: while
 * SEARCHING it polls every RANKED_RULES.queuePollMs; closing the screen stops it and the server
 * drops the ticket on its own. MATCHED hands the room code to `onMatched` exactly once.
 */
export function useRankedQueue(onMatched: (code: string) => void) {
  const [audio]=useState(()=>new RankedAudioSession());
  useEffect(()=>()=>audio.dispose(),[audio]);
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [queue, setQueue] = useState<RankedQueueState>({ state: "IDLE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const accepting = useRef<number | null>(null);
  const polling = useRef(false);
  const handed = useRef<string | null>(null);
  const matched = useRef(onMatched);
  useEffect(() => {
    matched.current = onMatched;
  });

  const apply = useCallback((next: RankedQueueState) => {
    audio.update(next);
    setQueue(next);
    if (next.state === "MATCHED" && handed.current !== next.code) {
      handed.current = next.code;
      matched.current(next.code);
    }
  }, [audio]);

  useEffect(() => {
    const close = (event: Event) => {
      if (!(event as CustomEvent<{ admissionsBlocked?: boolean }>).detail?.admissionsBlocked) return;
      audio.terminal(); generation.current++; accepting.current = null; setBusy(false); setQueue({ state: 'IDLE' });
      setError('Actualización en curso. La búsqueda se ha detenido.');
      void rankedApi.cancel();
    };
    window.addEventListener('rpggo-maintenance', close);
    return () => window.removeEventListener('rpggo-maintenance', close);
  }, [audio]);

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    const r = await rankedApi.me();
    if (epoch !== generation.current ||!r?.ok) return;
    setProfile(r.data);
    if (r.data.enabled) apply(r.data.queue);
  }, [apply]);

  useEffect(() => {
    let alive = true;
    const epoch = generation.current;
    void rankedApi.me().then((r) => {
      if (!alive || epoch !== generation.current || !r?.ok) return;
      setProfile(r.data);
      if (r.data.enabled) apply(r.data.queue);
    });
    return () => {
      alive = false;
      // Deliberately invalidate the current request generation, including requests begun after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [apply]);

  useEffect(() => {
    if (queue.state !== "SEARCHING") return;
    const timer = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      const epoch = generation.current;
      void rankedApi.poll().then((r) => {
        if (epoch === generation.current){if(r?.ok)apply(r.data.queue);else if(r){audio.rejected(r.error.status);if(r.error.status===429){apply({state:"IDLE"});void refresh();}}}
        })
        .catch(() => {})
        .finally(() => {
          polling.current = false;
      });
    }, RANKED_RULES.queuePollMs);
    return () => clearInterval(timer);
  }, [queue.state, apply, audio, refresh]);

  useEffect(()=>{if(!profile?.enabled||!profile.protection?.until)return;const p=profile.protection,anchor=performance.now();const timer=setInterval(()=>{if(p.serverNow+performance.now()-anchor>=p.until)void refresh();},1000);return()=>clearInterval(timer);},[profile,refresh]);
  // Explicit consent only. The server still gives human pairing the final opportunity.
  async function acceptBot() {
    if (queue.state !== "SEARCHING" || !queue.botOffer || accepting.current === queue.since) return;
    const ticket = queue.since, epoch = ++generation.current;
    accepting.current = ticket;
    setBusy(true);
    setError("");
    try {
      const r = await rankedApi.acceptBot(ticket);
      if (epoch !== generation.current) return;
      if (r?.ok) apply(r.data.queue);
      else {if(r)audio.rejected(r.error.status);else audio.terminal();setError(r ? r.error.message : "No se pudo preparar el rival.");}
    } catch {
      if (epoch === generation.current) setError("No se pudo preparar el rival. Puedes seguir buscando.");
    } finally {
      if (epoch === generation.current) {
        accepting.current = null;
        setBusy(false);
      }
    }
  }

  async function run(call: () => ReturnType<typeof rankedApi.join>) {
    const epoch = ++generation.current;
    accepting.current = null;
    setBusy(true);
    setError("");
    try {
    const r = await call();
      if(epoch !== generation.current) return;
    if (!r) {audio.terminal();setError("Inicia sesión para jugar clasificatoria.");}
    else if (r.ok) apply(r.data.queue);
    else {audio.rejected(r.error.status);setError(r.error.message);if(r.error.status===429){apply({state:"IDLE"});await refresh();}}
    } catch {
      if (epoch === generation.current)
        setError("No se pudo actualizar la búsqueda.");
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }

  return {
    profile,
    queue,
    busy,
    error,
    refresh,
    acceptBot,
    search: (heroId: string, deckId?: string) =>
      {if(profile?.enabled&&profile.protection?.until)return refresh();audio.begin();return run(() => rankedApi.join(heroId, deckId));},
    cancel: () => run(() => rankedApi.cancel()),
    /** After a ranked room closes: forget the handed code so a new match can be handed. */
    reset: () => {
      audio.terminal();
      generation.current++;
      accepting.current = null;
      handed.current = null;
      setQueue({ state: "IDLE" });
    },
  };
}
