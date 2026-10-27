import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { orderReference, purchaseResult, type RealMoneyOrderStatus } from '../src/game/store/realMoney';
import { sanitizeBugContext } from '../src/game/support/bugReport';
import type { CloudResult } from '../src/presentation/cloud/http';
import { pollOrder, resultText, RESULT_LABEL, type OrderResponse } from '../src/presentation/shop/realMoney';

const order = (status: RealMoneyOrderStatus, balance = 0): CloudResult<OrderResponse> => ({
  ok: true,
  data: {
    order: { orderId: 'rmo_x', reference: 'X', result: purchaseResult(status), packageId: 'crystals_500', status, crystals: 500, amount: 9900, currency: 'COP', testMode: true, createdAt: 0, paidAt: null, fulfilledAt: null },
    wallet: { currencyId: 'arcane_crystals', name: 'Cristales Arcanos', balance },
  },
});
/** Runs scheduled ticks immediately (no timers). */
const sync = { schedule: (fn: () => void) => (queueMicrotask(fn), 1), cancel: () => undefined };

describe('order polling (wallet refresh)', () => {
  it('polls until FULFILLED and hands over the server wallet', async () => {
    const replies = [order('PENDING'), order('PENDING'), order('FULFILLED', 1200)];
    const read = vi.fn(async () => replies.shift()!);
    const seen: string[] = [];
    const last = await pollOrder(read, (d) => seen.push(`${d.order.status}:${d.wallet.balance}`), sync).done;
    expect(seen).toEqual(['PENDING:0', 'PENDING:0', 'FULFILLED:1200']);
    expect(last?.wallet.balance).toBe(1200);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps waiting through network errors (the webhook may come later) and stops at maxMs', async () => {
    const read = vi.fn(async (): Promise<CloudResult<OrderResponse>> => ({ ok: false, error: { kind: 'NETWORK', status: 0, code: 'NETWORK', message: '' } }));
    await pollOrder(read, () => undefined, { ...sync, intervalMs: 1000, maxMs: 5000 }).done;
    expect(read).toHaveBeenCalledTimes(5);
  });

  it('stops on auth errors / unknown order and on stop()', async () => {
    const onAuthError = vi.fn();
    await pollOrder(async () => ({ ok: false, error: { kind: 'AUTH', status: 401, code: 'X', message: '' } }), () => undefined, { ...sync, onAuthError }).done;
    expect(onAuthError).toHaveBeenCalledOnce();
    const read = vi.fn(async () => order('PENDING'));
    const p = pollOrder(read, () => undefined, { schedule: () => 1, cancel: () => undefined });
    p.stop();
    await p.done;
    expect(read.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('result page states come only from the server order: VERIFYING / APPROVED / PENDING / REJECTED / FAILED', () => {
    expect(purchaseResult(null)).toBe('VERIFYING');
    expect(purchaseResult('CREATED')).toBe('VERIFYING');
    expect(purchaseResult('PENDING')).toBe('PENDING');
    expect(purchaseResult('FULFILLED')).toBe('APPROVED');
    expect(purchaseResult('FAILED', '2 Rechazada')).toBe('REJECTED');
    expect(purchaseResult('FAILED', '4 Fallida')).toBe('FAILED');
    expect(purchaseResult('CANCELLED')).toBe('FAILED');
    expect(purchaseResult('EXPIRED')).toBe('FAILED');
    expect(purchaseResult('REFUNDED')).toBe('REVIEW');
    expect(resultText(null).title).toBe('Estamos verificando tu pago…');
    expect(resultText('PENDING').title).toBe('Estamos verificando tu pago.');
    expect(resultText('APPROVED').tone).toBe('good');
    expect(resultText('REJECTED').title).toMatch(/rechazado/i);
    for (const r of ['VERIFYING', 'PENDING', 'REJECTED', 'FAILED', 'REVIEW'] as const) expect(resultText(r).title).not.toMatch(/aprobado/i);
    expect(Object.keys(RESULT_LABEL)).toHaveLength(6);
    expect(orderReference('rmo_075cb6de-206d-443a-b1cb-98c8975146d4')).toBe('075CB6DE20');
  });
});

describe('support integration and pricing source', () => {
  it('a purchase report carries category STORE and the order id through the context whitelist', async () => {
    const { onBugReportRequest, requestBugReport } = await import('../src/presentation/support/reportContext');
    const seen: unknown[] = [];
    const off = onBugReportRequest((p) => seen.push(p));
    requestBugReport({ category: 'STORE', orderId: 'rmo_075cb6de-206d-443a-b1cb-98c8975146d4' });
    off();
    requestBugReport({ category: 'STORE' });
    expect(seen).toEqual([{ category: 'STORE', orderId: 'rmo_075cb6de-206d-443a-b1cb-98c8975146d4' }]);
    expect(sanitizeBugContext({ orderId: 'rmo_075cb6de-206d-443a-b1cb-98c8975146d4', invoice: 'RGT-X', ref_payco: 'abc' })).toEqual({
      orderId: 'rmo_075cb6de-206d-443a-b1cb-98c8975146d4',
    });
  });

  it('no package price is hard-coded in the frontend (prices come from the server)', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
    const offenders = [...files('src/presentation'), ...files('src/game')]
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /\b(9[._]?900|19[._]?900|39[._]?900|79[._]?900)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
