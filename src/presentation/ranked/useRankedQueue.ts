import { useCallback, useEffect, useRef, useState } from 'react';
import { RANKED_RULES } from '../../game/ranked/ranked';
import { rankedApi, type RankedProfile, type RankedQueueState } from './rankedApi';

/**
 * Ranked profile + queue lifecycle for the PvP screen. Polling is the queue heartbeat: while
 * SEARCHING it polls every RANKED_RULES.queuePollMs; closing the screen stops it and the server
 * drops the ticket on its own. MATCHED hands the room code to `onMatched` exactly once.
 */
export function useRankedQueue(onMatched: (code: string) => void) {
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [queue, setQueue] = useState<RankedQueueState>({ state: 'IDLE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handed = useRef<string | null>(null);
  const matched = useRef(onMatched);
  useEffect(() => {
    matched.current = onMatched;
  });

  const apply = useCallback((next: RankedQueueState) => {
    setQueue(next);
    if (next.state === 'MATCHED' && handed.current !== next.code) {
      handed.current = next.code;
      matched.current(next.code);
    }
  }, []);

  const refresh = useCallback(async () => {
    const r = await rankedApi.me();
    if (!r?.ok) return;
    setProfile(r.data);
    if (r.data.enabled) apply(r.data.queue);
  }, [apply]);

  useEffect(() => {
    let alive = true;
    void rankedApi.me().then((r) => {
      if (!alive || !r?.ok) return;
      setProfile(r.data);
      if (r.data.enabled) apply(r.data.queue);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  useEffect(() => {
    if (queue.state !== 'SEARCHING') return;
    const timer = setInterval(() => {
      void rankedApi.poll().then((r) => {
        if (r?.ok) apply(r.data.queue);
      });
    }, RANKED_RULES.queuePollMs);
    return () => clearInterval(timer);
  }, [queue.state, apply]);

  async function run(call: () => ReturnType<typeof rankedApi.join>) {
    setBusy(true);
    setError('');
    const r = await call();
    setBusy(false);
    if (!r) setError('Inicia sesión para jugar clasificatoria.');
    else if (r.ok) apply(r.data.queue);
    else setError(r.error.message);
  }

  return {
    profile,
    queue,
    busy,
    error,
    refresh,
    search: (heroId: string, deckId?: string) => run(() => rankedApi.join(heroId, deckId)),
    cancel: () => run(() => rankedApi.cancel()),
    /** After a ranked room closes: forget the handed code so a new match can be handed. */
    reset: () => {
      handed.current = null;
      setQueue({ state: 'IDLE' });
    },
  };
}
