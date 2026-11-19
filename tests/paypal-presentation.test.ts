import {afterEach, describe, expect, it, vi} from 'vitest';
import{paypalReturnPending,paypalSandboxBuildEnabled}from'../src/presentation/shop/paypalAvailability';
afterEach(()=>vi.unstubAllEnvs());
describe('PayPal return ownership of the presentation',()=>{
 it('is disabled by default and cannot open a result just from query parameters',()=>{vi.stubEnv('VITE_PAYPAL_SANDBOX_ENABLED','0');expect(paypalSandboxBuildEnabled()).toBe(false);expect(paypalReturnPending('?paypal=approved&order=qa')).toBe(false);});
 it.each(['approved','cancelled'])('owns the screen until closed for %s return',flow=>{vi.stubEnv('VITE_PAYPAL_SANDBOX_ENABLED','1');expect(paypalReturnPending('?paypal='+flow+'&order=qa')).toBe(true);});
 it.each(['?paypal=approved','?order=qa','?paypal=other&order=qa',''])('does not suppress normal navigation for %s',search=>{expect(paypalReturnPending(search,true)).toBe(false);});
});
