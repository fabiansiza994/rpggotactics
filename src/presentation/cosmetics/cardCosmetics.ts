import { withArcanaSecret } from '../cards/premiumTreatment';
import { create } from 'zustand';
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { CardDefinition } from '../../game';
import {
  RANKED_PREMIUM_COSMETICS,
  RANKED_PREMIUM_SHOWCASES,
} from '../../game/ranked/premiumCosmetics';
import { request } from '../cloud/http';
import { CLOUD_CONFIG } from '../cloud/config';
import { loadSession } from '../cloud/session';
import { storeApi, type Cosmetics } from '../shop/api';

export const CosmeticPreviewContext = createContext<Cosmetics | null>(null);
/** Presentation preview only: does not grant ownership or alter catalog definitions. */
export const CardFinishPreviewContext = createContext<string | null>(null);
const EMPTY: Cosmetics = { owned: [], equipped: {} };
export function showcaseFor(card: CardDefinition, cosmetics: Cosmetics): string | null {
  const id = cosmetics.equipped.CARD_ART;
  const def = id ? RANKED_PREMIUM_SHOWCASES[id] : undefined;
  return id &&
    def?.targetId === card.id &&
    cosmetics.owned.some((o) => o.cosmeticId === id && o.kind === 'CARD_ART')
    ? id
    : null;
}
export function cosmeticCard(card: CardDefinition, cosmetics: Cosmetics): CardDefinition {
  return showcaseFor(card, cosmetics)
    ? { ...card, presentation: { ...card.presentation, premiumTreatment: 'showcase' } }
    : card;
}
export function cardBackFor(cosmetics: Cosmetics): string | null {
  const id = cosmetics.equipped.CARD_BACK;
  return id &&
    RANKED_PREMIUM_COSMETICS[id]?.kind === 'CARD_BACK' &&
    cosmetics.owned.some((o) => o.cosmeticId === id && o.kind === 'CARD_BACK')
    ? id
    : null;
}
interface State {
  scope: string;
  data: Cosmetics;
  busy: boolean;
  error: string;
  load(force?: boolean): Promise<void>;
  equip(slot: 'CARD_BACK' | 'CARD_ART', id: string | null): Promise<void>;
}
let inFlight: Promise<void> | null = null;
export const useCardCosmetics = create<State>((set, get) => ({
  scope: '',
  data: EMPTY,
  busy: false,
  error: '',
  async load(force = false) {
    const session = loadSession();
    if (!session) {
      set({ scope: '', data: EMPTY, busy: false, error: '' });
      return;
    }
    if (!force && get().scope === session.token) return inFlight ?? undefined;
    set({
      scope: session.token,
      data: get().scope === session.token ? get().data : EMPTY,
      busy: true,
      error: '',
    });
    const task = (async () => {
      const r = await request<Cosmetics>(CLOUD_CONFIG.apiUrl, '/api/tactics/cosmetics', {
        token: session.token,
        timeoutMs: CLOUD_CONFIG.timeoutMs,
      });
      if (loadSession()?.token !== session.token) return;
      set(
        r.ok ? { data: r.data, busy: false, error: '' } : { busy: false, error: r.error.message },
      );
    })();
    inFlight = task;
    await task;
    if (inFlight === task) inFlight = null;
  },
  async equip(slot, id) {
    const session = loadSession();
    if (!session || get().busy) return;
    set({ busy: true, error: '' });
    const r = await storeApi.equip(session.token, slot, id);
    if (loadSession()?.token !== session.token) return;
    set(
      r.ok
        ? { scope: session.token, data: r.data, busy: false, error: '' }
        : { busy: false, error: r.error.message },
    );
  },
}));
export function useCosmeticView() {
  const override = useContext(CosmeticPreviewContext);
  const token = loadSession()?.token ?? '';
  const scope = useCardCosmetics((s) => s.scope),
    data = useCardCosmetics((s) => s.data);
  useEffect(() => {
    if (!override) void useCardCosmetics.getState().load();
  }, [token, override]);
  return override ?? (scope === token ? data : EMPTY);
}
export function useCosmeticCard(card: CardDefinition | undefined) {
  const data = useCosmeticView();
  const secretCardId = useContext(CardFinishPreviewContext);
  return useMemo(() => {
    const visual = card ? cosmeticCard(card, data) : undefined;
    return visual && visual.id === secretCardId ? withArcanaSecret(visual) : visual;
  }, [card, data, secretCardId]);
}
