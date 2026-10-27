import { create } from 'zustand';
import { loadSession } from '../cloud/session';
import { useBattleStore } from '../store/battleStore';
import { giftApi, giftError, type ReceivedGift } from './api';

/**
 * Received gifts of the signed-in account. Refreshed when the social overview's pending-gift count
 * changes (the GIFT_RECEIVED push makes the social store refetch it) and when the store opens.
 * Opening a gift never claims it; only "RECIBIR REGALO" does, on the server.
 */
interface GiftState {
  received: ReceivedGift[];
  /** Gift shown in the modal (by id, so a refresh keeps it open). */
  openId: string | null;
  /** Pops hidden with "Más tarde" this session (the gift stays pending and listed). */
  later: string[];
  claiming: boolean;
  /** Last claim outcome shown in the modal. */
  result: { giftId: string; ok: boolean; text: string } | null;
  refresh(): Promise<void>;
  open(giftId: string): void;
  close(): void;
  snooze(giftId: string): void;
  claim(giftId: string): Promise<void>;
  reset(): void;
}

const token = () => (useBattleStore.getState().account.status === 'READY' ? (loadSession()?.token ?? null) : null);
let refreshing: Promise<void> | null = null;

export const useGiftStore = create<GiftState>()((set, get) => ({
  received: [],
  openId: null,
  later: [],
  claiming: false,
  result: null,

  refresh() {
    const t = token();
    if (!t) return Promise.resolve();
    refreshing ??= giftApi
      .received(t)
      .then((res) => {
        if (res.ok) set({ received: res.data.gifts });
        else if (res.error.kind === 'AUTH') useBattleStore.getState().sessionExpired();
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  },
  open: (giftId) => set({ openId: giftId, result: null }),
  close: () => {
    if (!get().claiming) set({ openId: null, result: null });
  },
  snooze: (giftId) => set((s) => ({ later: [...s.later, giftId] })),
  async claim(giftId) {
    const t = token();
    if (!t || get().claiming) return;
    set({ claiming: true, result: null });
    const res = await giftApi.claim(t, giftId);
    if (res.ok) {
      if (res.data.profile) useBattleStore.setState({ profile: res.data.profile });
      set((s) => ({
        claiming: false,
        received: s.received.map((g) => (g.giftId === giftId ? res.data.gift : g)),
        result: { giftId, ok: true, text: 'Se ha añadido a tu colección.' },
      }));
      return;
    }
    if (res.error.kind === 'AUTH') useBattleStore.getState().sessionExpired();
    set({ claiming: false, result: { giftId, ok: false, text: giftError(res.error) } });
    void get().refresh();
  },
  reset: () => set({ received: [], openId: null, later: [], claiming: false, result: null }),
}));
