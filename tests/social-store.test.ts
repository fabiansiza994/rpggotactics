import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/presentation/cloud/session', () => ({ loadSession: () => ({ token: 't', username: 'ana' }) }));

const { socialApi } = await import('../src/presentation/social/api');
const { useSocialStore, socialBadge } = await import('../src/presentation/social/socialStore');

const msg = (id: number, mine = false) => ({ id, mine, body: `m${id}`, createdAt: id, readAt: null });

beforeEach(() => {
  vi.restoreAllMocks();
  useSocialStore.setState({ conversations: {}, visible: {}, toasts: [], overview: null, roomReady: null });
});

describe('social store', () => {
  it('a message sent while the first load is in flight is kept after the load lands', async () => {
    let finishLoad!: () => void;
    vi.spyOn(socialApi, 'messages').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLoad = () => resolve({ ok: true, data: { conversationId: 'c', with: 'bruno', friend: null, canSend: true, messages: [msg(1)] } });
        }),
    );
    vi.spyOn(socialApi, 'markRead').mockResolvedValue({ ok: true, data: { ok: true } });
    vi.spyOn(socialApi, 'overview').mockResolvedValue({ ok: false, error: { kind: 'NETWORK', status: 0, code: 'NETWORK', message: 'x' } });
    vi.spyOn(socialApi, 'send').mockResolvedValue({ ok: true, data: { message: msg(2, true) } });
    const loading = useSocialStore.getState().openConversation('c');
    expect(await useSocialStore.getState().send('c', 'hola')).toBeNull();
    finishLoad();
    await loading;
    expect(useSocialStore.getState().conversations.c!.messages.map((m) => m.id)).toEqual([1, 2]);
    expect(useSocialStore.getState().conversations.c!.loaded).toBe(true);
  });

  it('send failures surface the server message and CHAT_DISABLED locks the composer', async () => {
    useSocialStore.setState({ conversations: { c: { messages: [], with: 'bruno', canSend: true, loaded: true, hasMore: false } } });
    vi.spyOn(socialApi, 'send').mockResolvedValue({
      ok: false,
      error: { kind: 'REJECTED', status: 403, code: 'CHAT_DISABLED', message: 'No puedes enviar mensajes a este jugador.' },
    });
    expect(await useSocialStore.getState().send('c', 'hola')).toBe('No puedes enviar mensajes a este jugador.');
    expect(useSocialStore.getState().conversations.c!.canSend).toBe(false);
  });

  it('the menu badge sums unread messages, pending requests and incoming challenges', () => {
    expect(socialBadge({ overview: null })).toBe(0);
    const overview = { counts: { unread: 3, requests: 1, invites: 2 } } as never;
    expect(socialBadge({ overview })).toBe(6);
    // Unclaimed store gifts count too.
    expect(socialBadge({ overview: { counts: { unread: 3, requests: 1, invites: 2, gifts: 2 } } as never })).toBe(8);
  });
});
