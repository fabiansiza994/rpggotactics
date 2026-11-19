import { afterEach, describe, expect, it, vi } from 'vitest';
import { paypalApiPath, paypalBuildEnabled, paypalLiveBuildEnabled, paypalReturnPending } from '../src/presentation/shop/paypalAvailability';
import { sandboxConfig } from '../server/src/paypalSandbox';
import type { Env } from '../server/src/db';
afterEach(() => vi.unstubAllEnvs());
describe('Live presentation and environment boundaries', () => {
  it('stays OFF with production build flags', () => {
    vi.stubEnv('VITE_PAYPAL_SANDBOX_ENABLED','0');vi.stubEnv('VITE_PAYPAL_LIVE_ENABLED','0');
    expect(paypalBuildEnabled()).toBe(false);
    expect(paypalReturnPending('?paypal=approved&order=forged')).toBe(false);
  });
  it('one public flag cannot expose Live', () => {
    vi.stubEnv('VITE_PAYPAL_SANDBOX_ENABLED','0');vi.stubEnv('VITE_PAYPAL_LIVE_ENABLED','1');vi.stubEnv('VITE_PAYPAL_LIVE_ACTIVATION','');
    expect(paypalLiveBuildEnabled()).toBe(false);
  });
  it('explicit Live build selects only the Live route', () => {
    vi.stubEnv('VITE_PAYPAL_SANDBOX_ENABLED','0');vi.stubEnv('VITE_PAYPAL_LIVE_ENABLED','1');vi.stubEnv('VITE_PAYPAL_LIVE_ACTIVATION','paypal-live-v1-reviewed');
    expect(paypalApiPath()).toBe('/api/tactics/store/paypal/live');
    expect(paypalLiveBuildEnabled()).toBe(true);
  });
  it('cannot expose both environments together', () => {
    vi.stubEnv('VITE_PAYPAL_SANDBOX_ENABLED','1');vi.stubEnv('VITE_PAYPAL_LIVE_ENABLED','1');vi.stubEnv('VITE_PAYPAL_LIVE_ACTIVATION','paypal-live-v1-reviewed');
    expect(paypalLiveBuildEnabled()).toBe(false);
    expect(paypalApiPath()).toBe('/api/tactics/store/paypal');
  });
  it('Sandbox refuses reused Live credentials', () => {
    const env={PAYPAL_SANDBOX_ENABLED:'1',PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_CLIENT_ID:'duplicate',PAYPAL_CLIENT_SECRET:'fixture',PAYPAL_WEBHOOK_ID:'fixture-hook',PAYPAL_RETURN_ORIGIN:'https://qa.example',PAYPAL_LIVE_CLIENT_ID:'duplicate'} as Env;
    expect(sandboxConfig(env,new Request('https://qa.example'))).toBe(null);
  });
});
