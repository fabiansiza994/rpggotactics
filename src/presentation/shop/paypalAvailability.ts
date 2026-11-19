/** Sandbox is opt-in; this flag never enables PayPal Live. Backend remains authoritative. */
export const paypalSandboxBuildEnabled = (): boolean => import.meta.env.VITE_PAYPAL_SANDBOX_ENABLED === '1';
export function paypalReturnPending(search: string = location.search, enabled = paypalSandboxBuildEnabled()): boolean {
  const params = new URLSearchParams(search);
  return enabled && !!params.get('order') && ['approved', 'cancelled'].includes(params.get('paypal') ?? '');
}
