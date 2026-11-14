import {beforeEach,expect,it,vi} from 'vitest';
import {request} from '../src/presentation/cloud/http';
import {fetchMobileWallet} from '../src/presentation/mobile/useMobileBalance';
vi.mock('../src/presentation/cloud/http',()=>({request:vi.fn()}));
beforeEach(()=>vi.mocked(request).mockReset());
it('reads the existing wallet endpoint with the real transport contract, without a mutation',async()=>{
 vi.mocked(request).mockResolvedValue({ok:true,data:{wallet:{currencyId:'arcane_crystal',name:'Cristales',balance:0}}});
 const r=await fetchMobileWallet('unit-test-session');expect(r.ok&&r.data.wallet.balance).toBe(0);
 expect(request).toHaveBeenCalledExactlyOnceWith(expect.any(String),'/api/tactics/wallet',{token:'unit-test-session',timeoutMs:10000});
});
it('preserves a positive authoritative balance',async()=>{vi.mocked(request).mockResolvedValue({ok:true,data:{wallet:{balance:47}}});const r=await fetchMobileWallet('unit-test-session');expect(r.ok&&r.data.wallet.balance).toBe(47);});
it('retains the AUTH failure for the existing session-expired flow',async()=>{const error={kind:'AUTH' as const,status:401,code:'UNAUTHENTICATED',message:'Sesión vencida'};vi.mocked(request).mockResolvedValue({ok:false,error});expect(await fetchMobileWallet('expired-unit-fixture')).toEqual({ok:false,error});});
