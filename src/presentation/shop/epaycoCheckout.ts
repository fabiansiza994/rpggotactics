/**
 * ePayco Smart Checkout v2 loader (docs.epayco.com/docs/checkout-implementacion). The script is
 * loaded only when the player presses COMPRAR. The card form is ePayco's (onpage overlay): no card
 * data ever touches this app. Phase 1 always opens in test mode.
 */
export const EPAYCO_SCRIPT = 'https://checkout.epayco.co/checkout-v2.js';

interface EpaycoHandler {
  open(): void;
  setHooks?(hooks: { onCreated?(d: unknown): void; onResponse?(d: unknown): void; onErrors?(e: unknown): void; onClosed?(e: unknown): void }): void;
}
declare global {
  interface Window {
    ePayco?: { checkout: { configure(opts: { sessionId: string; type: 'onpage' | 'standard'; test: boolean }): EpaycoHandler } };
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.ePayco?.checkout) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = EPAYCO_SCRIPT;
    script.async = true;
    script.onload = () => (window.ePayco?.checkout ? resolve() : reject(new Error('ePayco unavailable')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('ePayco script failed'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Opens the hosted checkout. Hooks are UX only (they never credit anything). */
export async function openEpaycoCheckout(sessionId: string, hooks: { onClosed(): void; onResponse(): void; onErrors(): void }): Promise<void> {
  await loadScript();
  const handler = window.ePayco!.checkout.configure({ sessionId, type: 'onpage', test: true });
  handler.setHooks?.({ onClosed: hooks.onClosed, onResponse: hooks.onResponse, onErrors: hooks.onErrors });
  handler.open();
}
