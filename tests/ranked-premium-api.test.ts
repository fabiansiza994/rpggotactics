import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session, request } = vi.hoisted(() => ({ session: vi.fn(), request: vi.fn() }));
vi.mock('../src/presentation/cloud/session', () => ({ loadSession: session }));
vi.mock('../src/presentation/cloud/http', () => ({ request }));
import { rankedApi } from '../src/presentation/ranked/rankedApi';
beforeEach(() => {
  vi.clearAllMocks();
  session.mockReturnValue({ token: 'qa-only' });
  request.mockResolvedValue({ ok: true, data: {} });
});
describe('Premium UI API transport', () => {
  it('keeps the same operation key on explicit retry and sends no client rewards or price', async () => {
    await rankedApi.purchasePremium('preseason_0', 'stable-qa-key');
    await rankedApi.purchasePremium('preseason_0', 'stable-qa-key');
    for (const call of request.mock.calls) {
      expect(call[1]).toBe('/api/tactics/ranked/premium/purchase');
      expect(call[2]).toMatchObject({
        method: 'POST',
        token: 'qa-only',
        body: { seasonId: 'preseason_0', idempotencyKey: 'stable-qa-key' },
      });
      expect(Object.keys(call[2].body)).toHaveLength(2);
    }
  });
  it('uses the existing Showcase endpoint and refuses unauthenticated calls', async () => {
    await rankedApi.chooseShowcase('ash_eclipse');
    expect(request.mock.calls[0]?.[1]).toBe('/api/tactics/ranked/premium/showcase');
    expect(request.mock.calls[0]?.[2].body).toEqual({ cardId: 'ash_eclipse' });
    session.mockReturnValue(null);
    expect(await rankedApi.purchasePremium('preseason_0', 'stable-qa-key')).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
