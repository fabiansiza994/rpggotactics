import { useEffect, useSyncExternalStore } from 'react';
import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';
import { loadSession } from '../cloud/session';

/** GET /api/tactics/mastery (server/src/mastery.ts). Names are resolved client-side by title id. */
export type MasteryState =
  | { enabled: false }
  | {
      enabled: true;
      champions: Record<string, { xp: number; level: number }>;
      titles: { id: string; championId: string; requiredMastery: number; unlocked: boolean; equipped: boolean }[];
      equippedTitleId: string | null;
      rewards: { heroId: string; level: number; crystals: number; reachedAt: number }[];
    };

const path = '/api/tactics/mastery';

/** One shared snapshot for every mastery view (champion screen, lobby). Read-only except equip. */
let snapshot: MasteryState | null = null;
let error = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshMastery(): Promise<void> {
  const s = loadSession();
  if (!s || !CLOUD_CONFIG.apiUrl) return;
  const r = await request<MasteryState>(CLOUD_CONFIG.apiUrl, path, { token: s.token, timeoutMs: CLOUD_CONFIG.timeoutMs });
  if (r.ok) {
    snapshot = r.data;
    error = '';
  } else error = r.error.message;
  emit();
}

/** Equip an unlocked title (null = none). The server validates catalog + level; nothing else is sent. */
export async function equipTitle(titleId: string | null): Promise<string | null> {
  const s = loadSession();
  if (!s) return 'Inicia sesión para equipar títulos.';
  const r = await request<MasteryState>(CLOUD_CONFIG.apiUrl, path + '/title', { method: 'PUT', body: { titleId }, token: s.token, timeoutMs: CLOUD_CONFIG.timeoutMs });
  if (!r.ok) return r.error.message;
  snapshot = r.data;
  emit();
  return null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Current mastery snapshot (null until loaded / guest). Refetches when a view mounts. */
export function useMastery(): { state: MasteryState | null; error: string } {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  const err = useSyncExternalStore(subscribe, () => error);
  useEffect(() => {
    void refreshMastery();
  }, []);
  return { state, error: err };
}
