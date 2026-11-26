import {useRankedPresence} from './rankedPresence';
import {arcaneAudio} from '../audio/audio';
import{RankedAudioSession}from'../audio/audio';
import { useCallback, useEffect, useRef, useState } from "react";
import { RANKED_RULES } from "../../game/ranked/ranked";
import {
  rankedApi,
  type RankedProfile,
  type RankedQueueState,
} from "./rankedApi";

/**
 * Single queue owner in the persistent application PvP host. Navigation only hides its view;
 * it never unmounts this hook or ends the existing ticket/heartbeat.
 */
export function useRankedQueue(onMatched: (code: string) => void) {
  const [audio]=useState(()=>{const a=new RankedAudioSession();if(typeof navigator!=='undefined'&&navigator.locks)a.setAudible(false);return a;});
  useEffect(()=>()=>audio.dispose(),[audio]);
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [queue, setQueue] = useState<RankedQueueState>({ state: "IDLE" });
  const [busy, setBusy] = useState(true);
  const queueRef=useRef(queue);useEffect(()=>{queueRef.current=queue;},[queue]);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const accepting = useRef<number | null>(null);
  const polling = useRef(false);
  const operation=useRef(false);
  const readGeneration=useRef(0);
  const handed = useRef<string | null>(null);
  const matched = useRef(onMatched);
  useEffect(() => {
    matched.current = onMatched;
  });

  const apply = useCallback((next: RankedQueueState) => {
    audio.update(next);
    useRankedPresence.setState({queue:next,...(next.state==='SEARCHING'?{heroId:next.heroId,deckId:next.deckId??null}:next.state==='IDLE'?{heroId:null,deckId:null}:{})});
    setQueue(next);
    if (next.state === "MATCHED" && handed.current !== next.code) {
      handed.current = next.code;
      matched.current(next.code);
    }
  }, [audio]);

  const queueIdle=queue.state==='IDLE';
  useEffect(()=>{
    if(!navigator.locks){
      const sync=()=>{const audible=!document.hidden&&document.hasFocus();audio.setAudible(audible);if(audible)audio.update(queueRef.current);};
      window.addEventListener('focus',sync);window.addEventListener('blur',sync);document.addEventListener('visibilitychange',sync);sync();
      return()=>{window.removeEventListener('focus',sync);window.removeEventListener('blur',sync);document.removeEventListener('visibilitychange',sync);audio.setAudible(false);};
    }
    let alive=true,requesting=false,release:(()=>void)|null=null;
    const acquire=()=>{
      if(!alive||document.hidden||requesting||release||queueRef.current.state==='IDLE')return;
      requesting=true;
      void navigator.locks.request('rpggo-ranked-audio',{ifAvailable:true},async lock=>{
        requesting=false;if(!lock||!alive||document.hidden)return;
        audio.setAudible(true);audio.update(queueRef.current);
        await new Promise<void>(resolve=>{release=resolve;});release=null;audio.setAudible(false);
      });
    };
    const visibility=()=>{if(document.hidden){audio.setAudible(false);release?.();}else acquire();};
    const timer=setInterval(acquire,1000);document.addEventListener('visibilitychange',visibility);acquire();
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);release?.();audio.setAudible(false);};
  },[audio,queueIdle]);
  useEffect(() => {
    const close = (event: Event) => {
      if (!(event as CustomEvent<{ admissionsBlocked?: boolean }>).detail?.admissionsBlocked) return;
      audio.terminal(); generation.current++; accepting.current = null; setBusy(false); apply({state:'IDLE'});
      setError('Actualización en curso. La búsqueda se ha detenido.');
      void rankedApi.cancel();
    };
    window.addEventListener('rpggo-maintenance', close);
    return () => window.removeEventListener('rpggo-maintenance', close);
  }, [audio,apply]);

  const refresh = useCallback(async (force=false) => {
    if(operation.current&&!force)return;
    const read=++readGeneration.current;
    const epoch = generation.current;
    const r = await rankedApi.me();
    if (epoch !== generation.current ||read!==readGeneration.current||!r?.ok) return;
    setProfile(r.data);
    if (r.data.enabled) apply(r.data.queue);
  }, [apply]);

  useEffect(() => {
    let alive = true;
    useRankedPresence.setState({busy:true});
    const epoch = generation.current,read=++readGeneration.current;
    void rankedApi.me().then((r) => {
      if (!alive || epoch !== generation.current || read!==readGeneration.current || !r?.ok) return;
      setProfile(r.data);
      if (r.data.enabled) apply(r.data.queue);
    }).catch(()=>{}).finally(()=>{if(alive)setBusy(false);});
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
      if (polling.current||operation.current) return;
      polling.current = true;
      const epoch = generation.current,read=++readGeneration.current;
      void rankedApi.poll().then((r) => {
        if (epoch === generation.current&&read===readGeneration.current){if(r?.ok)apply(r.data.queue);else if(r){audio.rejected(r.error.status);if(r.error.status===429){apply({state:"IDLE"});void refresh();}}}
        })
        .catch(() => {})
        .finally(() => {
          polling.current = false;
      });
    }, RANKED_RULES.queuePollMs);
    return () => clearInterval(timer);
  }, [queue.state, apply, audio, refresh]);

  useEffect(()=>{
    if(typeof BroadcastChannel==='undefined')return;
    const channel=new BroadcastChannel('rpggo-ranked');channel.onmessage=()=>void refresh();
    return()=>channel.close();
  },[refresh]);
  useEffect(()=>{
    const sync=()=>{if(!document.hidden)void refresh();};
    const resume=()=>{if(!document.hidden&&queue.state==='SEARCHING')audio.update(queue);};
    window.addEventListener('online',sync);document.addEventListener('visibilitychange',sync);
    window.addEventListener('pointerdown',resume);window.addEventListener('keydown',resume);
    const off=arcaneAudio.subscribe(resume);
    return()=>{window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('pointerdown',resume);window.removeEventListener('keydown',resume);off();};
  },[refresh,audio,queue]);
  useEffect(()=>{useRankedPresence.setState({busy,cancel:()=>{void run(()=>rankedApi.cancel());}});return()=>{useRankedPresence.setState({cancel:null});};});
  useEffect(()=>()=>useRankedPresence.setState({queue:{state:'IDLE'},busy:false,heroId:null,deckId:null,cancel:null}),[]);
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
    if(operation.current)return;operation.current=true;readGeneration.current++;
    const epoch = ++generation.current;
    accepting.current = null;
    setBusy(true);
    setError("");
    try {
    const r = await call();
      if(epoch !== generation.current) return;
    if (!r) {audio.terminal();setError("Inicia sesión para jugar clasificatoria.");}
    else if (r.ok) {apply(r.data.queue);if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('rpggo-ranked');channel.postMessage('changed');channel.close();}}
    else {audio.rejected(r.error.status);setError(r.error.message);if(r.error.status===429){apply({state:"IDLE"});await refresh(true);}}
    } catch {
      if (epoch === generation.current)
        setError("No se pudo actualizar la búsqueda.");
    } finally {
      operation.current=false;
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
      {if(operation.current||useRankedPresence.getState().queue.state!=='IDLE')return;if(profile?.enabled&&profile.protection?.until)return refresh();audio.begin();return run(() => rankedApi.join(heroId, deckId));},
    cancel: () => run(() => rankedApi.cancel()),
    /** After a ranked room closes: forget the handed code so a new match can be handed. */
    reset: () => {
      audio.terminal();
      generation.current++;
      accepting.current = null;
      handed.current = null;
      apply({ state: "IDLE" });
      if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('rpggo-ranked');channel.postMessage('changed');channel.close();}
    },
  };
}
