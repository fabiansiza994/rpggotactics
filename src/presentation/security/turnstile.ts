/** Public widget API only. Tokens and secrets must never be logged. */
export interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_LOAD_TIMEOUT = 15_000;
let pending: Promise<TurnstileApi> | null = null;

/** One script for all consumers. Failed/missing-API loads are evicted so retry is real. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (pending) return pending;
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    let script: HTMLScriptElement | null = null;
    let settled = false;
    const finish = (api?: TurnstileApi) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (script) { script.onload = null; script.onerror = null; }
      if (api) resolve(api);
      else { script?.remove(); reject(new Error('TURNSTILE_SCRIPT_UNAVAILABLE')); }
    };
    const ready = () => {
      const api = window.turnstile;
      if (!api) { finish(); return; }
      // Explicit async scripts are usable at onload; ready() is incompatible with async loading.
      finish(api);
    };
    const timer = setTimeout(() => finish(), TURNSTILE_LOAD_TIMEOUT);
    if (window.turnstile) { ready(); return; }
    script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => finish();
    try { document.head.appendChild(script); } catch { finish(); }
  });
  pending = loading.catch(error => { pending = null; throw error; });
  return pending;
}

export type VerificationState =
  | { kind: 'loading' | 'ready' | 'verified' | 'load-error' | 'expired' | 'timeout' | 'unsupported' }
  | { kind: 'challenge-error'; code?: string };
export function verificationMessage(state: VerificationState): string | null {
  switch (state.kind) {
    case 'load-error': return 'No pudimos conectar con el servicio de verificación de Cloudflare. Reinténtalo sin recargar la página.';
    case 'expired': return 'La verificación caducó. Reinténtala para continuar.';
    case 'timeout': return 'La verificación tardó demasiado. Reinténtala para continuar.';
    case 'unsupported': return 'Este navegador no pudo iniciar la verificación. Prueba un navegador actualizado.';
    case 'challenge-error':
      if (state.code === '110200') return 'La verificación no está configurada para este sitio. Contacta con soporte.';
      if (state.code === '200500') return 'No pudimos conectar con Cloudflare para cargar la verificación. Reinténtalo sin recargar la página.';
      if (['110100','110110','400020','400021','400070'].includes(state.code ?? '')) return 'El servicio de verificación no está disponible para este sitio. Contacta con soporte.';
      if (state.code === '110600' || state.code === '110620') return 'La verificación tardó demasiado. Reinténtala para continuar.';
      return 'El servicio de verificación no pudo completar la comprobación. Reinténtalo sin perder tus datos.';
    default: return null;
  }
}

/** Independent mount generation: unmounted/replaced widgets cannot publish stale tokens. */
export function mountTurnstile(element: HTMLElement, options: {
  siteKey: string; action?: string;
  onToken(token: string | null): void;
  onState(state: VerificationState): void;
  load?: () => Promise<TurnstileApi>;
}): () => void {
  let alive = true;
  let id: string | null = null;
  let api: TurnstileApi | null = null;
  options.onToken(null);
  options.onState({kind:'loading'});
  const invalidate = (state: VerificationState) => {
    if (!alive) return;
    options.onToken(null);
    options.onState(state);
  };
  void (options.load ?? loadTurnstile)().then(widget => {
    if (!alive) return;
    api = widget;
    options.onState({kind:'ready'});
    id = widget.render(element, {
      sitekey: options.siteKey,
      ...(options.action ? {action: options.action} : {}),
      theme: 'dark',
      callback: (token: string) => {
        if (!alive) return;
        if (!token) { invalidate({kind:'challenge-error'}); return; }
        options.onToken(token);
        options.onState({kind:'verified'});
      },
      'error-callback': (code: string) => invalidate({kind:'challenge-error',code: /^\d{3,6}$/.test(String(code)) ? String(code) : undefined}),
      'expired-callback': () => invalidate({kind:'expired'}),
      'timeout-callback': () => invalidate({kind:'timeout'}),
      'unsupported-callback': () => invalidate({kind:'unsupported'}),
    });
  }).catch(() => invalidate(api ? {kind:'challenge-error'} : {kind:'load-error'}));
  return () => {
    alive = false;
    if (api && id !== null) { try { api.remove(id); } catch { /* stale/removed SDK widget */ } }
  };
}
