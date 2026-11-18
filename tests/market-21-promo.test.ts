import {describe,it,expect} from 'vitest';
import {marketFixture} from './support/marketReorg';
import {addAccount} from './support/d1';
import {handle} from '../server/src/index';
import {promoCodeSql} from '../server/scripts/promo-code-sql.mjs';

async function setup(){
 const f=await marketFixture();const other=addAccount(f.db,'other_local_qa');
 f.db.sql.exec(promoCodeSql({code:'ARCANOTEST2000',reward:{type:'ARCANE_CRYSTALS',amount:2000},allowedUserId:f.account.id,maxGlobalUses:1,now:Date.now()}));
 await handle(new Request('http://qa/api/tactics/profile',{method:'POST',headers:{Authorization:'Bearer '+other.token,'Content-Type':'application/json'},body:'{}'}),f.env,f.deps);
 const otherCall=async(code='ARCANO-TEST-2000')=>{const res=await handle(new Request('http://qa/api/tactics/store/promo/redeem',{method:'POST',headers:{Authorization:'Bearer '+other.token,'Content-Type':'application/json'},body:JSON.stringify({code,userId:f.account.id})}),f.env,f.deps);return{status:res.status,body:await res.json()};};
 return {...f,other,otherCall};
}
describe('account-restricted ARCANO-TEST-2000',()=>{
 it('credits exactly 2000 server-side, once, with persistent ledger and no ownership changes',async()=>{
 const f=await setup();try{const before=(await f.call('GET','/wallet')).data.wallet.balance;
 const cards=f.db.sql.prepare('SELECT * FROM tactics_player_cards ORDER BY user_id,hero_id,card_id').all();
 const r=await f.call('POST','/store/promo/redeem',{code:'ARCANO-TEST-2000',amount:99999});expect(r.status).toBe(200);expect(r.data.wallet.balance).toBe(before+2000);expect(r.data.reward.items[0].amount).toBe(2000);
 const retry=await f.call('POST','/store/promo/redeem',{code:'arcano_test_2000'});expect(retry.status).toBe(409);expect(retry.data.error.code).toBe('ALREADY_REDEEMED');expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(before+2000);
 expect(f.db.sql.prepare("SELECT amount_delta,reason FROM tactics_wallet_ledger WHERE reason='PROMO_GRANT'").all()).toEqual([{amount_delta:2000,reason:'PROMO_GRANT'}]);expect(f.db.sql.prepare('SELECT * FROM tactics_player_cards ORDER BY user_id,hero_id,card_id').all()).toEqual(cards);
 expect(f.db.sql.prepare('SELECT COUNT(*) n FROM tactics_promo_redemptions').get()).toMatchObject({n:1});
 // A replacement session for the same account reads the same ledger and cannot redeem twice.
 const token='replacement-local-session';f.db.sql.prepare('INSERT INTO sessions(token,username,created_at,expires_at) VALUES(?,?,?,?)').run(token,'market_local_qa',Date.now(),Date.now()+3600000);
 const request=async(path:string,method='GET')=>handle(new Request('http://qa/api/tactics'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({code:'ARCANO-TEST-2000'})}:{})}),f.env,f.deps);
 const wallet=await request('/wallet');expect((await wallet.json()).wallet.balance).toBe(before+2000);expect((await request('/store/promo/redeem','POST')).status).toBe(409);
 }finally{f.db.sql.close();}});
 it('rejects another account before and after redemption without leaking recipient or reward',async()=>{
 const f=await setup();try{for(const when of [0,1]){if(when)await f.call('POST','/store/promo/redeem',{code:'ARCANO-TEST-2000'});const r=await f.otherCall();expect(r.status).toBe(404);expect(r.body.error.code).toBe('INVALID_CODE');expect(JSON.stringify(r.body)).not.toContain('allowed_user_id');}expect(f.db.sql.prepare('SELECT COUNT(*) n FROM tactics_promo_redemptions WHERE user_id=?').get(f.other.id)).toMatchObject({n:0});}finally{f.db.sql.close();}});
 it('concurrent submissions and retries yield one receipt and one credit',async()=>{
 const f=await setup();try{const before=(await f.call('GET','/wallet')).data.wallet.balance;const results=await Promise.all(Array.from({length:6},()=>f.call('POST','/store/promo/redeem',{code:'ARCANO-TEST-2000'})));expect(results.filter(r=>r.status===200)).toHaveLength(1);expect(results.filter(r=>r.status===409)).toHaveLength(5);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(before+2000);expect(f.db.sql.prepare("SELECT COUNT(*) n FROM tactics_wallet_ledger WHERE reason='PROMO_GRANT'").get()).toMatchObject({n:1});}finally{f.db.sql.close();}});
 it('SQL trigger rejects unauthorized redemption and rolls back its batch; recipient cannot be removed',async()=>{
 const f=await setup();try{const code=f.db.sql.prepare("SELECT id FROM tactics_promo_codes WHERE code='ARCANOTEST2000'").get()!;expect(()=>f.db.sql.prepare("INSERT INTO tactics_promo_redemptions(redemption_id,promo_code_id,user_id,code,status,reward_json,redeemed_at) VALUES('bad',?,?,'ARCANOTEST2000','COMPLETED','{}',1)").run(code.id as number,f.other.id)).toThrow(/not redeemable/);expect(()=>f.db.sql.exec("UPDATE tactics_promo_codes SET allowed_user_id=NULL WHERE code='ARCANOTEST2000'")).toThrow(/immutable/);expect(f.db.sql.prepare("SELECT uses FROM tactics_promo_codes WHERE code='ARCANOTEST2000'").get()).toMatchObject({uses:0});}finally{f.db.sql.close();}});
 it('admin upsert preserves a private recipient and cannot create this code without one',async()=>{
 const f=await setup();try{expect(()=>promoCodeSql({code:'ARCANOTEST2000',reward:{type:'ARCANE_CRYSTALS',amount:2000},now:1})).toThrow(/authorized account/);expect(()=>promoCodeSql({code:'INVALID',reward:{type:'ARCANE_CRYSTALS',amount:2000},allowedUserId:-1,now:1})).toThrow();const before=f.db.sql.prepare("SELECT allowed_user_id FROM tactics_promo_codes WHERE code='ARCANOTEST2000'").get();f.db.sql.exec(promoCodeSql({code:'ARCANOTEST2000',reward:{type:'ARCANE_CRYSTALS',amount:2000},allowedUserId:f.account.id,maxGlobalUses:1,active:false,now:2}));expect(f.db.sql.prepare("SELECT allowed_user_id FROM tactics_promo_codes WHERE code='ARCANOTEST2000'").get()).toEqual(before);}finally{f.db.sql.close();}});
});
