import { PREMIUM_CURRENCY_ID } from '../../src/game';
import { error, json } from './http';
import { ledgerStatement, walletView, type StoreRequest } from './store';

export const LAUNCH_REWARD_ID = 'launch_reward_2026_expansions_500';
export const LAUNCH_REWARD_AMOUNT = 500;
/** The existing immutable ledger's UNIQUE(user,currency,reason,reference) is the receipt.
 * Its INSERT trigger credits the wallet in the same atomic SQLite statement. No read/modify/write.
 */
export async function launchRewardRoute(route: string, r: StoreRequest, enabled: boolean): Promise<Response | null> {
  if (route !== 'GET /api/tactics/store/launch-reward' && route !== 'POST /api/tactics/store/launch-reward/claim') return null;
  const privateResponse = (response: Response) => {response.headers.set('Cache-Control', 'private, no-store');return response;};
  const receipt = () => r.db.prepare(
    'SELECT transaction_id, amount_delta, created_at FROM tactics_wallet_ledger WHERE user_id = ? AND currency_id = ? AND reason = ? AND reference_id = ?',
  ).bind(r.userId, PREMIUM_CURRENCY_ID, 'PROMO_GRANT', LAUNCH_REWARD_ID).first<{transaction_id:string;amount_delta:number;created_at:number}>();
  const view = async (credited = 0) => {
    const row = await receipt();
    return privateResponse(json({ id: LAUNCH_REWARD_ID, amount: LAUNCH_REWARD_AMOUNT, enabled, claimed: !!row,
      credited, receipt: row, wallet: await walletView(r.db, r.userId) }));
  };
  if (route.startsWith('GET ') || await receipt()) return view();
  if (!enabled) return privateResponse(error(410, 'LAUNCH_REWARD_INACTIVE', 'El Regalo de Lanzamiento ya no está disponible.'));
  try {
    await ledgerStatement(r.db, {transactionId: `txn_${r.store.newId()}`, userId: r.userId,
      currencyId: PREMIUM_CURRENCY_ID, delta: LAUNCH_REWARD_AMOUNT, reason: 'PROMO_GRANT',
      referenceId: LAUNCH_REWARD_ID, note: 'Regalo de Lanzamiento', now: r.now}).run();
  } catch {
    // A concurrent winner is a successful replay, never a second credit. Other failures stay retryable.
    if (await receipt()) return view();
    return privateResponse(error(503, 'LAUNCH_REWARD_RETRY', 'No pudimos confirmar el regalo. Vuelve a intentarlo; no se entregará dos veces.'));
  }
  return view(LAUNCH_REWARD_AMOUNT);
}
