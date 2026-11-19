/** Sandbox is opt-in; this flag never enables PayPal Live. Backend remains authoritative. */
export const paypalSandboxBuildEnabled = (): boolean => import.meta.env.VITE_PAYPAL_SANDBOX_ENABLED === '1';
export function paypalReturnPending(search: string = location.search, enabled = paypalBuildEnabled()): boolean {
  const params = new URLSearchParams(search);
  return enabled && !!params.get('order') && ['approved', 'cancelled'].includes(params.get('paypal') ?? '');
}

/** A build switch exposes UI only; every purchase remains gated by the backend. */
export const paypalLiveBuildEnabled = (): boolean => import.meta.env.VITE_PAYPAL_LIVE_ENABLED === '1' && import.meta.env.VITE_PAYPAL_LIVE_ACTIVATION === 'paypal-live-v1-reviewed' && !paypalSandboxBuildEnabled();
export const paypalBuildEnabled = (): boolean => paypalSandboxBuildEnabled() || paypalLiveBuildEnabled();
export const paypalApiPath = (): string => '/api/tactics/store/paypal' + (paypalLiveBuildEnabled() ? '/live' : '');
